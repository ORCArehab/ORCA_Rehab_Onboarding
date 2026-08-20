const express = require("express");
const cors = require("cors");
const session = require("express-session");
const {
  createOAuthClient,
  getAuthorizeUri,
  handleCallback,
  createEmployee,
} = require("./quickbooks");
const { loadTokens } = require("./tokenStore");
const db = require("./db");
const { createSignedUpload, resolveUploadedFile, downloadFile, deleteFiles } = require("./storage");
const { verifyLogin, requireAuth } = require("./auth");
const { notifyNewSubmission } = require("./mailer");

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Set only when the frontend is hosted on a different domain than this API. On
// a single Vercel project everything is same-origin, so it stays unset — which
// means no CORS and a stricter cookie policy.
const CROSS_SITE = Boolean(process.env.FRONTEND_ORIGIN);

// Behind a reverse proxy (Vercel, Render, Railway), the app sees plain HTTP
// internally even though the real request was HTTPS — trust proxy so
// req.secure (and therefore secure cookies) reflect the original request.
if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

if (CROSS_SITE) {
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
}

app.use(express.json());

// Sessions live in the Supabase `session` table when DATABASE_URL is set, so an
// admin stays logged in across restarts and redeploys — and so that separate
// serverless invocations share one session. Without it we fall back to
// express-session's in-memory store, which is fine for local dev but useless
// on serverless, where each invocation may be a fresh process.
function createSessionStore() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "DATABASE_URL is not set — using an in-memory session store. Admin logins will not survive a restart, and will not work at all on serverless. Set it to your Supabase pooled connection string.",
    );
    return undefined;
  }

  const pgSession = require("connect-pg-simple")(session);

  return new pgSession({
    conObject: {
      connectionString: process.env.DATABASE_URL,
      // Supabase requires TLS but presents a cert chain Node doesn't ship a
      // root for, so verification is disabled while encryption stays on.
      ssl: { rejectUnauthorized: false },
    },
    tableName: "session",
    createTableIfMissing: false,
  });
}

app.use(
  session({
    store: createSessionStore(),
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
      // SameSite=None is only needed when the frontend is on another domain,
      // and it requires Secure (so, HTTPS). Same-origin deployments get Lax,
      // which is strictly safer.
      sameSite: IS_PRODUCTION && CROSS_SITE ? "none" : "lax",
      secure: IS_PRODUCTION,
    },
  }),
);

// Diagnostic for a fresh deployment. `path` echoes back what Express actually
// received: if this returns "/api/health" the platform is forwarding full paths
// correctly, which is what every other route depends on.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    path: req.originalUrl,
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    sessionStore: process.env.DATABASE_URL ? "postgres" : "memory",
    crossSite: CROSS_SITE,
  });
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

app.get("/api/quickbooks/status", async (req, res) => {
  try {
    res.json({ connected: Boolean(await loadTokens()) });
  } catch (error) {
    console.error("Failed to check QuickBooks connection status:", error);
    res.status(500).json({ error: "Could not check QuickBooks status." });
  }
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

// --- File uploads ---

// Hands the browser a short-lived URL it can PUT a file to directly. Files do
// not pass through this server, so Vercel's 4.5 MB body limit never applies.
// The returned signature must be echoed back at submit time.
app.post("/api/onboarding/upload-url", async (req, res) => {
  const { filename, contentType } = req.body ?? {};

  try {
    res.json(await createSignedUpload({ filename, contentType }));
  } catch (error) {
    const status = error.statusCode ?? 500;
    if (status === 500) console.error("Failed to create signed upload URL:", error);
    res.status(status).json({ error: error.message });
  }
});

// --- Onboarding submission ---
// Submissions are only ever saved here — QuickBooks is never touched
// automatically. An HR/Payroll admin has to review the submission and
// explicitly approve it (see POST /api/admin/submissions/:id/approve)
// before an employee record is created in QuickBooks.
app.post("/api/onboarding/submit", async (req, res) => {
  const { employee, bank, additional, policy, files } = req.body ?? {};

  if (!employee?.firstName || !employee?.lastName) {
    return res.status(400).json({ error: "Employee first and last name are required." });
  }

  if (!policy?.fullName || !policy?.signedAt) {
    return res
      .status(400)
      .json({ error: "The policy agreement must be signed before submitting." });
  }

  let driverLicensePath, resumePath;

  try {
    // Verify both uploads before writing anything, so a submission row can
    // never point at a file that isn't there or isn't ours to reference.
    [driverLicensePath, resumePath] = await Promise.all([
      resolveUploadedFile(files?.driverLicense, "driver's license"),
      resolveUploadedFile(files?.resume, "resume"),
    ]);
  } catch (error) {
    const status = error.statusCode ?? 500;
    if (status === 500) console.error("Failed to verify uploaded files:", error);
    return res.status(status).json({ error: error.message });
  }

  let submissionId;

  try {
    submissionId = await db.createSubmission({
      employee,
      bank,
      additional,
      policy,
      driverLicensePath,
      resumePath,
    });
  } catch (error) {
    console.error("Failed to save onboarding submission:", error);
    return res
      .status(500)
      .json({ error: "Could not save your submission. Please try again." });
  }

  try {
    await notifyNewSubmission(employee);
  } catch (error) {
    console.error("Failed to send notification email:", error);
  }

  res.json({ success: true, id: submissionId });
});

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

app.get("/api/admin/submissions", requireAuth, async (req, res) => {
  try {
    res.json(await db.listSubmissions());
  } catch (error) {
    console.error("Failed to list submissions:", error);
    res.status(500).json({ error: "Could not load submissions." });
  }
});

app.get("/api/admin/submissions/:id", requireAuth, async (req, res) => {
  try {
    const submission = await db.getSubmission(req.params.id);
    if (!submission) return res.status(404).json({ error: "Not found." });
    res.json(submission);
  } catch (error) {
    console.error(`Failed to load submission ${req.params.id}:`, error);
    res.status(500).json({ error: "Could not load this submission." });
  }
});

app.post("/api/admin/submissions/:id/approve", requireAuth, async (req, res) => {
  let submission;

  try {
    submission = await db.getSubmission(req.params.id);
  } catch (error) {
    console.error(`Failed to load submission ${req.params.id} for approval:`, error);
    return res.status(500).json({ error: "Could not load this submission." });
  }

  if (!submission) return res.status(404).json({ error: "Not found." });

  if (submission.quickbooksSynced) {
    return res.json({
      success: true,
      quickbooksEmployeeId: submission.quickbooksEmployeeId,
    });
  }

  try {
    const qboEmployee = await createEmployee(toQuickBooksEmployee(submission.employee));
    await db.markQuickBooksSynced(submission.id, qboEmployee.Id);
    res.json({ success: true, quickbooksEmployeeId: qboEmployee.Id });
  } catch (error) {
    console.error(`Failed to approve submission ${submission.id} into QuickBooks:`, error);
    res.status(502).json({ error: "Failed to create employee in QuickBooks." });
  }
});

app.delete("/api/admin/submissions/:id", requireAuth, async (req, res) => {
  try {
    const deleted = await db.deleteSubmission(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found." });

    await deleteFiles([deleted.driver_license_path, deleted.resume_path]);

    res.json({ success: true });
  } catch (error) {
    console.error(`Failed to delete submission ${req.params.id}:`, error);
    res.status(500).json({ error: "Could not delete this submission." });
  }
});

// Streams a private Storage object through the backend rather than handing out
// a bucket URL, so the file stays behind the admin login. Admin downloads are
// small enough that the 4.5 MB *response* limit is not a practical concern for
// a license photo; a very large resume PDF would need a signed download URL.
app.get("/api/admin/uploads/:filename", requireAuth, async (req, res) => {
  try {
    const file = await downloadFile(req.params.filename);
    if (!file) return res.status(404).send("Not found.");

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${req.params.filename}"`);
    // Don't let the browser second-guess the declared type and render, say, a
    // mislabelled file as HTML in the admin's own origin.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.buffer);
  } catch (error) {
    console.error(`Failed to download upload ${req.params.filename}:`, error);
    res.status(500).send("Could not load this file.");
  }
});

module.exports = app;
