const bcrypt = require("bcryptjs");

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/hash-password.js <new-password>");
  process.exit(1);
}

bcrypt.hash(password, 12).then((hash) => {
  console.log("\nPaste this into server/.env as ADMIN_PASSWORD_HASH:\n");
  console.log(hash);
  console.log();
});
