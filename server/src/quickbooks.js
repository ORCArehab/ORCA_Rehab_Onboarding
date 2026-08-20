const OAuthClient = require("intuit-oauth");
const QuickBooks = require("node-quickbooks");
const { saveTokens, loadTokens } = require("./tokenStore");

function createOAuthClient() {
  return new OAuthClient({
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    environment: process.env.QBO_ENVIRONMENT || "sandbox",
    redirectUri: process.env.QBO_REDIRECT_URI,
  });
}

function getAuthorizeUri(oauthClient) {
  return oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: "orcarehab-onboarding",
  });
}

async function handleCallback(oauthClient, callbackUrl) {
  const authResponse = await oauthClient.createToken(callbackUrl);
  const tokens = authResponse.getJson();
  const realmId = oauthClient.getToken().realmId;

  await saveTokens({ ...tokens, realmId });

  return tokens;
}

// QuickBooks access tokens expire after 1 hour, so we refresh using the
// stored refresh token before every request rather than tracking expiry.
async function refreshTokens() {
  const tokens = await loadTokens();

  if (!tokens?.refresh_token) {
    throw new Error(
      "QuickBooks is not connected yet. Visit /api/quickbooks/connect first.",
    );
  }

  const oauthClient = createOAuthClient();
  const authResponse = await oauthClient.refreshUsingToken(
    tokens.refresh_token,
  );
  const refreshedTokens = authResponse.getJson();

  await saveTokens({ ...refreshedTokens, realmId: tokens.realmId });

  return { ...refreshedTokens, realmId: tokens.realmId };
}

function buildQuickBooksClient(tokens) {
  return new QuickBooks(
    process.env.QBO_CLIENT_ID,
    process.env.QBO_CLIENT_SECRET,
    tokens.access_token,
    false,
    tokens.realmId,
    process.env.QBO_ENVIRONMENT !== "production",
    true,
    null,
    "2.0",
    tokens.refresh_token,
  );
}

async function createEmployee(employeeData) {
  const tokens = await refreshTokens();
  const qbo = buildQuickBooksClient(tokens);

  return new Promise((resolve, reject) => {
    qbo.createEmployee(employeeData, (err, employee) => {
      if (err) return reject(err);
      resolve(employee);
    });
  });
}

module.exports = {
  createOAuthClient,
  getAuthorizeUri,
  handleCallback,
  createEmployee,
};
