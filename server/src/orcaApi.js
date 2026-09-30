// Client for the shared ORCA API (the ORCA Careers API service), which is the
// source of truth for ORCA staff and their roles across every ORCA app.
// Roles are granted in the employee portal at /admin/people.
//
// Server-only: ORCA_API_KEY and the user tokens it issues never reach the
// browser. The user token lives only in the server-side session.

// Roles allowed into this app's HR/Payroll dashboard.
const DASHBOARD_ROLES = ["HR", "ADMIN"];

class OrcaApiError extends Error {
  constructor(status) {
    super(`ORCA API responded ${status}`);
    this.status = status;
  }
}

function isConfigured() {
  return Boolean(process.env.ORCA_API_URL?.trim() && process.env.ORCA_API_KEY?.trim());
}

async function request(path, { userToken, ...init } = {}) {
  const baseUrl = process.env.ORCA_API_URL.trim().replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${process.env.ORCA_API_KEY.trim()}`,
      ...(userToken ? { "x-orca-user-token": userToken } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new OrcaApiError(res.status);
  return res.json();
}

// Exchanges the Google ID token from a completed sign-in for the person's
// roles and a user token. The API verifies the ID token itself, including
// that it's an ORCA Workspace account.
function createSession(idToken) {
  return request("/v1/identity/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

// The person's current roles. Throws OrcaApiError(401) once they've been
// deactivated or the token has expired.
function getMe(userToken) {
  return request("/v1/identity/me", { userToken });
}

function canUseDashboard(person) {
  return Boolean(person?.active) && person.roles.some((role) => DASHBOARD_ROLES.includes(role));
}

module.exports = { OrcaApiError, isConfigured, createSession, getMe, canUseDashboard };
