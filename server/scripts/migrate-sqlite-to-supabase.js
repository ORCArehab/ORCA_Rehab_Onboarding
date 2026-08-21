// One-shot migration: copies submissions out of the old local SQLite database
// (server/data.db) into Supabase Postgres, and any uploaded files out of
// server/uploads/ into the Supabase Storage bucket.
//
//   node scripts/migrate-sqlite-to-supabase.js            # dry run, prints a plan
//   node scripts/migrate-sqlite-to-supabase.js --commit   # actually writes
//
// `encrypted_data` is copied verbatim — the ciphertext is never opened, so
// ENCRYPTION_KEY must be unchanged for the migrated rows to stay readable.
//
// Postgres assigns fresh ids rather than carrying the SQLite ones over. Keeping
// the old ids would leave the identity sequence behind them, and the next real
// submission would fail on a duplicate primary key. Nothing references these
// ids, so renumbering costs nothing. The tradeoff is that this script is NOT
// idempotent: running it twice imports every row twice.

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getSupabase, UPLOADS_BUCKET } = require("../src/supabase");

const DB_PATH = path.join(__dirname, "..", "data.db");
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const COMMIT = process.argv.includes("--commit");

const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function readLegacyRows() {
  if (!fs.existsSync(DB_PATH)) return [];

  // better-sqlite3 is deliberately not a project dependency: it's a native
  // addon needed only by this one-off script, and keeping it out means nothing
  // has to compile during a deployment build.
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    throw new Error(
      "better-sqlite3 isn't installed — it's only needed for this migration. Install it temporarily with:\n  npm install --no-save better-sqlite3",
    );
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    return db.prepare("SELECT * FROM submissions ORDER BY id").all();
  } finally {
    db.close();
  }
}

async function migrateRows(rows) {
  // No `id` — Postgres assigns one, keeping the identity sequence consistent.
  const payload = rows.map((row) => ({
    created_at: row.created_at,
    first_name: row.first_name,
    last_name: row.last_name,
    driver_license_path: row.driver_license_path,
    resume_path: row.resume_path,
    encrypted_data: row.encrypted_data,
  }));

  const { data, error } = await getSupabase()
    .from("submissions")
    .insert(payload)
    .select("id");

  if (error) throw new Error(`Row migration failed: ${error.message}`);

  return data.map((row) => row.id);
}

async function migrateFiles() {
  if (!fs.existsSync(UPLOADS_DIR)) return { uploaded: 0, failed: 0 };

  const filenames = fs.readdirSync(UPLOADS_DIR).filter((name) => {
    return fs.statSync(path.join(UPLOADS_DIR, name)).isFile();
  });

  let uploaded = 0;
  let failed = 0;

  for (const filename of filenames) {
    const buffer = fs.readFileSync(path.join(UPLOADS_DIR, filename));
    const contentType =
      CONTENT_TYPES[path.extname(filename).toLowerCase()] || "application/octet-stream";

    const { error } = await getSupabase()
      .storage.from(UPLOADS_BUCKET)
      .upload(filename, buffer, { contentType, upsert: true });

    if (error) {
      console.error(`  ✗ ${filename} — ${error.message}`);
      failed += 1;
    } else {
      console.log(`  ✓ ${filename}`);
      uploaded += 1;
    }
  }

  return { uploaded, failed };
}

async function main() {
  const rows = readLegacyRows();
  const fileCount = fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR).length : 0;

  if (rows.length === 0 && fileCount === 0) {
    console.log("Nothing to migrate — no data.db rows and no files in uploads/.");
    return;
  }

  console.log(`Found ${rows.length} submission(s) and ${fileCount} uploaded file(s).`);
  for (const row of rows) {
    console.log(`  #${row.id}  ${row.first_name} ${row.last_name}  ${row.created_at}`);
  }

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write these to Supabase.");
    console.log("Note: this imports rows unconditionally — running it twice duplicates them.");
    return;
  }

  if (rows.length > 0) {
    console.log("\nMigrating submissions…");
    const newIds = await migrateRows(rows);
    console.log(`  ✓ ${rows.length} row(s) imported, now id(s): ${newIds.join(", ")}`);
  }

  if (fileCount > 0) {
    console.log("\nMigrating uploaded files…");
    const { uploaded, failed } = await migrateFiles();
    console.log(`  ${uploaded} uploaded, ${failed} failed.`);
  }

  console.log(
    "\nDone. Verify the dashboard at /admin, then delete server/data.db and server/uploads/.",
  );
}

main().catch((error) => {
  console.error(`\nMigration aborted: ${error.message}`);
  process.exit(1);
});
