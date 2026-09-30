const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const db = require("./db");
const { createSignedUpload, resolveUploadedFile, downloadFile, deleteFiles, signPath } = require("./storage");
const {
  isAdminEmailAllowed,
  isWorkspaceAccount,
  requireAuth,
  requireProviderAuth,
  signOutProvider,
} = require("./auth");
const googleAuth = require("./googleAuth");
const orcaApi = require("./orcaApi");
const { notifyNewSubmission } = require("./mailer");
const documentVerification = require("./documentVerification");
const { buildCredentialingZip } = require("./credentialingPackage");
const applicants = require("./applicants");

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

// --- Sample test fixture ---

// "Load Sample: John Doe" in the onboarding form fetches these to fill in
// the file fields with real (fake) documents, so the whole flow — upload, AI
// verification, submit — can be exercised end-to-end without hunting down
// real credentialing paperwork every time. Fixed filename allowlist, so this
// can never be used to read arbitrary files off disk.
const SAMPLE_JOHN_DOE_DIR = path.join(__dirname, "..", "sample-data", "john-doe");
const SAMPLE_JOHN_DOE_FILES = new Set([
  "driver-license.pdf",
  "resume.pdf",
  "degree-certificate.pdf",
  "board-certificate.pdf",
  "dea-certificate.pdf",
  "professional-liability.pdf",
  "state-license.pdf",
  "bls-certificate.pdf",
]);

// Dev/staging convenience only — not reachable once deployed with
// NODE_ENV=production, matching how the "Load Sample" button itself is
// already hidden in production builds (see DevNav in src/App.tsx).
if (!IS_PRODUCTION) {
  app.get("/api/dev/sample-employee/:file", (req, res) => {
    if (!SAMPLE_JOHN_DOE_FILES.has(req.params.file)) {
      return res.status(404).send("Not found.");
    }

    res.sendFile(path.join(SAMPLE_JOHN_DOE_DIR, req.params.file));
  });
}

// --- Provider accounts ---
//
// Providers open this app from Resources in the employee portal and sign in
// with their ORCA Google account (see the Google callback below); holding the
// PROVIDER role is what lets them in. Their account here keeps their
// in-progress form auto-saved. `req.session.applicantId` and the admin
// login's `req.session.isAdmin` share the same session object but are
// otherwise unrelated.

app.get("/api/applicant/login/google", (req, res) => startGoogleLogin(req, res, "provider"));

app.post("/api/applicant/logout", (req, res) => {
  if (req.session) signOutProvider(req);
  res.json({ success: true });
});

app.get("/api/applicant/session", (req, res) => {
  if (!req.session?.applicantId) return res.json({ authenticated: false });

  requireProviderAuth(req, res, async () => {
    try {
      const account = await applicants.getAccountById(req.session.applicantId);
      if (!account) return res.json({ authenticated: false });

      res.json({ authenticated: true, ...applicants.toProfile(account) });
    } catch (error) {
      console.error("Failed to check applicant session:", error);
      res.status(500).json({ error: "Could not check session." });
    }
  });
});

// Keyed the same way DOCUMENT_CHECKS/the submit route's `files` body are —
// maps the request body's file keys to the draft's path-column keys.
const DRAFT_FILE_RESOLUTION = {
  driverLicense: { pathKey: "driverLicensePath", label: "driver's license" },
  resume: { pathKey: "resumePath", label: "resume" },
  degreeCertificate: { pathKey: "degreeCertificatePath", label: "degree certificate" },
  boardCertificate: { pathKey: "boardCertificatePath", label: "board certificate" },
  deaCertificate: { pathKey: "deaCertificatePath", label: "DEA certificate" },
  professionalLiability: { pathKey: "professionalLiabilityPath", label: "professional liability document" },
  stateMedicalLicense: { pathKey: "stateMedicalLicensePath", label: "state medical license" },
  blsCertificate: { pathKey: "blsCertificatePath", label: "BLS certificate" },
  aclsCertificate: { pathKey: "aclsCertificatePath", label: "ACLS certificate" },
};

app.get("/api/applicant/draft", requireProviderAuth, async (req, res) => {
  try {
    const draft = await applicants.getDraft(req.session.applicantId);

    // Re-sign each already-uploaded path so the frontend gets back the same
    // {path, signature} shape it already works with everywhere else — a
    // fresh HMAC over a path the backend already knows is legitimate is just
    // as valid as the one issued at upload time (see storage.js).
    const files = {};
    for (const { pathKey } of Object.values(DRAFT_FILE_RESOLUTION)) {
      const value = draft.files[pathKey];
      files[pathKey] = value ? { path: value, signature: signPath(value) } : null;
    }

    res.json({ ...draft, files });
  } catch (error) {
    console.error("Failed to load draft:", error);
    res.status(500).json({ error: "Could not load your saved progress." });
  }
});

// Auto-save: called on a debounce from the frontend as the applicant fills
// out the form. Only touches the fields/files actually included in the
// request, so a partial save never clobbers other already-saved draft data.
app.post("/api/applicant/draft", requireProviderAuth, async (req, res) => {
  const { employee, files, documentVerdicts } = req.body ?? {};

  const resolvedFiles = {};

  try {
    await Promise.all(
      Object.entries(DRAFT_FILE_RESOLUTION).map(async ([key, { pathKey, label }]) => {
        if (!files || !(key in files)) return;
        resolvedFiles[pathKey] = await resolveUploadedFile(files[key], label);
      }),
    );
  } catch (error) {
    const status = error.statusCode ?? 500;
    if (status === 500) console.error("Failed to verify draft upload:", error);
    return res.status(status).json({ error: error.message });
  }

  try {
    await applicants.updateDraft(req.session.applicantId, {
      employee,
      files: resolvedFiles,
      documentVerdicts,
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to save draft:", error);
    res.status(500).json({ error: "Could not save your progress. Please try again." });
  }
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
    checkExpiration: true,
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
      checkExpiration: Boolean(check.checkExpiration),
    });

    if (check.checkExpiration && verdict.isExpired) {
      verdict.matches = false;
      verdict.reason = verdict.expirationDate
        ? `This DEA certificate expired on ${verdict.expirationDate}.`
        : "This DEA certificate appears to be expired.";
    }

    res.json(verdict);
  } catch (error) {
    console.error(`Document verification failed for ${documentType}:`, error);
    res.status(502).json({ error: "Could not verify this document right now. Please try again." });
  }
});

app.post("/api/onboarding/submit", requireProviderAuth, async (req, res) => {
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
    await applicants.markSubmitted(req.session.applicantId, submissionId);
  } catch (error) {
    // The submission itself is already saved at this point — a failure here
    // just means the account won't correctly show "already submitted" next
    // time they log in, not that anything was lost.
    console.error("Failed to mark applicant account as submitted:", error);
  }

  try {
    await notifyNewSubmission(employee);
  } catch (error) {
    console.error("Failed to send notification email:", error);
  }

  res.json({ success: true, id: submissionId });
});

// --- Google Workspace SSO ---
//
// Providers and HR/Payroll both sign in with Google through the same
// callback (one redirect URI to register with Google). `purpose` records
// which login was started, which decides the access check and where the
// browser lands afterwards.

function adminDashboardUrl() {
  return process.env.ADMIN_DASHBOARD_URL || "http://localhost:5173/admin";
}

function onboardingUrl() {
  return `${process.env.APP_URL || "http://localhost:5173"}/`;
}

// Kicks off the OAuth redirect dance — the browser navigates here directly
// (not a fetch), so this has to be a real 302 to Google, not a JSON response.
function startGoogleLogin(req, res, purpose) {
  // Rotates on every attempt and is checked again in the callback below, so
  // a callback request that didn't originate from this exact login attempt
  // (forged or replayed) is rejected before any session is granted.
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  req.session.oauthPurpose = purpose;

  try {
    res.redirect(googleAuth.buildAuthUrl(state));
  } catch (error) {
    console.error("Google OAuth is not configured:", error);
    res.status(500).send("Google sign-in is not configured on this server.");
  }
}

app.get("/api/admin/login/google", (req, res) => startGoogleLogin(req, res, "admin"));

// Exchanges the Google sign-in with the ORCA API for the person's roles and a
// user token. Returns null when the API refuses them.
async function createOrcaSession(idToken) {
  try {
    return await orcaApi.createSession(idToken);
  } catch (error) {
    if (error instanceof orcaApi.OrcaApiError && [401, 403, 409].includes(error.status)) return null;
    throw error;
  }
}

async function completeAdminLogin(req, profile) {
  if (orcaApi.isConfigured()) {
    // Roles come from the ORCA API (granted in the employee portal), which
    // re-verifies the Google sign-in itself.
    const apiSession = await createOrcaSession(profile.idToken);
    if (!apiSession || !orcaApi.canUseDashboard(apiSession.person)) return false;
    req.session.orcaApiToken = apiSession.token;
    req.session.rolesCheckedAt = Date.now();
  } else if (!isAdminEmailAllowed(profile.email)) {
    return false;
  }

  req.session.isAdmin = true;
  req.session.adminEmail = profile.email;
  return true;
}

async function completeProviderLogin(req, profile) {
  if (orcaApi.isConfigured()) {
    const apiSession = await createOrcaSession(profile.idToken);
    if (!apiSession || !orcaApi.canUseOnboarding(apiSession.person)) return false;
    req.session.providerOrcaToken = apiSession.token;
    req.session.providerRolesCheckedAt = Date.now();
  } else if (!isWorkspaceAccount(profile)) {
    return false;
  }

  req.session.applicantId = await applicants.findOrCreateAccount({
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
  });
  return true;
}

app.get("/api/admin/login/google/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const expectedState = req.session?.oauthState;
  const purpose = req.session?.oauthPurpose === "provider" ? "provider" : "admin";
  req.session.oauthState = null;
  req.session.oauthPurpose = null;

  const landingUrl = purpose === "provider" ? onboardingUrl() : adminDashboardUrl();
  const failure = (reason) => res.redirect(`${landingUrl}?login_error=${encodeURIComponent(reason)}`);

  if (oauthError) return failure("access_denied");
  if (!code || !state || state !== expectedState) return failure("invalid_request");

  try {
    const profile = await googleAuth.exchangeCodeForProfile(code);
    const signedIn =
      purpose === "provider"
        ? await completeProviderLogin(req, profile)
        : await completeAdminLogin(req, profile);

    if (!signedIn) return failure("not_authorized");
    res.redirect(landingUrl);
  } catch (error) {
    console.error(`Google ${purpose} login failed:`, error);
    failure("login_failed");
  }
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/admin/session", (req, res) => {
  if (!req.session?.isAdmin) return res.json({ authenticated: false });
  res.json({ authenticated: true, email: req.session.adminEmail });
});

// --- Admin data ---

// Every applicant account, finished or not — lets HR see who's stuck
// partway through and follow up, separate from the finished `submissions`
// list below.
app.get("/api/admin/applicants", requireAuth, async (req, res) => {
  try {
    res.json(await applicants.listAccounts());
  } catch (error) {
    console.error("Failed to list applicant accounts:", error);
    res.status(500).json({ error: "Could not load applicant accounts." });
  }
});

app.get("/api/admin/applicants/:id", requireAuth, async (req, res) => {
  try {
    const account = await applicants.getAccountDetail(req.params.id);
    if (!account) return res.status(404).json({ error: "Not found." });
    res.json(account);
  } catch (error) {
    console.error(`Failed to load applicant ${req.params.id}:`, error);
    res.status(500).json({ error: "Could not load this applicant." });
  }
});

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
