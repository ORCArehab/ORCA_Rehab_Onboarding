const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const MIN_PASSWORD_LENGTH = 8;

function isValidPassword(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// The raw token goes in the reset email; only its hash is ever stored, so a
// database read alone can't be used to reset someone's password — same
// principle as the HMAC-signed upload paths in storage.js.
function generateResetToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  isValidPassword,
  hashPassword,
  verifyPassword,
  generateResetToken,
  hashToken,
};
