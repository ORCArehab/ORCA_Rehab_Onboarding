// Decides whether a Google account that just completed SSO is allowed into
// the HR/Payroll dashboard. This is the actual access-control decision —
// Google only proves *which* Google account signed in, not that it belongs
// to HR/Payroll.
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

function requireAuth(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ error: "Not authenticated." });
}

module.exports = { isAdminEmailAllowed, requireAuth };
