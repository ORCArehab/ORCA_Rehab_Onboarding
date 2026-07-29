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
  quickbooks_employee_id: string | null;
  quickbooks_synced: number;
}

interface BankAccountDetail {
  bankName: string;
  accountType: string;
  routingNumber: string;
  accountNumber: string;
}

interface SubmissionDetail {
  id: number;
  createdAt: string;
  driverLicensePath: string | null;
  resumePath: string | null;
  quickbooksEmployeeId: string | null;
  quickbooksSynced: boolean;
  employee: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phone: string;
    address: string;
    degree: string;
    ssn: string;
  };
  bank: {
    splitDeposit: boolean;
    primaryAccount: BankAccountDetail;
    secondaryAccount: BankAccountDetail;
    primaryAllocation: string;
  };
  additional: {
    emergencyContactName: string;
    emergencyContactRelationship: string;
    emergencyContactPhone: string;
    workAuthorization: string;
    filingStatus: string;
    dependentsAmount: string;
    extraWithholding: string;
  };
  policy?: {
    fullName: string;
    signedAt: string;
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

function AdminApp() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [selected, setSelected] = useState<SubmissionDetail | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  useEffect(() => {
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

  async function approveSubmission(id: number) {
    setApprovingId(id);

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/submissions/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error ?? "Failed to approve this submission.");
        return;
      }

      await loadSubmissions();
      if (selected?.id === id) await openDetail(id);
    } finally {
      setApprovingId(null);
    }
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
                <th>QuickBooks</th>
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
                  <td>
                    <span
                      className={`badge ${submission.quickbooks_synced ? "synced" : "pending"}`}
                    >
                      {submission.quickbooks_synced ? "Synced" : "Awaiting approval"}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button type="button" onClick={() => openDetail(submission.id)}>
                      View
                    </button>
                    {!submission.quickbooks_synced && (
                      <button
                        type="button"
                        className="approve"
                        disabled={approvingId === submission.id}
                        onClick={() => approveSubmission(submission.id)}
                      >
                        {approvingId === submission.id ? "Approving…" : "Approve"}
                      </button>
                    )}
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
              <p className="admin-sync-status">
                {selected.quickbooksSynced
                  ? `Synced to QuickBooks (Employee ID ${selected.quickbooksEmployeeId})`
                  : "Awaiting approval — not yet created in QuickBooks"}
              </p>
              {!selected.quickbooksSynced && (
                <button
                  type="button"
                  className="primary-button admin-approve-button"
                  disabled={approvingId === selected.id}
                  onClick={() => approveSubmission(selected.id)}
                >
                  {approvingId === selected.id
                    ? "Approving…"
                    : "Approve & create in QuickBooks"}
                  <span aria-hidden="true">→</span>
                </button>
              )}
            </div>

            <div className="detail-section">
              <h2>Employee information</h2>
              <div className="detail-grid">
                <DetailField label="Date of birth" value={selected.employee.dateOfBirth} />
                <DetailField label="Phone" value={selected.employee.phone} />
                <DetailField label="Address" value={selected.employee.address} />
                <DetailField label="Degree" value={selected.employee.degree} />
                <DetailField label="SSN" value={selected.employee.ssn} />
              </div>
              <div className="admin-file-links">
                {selected.driverLicensePath && (
                  <a
                    className="file-link"
                    href={`${API_BASE_URL}/api/admin/uploads/${selected.driverLicensePath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View driver's license photo
                  </a>
                )}
                {selected.resumePath && (
                  <a
                    className="file-link"
                    href={`${API_BASE_URL}/api/admin/uploads/${selected.resumePath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View resume
                  </a>
                )}
              </div>
            </div>

            <div className="detail-section">
              <h2>Direct deposit</h2>
              <div className="detail-grid">
                <DetailField label="Bank name" value={selected.bank?.primaryAccount?.bankName} />
                <DetailField
                  label="Account type"
                  value={selected.bank?.primaryAccount?.accountType}
                />
                <DetailField
                  label="Routing number"
                  value={selected.bank?.primaryAccount?.routingNumber}
                />
                <DetailField
                  label="Account number"
                  value={selected.bank?.primaryAccount?.accountNumber}
                />
              </div>

              {selected.bank?.splitDeposit && (
                <>
                  <p className="account-label admin-split-label">
                    Split deposit — Account 2 (
                    {selected.bank.primaryAllocation
                      ? 100 - Number(selected.bank.primaryAllocation)
                      : 0}
                    %)
                  </p>
                  <div className="detail-grid">
                    <DetailField
                      label="Bank name"
                      value={selected.bank?.secondaryAccount?.bankName}
                    />
                    <DetailField
                      label="Account type"
                      value={selected.bank?.secondaryAccount?.accountType}
                    />
                    <DetailField
                      label="Routing number"
                      value={selected.bank?.secondaryAccount?.routingNumber}
                    />
                    <DetailField
                      label="Account number"
                      value={selected.bank?.secondaryAccount?.accountNumber}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="detail-section">
              <h2>Emergency contact &amp; tax withholding</h2>
              <div className="detail-grid">
                <DetailField
                  label="Contact name"
                  value={selected.additional?.emergencyContactName}
                />
                <DetailField
                  label="Relationship"
                  value={selected.additional?.emergencyContactRelationship}
                />
                <DetailField
                  label="Contact phone"
                  value={selected.additional?.emergencyContactPhone}
                />
                <DetailField
                  label="Work authorization"
                  value={selected.additional?.workAuthorization}
                />
                <DetailField label="Filing status" value={selected.additional?.filingStatus} />
                <DetailField
                  label="Dependents amount"
                  value={selected.additional?.dependentsAmount}
                />
                <DetailField
                  label="Extra withholding"
                  value={selected.additional?.extraWithholding}
                />
              </div>
            </div>

            <div className="detail-section">
              <h2>Policy agreement</h2>
              <div className="detail-grid">
                <DetailField label="Signed by" value={selected.policy?.fullName} />
                <DetailField
                  label="Signed at"
                  value={
                    selected.policy?.signedAt
                      ? new Date(selected.policy.signedAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : undefined
                  }
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
