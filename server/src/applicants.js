const { getSupabase } = require("./supabase");
const { encrypt, decrypt } = require("./crypto");

const ACCOUNTS_TABLE = "applicant_accounts";

const DRAFT_PATH_COLUMNS = {
  driverLicensePath: "draft_driver_license_path",
  resumePath: "draft_resume_path",
  degreeCertificatePath: "draft_degree_certificate_path",
  boardCertificatePath: "draft_board_certificate_path",
  deaCertificatePath: "draft_dea_certificate_path",
  professionalLiabilityPath: "draft_professional_liability_path",
  stateMedicalLicensePath: "draft_state_medical_license_path",
  blsCertificatePath: "draft_bls_certificate_path",
  aclsCertificatePath: "draft_acls_certificate_path",
};

function failed(action, error) {
  return new Error(`Failed to ${action}: ${error.message}`);
}

// Providers sign in with their ORCA Google account, so their onboarding
// account is found (or made, on first sign-in) by that account's email.
async function findOrCreateAccount({ email, firstName, lastName }) {
  const existing = await getAccountByEmail(email);
  if (existing) return existing.id;

  const { data, error } = await getSupabase()
    .from(ACCOUNTS_TABLE)
    .insert({ first_name: firstName, last_name: lastName, email })
    .select("id")
    .single();

  if (error) {
    // Postgres unique_violation: a concurrent first sign-in created it.
    if (error.code === "23505") return (await getAccountByEmail(email)).id;
    throw failed("create the account", error);
  }

  return data.id;
}

async function getAccountByEmail(email) {
  const { data, error } = await getSupabase()
    .from(ACCOUNTS_TABLE)
    .select("*")
    // Emails are stored lowercased. Not ilike: `_` and `%` in an address
    // would act as wildcards and could match someone else's account.
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (error) throw failed("look up the account", error);

  return data;
}

async function getAccountById(id) {
  const { data, error } = await getSupabase()
    .from(ACCOUNTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw failed("look up the account", error);

  return data;
}

function toProfile(row) {
  if (!row) return null;

  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    hasSubmitted: Boolean(row.submitted_at),
  };
}

async function updateDraft(accountId, { employee, files, documentVerdicts }) {
  const update = { updated_at: new Date().toISOString() };

  if (employee) {
    update.draft_data = encrypt(JSON.stringify(employee));
  }

  if (files) {
    for (const [key, column] of Object.entries(DRAFT_PATH_COLUMNS)) {
      if (files[key] !== undefined) update[column] = files[key] || null;
    }
  }

  if (documentVerdicts) {
    update.draft_document_verdicts = documentVerdicts;
  }

  const { error } = await getSupabase().from(ACCOUNTS_TABLE).update(update).eq("id", accountId);

  if (error) throw failed("save the draft", error);
}

async function getDraft(accountId) {
  const row = await getAccountById(accountId);
  if (!row) return null;

  const employee = row.draft_data ? JSON.parse(decrypt(row.draft_data)) : {};
  const files = {};

  for (const [key, column] of Object.entries(DRAFT_PATH_COLUMNS)) {
    files[key] = row[column] || null;
  }

  return {
    employee,
    files,
    documentVerdicts: row.draft_document_verdicts || {},
  };
}

// For the admin dashboard: every account, whether or not they've finished —
// so HR can see who's stuck partway through and follow up. Only the
// plaintext path columns are read here (not draft_data), so listing every
// applicant never has to decrypt anything just to render a status.
async function listAccounts() {
  const pathColumns = Object.values(DRAFT_PATH_COLUMNS);

  const { data, error } = await getSupabase()
    .from(ACCOUNTS_TABLE)
    .select(
      [
        "id",
        "first_name",
        "last_name",
        "email",
        "created_at",
        "updated_at",
        "submitted_at",
        "submission_id",
        "draft_data",
        ...pathColumns,
      ].join(", "),
    )
    .order("updated_at", { ascending: false });

  if (error) throw failed("list applicant accounts", error);

  return data.map((row) => {
    const uploadedDocumentCount = pathColumns.filter((column) => row[column]).length;

    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hasSubmitted: Boolean(row.submitted_at),
      submissionId: row.submission_id,
      // draft_data is an encrypted blob — its mere presence (not its
      // contents) is enough to know they've entered at least some info.
      hasStarted: Boolean(row.draft_data) || uploadedDocumentCount > 0,
      uploadedDocumentCount,
      totalDocumentCount: pathColumns.length,
    };
  });
}

// For the admin detail view: profile + whatever draft data exists, decrypted
// — same shape as a `submissions` row (driverLicensePath, boardCertificatePath,
// etc.), so the admin UI can reuse the exact same detail/preview components.
async function getAccountDetail(accountId) {
  const row = await getAccountById(accountId);
  if (!row) return null;

  const employee = row.draft_data ? JSON.parse(decrypt(row.draft_data)) : {};
  const files = {};

  for (const [key, column] of Object.entries(DRAFT_PATH_COLUMNS)) {
    files[key] = row[column] || null;
  }

  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasSubmitted: Boolean(row.submitted_at),
    submittedAt: row.submitted_at,
    employee,
    documentVerdicts: row.draft_document_verdicts || {},
    ...files,
  };
}

async function markSubmitted(accountId, submissionId) {
  const clearedPaths = Object.fromEntries(
    Object.values(DRAFT_PATH_COLUMNS).map((column) => [column, null]),
  );

  const { error } = await getSupabase()
    .from(ACCOUNTS_TABLE)
    .update({
      submitted_at: new Date().toISOString(),
      submission_id: submissionId,
      draft_data: null,
      draft_document_verdicts: null,
      ...clearedPaths,
    })
    .eq("id", accountId);

  if (error) throw failed("mark the account as submitted", error);
}

module.exports = {
  findOrCreateAccount,
  getAccountByEmail,
  getAccountById,
  toProfile,
  updateDraft,
  getDraft,
  listAccounts,
  getAccountDetail,
  markSubmitted,
};
