const { getSupabase } = require("./supabase");
const { encrypt, decrypt } = require("./crypto");

const TABLE = "submissions";

// Every function here is async — Supabase is a network call, where the old
// better-sqlite3 implementation was synchronous. The schema lives in
// supabase/schema.sql and is applied once by hand, not on boot.

function failed(action, error) {
  return new Error(`Failed to ${action}: ${error.message}`);
}

async function createSubmission({
  employee,
  documentVerdicts,
  driverLicensePath,
  resumePath,
  degreeCertificatePath,
  boardCertificatePath,
  deaCertificatePath,
  professionalLiabilityPath,
  stateMedicalLicensePath,
  blsCertificatePath,
  aclsCertificatePath,
}) {
  const encryptedData = encrypt(JSON.stringify({ employee }));

  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert({
      created_at: new Date().toISOString(),
      first_name: employee.firstName,
      last_name: employee.lastName,
      driver_license_path: driverLicensePath || null,
      resume_path: resumePath || null,
      degree_certificate_path: degreeCertificatePath || null,
      board_certificate_path: boardCertificatePath || null,
      dea_certificate_path: deaCertificatePath || null,
      professional_liability_path: professionalLiabilityPath || null,
      state_medical_license_path: stateMedicalLicensePath || null,
      bls_certificate_path: blsCertificatePath || null,
      acls_certificate_path: aclsCertificatePath || null,
      document_verdicts: documentVerdicts || null,
      encrypted_data: encryptedData,
    })
    .select("id")
    .single();

  if (error) throw failed("save the submission", error);

  return data.id;
}

async function listSubmissions() {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("id, created_at, first_name, last_name")
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
    degreeCertificatePath: row.degree_certificate_path,
    boardCertificatePath: row.board_certificate_path,
    deaCertificatePath: row.dea_certificate_path,
    professionalLiabilityPath: row.professional_liability_path,
    stateMedicalLicensePath: row.state_medical_license_path,
    blsCertificatePath: row.bls_certificate_path,
    aclsCertificatePath: row.acls_certificate_path,
    documentVerdicts: row.document_verdicts,
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
    .select(
      "driver_license_path, resume_path, degree_certificate_path, board_certificate_path, dea_certificate_path, professional_liability_path, state_medical_license_path, bls_certificate_path, acls_certificate_path",
    )
    .maybeSingle();

  if (error) throw failed("delete the submission", error);

  return data;
}

module.exports = {
  createSubmission,
  listSubmissions,
  getSubmission,
  deleteSubmission,
};
