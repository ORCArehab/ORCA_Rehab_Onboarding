const { OAuth2Client } = require("google-auth-library");

// Must exactly match an "Authorized redirect URI" configured on the OAuth
// client in Google Cloud Console. Reuses APP_URL (the frontend's own base
// URL, already required for the applicant password-reset email) rather than
// introducing a second "where am I hosted" variable — in dev this proxies
// through Vite to the backend same-origin, and in prod frontend/backend
// share a domain anyway.
function getRedirectUri() {
  const appUrl = process.env.APP_URL || "http://localhost:5173";
  return `${appUrl}/api/admin/login/google/callback`;
}

function getClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in the server's .env file.",
    );
  }

  return new OAuth2Client({ clientId, clientSecret, redirectUri: getRedirectUri() });
}

// `hd` just pre-selects the right Google account in the picker — it's a UX
// hint, not a security boundary. The actual access decision happens after
// the token exchange, in auth.js's isAdminEmailAllowed().
function buildAuthUrl(state) {
  const client = getClient();
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN;

  return client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
    // Spreading this in only when set — generateAuthUrl adds a literal
    // `hd=` param for an explicit `hd: undefined`, not just omitting it.
    ...(domain ? { hd: domain } : {}),
    prompt: "select_account",
  });
}

async function exchangeCodeForProfile(code) {
  const client = getClient();
  const { tokens } = await client.getToken(code);

  // Signature, issuer, audience, and expiry are all verified here against
  // Google's published keys — this is what actually proves the profile
  // below came from Google, not just the fact that a request hit our
  // callback URL.
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload?.email || !payload.email_verified) {
    throw new Error("Google did not return a verified email address.");
  }

  return {
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
    hostedDomain: payload.hd || null,
    // Passed on to the ORCA API, which verifies it independently.
    idToken: tokens.id_token,
  };
}

module.exports = { buildAuthUrl, exchangeCodeForProfile };
