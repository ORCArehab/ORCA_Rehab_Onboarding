const orcaApi = require("./orcaApi");

// How often an admin session re-checks the person's roles with the ORCA API.
// Revoking HR access in the portal locks them out of this dashboard within this.
const ROLE_RECHECK_MS = 60 * 1000;

// Fallback when the ORCA API isn't configured (local dev): decides from env
// config whether a Google account that just completed SSO is allowed into the
// HR/Payroll dashboard. With the API configured, its roles decide instead —
// see the login callback in app.js. Google only proves *which* Google account
// signed in, not that it belongs to HR/Payroll.
function isAdminEmailAllowed(email) {
  const normalized = email.toLowerCase();

  const allowedEmails = (process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (allowedEmails.length > 0) {
    return allowedEmails.includes(normalized);
  }

  // No explicit allowlist — fall back to "anyone on the company's Workspace
  // domain". Set ADMIN_ALLOWED_EMAILS in .env to restrict this to specific
  // HR/Payroll staff instead of everyone at the company.
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN;
  if (domain) {
    return normalized.endsWith(`@${domain.toLowerCase()}`);
  }

  // Neither is configured — refuse everyone rather than silently letting any
  // Google account reach submissions containing SSNs and other PII.
  return false;
}

async function requireAuth(req, res, next) {
  if (!req.session?.isAdmin) return res.status(401).json({ error: "Not authenticated." });

  // Sessions from the env-list fallback have no API token to re-check.
  const token = req.session.orcaApiToken;
  if (!token || Date.now() - (req.session.rolesCheckedAt || 0) < ROLE_RECHECK_MS) return next();

  try {
    const { person } = await orcaApi.getMe(token);
    if (!orcaApi.canUseDashboard(person)) throw new orcaApi.OrcaApiError(403);
    req.session.rolesCheckedAt = Date.now();
    next();
  } catch (error) {
    if (error instanceof orcaApi.OrcaApiError && (error.status === 401 || error.status === 403)) {
      return req.session.destroy(() => res.status(401).json({ error: "Not authenticated." }));
    }
    // This dashboard holds SSNs: if access can't be confirmed, refuse rather than assume.
    console.error("Could not confirm admin access with the ORCA API:", error.message);
    res.status(503).json({ error: "Couldn't confirm your access. Please try again shortly." });
  }
}

module.exports = { isAdminEmailAllowed, requireAuth };
