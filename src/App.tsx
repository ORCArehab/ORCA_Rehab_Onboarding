import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import logo from "./assets/orca-logo.png";
import { API_BASE_URL } from "./apiConfig";
import { uploadFile } from "./uploads";
import type { UploadedFile } from "./uploads";
import "./App.css";

interface ApplicantProfile {
  firstName: string;
  lastName: string;
  email: string;
  hasSubmitted: boolean;
}

type ApplicantAuthStatus = "checking" | "authenticated" | "unauthenticated";

type ProviderRole = "" | "PA" | "NP" | "MD";

interface EmployeeForm {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  stateOfBirth: string;
  phone: string;
  address: string;
  ssn: string;
  providerRole: ProviderRole;
  degree: string;
  npi: string;
  caqhUsername: string;
  caqhPassword: string;
  nppesUsername: string;
  nppesPassword: string;
  pecosUsername: string;
  pecosPassword: string;
}

const initialForm: EmployeeForm = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  stateOfBirth: "",
  phone: "",
  address: "",
  ssn: "",
  providerRole: "",
  degree: "",
  npi: "",
  caqhUsername: "",
  caqhPassword: "",
  nppesUsername: "",
  nppesPassword: "",
  pecosUsername: "",
  pecosPassword: "",
};

// The 6 credentialing documents that get AI-checked live as soon as they're
// uploaded — see handleFileUpload. Keyed the same way the backend's
// DOCUMENT_CHECKS map is (server/src/app.js), since the key doubles as the
// `documentType` sent to POST /api/onboarding/verify-document.
type CheckableDocKey =
  | "degreeCertificate"
  | "boardCertificate"
  | "deaCertificate"
  | "professionalLiability"
  | "stateMedicalLicense"
  | "blsCertificate"
  | "aclsCertificate";

// Driver's license and resume upload the same way but are never AI-checked.
type UploadOnlyDocKey = "driverLicensePhoto" | "resume";

type AllDocKey = CheckableDocKey | UploadOnlyDocKey;

type DocumentStatus =
  | "uploading"
  | "checking"
  | "matches"
  | "mismatch"
  | "skipped"
  | "error"
  | "restored";

interface DocumentUpload {
  file: File;
  uploaded: UploadedFile | null;
  status: DocumentStatus;
  reason?: string;
}

type DocumentsState = Record<AllDocKey, DocumentUpload | null>;

const initialDocuments: DocumentsState = {
  driverLicensePhoto: null,
  resume: null,
  degreeCertificate: null,
  boardCertificate: null,
  deaCertificate: null,
  professionalLiability: null,
  stateMedicalLicense: null,
  blsCertificate: null,
  aclsCertificate: null,
};

const DOCUMENT_LABELS: Record<AllDocKey, string> = {
  driverLicensePhoto: "driver's license photo",
  resume: "resume",
  degreeCertificate: "degree certificate",
  boardCertificate: "board certificate",
  deaCertificate: "DEA certificate",
  professionalLiability: "professional liability document",
  stateMedicalLicense: "state medical license",
  blsCertificate: "BLS certificate",
  aclsCertificate: "ACLS certificate",
};

const CHECKABLE_DOC_KEYS: CheckableDocKey[] = [
  "degreeCertificate",
  "boardCertificate",
  "deaCertificate",
  "professionalLiability",
  "stateMedicalLicense",
  "blsCertificate",
  "aclsCertificate",
];

// ACLS is preferred but not required, so it's excluded from both the
// AI-verification progress bar and the required-upload list below.
const REQUIRED_DOCUMENT_KEYS: CheckableDocKey[] = [
  "degreeCertificate",
  "boardCertificate",
  "deaCertificate",
  "professionalLiability",
  "stateMedicalLicense",
  "blsCertificate",
];

const REQUIRED_UPLOAD_KEYS: AllDocKey[] = ["driverLicensePhoto", "resume", ...REQUIRED_DOCUMENT_KEYS];

// Wire keys the backend's /submit and /applicant/draft routes expect —
// "driverLicense", not "driverLicensePhoto".
const FILE_WIRE_KEYS: Record<AllDocKey, string> = {
  driverLicensePhoto: "driverLicense",
  resume: "resume",
  degreeCertificate: "degreeCertificate",
  boardCertificate: "boardCertificate",
  deaCertificate: "deaCertificate",
  professionalLiability: "professionalLiability",
  stateMedicalLicense: "stateMedicalLicense",
  blsCertificate: "blsCertificate",
  aclsCertificate: "aclsCertificate",
};

// Draft path-column keys the backend returns — mirrors DRAFT_FILE_RESOLUTION
// in server/src/app.js.
const DRAFT_PATH_KEYS: Record<AllDocKey, string> = {
  driverLicensePhoto: "driverLicensePath",
  resume: "resumePath",
  degreeCertificate: "degreeCertificatePath",
  boardCertificate: "boardCertificatePath",
  deaCertificate: "deaCertificatePath",
  professionalLiability: "professionalLiabilityPath",
  stateMedicalLicense: "stateMedicalLicensePath",
  blsCertificate: "blsCertificatePath",
  aclsCertificate: "aclsCertificatePath",
};

function formatSSN(value: string): string {
  const numbers = value.replace(/\D/g, "").slice(0, 9);

  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 5) {
    return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
  }

  return `${numbers.slice(0, 3)}-${numbers.slice(3, 5)}-${numbers.slice(5)}`;
}

function formatPhone(value: string): string {
  const numbers = value.replace(/\D/g, "").slice(0, 10);

  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 3)}) ${numbers.slice(3)}`;
  }

  return `(${numbers.slice(0, 3)}) ${numbers.slice(3, 6)}-${numbers.slice(6)}`;
}

function formatDigits(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function boardCertifyingBody(role: ProviderRole): string {
  switch (role) {
    case "PA":
      return "NCCPA-certified.";
    case "NP":
      return "AANPCB or ANCC-certified.";
    case "MD":
      return "ABMS Specialty Board-certified (e.g. ABIM, ABFM, ABS).";
    default:
      return "Select your provider role above first.";
  }
}

// Whatever /verify-document already returned for each document, live as it
// was uploaded — sent along at submit/draft time so HR can see it in the
// admin dashboard. Not re-checked server-side (that would just double the AI
// cost). Only the 6 AI-checkable documents get a verdict entry.
function buildDocumentVerdicts(documents: DocumentsState) {
  const verdicts: Record<string, { matches: boolean; reason: string | null }> = {};

  for (const key of CHECKABLE_DOC_KEYS) {
    const doc = documents[key];
    if (!doc || doc.status === "uploading" || doc.status === "checking") continue;

    verdicts[key] = {
      matches: doc.status === "matches" || doc.status === "skipped" || doc.status === "restored",
      reason: doc.reason ?? null,
    };
  }

  return verdicts;
}

function buildFilesPayload(documents: DocumentsState) {
  const files: Record<string, UploadedFile | null> = {};

  for (const key of Object.keys(FILE_WIRE_KEYS) as AllDocKey[]) {
    files[FILE_WIRE_KEYS[key]] = documents[key]?.uploaded ?? null;
  }

  return files;
}

function DevNav({ onLoadSample }: { onLoadSample?: () => void }) {
  if (!import.meta.env.DEV) return null;

  return (
    <div className="dev-nav">
      <span>DEV</span>
      {onLoadSample && (
        <button type="button" onClick={onLoadSample}>
          Load Sample: John Doe
        </button>
      )}
    </div>
  );
}

function SectionHeader({
  step,
  total,
  title,
  description,
}: {
  step: number;
  total: number;
  title: string;
  description?: string;
}) {
  return (
    <div className="section-header">
      <span className="section-header-step">{step}</span>
      <div className="section-header-text">
        <span className="section-header-eyebrow">
          Step {step} of {total}
        </span>
        <span className="section-header-title">{title}</span>
        {description && <span className="section-header-description">{description}</span>}
      </div>
    </div>
  );
}

function DocumentField({
  label,
  hint,
  required,
  accept = ".pdf,image/*",
  doc,
  onFileSelected,
}: {
  label: string;
  hint?: string;
  required: boolean;
  accept?: string;
  doc: DocumentUpload | null;
  onFileSelected: (file: File | null) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!doc?.file || doc.file.size === 0 || !doc.file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(doc.file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [doc]);

  const isComplete =
    doc?.status === "matches" || doc?.status === "restored" || doc?.status === "skipped";
  const isPdf =
    doc?.file.type === "application/pdf" || doc?.file.name.toLowerCase().endsWith(".pdf");

  return (
    <label className={`doc-tile${doc ? " has-file" : ""}${isComplete ? " is-complete" : ""}`}>
      <div className="doc-tile-head">
        <span className="doc-tile-label">{label}</span>
        <span className={`doc-tile-tag ${required ? "required" : "preferred"}`}>
          {required ? "Required" : "Preferred"}
        </span>
      </div>

      <input
        type="file"
        className="doc-tile-input"
        accept={accept}
        onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
      />

      <div className="doc-tile-preview">
        {previewUrl ? (
          <img src={previewUrl} alt="" />
        ) : doc ? (
          <div className="doc-tile-file-icon">{isPdf ? "PDF" : "DOC"}</div>
        ) : (
          <div className="doc-tile-empty">
            <span className="doc-tile-empty-icon" aria-hidden="true">
              ↑
            </span>
            <span>Click to upload</span>
          </div>
        )}
      </div>

      <span className="doc-tile-btn">{doc ? "Change file" : "Choose file"}</span>

      {doc && <span className="doc-tile-filename">{doc.file.name}</span>}
      {doc?.status === "uploading" && <span className="doc-status checking">Uploading…</span>}
      {doc?.status === "checking" && (
        <span className="doc-status checking">Checking document…</span>
      )}
      {doc?.status === "matches" && <span className="doc-status matches">✓ Looks correct</span>}
      {doc?.status === "restored" && (
        <span className="doc-status matches">✓ Previously uploaded</span>
      )}
      {(doc?.status === "mismatch" || doc?.status === "error") && (
        <span className="doc-status mismatch">⚠ {doc.reason}</span>
      )}

      {hint && <small className="doc-tile-hint">{hint}</small>}
      {!required && (
        <small className="doc-tile-hint">
          Preferred, but only required if your assigned facility needs it.
        </small>
      )}
    </label>
  );
}

// Google redirects back with ?login_error=<reason> when sign-in doesn't end in
// a session — see the /api/admin/login/google/callback handler in
// server/src/app.js for where each of these comes from.
const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  invalid_request: "That sign-in link expired or was already used. Please try again.",
  not_authorized:
    "Onboarding is for ORCA providers. If you're a provider, ask HR to give your account the Provider role.",
  login_failed: "Something went wrong signing you in. Please try again.",
};

function SignInPage({ error }: { error: string | null }) {
  return (
    <section className="form-card auth-card">
      <p className="eyebrow">ORCA Rehab</p>
      <h1>Provider Onboarding</h1>
      <p className="welcome-description">
        Sign in with your ORCA Google account. Your progress is saved as you go,
        so you can pick up where you left off.
      </p>

      {error && <p className="auth-error">{error}</p>}

      <button
        className="primary-button"
        type="button"
        // Full-page navigation, not a fetch — the browser has to leave the app
        // for Google's sign-in and come back.
        onClick={() => (window.location.href = `${API_BASE_URL}/api/applicant/login/google`)}
      >
        Continue with Google
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

function App() {
  const [form, setForm] = useState<EmployeeForm>(initialForm);
  const [documents, setDocuments] = useState<DocumentsState>(initialDocuments);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [applicantAuthStatus, setApplicantAuthStatus] = useState<ApplicantAuthStatus>("checking");
  const [profile, setProfile] = useState<ApplicantProfile | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Read once, then cleared from the address bar so a reload doesn't repeat it.
  const [loginError] = useState(() => {
    const reason = new URLSearchParams(window.location.search).get("login_error");
    return reason ? (LOGIN_ERROR_MESSAGES[reason] ?? LOGIN_ERROR_MESSAGES.login_failed) : null;
  });

  function applyDraft(draft: {
    employee: Partial<EmployeeForm>;
    files: Record<string, UploadedFile | null>;
    documentVerdicts: Record<string, { matches: boolean; reason: string | null }>;
  }) {
    setForm((currentForm) => ({ ...currentForm, ...draft.employee }));

    setDocuments((docs) => {
      const next = { ...docs };

      for (const key of Object.keys(DRAFT_PATH_KEYS) as AllDocKey[]) {
        const uploaded = draft.files[DRAFT_PATH_KEYS[key]];
        if (!uploaded) continue;

        const verdict = draft.documentVerdicts[key];
        next[key] = {
          file: new File([], uploaded.path.split("/").pop() || "uploaded-file"),
          uploaded,
          status: "restored",
          reason: verdict?.reason ?? undefined,
        };
      }

      return next;
    });
  }

  async function loadSessionAndDraft() {
    const sessionRes = await fetch(`${API_BASE_URL}/api/applicant/session`, {
      credentials: "include",
    });
    const sessionData = await sessionRes.json();

    if (!sessionData.authenticated) {
      setApplicantAuthStatus("unauthenticated");
      return;
    }

    const nextProfile: ApplicantProfile = {
      firstName: sessionData.firstName,
      lastName: sessionData.lastName,
      email: sessionData.email,
      hasSubmitted: sessionData.hasSubmitted,
    };
    setProfile(nextProfile);
    setApplicantAuthStatus("authenticated");

    // Pre-fill from the name on their Google account — the draft's own saved
    // values (applied below, once there's anything to apply) take
    // precedence over this if they've since edited it on the form itself.
    setForm((currentForm) => ({
      ...currentForm,
      firstName: nextProfile.firstName,
      lastName: nextProfile.lastName,
    }));

    if (nextProfile.hasSubmitted) {
      setIsSubmitted(true);
      setDraftLoaded(true);
      return;
    }

    try {
      const draftRes = await fetch(`${API_BASE_URL}/api/applicant/draft`, {
        credentials: "include",
      });
      if (draftRes.ok) applyDraft(await draftRes.json());
    } catch (error) {
      console.error("Failed to load draft:", error);
    } finally {
      setDraftLoaded(true);
    }
  }

  useEffect(() => {
    if (loginError) window.history.replaceState(null, "", window.location.pathname);

    loadSessionAndDraft().catch((error) => {
      console.error("Failed to check session:", error);
      setApplicantAuthStatus("unauthenticated");
    });
    // Only ever runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save: debounced so it doesn't fire on every keystroke. Gated on
  // draftLoaded so it can never fire before an existing draft has finished
  // loading (which would otherwise overwrite it with blank fields).
  useEffect(() => {
    if (!draftLoaded || applicantAuthStatus !== "authenticated" || profile?.hasSubmitted) return;

    const timeout = setTimeout(() => {
      fetch(`${API_BASE_URL}/api/applicant/draft`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee: form,
          files: buildFilesPayload(documents),
          documentVerdicts: buildDocumentVerdicts(documents),
        }),
      }).catch((error) => console.error("Auto-save failed:", error));
    }, 1500);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, documents, draftLoaded, applicantAuthStatus]);

  const updateField = (field: keyof EmployeeForm, value: string) => {
    setForm((currentForm) => ({
      ...currentForm,
      [field]:
        field === "ssn"
          ? formatSSN(value)
          : field === "phone"
            ? formatPhone(value)
            : field === "npi"
              ? formatDigits(value, 10)
              : value,
    }));
  };

  // Uploads a document the moment it's chosen. The 6 credentialing documents
  // also get AI-checked immediately after — this is what powers the live
  // checkmark. Driver's license/resume upload the same way but skip
  // verification (verify: false).
  const handleFileUpload =
    (key: AllDocKey, verify: boolean) => async (file: File | null) => {
      if (!file) {
        setDocuments((docs) => ({ ...docs, [key]: null }));
        return;
      }

      setDocuments((docs) => ({ ...docs, [key]: { file, uploaded: null, status: "uploading" } }));

      try {
        const uploaded = await uploadFile(file);

        if (!verify) {
          setDocuments((docs) =>
            docs[key]?.file === file ? { ...docs, [key]: { file, uploaded, status: "skipped" } } : docs,
          );
          return;
        }

        setDocuments((docs) =>
          docs[key]?.file === file
            ? { ...docs, [key]: { file, uploaded, status: "checking" } }
            : docs,
        );

        const response = await fetch(`${API_BASE_URL}/api/onboarding/verify-document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: uploaded, documentType: key }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? "Could not verify this document.");
        }

        const verdict: { matches: boolean; reason: string; skipped?: boolean } = await response.json();

        setDocuments((docs) =>
          docs[key]?.file === file
            ? {
                ...docs,
                [key]: {
                  file,
                  uploaded,
                  status: verdict.skipped ? "skipped" : verdict.matches ? "matches" : "mismatch",
                  reason: verdict.reason,
                },
              }
            : docs,
        );
      } catch (error) {
        console.error(`Failed to upload/verify ${key}:`, error);

        setDocuments((docs) =>
          docs[key]?.file === file
            ? {
                ...docs,
                [key]: {
                  file,
                  uploaded: docs[key]?.uploaded ?? null,
                  status: "error",
                  reason: "Could not upload or verify this document. Please try again.",
                },
              }
            : docs,
        );
      }
    };

  const verifiedRequiredCount = REQUIRED_DOCUMENT_KEYS.filter((key) => {
    const status = documents[key]?.status;
    return status === "matches" || status === "skipped" || status === "restored";
  }).length;

  const progressPercent = Math.round(
    (verifiedRequiredCount / REQUIRED_DOCUMENT_KEYS.length) * 100,
  );

  const handleEmployeeSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const [dobYear] = form.dateOfBirth.split("-");
    const currentYear = new Date().getFullYear();

    if (
      !dobYear ||
      dobYear.length !== 4 ||
      Number(dobYear) < currentYear - 100 ||
      Number(dobYear) > currentYear - 14
    ) {
      alert("Please enter a valid date of birth.");
      return;
    }

    if (!form.stateOfBirth.trim()) {
      alert("Please enter your state of birth.");
      return;
    }

    const ssnNumbers = form.ssn.replace(/\D/g, "");

    if (ssnNumbers.length !== 9) {
      alert("Please enter a valid 9-digit Social Security number.");
      return;
    }

    const phoneNumbers = form.phone.replace(/\D/g, "");

    if (phoneNumbers.length !== 10) {
      alert("Please enter a valid 10-digit phone number.");
      return;
    }

    if (!form.providerRole) {
      alert("Please select your provider role.");
      return;
    }

    if (form.npi.length !== 10) {
      alert("Please enter a valid 10-digit NPI.");
      return;
    }

    for (const [label, value] of [
      ["CAQH username", form.caqhUsername],
      ["CAQH password", form.caqhPassword],
      ["NPPES username", form.nppesUsername],
      ["NPPES password", form.nppesPassword],
      ["PECOS username", form.pecosUsername],
      ["PECOS password", form.pecosPassword],
    ] as const) {
      if (!value.trim()) {
        alert(`Please enter your ${label}.`);
        return;
      }
    }

    for (const key of REQUIRED_UPLOAD_KEYS) {
      const doc = documents[key];
      const label = DOCUMENT_LABELS[key];

      if (!doc) {
        alert(`Please attach your ${label}.`);
        return;
      }

      if (doc.status === "uploading" || doc.status === "checking") {
        alert(`Please wait for your ${label} to finish uploading.`);
        return;
      }

      if (doc.status === "mismatch" || doc.status === "error") {
        alert(`Please fix your ${label} before saving: ${doc.reason ?? "it doesn't look right."}`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/onboarding/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee: {
            firstName: form.firstName,
            lastName: form.lastName,
            dateOfBirth: form.dateOfBirth,
            stateOfBirth: form.stateOfBirth,
            phone: phoneNumbers,
            address: form.address,
            ssn: ssnNumbers,
            providerRole: form.providerRole,
            degree: form.degree,
            npi: form.npi,
            caqhUsername: form.caqhUsername,
            caqhPassword: form.caqhPassword,
            nppesUsername: form.nppesUsername,
            nppesPassword: form.nppesPassword,
            pecosUsername: form.pecosUsername,
            pecosPassword: form.pecosPassword,
          },
          files: buildFilesPayload(documents),
          documentVerdicts: buildDocumentVerdicts(documents),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed with status ${response.status}`);
      }

      setIsSubmitted(true);
      setProfile((current) => (current ? { ...current, hasSubmitted: true } : current));
    } catch (error) {
      console.error("Failed to save onboarding data:", error);

      if (error instanceof TypeError) {
        alert(
          "We couldn't reach the onboarding server. Please make sure it's running and try again.",
        );
      } else {
        alert(
          error instanceof Error
            ? error.message
            : "Something went wrong saving your information.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/applicant/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Failed to log out:", error);
    }

    setProfile(null);
    setApplicantAuthStatus("unauthenticated");
    setForm(initialForm);
    setDocuments(initialDocuments);
    setDraftLoaded(false);
    setIsSubmitted(false);
  };

  // Loads John Doe's fixed sample documents (server/sample-data/john-doe/)
  // through the exact same code path as picking a file by hand, so this
  // exercises the real upload + AI verification pipeline end-to-end. Faking
  // "authenticated" here (dev-only, gated by DevNav's import.meta.env.DEV
  // check) is what lets this preview the form without a real login — the
  // form itself is now reached purely by auth status, not a page value.
  const handleLoadSample = async () => {
    setApplicantAuthStatus("authenticated");
    setIsSubmitted(false);

    setForm((currentForm) => ({
      ...currentForm,
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1985-06-15",
      stateOfBirth: "California",
      phone: "5551234567",
      address: "123 Sample St, Anaheim, CA 92805",
      ssn: "123456789",
      providerRole: "MD",
      degree: "Doctor of Medicine",
      npi: "1234567890",
      caqhUsername: "johndoe_caqh",
      caqhPassword: "SamplePassword123",
      nppesUsername: "johndoe_nppes",
      nppesPassword: "SamplePassword123",
      pecosUsername: "johndoe_pecos",
      pecosPassword: "SamplePassword123",
    }));

    async function fetchSampleFile(filename: string): Promise<File> {
      const response = await fetch(`${API_BASE_URL}/api/dev/sample-employee/${filename}`);
      if (!response.ok) throw new Error(`Could not load sample file ${filename}`);
      const blob = await response.blob();
      return new File([blob], filename, { type: "application/pdf" });
    }

    // Uploads a sample file for real (exercises Supabase Storage) but skips
    // the AI check and marks it verified directly. Several of John Doe's
    // sample PDFs contain their own "this is a synthetic test document, not
    // a real DEA certificate" disclaimer text, which the AI correctly reads
    // and flags — appropriate for a real submission, but it would make this
    // one-click fixture unable to ever reach Save. This keeps the sample
    // reliably usable while being explicit in the UI that it wasn't really
    // checked.
    async function loadSampleDocument(key: AllDocKey, filename: string) {
      const file = await fetchSampleFile(filename);
      setDocuments((docs) => ({ ...docs, [key]: { file, uploaded: null, status: "uploading" } }));

      try {
        const uploaded = await uploadFile(file);
        setDocuments((docs) => ({
          ...docs,
          [key]: {
            file,
            uploaded,
            status: "matches",
            reason: "Sample document — AI verification skipped for this test fixture.",
          },
        }));
      } catch (error) {
        console.error(`Failed to upload sample ${key}:`, error);
        setDocuments((docs) => ({
          ...docs,
          [key]: { file, uploaded: null, status: "error", reason: "Could not upload this sample file." },
        }));
      }
    }

    try {
      const documentFiles: [AllDocKey, string][] = [
        ["driverLicensePhoto", "driver-license.pdf"],
        ["resume", "resume.pdf"],
        ["degreeCertificate", "degree-certificate.pdf"],
        ["boardCertificate", "board-certificate.pdf"],
        ["deaCertificate", "dea-certificate.pdf"],
        ["professionalLiability", "professional-liability.pdf"],
        ["stateMedicalLicense", "state-license.pdf"],
        ["blsCertificate", "bls-certificate.pdf"],
      ];

      await Promise.all(documentFiles.map(([key, filename]) => loadSampleDocument(key, filename)));
    } catch (error) {
      console.error("Failed to load sample employee:", error);
      alert(
        "Could not load John Doe's sample files. Make sure the backend server is running.",
      );
    }
  };

  if (applicantAuthStatus === "checking") {
    return <main className="app-shell" />;
  }

  if (applicantAuthStatus !== "authenticated") {
    return (
      <main className="app-shell">
        <DevNav onLoadSample={handleLoadSample} />
        <SignInPage error={loginError} />
      </main>
    );
  }

  if (isSubmitted) {
    return (
      <main className="app-shell">
        <DevNav onLoadSample={handleLoadSample} />
        <section className="form-card success-card">
          <div className="success-icon">✓</div>
          <p className="eyebrow">INFORMATION SAVED</p>
          <h1>Thank you, {form.firstName || profile?.firstName}.</h1>
          <p>
            Your employee information has been saved. Our team will follow up
            with the next steps of onboarding.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <DevNav onLoadSample={handleLoadSample} />
      <section className="form-card">
        <div className="page-actions">
          <button className="back-button" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </div>

        <header className="form-header">
          <img className="form-logo" src={logo} alt="ORCA Rehab" />
          <h1>Employee Information</h1>
          <p>Please enter your legal information exactly as it appears on official records.</p>
        </header>

        <form className="employee-form" onSubmit={handleEmployeeSubmit}>
          <SectionHeader
            step={1}
            total={4}
            title="Personal Information"
            description="Your legal name and contact details."
          />

          <div className="field-row field-row-3">
            <label className="form-field">
              <span>First name</span>
              <input
                type="text"
                name="firstName"
                autoComplete="given-name"
                placeholder="Enter your first name"
                value={form.firstName}
                onChange={(event) =>
                  updateField("firstName", event.target.value)
                }
                required
              />
            </label>

            <label className="form-field">
              <span>Last name</span>
              <input
                type="text"
                name="lastName"
                autoComplete="family-name"
                placeholder="Enter your last name"
                value={form.lastName}
                onChange={(event) =>
                  updateField("lastName", event.target.value)
                }
                required
              />
            </label>

            <label className="form-field">
              <span>Date of birth</span>
              <input
                type="date"
                name="dateOfBirth"
                autoComplete="bday"
                value={form.dateOfBirth}
                onChange={(event) =>
                  updateField("dateOfBirth", event.target.value)
                }
                required
              />
            </label>
          </div>

          <div className="field-row field-row-3">
            <label className="form-field">
              <span>State of birth</span>
              <input
                type="text"
                name="stateOfBirth"
                placeholder="e.g. California"
                value={form.stateOfBirth}
                onChange={(event) =>
                  updateField("stateOfBirth", event.target.value)
                }
                required
              />
            </label>

            <label className="form-field">
              <span>Phone number</span>
              <input
                type="tel"
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(555) 123-4567"
                maxLength={14}
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                required
              />
            </label>

            <label className="form-field">
              <span>Home address</span>
              <input
                type="text"
                name="address"
                autoComplete="street-address"
                placeholder="Street address, city, state, ZIP code"
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
                required
              />
            </label>
          </div>

          <label className="form-field">
            <span>Social Security number</span>
            <input
              type="password"
              name="ssn"
              inputMode="numeric"
              autoComplete="off"
              placeholder="XXX-XX-XXXX"
              maxLength={11}
              value={form.ssn}
              onChange={(event) => updateField("ssn", event.target.value)}
              required
            />

            <small>
              Your Social Security number should only be transmitted through a
              secure, encrypted connection.
            </small>
          </label>

          <SectionHeader
            step={2}
            total={4}
            title="Provider Details"
            description="Your role, degree, and National Provider Identifier."
          />

          <div className="field-row field-row-3">
            <label className="form-field">
              <span>Provider role</span>
              <select
                value={form.providerRole}
                onChange={(event) =>
                  updateField("providerRole", event.target.value)
                }
                required
              >
                <option value="" disabled>
                  Select your role
                </option>
                <option value="PA">Physician Assistant (PA)</option>
                <option value="NP">Nurse Practitioner (NP)</option>
                <option value="MD">Physician (MD)</option>
              </select>
            </label>

            <label className="form-field">
              <span>Degree</span>
              <input
                type="text"
                name="degree"
                placeholder="e.g. Master in Nursing, MD"
                value={form.degree}
                onChange={(event) => updateField("degree", event.target.value)}
                required
              />
            </label>

            <label className="form-field">
              <span>NPI</span>
              <input
                type="text"
                name="npi"
                inputMode="numeric"
                autoComplete="off"
                placeholder="10-digit National Provider Identifier"
                maxLength={10}
                value={form.npi}
                onChange={(event) => updateField("npi", event.target.value)}
                required
              />
            </label>
          </div>

          <SectionHeader
            step={3}
            total={4}
            title="Credentialing Portal Logins"
            description="Your CAQH, NPPES, and PECOS account credentials."
          />

          <div className="field-row field-row-3">
            <label className="form-field">
              <span>CAQH username</span>
              <input
                type="text"
                autoComplete="off"
                value={form.caqhUsername}
                onChange={(event) =>
                  updateField("caqhUsername", event.target.value)
                }
                required
              />
            </label>

            <label className="form-field">
              <span>NPPES username</span>
              <input
                type="text"
                autoComplete="off"
                value={form.nppesUsername}
                onChange={(event) =>
                  updateField("nppesUsername", event.target.value)
                }
                required
              />
            </label>

            <label className="form-field">
              <span>PECOS username</span>
              <input
                type="text"
                autoComplete="off"
                value={form.pecosUsername}
                onChange={(event) =>
                  updateField("pecosUsername", event.target.value)
                }
                required
              />
            </label>
          </div>

          <div className="field-row field-row-3">
            <label className="form-field">
              <span>CAQH password</span>
              <input
                type="password"
                autoComplete="off"
                value={form.caqhPassword}
                onChange={(event) =>
                  updateField("caqhPassword", event.target.value)
                }
                required
              />
            </label>

            <label className="form-field">
              <span>NPPES password</span>
              <input
                type="password"
                autoComplete="off"
                value={form.nppesPassword}
                onChange={(event) =>
                  updateField("nppesPassword", event.target.value)
                }
                required
              />
            </label>

            <label className="form-field">
              <span>PECOS password</span>
              <input
                type="password"
                autoComplete="off"
                value={form.pecosPassword}
                onChange={(event) =>
                  updateField("pecosPassword", event.target.value)
                }
                required
              />
            </label>
          </div>

          <SectionHeader
            step={4}
            total={4}
            title="Documents"
            description="Upload your credentialing paperwork — we'll verify each one as it uploads."
          />

          <div className="progress-track" aria-label="Document verification progress">
            <div className="progress-value" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="progress-label">
            {verifiedRequiredCount} of {REQUIRED_DOCUMENT_KEYS.length} documents verified
          </p>

          <div className="documents-grid">
            <DocumentField
              label="Driver's license photo"
              accept="image/*"
              required
              doc={documents.driverLicensePhoto}
              onFileSelected={handleFileUpload("driverLicensePhoto", false)}
            />

            <DocumentField
              label="Resume (CV)"
              accept=".pdf,.doc,.docx"
              required
              doc={documents.resume}
              onFileSelected={handleFileUpload("resume", false)}
            />

            <DocumentField
              label="Degree certificate / diploma"
              required
              doc={documents.degreeCertificate}
              onFileSelected={handleFileUpload("degreeCertificate", true)}
            />

            <DocumentField
              label="Board certificate"
              hint={boardCertifyingBody(form.providerRole)}
              required
              doc={documents.boardCertificate}
              onFileSelected={handleFileUpload("boardCertificate", true)}
            />

            <DocumentField
              label="DEA certificate"
              hint="We'll automatically check the expiration date printed on your certificate."
              required
              doc={documents.deaCertificate}
              onFileSelected={handleFileUpload("deaCertificate", true)}
            />
          </div>

          <div className="documents-grid">
            <DocumentField
              label="Professional liability"
              required
              doc={documents.professionalLiability}
              onFileSelected={handleFileUpload("professionalLiability", true)}
            />

            <DocumentField
              label="State medical license"
              required
              doc={documents.stateMedicalLicense}
              onFileSelected={handleFileUpload("stateMedicalLicense", true)}
            />

            <DocumentField
              label="BLS certificate"
              required
              doc={documents.blsCertificate}
              onFileSelected={handleFileUpload("blsCertificate", true)}
            />

            <DocumentField
              label="ACLS certificate"
              required={false}
              doc={documents.aclsCertificate}
              onFileSelected={handleFileUpload("aclsCertificate", true)}
            />
          </div>

          <div className="form-footer">
            <p>Fields marked required must be completed.</p>

            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default App;
