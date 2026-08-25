const crypto = require("crypto");
const path = require("path");
const { getSupabase, UPLOADS_BUCKET } = require("./supabase");

// Files never pass through this server. The browser asks for a short-lived
// signed upload URL and PUTs the file straight to Supabase Storage, which
// sidesteps Vercel's 4.5 MB request body limit entirely.
//
// The path is generated here, not by the client, so a caller can't choose
// where their file lands. But the client has to hand the path back at submit
// time, and nothing stops it returning *someone else's* path — so each issued
// path is accompanied by an HMAC that the submit handler verifies. Without it,
// a submission could be made to point at another employee's license photo.

const SIGNATURE_CONTEXT = "orcarehab:upload-path:v1";

// Raster image formats plus resume document types. Browsers report an empty
// type for some files (HEIC especially), which is allowed through rather than
// blocking a legitimate phone photo.
//
// SVG is deliberately absent. Admin downloads are served inline from the same
// origin as the app, so an SVG carrying a <script> would run with access to
// the admin's session.
const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function getSigningKey() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error(
      "SESSION_SECRET must be set — it signs the upload paths that tie a submission to its files.",
    );
  }

  return secret;
}

function signPath(storedName) {
  return crypto
    .createHmac("sha256", getSigningKey())
    .update(`${SIGNATURE_CONTEXT}:${storedName}`)
    .digest("base64url");
}

function verifyPath(storedName, signature) {
  if (typeof storedName !== "string" || typeof signature !== "string") return false;

  const expected = Buffer.from(signPath(storedName));
  const provided = Buffer.from(signature);

  // Length check first: timingSafeEqual throws on a length mismatch.
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

// Timestamp for rough ordering plus random bytes so two uploads in the same
// millisecond can't collide. The original filename is deliberately discarded —
// it's client controlled and only the extension is worth keeping.
function generateStoredName(originalName) {
  const extension = path.extname(originalName || "").toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";

  return `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExtension}`;
}

async function createSignedUpload({ filename, contentType }) {
  if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw Object.assign(new Error(`Unsupported file type: ${contentType}`), {
      statusCode: 400,
    });
  }

  const storedName = generateStoredName(filename);

  const { data, error } = await getSupabase()
    .storage.from(UPLOADS_BUCKET)
    .createSignedUploadUrl(storedName);

  if (error || !data) {
    throw new Error(`Could not create an upload URL: ${error?.message ?? "unknown error"}`);
  }

  // supabase-js has returned this both absolute and root-relative across
  // versions; normalise so the browser always gets something it can fetch.
  const uploadUrl = data.signedUrl.startsWith("http")
    ? data.signedUrl
    : new URL(data.signedUrl, process.env.SUPABASE_URL).toString();

  return { path: storedName, signature: signPath(storedName), uploadUrl };
}

// Confirms the browser actually completed its upload before we save a
// submission row that claims the file is there.
async function objectExists(storedName) {
  const { data, error } = await getSupabase()
    .storage.from(UPLOADS_BUCKET)
    .list("", { search: storedName, limit: 100 });

  if (error) throw new Error(`Could not verify uploaded file: ${error.message}`);

  return (data || []).some((entry) => entry.name === storedName);
}

// Resolves a { path, signature } pair from a submission into a storage path,
// or null when no file was attached. Throws if the pair doesn't check out.
async function resolveUploadedFile(file, label) {
  if (!file || !file.path) return null;

  if (!verifyPath(file.path, file.signature)) {
    throw Object.assign(new Error(`The ${label} upload could not be verified.`), {
      statusCode: 400,
    });
  }

  if (!(await objectExists(file.path))) {
    throw Object.assign(new Error(`The ${label} upload did not finish. Please try again.`), {
      statusCode: 400,
    });
  }

  return file.path;
}

async function downloadFile(storedName) {
  const { data, error } = await getSupabase()
    .storage.from(UPLOADS_BUCKET)
    .download(storedName);

  if (error || !data) return null;

  return {
    buffer: Buffer.from(await data.arrayBuffer()),
    contentType: data.type || "application/octet-stream",
  };
}

// Best effort: a submission being deleted shouldn't fail because its files
// were already gone from the bucket.
async function deleteFiles(storedNames) {
  const names = storedNames.filter(Boolean);
  if (names.length === 0) return;

  const { error } = await getSupabase().storage.from(UPLOADS_BUCKET).remove(names);

  if (error) {
    console.error("Failed to remove uploaded files from Supabase Storage:", error.message);
  }
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  createSignedUpload,
  resolveUploadedFile,
  downloadFile,
  deleteFiles,
  signPath,
};
