import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import logo from "./assets/orca-logo.png";
import { API_BASE_URL } from "./apiConfig";
import { uploadFile } from "./uploads";
import type { UploadedFile } from "./uploads";
import "./App.css";

type Page = "welcome" | "auth" | "forgot-password" | "reset-password" | "employee-info";

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

const DEV_PAGES: { label: string; page: Page; submitted?: boolean }[] = [
  { label: "Welcome", page: "welcome" },
  { label: "Employee info", page: "employee-info" },
  { label: "Success", page: "employee-info", submitted: true },
];

function DevNav({
  onNavigate,
  onLoadSample,
}: {
  onNavigate: (page: Page, submitted: boolean) => void;
  onLoadSample?: () => void;
}) {
  if (!import.meta.env.DEV) return null;

  return (
    <div className="dev-nav">
      <span>DEV</span>
      {DEV_PAGES.map(({ label, page, submitted }) => (
        <button
          key={label}
          type="button"
          onClick={() => onNavigate(page, Boolean(submitted))}
        >
          {label}
        </button>
      ))}
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

function AuthPage({
  mode,
  onModeChange,
  onSubmit,
  onForgotPassword,
  isSubmitting,
  error,
}: {
  mode: "login" | "signup";
  onModeChange: (mode: "login" | "signup") => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onForgotPassword: () => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  return (
    <section className="form-card auth-card">
      <p className="eyebrow">ORCA Rehab</p>
      <h1>{mode === "login" ? "Log In" : "Create Your Account"}</h1>
      <p className="welcome-description">
        {mode === "login"
          ? "Log in to continue your onboarding where you left off."
          : "Your progress is saved automatically as you go, so you can pick up where you left off."}
      </p>

      <form className="employee-form" onSubmit={onSubmit}>
        {mode === "signup" && (
          <div className="field-row">
            <label className="form-field">
              <span>First name</span>
              <input type="text" name="firstName" autoComplete="given-name" required />
            </label>
            <label className="form-field">
              <span>Last name</span>
              <input type="text" name="lastName" autoComplete="family-name" required />
            </label>
          </div>
        )}

        <label className="form-field">
          <span>Email</span>
          <input type="email" name="email" autoComplete="email" required />
        </label>

        <label className="form-field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
          {mode === "signup" && <small>At least 8 characters.</small>}
        </label>

        {mode === "login" && (
          <button type="button" className="link-button" onClick={onForgotPassword}>
            Forgot password?
          </button>
        )}

        {error && <p className="auth-error">{error}</p>}

        <div className="form-footer">
          <button
            type="button"
            className="back-button"
            onClick={() => onModeChange(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
          </button>

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </section>
  );
}

function ForgotPasswordPage({
  onSubmit,
  onBack,
  isSubmitting,
  submitted,
}: {
  onSubmit: (email: string) => void;
  onBack: () => void;
  isSubmitting: boolean;
  submitted: boolean;
}) {
  return (
    <section className="form-card auth-card">
      <p className="eyebrow">ORCA Rehab</p>
      <h1>Reset Your Password</h1>

      {submitted ? (
        <>
          <p className="welcome-description">
            If an account exists for that email, we've sent a link to reset your
            password. Check your inbox (and spam folder).
          </p>
          <button className="primary-button" type="button" onClick={onBack}>
            Back to log in
            <span aria-hidden="true">→</span>
          </button>
        </>
      ) : (
        <form
          className="employee-form"
          onSubmit={(event) => {
            event.preventDefault();
            const email = String(new FormData(event.currentTarget).get("email") ?? "");
            onSubmit(email);
          }}
        >
          <label className="form-field">
            <span>Email</span>
            <input type="email" name="email" autoComplete="email" required />
          </label>

          <div className="form-footer">
            <button type="button" className="back-button" onClick={onBack}>
              ← Back to log in
            </button>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Sending…" : "Send reset link"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ResetPasswordPage({
  onSubmit,
  isSubmitting,
  error,
  success,
}: {
  onSubmit: (newPassword: string) => void;
  isSubmitting: boolean;
  error: string | null;
  success: boolean;
}) {
  return (
    <section className="form-card auth-card">
      <p className="eyebrow">ORCA Rehab</p>
      <h1>Set a New Password</h1>

      {success ? (
        <p className="welcome-description">
          Your password has been reset. You can now log in with your new password.
        </p>
      ) : (
        <form
          className="employee-form"
          onSubmit={(event) => {
            event.preventDefault();
            const newPassword = String(new FormData(event.currentTarget).get("newPassword") ?? "");
            onSubmit(newPassword);
          }}
        >
          <label className="form-field">
            <span>New password</span>
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <small>At least 8 characters.</small>
          </label>

          {error && <p className="auth-error">{error}</p>}

          <div className="form-footer">
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Set new password"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function App() {
  const [page, setPage] = useState<Page>("welcome");
  const [form, setForm] = useState<EmployeeForm>(initialForm);
  const [documents, setDocuments] = useState<DocumentsState>(initialDocuments);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [applicantAuthStatus, setApplicantAuthStatus] = useState<ApplicantAuthStatus>("checking");
  const [profile, setProfile] = useState<ApplicantProfile | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [forgotPasswordSubmitting, setForgotPasswordSubmitting] = useState(false);
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false);

  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

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

    // Pre-fill from the name they signed up with — the draft's own saved
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
      setPage("employee-info");
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
      setPage("employee-info");
    }
  }

  // On mount: a password-reset link takes priority over the normal session
  // check — someone can click a reset link while still logged in elsewhere.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("reset-token");

    if (token) {
      setResetToken(token);
      setPage("reset-password");
      setApplicantAuthStatus("unauthenticated");
      return;
    }

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
        alert(`Please fix your ${label} before submitting: ${doc.reason ?? "it doesn't look right."}`);
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
        throw new Error(body?.error ?? `Submission failed with status ${response.status}`);
      }

      setIsSubmitted(true);
      setProfile((current) => (current ? { ...current, hasSubmitted: true } : current));
    } catch (error) {
      console.error("Failed to submit onboarding data:", error);

      if (error instanceof TypeError) {
        alert(
          "We couldn't reach the onboarding server. Please make sure it's running and try again.",
        );
      } else {
        alert(
          error instanceof Error
            ? error.message
            : "Something went wrong submitting your information.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDevNavigate = (targetPage: Page, submitted: boolean) => {
    setPage(targetPage);
    setIsSubmitted(submitted);
  };

  const handleAuthSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      const endpoint = authMode === "signup" ? "signup" : "login";
      const body =
        authMode === "signup"
          ? {
              firstName: String(formData.get("firstName") ?? ""),
              lastName: String(formData.get("lastName") ?? ""),
              email,
              password,
            }
          : { email, password };

      const response = await fetch(`${API_BASE_URL}/api/applicant/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const responseBody = await response.json().catch(() => null);
        throw new Error(responseBody?.error ?? "Something went wrong. Please try again.");
      }

      await loadSessionAndDraft();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleForgotPasswordSubmit = async (email: string) => {
    setForgotPasswordSubmitting(true);

    try {
      await fetch(`${API_BASE_URL}/api/applicant/forgot-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch (error) {
      console.error("Failed to request password reset:", error);
    } finally {
      setForgotPasswordSubmitting(false);
      setForgotPasswordSent(true);
    }
  };

  const handleResetPasswordSubmit = async (newPassword: string) => {
    setResetError(null);
    setResetSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/applicant/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Could not reset your password.");
      }

      setResetSuccess(true);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setResetSubmitting(false);
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
    setPage("welcome");
  };

  // Loads John Doe's fixed sample documents (server/sample-data/john-doe/)
  // through the exact same code path as picking a file by hand, so this
  // exercises the real upload + AI verification pipeline end-to-end.
  const handleLoadSample = async () => {
    setPage("employee-info");
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
    // one-click fixture unable to ever reach Submit. This keeps the sample
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

  if (page === "welcome") {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} onLoadSample={handleLoadSample} />
        <section className="welcome-card">
          <img
            className="welcome-logo"
            src={logo}
            alt="ORCA Rehab"
          />

          <div className="welcome-content">
            <p className="eyebrow">NEW EMPLOYEE PORTAL</p>

            <h1>
              Welcome to <span>ORCA Rehab</span>
            </h1>

            <p className="welcome-description">
              We’re excited to have you join our team. This secure onboarding
              portal will guide you through the information needed to get
              started.
            </p>

            <button
              className="primary-button"
              type="button"
              disabled={applicantAuthStatus === "checking"}
              onClick={() =>
                setPage(applicantAuthStatus === "authenticated" ? "employee-info" : "auth")
              }
            >
              Continue
              <span aria-hidden="true">→</span>
            </button>

            <p className="security-message">
              Your information is kept private and secure.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (page === "auth") {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} onLoadSample={handleLoadSample} />
        <AuthPage
          mode={authMode}
          onModeChange={(mode) => {
            setAuthMode(mode);
            setAuthError(null);
          }}
          onSubmit={handleAuthSubmit}
          onForgotPassword={() => {
            setForgotPasswordSent(false);
            setPage("forgot-password");
          }}
          isSubmitting={authSubmitting}
          error={authError}
        />
      </main>
    );
  }

  if (page === "forgot-password") {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} onLoadSample={handleLoadSample} />
        <ForgotPasswordPage
          onSubmit={handleForgotPasswordSubmit}
          onBack={() => {
            setAuthMode("login");
            setPage("auth");
          }}
          isSubmitting={forgotPasswordSubmitting}
          submitted={forgotPasswordSent}
        />
      </main>
    );
  }

  if (page === "reset-password") {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} onLoadSample={handleLoadSample} />
        <ResetPasswordPage
          onSubmit={handleResetPasswordSubmit}
          isSubmitting={resetSubmitting}
          error={resetError}
          success={resetSuccess}
        />
      </main>
    );
  }

  if (isSubmitted) {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} onLoadSample={handleLoadSample} />
        <section className="form-card success-card">
          <div className="success-icon">✓</div>
          <p className="eyebrow">INFORMATION RECEIVED</p>
          <h1>Thank you, {form.firstName || profile?.firstName}.</h1>
          <p>
            Your employee information has been submitted. Our team will
            follow up with the next steps of onboarding.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <DevNav onNavigate={handleDevNavigate} onLoadSample={handleLoadSample} />
      <section className="form-card">
        <div className="page-actions">
          <button
            className="back-button"
            type="button"
            onClick={() => setPage("welcome")}
          >
            ← Back
          </button>

          {applicantAuthStatus === "authenticated" && (
            <button className="back-button" type="button" onClick={handleLogout}>
              Sign out
            </button>
          )}
        </div>

        <header className="form-header">
          <img className="form-logo" src={logo} alt="ORCA Rehab" />

          <div>
            <h1>Employee Information</h1>
            <p>Please enter your legal information exactly as it appears on official records.</p>
          </div>
        </header>

        <form className="employee-form" onSubmit={handleEmployeeSubmit}>
          <SectionHeader
            step={1}
            total={4}
            title="Personal Information"
            description="Your legal name and contact details."
          />

          <div className="field-row">
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
          </div>

          <div className="field-row">
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
          </div>

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

          <div className="field-row">
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
          </div>

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

          <SectionHeader
            step={3}
            total={4}
            title="Credentialing Portal Logins"
            description="Your CAQH, NPPES, and PECOS account credentials."
          />

          <div className="field-row">
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
          </div>

          <div className="field-row">
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
          </div>

          <div className="field-row">
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
              {isSubmitting ? "Submitting…" : "Submit"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default App;
