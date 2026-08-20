// bcryptjs, not bcrypt: the latter is a native addon that has to compile for
// the deployment target, which is fragile on serverless hosts. This is pure
// JS with an identical hash/compare API and the same hash format.
const bcrypt = require("bcryptjs");

async function verifyLogin(username, password) {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!expectedUsername || !passwordHash) {
    throw new Error(
      "ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be set in the server's .env file.",
    );
  }

  if (username !== expectedUsername) return false;

  return bcrypt.compare(password, passwordHash);
}

function requireAuth(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ error: "Not authenticated." });
}

module.exports = { verifyLogin, requireAuth };
