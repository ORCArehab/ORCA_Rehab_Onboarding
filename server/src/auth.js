// TEMPORARY: admin login is disabled for local testing. verifyLogin accepts
// any username/password and requireAuth lets every request through. Restore
// the real checks (see git history) before this goes anywhere near
// production — /admin and every /api/admin/* route are wide open right now.
async function verifyLogin() {
  return true;
}

function requireAuth(req, res, next) {
  next();
}

module.exports = { verifyLogin, requireAuth };
