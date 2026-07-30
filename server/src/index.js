// Local development entrypoint: loads .env and starts a long-running server.
//
// On Vercel this file is not used — api/index.js imports the app directly and
// Vercel owns the listening socket. Anything that must apply in both places
// belongs in app.js, not here.
// Explicit path: dotenv resolves relative to the working directory, and this is
// now started from the repo root (npm run dev:server), not from server/.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const app = require("./app");

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Onboarding server listening on http://localhost:${PORT}`);
});
