const { getSupabase } = require("./supabase");
const { encrypt, decrypt } = require("./crypto");

const TABLE = "submissions";

// Every function here is async — Supabase is a network call, where the old
// better-sqlite3 implementation was synchronous. The schema lives in
// supabase/schema.sql and is applied once by hand, not on boot.

function failed(action, error) {
  return new Error(`Failed to ${action}: ${error.message}`);
}

async function createSubmission({ employee, bank, additional, policy, driverLicensePath, resumePath }) {
  const encryptedData = encrypt(JSON.stringify({ employee, bank, additional, policy }));

  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert({
      created_at: new Date().toISOString(),
      first_name: employee.firstName,
      last_name: employee.lastName,
      driver_license_path: driverLicensePath || null,
      resume_path: resumePath || null,
      quickbooks_synced: false,
      encrypted_data: encryptedData,
    })
    .select("id")
    .single();

  if (error) throw failed("save the submission", error);

  return data.id;
}

async function markQuickBooksSynced(id, quickbooksEmployeeId) {
  const { error } = await getSupabase()
    .from(TABLE)
    .update({ quickbooks_synced: true, quickbooks_employee_id: quickbooksEmployeeId })
    .eq("id", id);

  if (error) throw failed("record the QuickBooks sync", error);
}

async function listSubmissions() {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("id, created_at, first_name, last_name, quickbooks_employee_id, quickbooks_synced")
    .order("created_at", { ascending: false });

  if (error) throw failed("list submissions", error);

  return data;
}

async function getSubmission(id) {
  const { data: row, error } = await getSupabase()
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw failed("load the submission", error);
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

// Returns the deleted row's file paths (or null if there was nothing to
// delete) so the caller can clean up the corresponding objects in Storage.
async function deleteSubmission(id) {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("id", id)
    .select("driver_license_path, resume_path")
    .maybeSingle();

  if (error) throw failed("delete the submission", error);

  return data;
}

module.exports = {
  createSubmission,
  markQuickBooksSynced,
  listSubmissions,
  getSubmission,
  deleteSubmission,
};
