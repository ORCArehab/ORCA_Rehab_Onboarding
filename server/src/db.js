const path = require("path");
const Database = require("better-sqlite3");
const { encrypt, decrypt } = require("./crypto");

const DB_PATH = path.join(__dirname, "..", "data.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    driver_license_path TEXT,
    resume_path TEXT,
    quickbooks_employee_id TEXT,
    quickbooks_synced INTEGER NOT NULL DEFAULT 0,
    encrypted_data TEXT NOT NULL
  )
`);

function createSubmission({ employee, bank, additional, policy, driverLicensePath, resumePath }) {
  const encryptedData = encrypt(JSON.stringify({ employee, bank, additional, policy }));

  const result = db
    .prepare(
      `INSERT INTO submissions
        (created_at, first_name, last_name, driver_license_path, resume_path, quickbooks_synced, encrypted_data)
       VALUES (@created_at, @first_name, @last_name, @driver_license_path, @resume_path, 0, @encrypted_data)`,
    )
    .run({
      created_at: new Date().toISOString(),
      first_name: employee.firstName,
      last_name: employee.lastName,
      driver_license_path: driverLicensePath || null,
      resume_path: resumePath || null,
      encrypted_data: encryptedData,
    });

  return result.lastInsertRowid;
}

function markQuickBooksSynced(id, quickbooksEmployeeId) {
  db.prepare(
    "UPDATE submissions SET quickbooks_synced = 1, quickbooks_employee_id = ? WHERE id = ?",
  ).run(quickbooksEmployeeId, id);
}

function listSubmissions() {
  return db
    .prepare(
      `SELECT id, created_at, first_name, last_name, quickbooks_employee_id, quickbooks_synced
       FROM submissions ORDER BY created_at DESC`,
    )
    .all();
}

function getSubmission(id) {
  const row = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id);
  if (!row) return null;

  const decrypted = JSON.parse(decrypt(row.encrypted_data));

  return {
    id: row.id,
    createdAt: row.created_at,
    driverLicensePath: row.driver_license_path,
    resumePath: row.resume_path,
    quickbooksEmployeeId: row.quickbooks_employee_id,
    quickbooksSynced: Boolean(row.quickbooks_synced),
    ...decrypted,
  };
}

function deleteSubmission(id) {
  const row = db
    .prepare("SELECT driver_license_path, resume_path FROM submissions WHERE id = ?")
    .get(id);
  db.prepare("DELETE FROM submissions WHERE id = ?").run(id);
  return row;
}

module.exports = {
  createSubmission,
  markQuickBooksSynced,
  listSubmissions,
  getSubmission,
  deleteSubmission,
};
