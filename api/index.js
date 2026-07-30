// Vercel Function entrypoint. The whole Express app becomes one function, so
// every /api/* route is handled here (see the rewrite in vercel.json).
//
// Note the .js extension on the import: this file is ESM (the root
// package.json sets "type": "module") while the server is CommonJS (scoped by
// server/package.json). Importing CJS from ESM gives module.exports as the
// default export, and an Express app is itself a (req, res) handler — which is
// exactly the signature Vercel expects.
import app from "../server/src/app.js";

export default app;
