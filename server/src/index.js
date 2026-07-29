require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const multer = require("multer");
const {
  createOAuthClient,
  getAuthorizeUri,
  handleCallback,
  createEmployee,
} = require("./quickbooks");
const { loadTokens } = require("./tokenStore");
const db = require("./db");
const { verifyLogin, requireAuth } = require("./auth");
const { notifyNewSubmission } = require("./mailer");

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Behind a reverse proxy (Render, Railway, etc.), the app sees plain HTTP
// internally even though the real request was HTTPS — trust proxy so
// req.secure (and therefore secure cookies) reflect the original request.
if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
      // Cross-origin cookies require SameSite=None + Secure, which in turn
      // requires HTTPS — only viable in production. In local dev, the
      // frontend proxies /api requests through Vite so everything is
      // same-origin and a plain cookie works fine.
      sameSite: IS_PRODUCTION ? "none" : "lax",
      secure: IS_PRODUCTION,
    },
  }),
);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const unique = crypto.randomBytes(8).toString("hex");
      cb(null, `${Date.now()}-${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// --- QuickBooks OAuth ---

// Step 1: visit this in a browser to connect this server to your QuickBooks
// Online company. Only needs to be done once (until the refresh token expires).
app.get("/api/quickbooks/connect", (req, res) => {
  const oauthClient = createOAuthClient();
  res.redirect(getAuthorizeUri(oauthClient));
});

// Step 2: QuickBooks redirects here after the user approves access.
app.get("/api/quickbooks/callback", async (req, res) => {
  try {
    const oauthClient = createOAuthClient();
    await handleCallback(oauthClient, req.url);
    res.send("QuickBooks connected. You can close this tab.");
  } catch (error) {
    console.error("QuickBooks OAuth callback failed:", error);
    res.status(500).send("Failed to connect QuickBooks. Check server logs.");
  }
});

app.get("/api/quickbooks/status", (req, res) => {
  res.json({ connected: Boolean(loadTokens()) });
});

// Maps our onboarding form fields to the subset of the QuickBooks Online
// Employee entity that's actually writable via the public Accounting API.
// QuickBooks Online Payroll (direct deposit, W-4 withholding) is NOT covered
// by this public API — Intuit restricts payroll writes to approved partners.
function isValidBirthDate(dateOfBirth) {
  const [year] = (dateOfBirth || "").split("-");
  const currentYear = new Date().getFullYear();

  return (
    year?.length === 4 &&
    Number(year) >= currentYear - 100 &&
    Number(year) <= currentYear - 14
  );
}

function toQuickBooksEmployee(employee) {
  const qboEmployee = {
    GivenName: employee.firstName,
    FamilyName: employee.lastName,
    HiredDate: new Date().toISOString().slice(0, 10),
  };

  if (employee.ssn) qboEmployee.SSN = employee.ssn;
  if (isValidBirthDate(employee.dateOfBirth)) {
    qboEmployee.BirthDate = employee.dateOfBirth;
  } else if (employee.dateOfBirth) {
    console.warn(
      `Rejected date of birth "${employee.dateOfBirth}" for ${employee.firstName} ${employee.lastName} — not sent to QuickBooks.`,
    );
  }
  if (employee.phone) qboEmployee.PrimaryPhone = { FreeFormNumber: employee.phone };
  if (employee.address) qboEmployee.PrimaryAddr = { Line1: employee.address };

  return qboEmployee;
}

// --- Onboarding submission ---
// Submissions are only ever saved locally here — QuickBooks is never
// touched automatically. An HR/Payroll admin has to review the submission
// and explicitly approve it (see POST /api/admin/submissions/:id/approve)
// before an employee record is created in QuickBooks.
app.post(
  "/api/onboarding/submit",
  upload.fields([
    { name: "driverLicensePhoto", maxCount: 1 },
    { name: "resume", maxCount: 1 },
  ]),
  async (req, res) => {
    let employee, bank, additional, policy;

    try {
      employee = JSON.parse(req.body.employee);
      bank = JSON.parse(req.body.bank);
      additional = JSON.parse(req.body.additional);
      policy = JSON.parse(req.body.policy);
    } catch {
      return res.status(400).json({ error: "Malformed submission data." });
    }

    if (!employee?.firstName || !employee?.lastName) {
      return res
        .status(400)
        .json({ error: "Employee first and last name are required." });
    }

    if (!policy?.fullName || !policy?.signedAt) {
      return res
        .status(400)
        .json({ error: "The policy agreement must be signed before submitting." });
    }

    const driverLicenseFile = req.files?.driverLicensePhoto?.[0];
    const resumeFile = req.files?.resume?.[0];

    const submissionId = db.createSubmission({
      employee,
      bank,
      additional,
      policy,
      driverLicensePath: driverLicenseFile?.filename,
      resumePath: resumeFile?.filename,
    });

    try {
      await notifyNewSubmission(employee);
    } catch (error) {
      console.error("Failed to send notification email:", error);
    }

    res.json({ success: true, id: submissionId });
  },
);

// --- Admin auth ---

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const valid = await verifyLogin(username, password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials." });

    req.session.isAdmin = true;
    res.json({ success: true });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Login is not configured correctly." });
  }
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/admin/session", (req, res) => {
  res.json({ authenticated: Boolean(req.session?.isAdmin) });
});

// --- Admin data ---

app.get("/api/admin/submissions", requireAuth, (req, res) => {
  res.json(db.listSubmissions());
});

app.get("/api/admin/submissions/:id", requireAuth, (req, res) => {
  const submission = db.getSubmission(req.params.id);
  if (!submission) return res.status(404).json({ error: "Not found." });
  res.json(submission);
});

app.post("/api/admin/submissions/:id/approve", requireAuth, async (req, res) => {
  const submission = db.getSubmission(req.params.id);
  if (!submission) return res.status(404).json({ error: "Not found." });

  if (submission.quickbooksSynced) {
    return res.json({
      success: true,
      quickbooksEmployeeId: submission.quickbooksEmployeeId,
    });
  }

  try {
    const qboEmployee = await createEmployee(toQuickBooksEmployee(submission.employee));
    db.markQuickBooksSynced(submission.id, qboEmployee.Id);
    res.json({ success: true, quickbooksEmployeeId: qboEmployee.Id });
  } catch (error) {
    console.error(`Failed to approve submission ${submission.id} into QuickBooks:`, error);
    res.status(502).json({ error: "Failed to create employee in QuickBooks." });
  }
});

app.delete("/api/admin/submissions/:id", requireAuth, (req, res) => {
  const deleted = db.deleteSubmission(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Not found." });

  for (const filename of [deleted.driver_license_path, deleted.resume_path]) {
    if (!filename) continue;
    const filePath = path.join(UPLOADS_DIR, path.basename(filename));
    fs.rm(filePath, { force: true }, () => {});
  }

  res.json({ success: true });
});

app.get("/api/admin/uploads/:filename", requireAuth, (req, res) => {
  const filePath = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found.");
  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`Onboarding server listening on http://localhost:${PORT}`);
});
