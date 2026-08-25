import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import logo from "./assets/orca-logo.png";
import { API_BASE_URL } from "./apiConfig";
import "./App.css";
import "./AdminApp.css";

interface DocumentVerdict {
  matches: boolean;
  reason: string | null;
  expirationDate?: string | null;
  isExpired?: boolean | null;
}

function deaExpirationLabel(verdicts: Record<string, DocumentVerdict> | null): string | null {
  const dea = verdicts?.deaCertificate;
  if (!dea?.expirationDate) return null;

  return dea.isExpired ? `${dea.expirationDate} (Expired)` : dea.expirationDate;
}

interface SubmissionDetail {
  id: number;
  createdAt: string;
  driverLicensePath: string | null;
  resumePath: string | null;
  degreeCertificatePath: string | null;
  boardCertificatePath: string | null;
  deaCertificatePath: string | null;
  professionalLiabilityPath: string | null;
  stateMedicalLicensePath: string | null;
  blsCertificatePath: string | null;
  aclsCertificatePath: string | null;
  documentVerdicts: Record<string, DocumentVerdict> | null;
  employee: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    stateOfBirth: string;
    phone: string;
    address: string;
    ssn: string;
    providerRole: string;
    degree: string;
    npi: string;
    caqhUsername: string;
    caqhPassword: string;
    nppesUsername: string;
    nppesPassword: string;
    pecosUsername: string;
    pecosPassword: string;
  };
}

interface ApplicantAccountSummary {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  hasSubmitted: boolean;
  submissionId: number | null;
  hasStarted: boolean;
  uploadedDocumentCount: number;
  totalDocumentCount: number;
}

interface ApplicantAccountDetail {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  hasSubmitted: boolean;
  submittedAt: string | null;
  documentVerdicts: Record<string, DocumentVerdict> | null;
  driverLicensePath: string | null;
  resumePath: string | null;
  degreeCertificatePath: string | null;
  boardCertificatePath: string | null;
  deaCertificatePath: string | null;
  professionalLiabilityPath: string | null;
  stateMedicalLicensePath: string | null;
  blsCertificatePath: string | null;
  aclsCertificatePath: string | null;
  employee: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    stateOfBirth?: string;
    phone?: string;
    address?: string;
    ssn?: string;
    providerRole?: string;
    degree?: string;
    npi?: string;
    caqhUsername?: string;
    caqhPassword?: string;
    nppesUsername?: string;
    nppesPassword?: string;
    pecosUsername?: string;
    pecosPassword?: string;
  };
}

function applicantStatusLabel(applicant: ApplicantAccountSummary): string {
  if (applicant.hasSubmitted) return "Completed";
  if (applicant.hasStarted) return "In progress";
  return "Not started";
}

function applicantStatusClass(applicant: ApplicantAccountSummary): string {
  if (applicant.hasSubmitted) return "matches";
  if (applicant.hasStarted) return "pending";
  return "not-started";
}

// Completed accounts have their draft columns cleared (the submission is the
// source of truth by then), so this always reads 100% for those rather than
// 0 — the document count only means something while still in progress.
function applicantProgressPercent(applicant: ApplicantAccountSummary): number {
  if (applicant.hasSubmitted) return 100;
  if (applicant.totalDocumentCount === 0) return 0;
  return Math.round((applicant.uploadedDocumentCount / applicant.totalDocumentCount) * 100);
}

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

function DetailField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;

  return (
    <div className="detail-field">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|heic|heif|gif|bmp|tiff)$/i.test(path);
}

function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}

function DocumentPreview({
  label,
  path,
  verdict,
}: {
  label: string;
  path: string | null;
  verdict?: DocumentVerdict;
}) {
  if (!path) return null;

  const src = `${API_BASE_URL}/api/admin/uploads/${path}`;

  return (
    <div className="document-card">
      <div className="document-card-header">
        <span className="document-card-label">{label}</span>
        {verdict && (
          <span className={`document-verdict ${verdict.matches ? "matches" : "mismatch"}`}>
            {verdict.matches ? "✓ Matches" : `⚠ ${verdict.reason ?? "Doesn't match"}`}
          </span>
        )}
      </div>

      {isImagePath(path) ? (
        <img className="document-preview" src={src} alt={label} />
      ) : isPdfPath(path) ? (
        <iframe className="document-preview" src={src} title={label} />
      ) : (
        <p className="document-preview-fallback">Preview not available for this file type.</p>
      )}

      <a className="file-link" href={src} target="_blank" rel="noopener noreferrer">
        Open in new tab
      </a>
    </div>
  );
}

function AdminApp() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [selected, setSelected] = useState<SubmissionDetail | null>(null);
  const [applicantsList, setApplicantsList] = useState<ApplicantAccountSummary[]>([]);
  const [selectedApplicant, setSelectedApplicant] = useState<ApplicantAccountDetail | null>(null);

  useEffect(() => {
    // TEMPORARY: skip the login screen entirely in local dev so /admin is
    // reachable without signing in. Backend auth is also disabled right now
    // (see server/src/auth.js) — remove both before this goes anywhere near
    // production.
    if (import.meta.env.DEV) {
      setAuthStatus("authenticated");
      return;
    }

    fetch(`${API_BASE_URL}/api/admin/session`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setAuthStatus(data.authenticated ? "authenticated" : "unauthenticated"))
      .catch(() => setAuthStatus("unauthenticated"));
  }, []);

  useEffect(() => {
    if (authStatus === "authenticated") loadApplicants();
  }, [authStatus]);

  async function loadApplicants() {
    const res = await fetch(`${API_BASE_URL}/api/admin/applicants`, {
      credentials: "include",
    });

    if (res.status === 401) {
      setAuthStatus("unauthenticated");
      return;
    }

    setApplicantsList(await res.json());
  }

  async function openApplicantDetail(id: number) {
    const res = await fetch(`${API_BASE_URL}/api/admin/applicants/${id}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    setSelectedApplicant(await res.json());
  }

  async function handleLogin(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    const formData = new FormData(event.currentTarget);

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.get("username"),
          password: formData.get("password"),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setLoginError(body?.error ?? "Invalid credentials.");
        return;
      }

      setAuthStatus("authenticated");
    } catch {
      setLoginError("Couldn't reach the server. Please make sure it's running.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch(`${API_BASE_URL}/api/admin/logout`, {
      method: "POST",
      credentials: "include",
    });
    setApplicantsList([]);
    setAuthStatus("unauthenticated");
  }

  async function openDetail(id: number) {
    const res = await fetch(`${API_BASE_URL}/api/admin/submissions/${id}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    setSelected(await res.json());
  }

  function downloadCredentialingPackage(id: number) {
    window.open(`${API_BASE_URL}/api/admin/submissions/${id}/download`, "_blank");
  }

  async function removeSubmission(id: number) {
    if (!confirm("Remove this submission permanently? This cannot be undone.")) return;

    const res = await fetch(`${API_BASE_URL}/api/admin/submissions/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setSelected(null);
      loadApplicants();
    }
  }

  function viewApplicant(applicant: ApplicantAccountSummary) {
    if (applicant.hasSubmitted && applicant.submissionId) {
      openDetail(applicant.submissionId);
    } else {
      openApplicantDetail(applicant.id);
    }
  }

  if (authStatus === "checking") {
    return <main className="app-shell" />;
  }

  if (authStatus === "unauthenticated") {
    return (
      <main className="app-shell">
        <form className="form-card admin-login-card" onSubmit={handleLogin}>
          <p className="eyebrow">ORCA Rehab</p>
          <h1>HR &amp; Payroll Login</h1>

          <label className="form-field">
            <span>Username</span>
            <input type="text" name="username" autoComplete="username" required />
          </label>

          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>

          {loginError && <p className="admin-error">{loginError}</p>}

          <button className="primary-button" type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? "Signing in…" : "Sign in"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell admin-shell">
      <section className="form-card admin-dashboard-card">
        <header className="admin-topbar">
          <div className="form-header">
            <img className="form-logo" src={logo} alt="ORCA Rehab" />
            <div>
              <p className="eyebrow">ORCA Rehab</p>
              <h1>New Employee Onboarding</h1>
            </div>
          </div>
          <button className="back-button" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </header>

        {applicantsList.length === 0 ? (
          <p className="admin-empty">No one has signed up yet.</p>
        ) : (
          <div className="table-scroll">
          <table className="submissions-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Last activity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {applicantsList.map((applicant) => (
                <tr key={applicant.id}>
                  <td>
                    {applicant.firstName} {applicant.lastName}
                  </td>
                  <td>{applicant.email}</td>
                  <td>
                    <div className="row-progress">
                      <div className="row-progress-track">
                        <div
                          className="row-progress-value"
                          style={{ width: `${applicantProgressPercent(applicant)}%` }}
                        />
                      </div>
                      <span className="row-progress-label">
                        {applicantProgressPercent(applicant)}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${applicantStatusClass(applicant)}`}>
                      {applicantStatusLabel(applicant)}
                    </span>
                  </td>
                  <td>
                    {new Date(applicant.updatedAt).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="row-actions">
                    <div className="row-actions-inner">
                      <button type="button" onClick={() => viewApplicant(applicant)}>
                        View
                      </button>
                      {applicant.hasSubmitted && applicant.submissionId && (
                        <>
                          <button
                            type="button"
                            onClick={() => downloadCredentialingPackage(applicant.submissionId!)}
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => removeSubmission(applicant.submissionId!)}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {selectedApplicant && (
        <div className="overlay" onClick={() => setSelectedApplicant(null)}>
          <div className="detail-card" onClick={(event) => event.stopPropagation()}>
            <button
              className="back-button close-button"
              type="button"
              onClick={() => setSelectedApplicant(null)}
            >
              × Close
            </button>

            <div className="detail-section">
              <h2>
                {selectedApplicant.firstName} {selectedApplicant.lastName}
              </h2>
              <p className="admin-sync-status">In progress — this new hire hasn't submitted yet.</p>
              <div className="detail-grid">
                <DetailField label="Email" value={selectedApplicant.email} />
                <DetailField
                  label="Account created"
                  value={new Date(selectedApplicant.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                />
              </div>
            </div>

            <div className="detail-section">
              <h2>Employee information</h2>
              <div className="detail-grid">
                <DetailField label="Date of birth" value={selectedApplicant.employee.dateOfBirth} />
                <DetailField label="State of birth" value={selectedApplicant.employee.stateOfBirth} />
                <DetailField label="Phone" value={selectedApplicant.employee.phone} />
                <DetailField label="Address" value={selectedApplicant.employee.address} />
                <DetailField label="SSN" value={selectedApplicant.employee.ssn} />
              </div>
            </div>

            <div className="detail-section">
              <h2>Provider details</h2>
              <div className="detail-grid">
                <DetailField label="Provider role" value={selectedApplicant.employee.providerRole} />
                <DetailField label="Degree" value={selectedApplicant.employee.degree} />
                <DetailField label="NPI" value={selectedApplicant.employee.npi} />
                <DetailField
                  label="DEA expiration"
                  value={deaExpirationLabel(selectedApplicant.documentVerdicts)}
                />
              </div>
            </div>

            <div className="detail-section">
              <h2>Credentialing portal logins</h2>
              <div className="detail-grid">
                <DetailField label="CAQH username" value={selectedApplicant.employee.caqhUsername} />
                <DetailField label="CAQH password" value={selectedApplicant.employee.caqhPassword} />
                <DetailField label="NPPES username" value={selectedApplicant.employee.nppesUsername} />
                <DetailField label="NPPES password" value={selectedApplicant.employee.nppesPassword} />
                <DetailField label="PECOS username" value={selectedApplicant.employee.pecosUsername} />
                <DetailField label="PECOS password" value={selectedApplicant.employee.pecosPassword} />
              </div>
            </div>

            <div className="detail-section">
              <h2>Documents so far</h2>
              <div className="document-grid">
                <DocumentPreview label="Driver's license" path={selectedApplicant.driverLicensePath} />
                <DocumentPreview label="Resume" path={selectedApplicant.resumePath} />
                <DocumentPreview
                  label="Degree certificate"
                  path={selectedApplicant.degreeCertificatePath}
                  verdict={selectedApplicant.documentVerdicts?.degreeCertificate}
                />
                <DocumentPreview
                  label="Board certificate"
                  path={selectedApplicant.boardCertificatePath}
                  verdict={selectedApplicant.documentVerdicts?.boardCertificate}
                />
                <DocumentPreview
                  label="DEA certificate"
                  path={selectedApplicant.deaCertificatePath}
                  verdict={selectedApplicant.documentVerdicts?.deaCertificate}
                />
                <DocumentPreview
                  label="Professional liability"
                  path={selectedApplicant.professionalLiabilityPath}
                  verdict={selectedApplicant.documentVerdicts?.professionalLiability}
                />
                <DocumentPreview
                  label="State medical license"
                  path={selectedApplicant.stateMedicalLicensePath}
                  verdict={selectedApplicant.documentVerdicts?.stateMedicalLicense}
                />
                <DocumentPreview
                  label="BLS certificate"
                  path={selectedApplicant.blsCertificatePath}
                  verdict={selectedApplicant.documentVerdicts?.blsCertificate}
                />
                <DocumentPreview
                  label="ACLS certificate"
                  path={selectedApplicant.aclsCertificatePath}
                  verdict={selectedApplicant.documentVerdicts?.aclsCertificate}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="detail-card" onClick={(event) => event.stopPropagation()}>
            <button
              className="back-button close-button"
              type="button"
              onClick={() => setSelected(null)}
            >
              × Close
            </button>

            <div className="detail-section">
              <h2>
                {selected.employee.firstName} {selected.employee.lastName}
              </h2>
              <button
                type="button"
                className="primary-button admin-download-button"
                onClick={() => downloadCredentialingPackage(selected.id)}
              >
                Download credentialing folder
                <span aria-hidden="true">↓</span>
              </button>
            </div>

            <div className="detail-section">
              <h2>Employee information</h2>
              <div className="detail-grid">
                <DetailField label="Date of birth" value={selected.employee.dateOfBirth} />
                <DetailField label="State of birth" value={selected.employee.stateOfBirth} />
                <DetailField label="Phone" value={selected.employee.phone} />
                <DetailField label="Address" value={selected.employee.address} />
                <DetailField label="SSN" value={selected.employee.ssn} />
              </div>
            </div>

            <div className="detail-section">
              <h2>Provider details</h2>
              <div className="detail-grid">
                <DetailField label="Provider role" value={selected.employee.providerRole} />
                <DetailField label="Degree" value={selected.employee.degree} />
                <DetailField label="NPI" value={selected.employee.npi} />
                <DetailField label="DEA expiration" value={deaExpirationLabel(selected.documentVerdicts)} />
              </div>
            </div>

            <div className="detail-section">
              <h2>Credentialing portal logins</h2>
              <div className="detail-grid">
                <DetailField label="CAQH username" value={selected.employee.caqhUsername} />
                <DetailField label="CAQH password" value={selected.employee.caqhPassword} />
                <DetailField label="NPPES username" value={selected.employee.nppesUsername} />
                <DetailField label="NPPES password" value={selected.employee.nppesPassword} />
                <DetailField label="PECOS username" value={selected.employee.pecosUsername} />
                <DetailField label="PECOS password" value={selected.employee.pecosPassword} />
              </div>
            </div>

            <div className="detail-section">
              <h2>Documents</h2>
              <div className="document-grid">
                <DocumentPreview label="Driver's license" path={selected.driverLicensePath} />
                <DocumentPreview label="Resume" path={selected.resumePath} />
                <DocumentPreview
                  label="Degree certificate"
                  path={selected.degreeCertificatePath}
                  verdict={selected.documentVerdicts?.degreeCertificate}
                />
                <DocumentPreview
                  label="Board certificate"
                  path={selected.boardCertificatePath}
                  verdict={selected.documentVerdicts?.boardCertificate}
                />
                <DocumentPreview
                  label="DEA certificate"
                  path={selected.deaCertificatePath}
                  verdict={selected.documentVerdicts?.deaCertificate}
                />
                <DocumentPreview
                  label="Professional liability"
                  path={selected.professionalLiabilityPath}
                  verdict={selected.documentVerdicts?.professionalLiability}
                />
                <DocumentPreview
                  label="State medical license"
                  path={selected.stateMedicalLicensePath}
                  verdict={selected.documentVerdicts?.stateMedicalLicense}
                />
                <DocumentPreview
                  label="BLS certificate"
                  path={selected.blsCertificatePath}
                  verdict={selected.documentVerdicts?.blsCertificate}
                />
                <DocumentPreview
                  label="ACLS certificate"
                  path={selected.aclsCertificatePath}
                  verdict={selected.documentVerdicts?.aclsCertificate}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default AdminApp;
