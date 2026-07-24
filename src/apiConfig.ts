// In dev, an empty string resolves to relative paths (e.g. "/api/..."),
// which Vite's dev server proxies to the local backend — this keeps
// requests same-origin so session cookies work without needing HTTPS.
// In production, set VITE_API_URL to the deployed backend's URL.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";
