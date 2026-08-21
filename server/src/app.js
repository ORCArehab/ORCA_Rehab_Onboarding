const express = require("express");
const cors = require("cors");
const session = require("express-session");
const db = require("./db");
const { createSignedUpload, resolveUploadedFile, downloadFile, deleteFiles } = require("./storage");
const { verifyLogin, requireAuth } = require("./auth");
const { notifyNewSubmission } = require("./mailer");
const documentVerification = require("./documentVerification");
const { buildCredentialingZip } = require("./credentialingPackage");

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

// The credentialing documents that get AI-verified against what they're
// supposed to be — driver's license and resume are excluded since there's no
// meaningful "wrong document" case for those the way there is for, say,
// someone attaching their driver's license photo as a DEA certificate. Keyed
// by the same name the frontend uses for that file in the `files` object of
// both /verify-document and /submit.
const DOCUMENT_CHECKS = {
  degreeCertificate: {
    pathKey: "degreeCertificatePath",
    label: "degree certificate",
    expectedDescription: "a diploma or degree certificate confirming completion of a degree program",
  },
  boardCertificate: {
    pathKey: "boardCertificatePath",
    label: "board certificate",
    expectedDescription:
      "a professional board certification document — e.g. an NCCPA certificate (for a PA), an AANPCB or ANCC certificate (for an NP), or an ABMS specialty board certificate such as ABIM, ABFM, or ABS (for an MD)",
  },
  deaCertificate: {
    pathKey: "deaCertificatePath",
    label: "DEA certificate",
    expectedDescription: "a DEA (Drug Enforcement Administration) registration certificate",
  },
  professionalLiability: {
    pathKey: "professionalLiabilityPath",
    label: "professional liability document",
    expectedDescription: "a professional liability (malpractice) insurance certificate or proof of coverage",
  },
  stateMedicalLicense: {
    pathKey: "stateMedicalLicensePath",
    label: "state medical license",
    expectedDescription: "a state-issued medical/professional license for a PA, NP, or MD",
  },
  blsCertificate: {
    pathKey: "blsCertificatePath",
    label: "BLS certificate",
    expectedDescription: "a Basic Life Support (BLS) certification card or certificate",
  },
  aclsCertificate: {
    pathKey: "aclsCertificatePath",
    label: "ACLS certificate",
    expectedDescription: "an Advanced Cardiovascular Life Support (ACLS) certification card or certificate",
  },
};

// AI verification only works on what the model can actually read.
function isVerifiableContentType(contentType) {
  return contentType === "application/pdf" || contentType?.startsWith("image/");
}

// Checks a single uploaded document against what it's supposed to be, right
// after the browser uploads it — this is what powers the live checkmark next
// to each document field. Verification is best-effort: if it isn't configured,
// or the model can't read this file type, the document is treated as passing
// rather than blocking the new hire.
app.post("/api/onboarding/verify-document", async (req, res) => {
  const { file, documentType } = req.body ?? {};
  const check = DOCUMENT_CHECKS[documentType];

  if (!check) {
    return res.status(400).json({ error: "Unknown document type." });
  }

  let path;

  try {
    path = await resolveUploadedFile(file, check.label);
  } catch (error) {
    const status = error.statusCode ?? 500;
    if (status === 500) console.error("Failed to verify uploaded file:", error);
    return res.status(status).json({ error: error.message });
  }

  if (!path) {
    return res.status(400).json({ error: "No file was uploaded." });
  }

  if (!documentVerification.isConfigured()) {
    return res.json({ skipped: true, matches: true, reason: "Document verification is not configured." });
  }

  try {
    const downloaded = await downloadFile(path);

    if (!downloaded || !isVerifiableContentType(downloaded.contentType)) {
      return res.json({
        skipped: true,
        matches: true,
        reason: "This file type can't be automatically verified.",
      });
    }

    const verdict = await documentVerification.verifyDocument({
      buffer: downloaded.buffer,
      contentType: downloaded.contentType,
      filename: path,
      expectedDescription: check.expectedDescription,
    });

    res.json(verdict);
  } catch (error) {
    console.error(`Document verification failed for ${documentType}:`, error);
    res.status(502).json({ error: "Could not verify this document right now. Please try again." });
  }
});

app.post("/api/onboarding/submit", async (req, res) => {
  const { employee, files, documentVerdicts } = req.body ?? {};

  if (!employee?.firstName || !employee?.lastName) {
    return res.status(400).json({ error: "Employee first and last name are required." });
  }

  let driverLicensePath,
    resumePath,
    degreeCertificatePath,
    boardCertificatePath,
    deaCertificatePath,
    professionalLiabilityPath,
    stateMedicalLicensePath,
    blsCertificatePath,
    aclsCertificatePath;

  try {
    // Verify every upload before writing anything, so a submission row can
    // never point at a file that isn't there or isn't ours to reference.
    [
      driverLicensePath,
      resumePath,
      degreeCertificatePath,
      boardCertificatePath,
      deaCertificatePath,
      professionalLiabilityPath,
      stateMedicalLicensePath,
      blsCertificatePath,
      aclsCertificatePath,
    ] = await Promise.all([
      resolveUploadedFile(files?.driverLicense, "driver's license"),
      resolveUploadedFile(files?.resume, "resume"),
      resolveUploadedFile(files?.degreeCertificate, "degree certificate"),
      resolveUploadedFile(files?.boardCertificate, "board certificate"),
      resolveUploadedFile(files?.deaCertificate, "DEA certificate"),
      resolveUploadedFile(files?.professionalLiability, "professional liability document"),
      resolveUploadedFile(files?.stateMedicalLicense, "state medical license"),
      resolveUploadedFile(files?.blsCertificate, "BLS certificate"),
      resolveUploadedFile(files?.aclsCertificate, "ACLS certificate"),
    ]);
  } catch (error) {
    const status = error.statusCode ?? 500;
    if (status === 500) console.error("Failed to verify uploaded files:", error);
    return res.status(status).json({ error: error.message });
  }

  const paths = {
    driverLicensePath,
    resumePath,
    degreeCertificatePath,
    boardCertificatePath,
    deaCertificatePath,
    professionalLiabilityPath,
    stateMedicalLicensePath,
    blsCertificatePath,
    aclsCertificatePath,
  };

  let submissionId;

  try {
    // documentVerdicts is whatever /verify-document already returned to the
    // browser for each file, live as it was uploaded — not re-checked here.
    // Re-running the AI check at submit time would just double the cost for
    // no benefit, since resolveUploadedFile above already confirms these are
    // genuinely files this session uploaded.
    submissionId = await db.createSubmission({
      employee,
      documentVerdicts,
      ...paths,
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

// Packages every uploaded credentialing document (plus two generated PDFs for
// the login-info and identity fields) into a single ZIP, matching ORCA's
// existing manual folder-naming convention — see credentialingPackage.js.
app.get("/api/admin/submissions/:id/download", requireAuth, async (req, res) => {
  try {
    const submission = await db.getSubmission(req.params.id);
    if (!submission) return res.status(404).json({ error: "Not found." });

    const { buffer, filename } = await buildCredentialingZip(submission);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error(`Failed to build credentialing package for submission ${req.params.id}:`, error);
    res.status(500).json({ error: "Could not build the credentialing document package." });
  }
});

app.delete("/api/admin/submissions/:id", requireAuth, async (req, res) => {
  try {
    const deleted = await db.deleteSubmission(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found." });

    await deleteFiles([
      deleted.driver_license_path,
      deleted.resume_path,
      deleted.degree_certificate_path,
      deleted.board_certificate_path,
      deleted.dea_certificate_path,
      deleted.professional_liability_path,
      deleted.state_medical_license_path,
      deleted.bls_certificate_path,
      deleted.acls_certificate_path,
    ]);

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
