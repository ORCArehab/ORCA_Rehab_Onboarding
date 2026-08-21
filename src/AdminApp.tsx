import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import logo from "./assets/orca-logo.png";
import { API_BASE_URL } from "./apiConfig";
import "./App.css";
import "./AdminApp.css";

interface SubmissionSummary {
  id: number;
  created_at: string;
  first_name: string;
  last_name: string;
}

interface DocumentVerdict {
  matches: boolean;
  reason: string | null;
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
    deaExpiration: string;
    caqhUsername: string;
    caqhPassword: string;
    nppesUsername: string;
    nppesPassword: string;
    pecosUsername: string;
    pecosPassword: string;
  };
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
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [selected, setSelected] = useState<SubmissionDetail | null>(null);

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
    if (authStatus === "authenticated") loadSubmissions();
  }, [authStatus]);

  async function loadSubmissions() {
    const res = await fetch(`${API_BASE_URL}/api/admin/submissions`, {
      credentials: "include",
    });

    if (res.status === 401) {
      setAuthStatus("unauthenticated");
      return;
    }

    setSubmissions(await res.json());
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
    setSubmissions([]);
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
    if (res.ok) loadSubmissions();
  }

  if (authStatus === "checking") {
    return <main className="app-shell" />;
  }

  if (authStatus === "unauthenticated") {
    return (
      <main className="app-shell">
        <form className="form-card admin-login-card" onSubmit={handleLogin}>
          <p className="eyebrow">ORCA REHAB</p>
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
              <p className="eyebrow">ORCA REHAB</p>
              <h1>New Employee Submissions</h1>
            </div>
          </div>
          <button className="back-button" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </header>

        {submissions.length === 0 ? (
          <p className="admin-empty">No submissions yet.</p>
        ) : (
          <table className="submissions-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.id}>
                  <td>
                    {submission.first_name} {submission.last_name}
                  </td>
                  <td>
                    {new Date(submission.created_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="row-actions">
                    <button type="button" onClick={() => openDetail(submission.id)}>
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadCredentialingPackage(submission.id)}
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => removeSubmission(submission.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
                <DetailField label="DEA expiration" value={selected.employee.deaExpiration} />
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
