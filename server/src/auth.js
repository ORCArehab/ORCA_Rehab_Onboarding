const orcaApi = require("./orcaApi");

// How often a signed-in session re-checks the person's roles with the ORCA API.
// Revoking a role in the portal locks them out of this app within this.
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

// Fallback when the ORCA API isn't configured: anyone on the company's
// Workspace domain may fill out the onboarding form. With the API configured,
// only people holding the PROVIDER role can.
function isWorkspaceAccount({ email, hostedDomain }) {
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase();
  // Not configured — refuse everyone rather than admit any Google account.
  if (!domain) return false;
  return email.toLowerCase().endsWith(`@${domain}`) && hostedDomain?.toLowerCase() === domain;
}

// Middleware that lets a signed-in session through, re-checking its roles with
// the ORCA API at most once per ROLE_RECHECK_MS. Sessions from the env-config
// fallback have no API token and are let through as-is.
function roleGuard({ isSignedIn, tokenKey, checkedAtKey, isAllowed, signOut }) {
  return async (req, res, next) => {
    if (!isSignedIn(req)) return res.status(401).json({ error: "Not authenticated." });

    const token = req.session[tokenKey];
    if (!token || Date.now() - (req.session[checkedAtKey] || 0) < ROLE_RECHECK_MS) return next();

    try {
      const { person } = await orcaApi.getMe(token);
      if (!isAllowed(person)) throw new orcaApi.OrcaApiError(403);
      req.session[checkedAtKey] = Date.now();
      next();
    } catch (error) {
      if (error instanceof orcaApi.OrcaApiError && (error.status === 401 || error.status === 403)) {
        return signOut(req, () => res.status(401).json({ error: "Not authenticated." }));
      }
      // Both sides of this app hold SSNs: if access can't be confirmed, refuse rather than assume.
      console.error("Could not confirm access with the ORCA API:", error.message);
      res.status(503).json({ error: "Couldn't confirm your access. Please try again shortly." });
    }
  };
}

// HR/Payroll dashboard.
const requireAuth = roleGuard({
  isSignedIn: (req) => Boolean(req.session?.isAdmin),
  tokenKey: "orcaApiToken",
  checkedAtKey: "rolesCheckedAt",
  isAllowed: orcaApi.canUseDashboard,
  signOut: (req, done) => req.session.destroy(done),
});

// Providers filling out their own onboarding form. Signing out here leaves an
// HR/Payroll login in the same browser untouched.
const requireProviderAuth = roleGuard({
  isSignedIn: (req) => Boolean(req.session?.applicantId),
  tokenKey: "providerOrcaToken",
  checkedAtKey: "providerRolesCheckedAt",
  isAllowed: orcaApi.canUseOnboarding,
  signOut: (req, done) => {
    signOutProvider(req);
    done();
  },
});

function signOutProvider(req) {
  req.session.applicantId = null;
  req.session.providerOrcaToken = null;
  req.session.providerRolesCheckedAt = null;
}

module.exports = {
  isAdminEmailAllowed,
  isWorkspaceAccount,
  requireAuth,
  requireProviderAuth,
  signOutProvider,
};
