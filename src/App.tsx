import { useEffect, useState } from "react";
import type { ChangeEvent, SubmitEvent } from "react";
import logo from "./assets/orca-logo.png";
import { API_BASE_URL } from "./apiConfig";
import { uploadFile } from "./uploads";
import type { UploadedFile } from "./uploads";
import "./App.css";

type Page = "welcome" | "employee-info";

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
  deaExpiration: string;
  caqhUsername: string;
  caqhPassword: string;
  nppesUsername: string;
  nppesPassword: string;
  pecosUsername: string;
  pecosPassword: string;
  driverLicensePhoto: File | null;
  resume: File | null;
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
  deaExpiration: "",
  caqhUsername: "",
  caqhPassword: "",
  nppesUsername: "",
  nppesPassword: "",
  pecosUsername: "",
  pecosPassword: "",
  driverLicensePhoto: null,
  resume: null,
};

// The 7 credentialing documents that get AI-checked, live, as soon as they're
// uploaded — see handleDocumentFileChange. Keyed the same way the backend's
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

type DocumentStatus = "uploading" | "checking" | "matches" | "mismatch" | "skipped" | "error";

interface DocumentUpload {
  file: File;
  uploaded: UploadedFile | null;
  status: DocumentStatus;
  reason?: string;
}

type DocumentsState = Record<CheckableDocKey, DocumentUpload | null>;

const initialDocuments: DocumentsState = {
  degreeCertificate: null,
  boardCertificate: null,
  deaCertificate: null,
  professionalLiability: null,
  stateMedicalLicense: null,
  blsCertificate: null,
  aclsCertificate: null,
};

const DOCUMENT_LABELS: Record<CheckableDocKey, string> = {
  degreeCertificate: "degree certificate",
  boardCertificate: "board certificate",
  deaCertificate: "DEA certificate",
  professionalLiability: "professional liability document",
  stateMedicalLicense: "state medical license",
  blsCertificate: "BLS certificate",
  aclsCertificate: "ACLS certificate",
};

// ACLS is preferred but not required, so it's excluded from both the
// required-field validation and the progress bar's denominator.
const REQUIRED_DOCUMENT_KEYS: CheckableDocKey[] = [
  "degreeCertificate",
  "boardCertificate",
  "deaCertificate",
  "professionalLiability",
  "stateMedicalLicense",
  "blsCertificate",
];

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
// was uploaded — sent along at submit time so HR can see it in the admin
// dashboard. Not re-checked server-side (that would just double the AI cost).
function buildDocumentVerdicts(documents: DocumentsState) {
  const verdicts: Record<string, { matches: boolean; reason: string | null }> = {};

  for (const key of Object.keys(documents) as CheckableDocKey[]) {
    const doc = documents[key];
    if (!doc || doc.status === "uploading" || doc.status === "checking") continue;

    verdicts[key] = {
      matches: doc.status === "matches" || doc.status === "skipped",
      reason: doc.reason ?? null,
    };
  }

  return verdicts;
}

const DEV_PAGES: { label: string; page: Page; submitted?: boolean }[] = [
  { label: "Welcome", page: "welcome" },
  { label: "Employee info", page: "employee-info" },
  { label: "Success", page: "employee-info", submitted: true },
];

function DevNav({
  onNavigate,
}: {
  onNavigate: (page: Page, submitted: boolean) => void;
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
    </div>
  );
}

function DocumentField({
  label,
  hint,
  required,
  doc,
  onFileSelected,
}: {
  label: string;
  hint?: string;
  required: boolean;
  doc: DocumentUpload | null;
  onFileSelected: (file: File | null) => void;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        type="file"
        accept=".pdf,image/*"
        onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
        required={required}
      />

      {hint && <small>{hint}</small>}
      {!required && (
        <small>Preferred, but only required if your assigned facility needs it.</small>
      )}

      {doc && <small className="file-name">{doc.file.name}</small>}
      {doc?.status === "uploading" && (
        <small className="doc-status checking">Uploading…</small>
      )}
      {doc?.status === "checking" && (
        <small className="doc-status checking">Checking document…</small>
      )}
      {doc?.status === "matches" && (
        <small className="doc-status matches">✓ Looks correct</small>
      )}
      {(doc?.status === "mismatch" || doc?.status === "error") && (
        <small className="doc-status mismatch">⚠ {doc.reason}</small>
      )}
    </label>
  );
}

function App() {
  const [page, setPage] = useState<Page>("welcome");
  const [form, setForm] = useState<EmployeeForm>(initialForm);
  const [documents, setDocuments] = useState<DocumentsState>(initialDocuments);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [licensePreview, setLicensePreview] = useState<string | null>(null);

  useEffect(() => {
    if (!form.driverLicensePhoto) {
      setLicensePreview(null);
      return;
    }

    const url = URL.createObjectURL(form.driverLicensePhoto);
    setLicensePreview(url);

    return () => URL.revokeObjectURL(url);
  }, [form.driverLicensePhoto]);

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

  const handleFileChange =
    (field: "driverLicensePhoto" | "resume") => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setForm((currentForm) => ({ ...currentForm, [field]: file }));
    };

  // Uploads a credentialing document the moment it's chosen, then immediately
  // asks the backend to AI-check it — this is what powers the live checkmark.
  const handleDocumentFileChange = (key: CheckableDocKey) => async (file: File | null) => {
    if (!file) {
      setDocuments((docs) => ({ ...docs, [key]: null }));
      return;
    }

    setDocuments((docs) => ({ ...docs, [key]: { file, uploaded: null, status: "uploading" } }));

    try {
      const uploaded = await uploadFile(file);

      setDocuments((docs) =>
        docs[key]?.file === file ? { ...docs, [key]: { file, uploaded, status: "checking" } } : docs,
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
      console.error(`Failed to verify ${key}:`, error);

      setDocuments((docs) =>
        docs[key]?.file === file
          ? {
              ...docs,
              [key]: {
                file,
                uploaded: docs[key]?.uploaded ?? null,
                status: "error",
                reason: "Could not verify this document. Please try re-uploading.",
              },
            }
          : docs,
      );
    }
  };

  const verifiedRequiredCount = REQUIRED_DOCUMENT_KEYS.filter((key) => {
    const status = documents[key]?.status;
    return status === "matches" || status === "skipped";
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

    if (!form.deaExpiration) {
      alert("Please enter your DEA certificate's expiration date.");
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

    if (!form.driverLicensePhoto) {
      alert("Please attach your driver's license photo.");
      return;
    }

    if (!form.resume) {
      alert("Please attach your resume.");
      return;
    }

    for (const key of REQUIRED_DOCUMENT_KEYS) {
      const doc = documents[key];
      const label = DOCUMENT_LABELS[key];

      if (!doc) {
        alert(`Please attach your ${label}.`);
        return;
      }

      if (doc.status === "uploading" || doc.status === "checking") {
        alert(`Please wait for your ${label} to finish uploading and verifying.`);
        return;
      }

      if (doc.status === "mismatch" || doc.status === "error") {
        alert(`Please fix your ${label} before submitting: ${doc.reason ?? "it doesn't look right."}`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // Driver's license and resume aren't AI-checked, so they still upload
      // fresh at submit time. The 6 credentialing documents already uploaded
      // the moment they were chosen — reuse those instead of uploading twice.
      const [driverLicense, resume] = await Promise.all([
        uploadFile(form.driverLicensePhoto!),
        uploadFile(form.resume!),
      ]);

      const response = await fetch(`${API_BASE_URL}/api/onboarding/submit`, {
        method: "POST",
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
            deaExpiration: form.deaExpiration,
            caqhUsername: form.caqhUsername,
            caqhPassword: form.caqhPassword,
            nppesUsername: form.nppesUsername,
            nppesPassword: form.nppesPassword,
            pecosUsername: form.pecosUsername,
            pecosPassword: form.pecosPassword,
          },
          files: {
            driverLicense,
            resume,
            degreeCertificate: documents.degreeCertificate?.uploaded ?? null,
            boardCertificate: documents.boardCertificate?.uploaded ?? null,
            deaCertificate: documents.deaCertificate?.uploaded ?? null,
            professionalLiability: documents.professionalLiability?.uploaded ?? null,
            stateMedicalLicense: documents.stateMedicalLicense?.uploaded ?? null,
            blsCertificate: documents.blsCertificate?.uploaded ?? null,
            aclsCertificate: documents.aclsCertificate?.uploaded ?? null,
          },
          documentVerdicts: buildDocumentVerdicts(documents),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Submission failed with status ${response.status}`);
      }

      setIsSubmitted(true);
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

  if (page === "welcome") {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} />
        <section className="welcome-card">
          <img
            className="welcome-logo"
            src={logo}
            alt="ORCA Rehab"
          />

          <div className="welcome-content">
            <p className="eyebrow">NEW EMPLOYEE PORTAL</p>

            <h1>
              Welcome to <span>ORCA REHAB</span>
            </h1>

            <p className="welcome-description">
              We’re excited to have you join our team. This secure onboarding
              portal will guide you through the information needed to get
              started.
            </p>

            <button
              className="primary-button"
              type="button"
              onClick={() => setPage("employee-info")}
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

  if (isSubmitted) {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} />
        <section className="form-card success-card">
          <div className="success-icon">✓</div>
          <p className="eyebrow">INFORMATION RECEIVED</p>
          <h1>Thank you, {form.firstName}.</h1>
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
      <DevNav onNavigate={handleDevNavigate} />
      <section className="form-card">
        <button
          className="back-button"
          type="button"
          onClick={() => setPage("welcome")}
        >
          ← Back
        </button>

        <header className="form-header">
          <img className="form-logo" src={logo} alt="ORCA Rehab" />

          <div>
            <h1>Employee Information</h1>
            <p>Please enter your legal information exactly as it appears on official records.</p>
          </div>
        </header>

        <div className="progress-track" aria-label="Document verification progress">
          <div className="progress-value" style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="progress-label">
          {verifiedRequiredCount} of {REQUIRED_DOCUMENT_KEYS.length} documents verified
        </p>

        <form className="employee-form" onSubmit={handleEmployeeSubmit}>
          <p className="section-label">Personal Information</p>

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

          <p className="section-label">Provider Details</p>

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

          <p className="section-label">Credentialing Portal Logins</p>

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

          <p className="section-label">Documents</p>

          <label className="form-field">
            <span>Driver's license photo</span>
            <input
              type="file"
              name="driverLicensePhoto"
              accept="image/*"
              onChange={handleFileChange("driverLicensePhoto")}
              required
            />

            {licensePreview && (
              <img
                className="license-preview"
                src={licensePreview}
                alt="Driver's license preview"
              />
            )}
          </label>

          <label className="form-field">
            <span>Resume (CV)</span>
            <input
              type="file"
              name="resume"
              accept=".pdf,.doc,.docx"
              onChange={handleFileChange("resume")}
              required
            />

            {form.resume && (
              <small className="file-name">{form.resume.name}</small>
            )}
          </label>

          <DocumentField
            label="Degree certificate / diploma"
            required
            doc={documents.degreeCertificate}
            onFileSelected={handleDocumentFileChange("degreeCertificate")}
          />

          <DocumentField
            label="Board certificate"
            hint={boardCertifyingBody(form.providerRole)}
            required
            doc={documents.boardCertificate}
            onFileSelected={handleDocumentFileChange("boardCertificate")}
          />

          <DocumentField
            label="DEA certificate"
            required
            doc={documents.deaCertificate}
            onFileSelected={handleDocumentFileChange("deaCertificate")}
          />

          <label className="form-field">
            <span>DEA certificate expiration date</span>
            <input
              type="date"
              value={form.deaExpiration}
              onChange={(event) =>
                updateField("deaExpiration", event.target.value)
              }
              required
            />
          </label>

          <DocumentField
            label="Professional liability"
            required
            doc={documents.professionalLiability}
            onFileSelected={handleDocumentFileChange("professionalLiability")}
          />

          <DocumentField
            label="State medical license"
            required
            doc={documents.stateMedicalLicense}
            onFileSelected={handleDocumentFileChange("stateMedicalLicense")}
          />

          <DocumentField
            label="BLS certificate"
            required
            doc={documents.blsCertificate}
            onFileSelected={handleDocumentFileChange("blsCertificate")}
          />

          <DocumentField
            label="ACLS certificate"
            required={false}
            doc={documents.aclsCertificate}
            onFileSelected={handleDocumentFileChange("aclsCertificate")}
          />

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
