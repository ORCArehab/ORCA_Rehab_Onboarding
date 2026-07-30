import { useEffect, useState } from "react";
import type { ChangeEvent, SubmitEvent, UIEvent } from "react";
import logo from "./assets/orca-logo.png";
import policyPdf from "./assets/PolicyAgreement.pdf";
import { API_BASE_URL } from "./apiConfig";
import { uploadFile } from "./uploads";
import "./App.css";

type Page =
  | "welcome"
  | "employee-info"
  | "bank-info"
  | "additional-info"
  | "policy-agreement";

interface EmployeeForm {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  address: string;
  degree: string;
  ssn: string;
  driverLicensePhoto: File | null;
  resume: File | null;
}

interface BankAccountForm {
  bankName: string;
  accountType: string;
  routingNumber: string;
  accountNumber: string;
}

interface BankForm {
  splitDeposit: boolean;
  primaryAccount: BankAccountForm;
  secondaryAccount: BankAccountForm;
  primaryAllocation: string;
}

interface AdditionalForm {
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  workAuthorization: string;
  filingStatus: string;
  dependentsAmount: string;
  extraWithholding: string;
}

const initialForm: EmployeeForm = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  phone: "",
  address: "",
  degree: "",
  ssn: "",
  driverLicensePhoto: null,
  resume: null,
};

const initialBankAccount: BankAccountForm = {
  bankName: "",
  accountType: "",
  routingNumber: "",
  accountNumber: "",
};

const initialBankForm: BankForm = {
  splitDeposit: false,
  primaryAccount: { ...initialBankAccount },
  secondaryAccount: { ...initialBankAccount },
  primaryAllocation: "50",
};

const initialAdditionalForm: AdditionalForm = {
  emergencyContactName: "",
  emergencyContactRelationship: "",
  emergencyContactPhone: "",
  workAuthorization: "",
  filingStatus: "",
  dependentsAmount: "",
  extraWithholding: "",
};

interface PolicyForm {
  fullName: string;
}

const initialPolicyForm: PolicyForm = {
  fullName: "",
};

function formatSSN(value: string): string {
  const numbers = value.replace(/\D/g, "").slice(0, 9);

  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 5) {
    return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
  }

  return `${numbers.slice(0, 3)}-${numbers.slice(3, 5)}-${numbers.slice(5)}`;
}

function formatDigits(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function formatPhone(value: string): string {
  const numbers = value.replace(/\D/g, "").slice(0, 10);

  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 3)}) ${numbers.slice(3)}`;
  }

  return `(${numbers.slice(0, 3)}) ${numbers.slice(3, 6)}-${numbers.slice(6)}`;
}

const DEV_PAGES: { label: string; page: Page; submitted?: boolean }[] = [
  { label: "Welcome", page: "welcome" },
  { label: "Employee info", page: "employee-info" },
  { label: "Bank info", page: "bank-info" },
  { label: "Additional info", page: "additional-info" },
  { label: "Policy agreement", page: "policy-agreement" },
  { label: "Success", page: "policy-agreement", submitted: true },
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

function BankAccountFields({
  account,
  onChange,
}: {
  account: BankAccountForm;
  onChange: (field: keyof BankAccountForm, value: string) => void;
}) {
  return (
    <div className="bank-account-fields">
      <label className="form-field">
        <span>Bank name</span>
        <input
          type="text"
          autoComplete="off"
          placeholder="Enter your bank's name"
          value={account.bankName}
          onChange={(event) => onChange("bankName", event.target.value)}
          required
        />
      </label>

      <label className="form-field">
        <span>Account type</span>
        <select
          value={account.accountType}
          onChange={(event) => onChange("accountType", event.target.value)}
          required
        >
          <option value="" disabled>
            Select account type
          </option>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
        </select>
      </label>

      <div className="field-row">
        <label className="form-field">
          <span>Routing number</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="9-digit routing number"
            maxLength={9}
            value={account.routingNumber}
            onChange={(event) => onChange("routingNumber", event.target.value)}
            required
          />
        </label>

        <label className="form-field">
          <span>Account number</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Account number"
            maxLength={17}
            value={account.accountNumber}
            onChange={(event) => onChange("accountNumber", event.target.value)}
            required
          />
        </label>
      </div>
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>("welcome");
  const [form, setForm] = useState<EmployeeForm>(initialForm);
  const [bankForm, setBankForm] = useState<BankForm>(initialBankForm);
  const [additionalForm, setAdditionalForm] = useState<AdditionalForm>(
    initialAdditionalForm,
  );
  const [policyForm, setPolicyForm] = useState<PolicyForm>(initialPolicyForm);
  const [hasReadPolicy, setHasReadPolicy] = useState(false);
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
            : value,
    }));
  };

  const updateBankAccountField = (
    account: "primaryAccount" | "secondaryAccount",
    field: keyof BankAccountForm,
    value: string,
  ) => {
    setBankForm((currentForm) => ({
      ...currentForm,
      [account]: {
        ...currentForm[account],
        [field]:
          field === "routingNumber"
            ? formatDigits(value, 9)
            : field === "accountNumber"
              ? formatDigits(value, 17)
              : value,
      },
    }));
  };

  const toggleSplitDeposit = () => {
    setBankForm((currentForm) => ({
      ...currentForm,
      splitDeposit: !currentForm.splitDeposit,
    }));
  };

  const updatePrimaryAllocation = (value: string) => {
    const digits = formatDigits(value, 3);
    const capped = digits === "" ? "" : String(Math.min(Number(digits), 100));

    setBankForm((currentForm) => ({
      ...currentForm,
      primaryAllocation: capped,
    }));
  };

  const updateAdditionalField = (
    field: keyof AdditionalForm,
    value: string,
  ) => {
    setAdditionalForm((currentForm) => ({
      ...currentForm,
      [field]:
        field === "emergencyContactPhone"
          ? formatPhone(value)
          : field === "dependentsAmount" || field === "extraWithholding"
            ? formatDigits(value, 6)
            : value,
    }));
  };

  const handleLicenseChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setForm((currentForm) => ({
      ...currentForm,
      driverLicensePhoto: file,
    }));
  };

  const handleResumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setForm((currentForm) => ({
      ...currentForm,
      resume: file,
    }));
  };

  const handleEmployeeSubmit = (event: SubmitEvent<HTMLFormElement>) => {
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

    if (!form.driverLicensePhoto) {
      alert("Please attach a photo of your driver's license.");
      return;
    }

    if (!form.resume) {
      alert("Please attach your resume.");
      return;
    }

    // Replace this with a secure request to your backend.
    // Never save an SSN in localStorage or sessionStorage.
    console.log({
      ...form,
      ssn: ssnNumbers,
    });

    setPage("bank-info");
  };

  const handleBankSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (bankForm.primaryAccount.routingNumber.length !== 9) {
      alert("Please enter a valid 9-digit routing number.");
      return;
    }

    if (bankForm.primaryAccount.accountNumber.length < 4) {
      alert("Please enter a valid account number.");
      return;
    }

    if (bankForm.splitDeposit) {
      if (bankForm.secondaryAccount.routingNumber.length !== 9) {
        alert("Please enter a valid 9-digit routing number for account 2.");
        return;
      }

      if (bankForm.secondaryAccount.accountNumber.length < 4) {
        alert("Please enter a valid account number for account 2.");
        return;
      }

      const allocation = Number(bankForm.primaryAllocation);

      if (!allocation || allocation < 1 || allocation > 99) {
        alert("Please enter a split percentage between 1 and 99 for account 1.");
        return;
      }
    }

    // Replace this with a secure request to your backend.
    // Never save bank account details in localStorage or sessionStorage.
    console.log(bankForm);

    setPage("additional-info");
  };

  const handleAdditionalSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const emergencyPhoneNumbers = additionalForm.emergencyContactPhone.replace(
      /\D/g,
      "",
    );

    if (emergencyPhoneNumbers.length !== 10) {
      alert("Please enter a valid 10-digit emergency contact phone number.");
      return;
    }

    if (!additionalForm.workAuthorization) {
      alert("Please select your work authorization status.");
      return;
    }

    if (!additionalForm.filingStatus) {
      alert("Please select your tax filing status.");
      return;
    }

    setPage("policy-agreement");
  };

  const handlePolicyScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;

    if (target.scrollHeight - target.scrollTop - target.clientHeight < 16) {
      setHasReadPolicy(true);
    }
  };

  const handlePolicySubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasReadPolicy) {
      alert("Please scroll through the entire policy before signing.");
      return;
    }

    const expectedName = `${form.firstName} ${form.lastName}`.trim().toLowerCase();
    const typedName = policyForm.fullName.trim().toLowerCase();

    if (typedName !== expectedName) {
      alert(
        "Please type your full legal name exactly as entered in Step 1 to sign.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      // Files go straight to Supabase Storage first, in parallel. Only the
      // resulting paths are sent to our backend, which keeps the submission
      // request small enough for any host's body size limit.
      const [driverLicense, resume] = await Promise.all([
        form.driverLicensePhoto ? uploadFile(form.driverLicensePhoto) : null,
        form.resume ? uploadFile(form.resume) : null,
      ]);

      const response = await fetch(`${API_BASE_URL}/api/onboarding/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee: {
            firstName: form.firstName,
            lastName: form.lastName,
            dateOfBirth: form.dateOfBirth,
            phone: form.phone.replace(/\D/g, ""),
            address: form.address,
            degree: form.degree,
            ssn: form.ssn.replace(/\D/g, ""),
          },
          bank: bankForm,
          additional: additionalForm,
          policy: {
            fullName: policyForm.fullName.trim(),
            signedAt: new Date().toISOString(),
          },
          files: { driverLicense, resume },
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
            Your employee, banking, and additional information has been
            submitted, and your policy agreement has been signed. Our team
            will follow up with the next steps of onboarding.
          </p>
        </section>
      </main>
    );
  }

  if (page === "bank-info") {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} />
        <section className="form-card">
          <button
            className="back-button"
            type="button"
            onClick={() => setPage("employee-info")}
          >
            ← Back
          </button>

          <header className="form-header">
            <img className="form-logo" src={logo} alt="ORCA Rehab" />

            <div>
              <p className="eyebrow">STEP 2 OF 4</p>
              <h1>Direct Deposit Information</h1>
              <p>
                Please enter your bank account details for direct deposit
                payroll setup.
              </p>
            </div>
          </header>

          <div className="progress-track" aria-label="Onboarding progress">
            <div className="progress-value" style={{ width: "50%" }} />
          </div>

          <form className="employee-form" onSubmit={handleBankSubmit}>
            <label className="toggle-row">
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={bankForm.splitDeposit}
                  onChange={toggleSplitDeposit}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
              </span>
              <span className="toggle-label">
                Split my paycheck between two accounts
              </span>
            </label>

            {bankForm.splitDeposit && <p className="account-label">Account 1</p>}

            <BankAccountFields
              account={bankForm.primaryAccount}
              onChange={(field, value) =>
                updateBankAccountField("primaryAccount", field, value)
              }
            />

            {bankForm.splitDeposit && (
              <>
                <label className="form-field">
                  <span>Percentage to Account 1</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 50"
                    maxLength={3}
                    value={bankForm.primaryAllocation}
                    onChange={(event) =>
                      updatePrimaryAllocation(event.target.value)
                    }
                    required
                  />
                  <small>
                    Account 2 will receive the remaining{" "}
                    {bankForm.primaryAllocation
                      ? 100 - Number(bankForm.primaryAllocation)
                      : 0}
                    %.
                  </small>
                </label>

                <p className="account-label">Account 2</p>

                <BankAccountFields
                  account={bankForm.secondaryAccount}
                  onChange={(field, value) =>
                    updateBankAccountField("secondaryAccount", field, value)
                  }
                />
              </>
            )}

            <div className="form-footer">
              <p>All fields are required.</p>

              <button className="primary-button" type="submit">
                Continue
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  if (page === "additional-info") {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} />
        <section className="form-card">
          <button
            className="back-button"
            type="button"
            onClick={() => setPage("bank-info")}
          >
            ← Back
          </button>

          <header className="form-header">
            <img className="form-logo" src={logo} alt="ORCA Rehab" />

            <div>
              <p className="eyebrow">STEP 3 OF 4</p>
              <h1>Additional Information</h1>
              <p>
                A few more required details: emergency contact, work
                eligibility, and tax withholding.
              </p>
            </div>
          </header>

          <div className="progress-track" aria-label="Onboarding progress">
            <div className="progress-value" style={{ width: "75%" }} />
          </div>

          <form className="employee-form" onSubmit={handleAdditionalSubmit}>
            <p className="account-label">Emergency contact</p>

            <div className="field-row">
              <label className="form-field">
                <span>Contact name</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="Full name"
                  value={additionalForm.emergencyContactName}
                  onChange={(event) =>
                    updateAdditionalField(
                      "emergencyContactName",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>

              <label className="form-field">
                <span>Relationship</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. Spouse, Parent"
                  value={additionalForm.emergencyContactRelationship}
                  onChange={(event) =>
                    updateAdditionalField(
                      "emergencyContactRelationship",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
            </div>

            <label className="form-field">
              <span>Contact phone number</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(555) 123-4567"
                maxLength={14}
                value={additionalForm.emergencyContactPhone}
                onChange={(event) =>
                  updateAdditionalField(
                    "emergencyContactPhone",
                    event.target.value,
                  )
                }
                required
              />
            </label>

            <p className="account-label">Work authorization (Form I-9)</p>

            <label className="form-field">
              <span>Citizenship / work authorization status</span>
              <select
                value={additionalForm.workAuthorization}
                onChange={(event) =>
                  updateAdditionalField("workAuthorization", event.target.value)
                }
                required
              >
                <option value="" disabled>
                  Select your status
                </option>
                <option value="citizen">U.S. citizen</option>
                <option value="national">U.S. national</option>
                <option value="permanent-resident">
                  Lawful permanent resident
                </option>
                <option value="authorized-alien">
                  Alien authorized to work
                </option>
              </select>
            </label>

            <p className="account-label">Tax withholding (Form W-4)</p>

            <label className="form-field">
              <span>Filing status</span>
              <select
                value={additionalForm.filingStatus}
                onChange={(event) =>
                  updateAdditionalField("filingStatus", event.target.value)
                }
                required
              >
                <option value="" disabled>
                  Select your filing status
                </option>
                <option value="single">
                  Single or married filing separately
                </option>
                <option value="married-filing-jointly">
                  Married filing jointly
                </option>
                <option value="head-of-household">Head of household</option>
              </select>
            </label>

            <div className="field-row">
              <label className="form-field">
                <span>Dependents amount ($)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 2000"
                  value={additionalForm.dependentsAmount}
                  onChange={(event) =>
                    updateAdditionalField(
                      "dependentsAmount",
                      event.target.value,
                    )
                  }
                />
              </label>

              <label className="form-field">
                <span>Extra withholding per paycheck ($)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 50"
                  value={additionalForm.extraWithholding}
                  onChange={(event) =>
                    updateAdditionalField(
                      "extraWithholding",
                      event.target.value,
                    )
                  }
                />
              </label>
            </div>

            <div className="form-footer">
              <p>Fields marked required must be completed.</p>

              <button className="primary-button" type="submit">
                Continue
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  if (page === "policy-agreement") {
    return (
      <main className="app-shell">
        <DevNav onNavigate={handleDevNavigate} />
        <section className="form-card">
          <button
            className="back-button"
            type="button"
            onClick={() => setPage("additional-info")}
          >
            ← Back
          </button>

          <header className="form-header">
            <img className="form-logo" src={logo} alt="ORCA Rehab" />

            <div>
              <p className="eyebrow">STEP 4 OF 4</p>
              <h1>Policy Agreement</h1>
              <p>
                Please read the full policy below before signing. You must
                scroll to the end to continue.
              </p>
            </div>
          </header>

          <div className="progress-track" aria-label="Onboarding progress">
            <div className="progress-value" style={{ width: "100%" }} />
          </div>

          <form className="employee-form" onSubmit={handlePolicySubmit}>
            <a
              className="policy-download-link"
              href={policyPdf}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download a copy (PDF)
            </a>

            <div className="policy-scroll-box" onScroll={handlePolicyScroll}>
              <div className="policy-text">
                <h2>ORCA Rehab, Inc.</h2>
                <h3>Holiday, Paid Time-Off, and Paid Sick Leave Policy</h3>

                <p>
                  <strong>Approved:</strong> June 18, 2026
                  <br />
                  <strong>Approved by:</strong> ORCA Management
                  <br />
                  <strong>Effective date:</strong> June 18, 2026
                  <br />
                  <strong>Supersedes:</strong> Any prior holiday, paid time
                  off, or paid sick leave policy
                </p>

                <h4>Purpose</h4>
                <p>
                  ORCA Rehab, Inc. recognizes the importance of providing
                  employees and providers with time to observe holidays,
                  spend time with family, attend to personal needs, and
                  maintain work-life balance.
                </p>
                <p>
                  As an inpatient rehabilitation practice, ORCA Rehab also has
                  an ongoing responsibility to maintain continuity of patient
                  care. Patients remain in hospitals, skilled nursing
                  facilities, and other care settings during holidays and
                  continue to require timely evaluation, treatment,
                  coordination, and provider oversight. Because hospitals and
                  patient care facilities do not close on holidays, ORCA
                  Rehab must maintain scheduling flexibility to support
                  patient care, meet facility expectations, and ensure
                  continuity of operations.
                </p>
                <p>
                  This policy outlines holiday observance, paid time off, and
                  paid sick leave guidelines for eligible office staff,
                  hospital-based providers, non-hospital providers, and other
                  eligible employees.
                </p>

                <h4>I. Recognized ORCA Holidays</h4>
                <p>ORCA Rehab recognizes the following six paid holidays:</p>
                <ul>
                  <li>New Year's Day</li>
                  <li>Memorial Day</li>
                  <li>Independence Day</li>
                  <li>Labor Day</li>
                  <li>Thanksgiving Day</li>
                  <li>Christmas Day</li>
                </ul>
                <p>
                  ORCA Rehab reserves the right to modify recognized
                  holidays, scheduling practices, coverage assignments, or
                  holiday procedures based on operational needs, patient care
                  needs, facility requirements, and applicable law.
                </p>

                <h4>II. Office Staff Holiday Policy</h4>
                <p>
                  Eligible full-time office staff are entitled to six (6)
                  paid holidays per calendar year from the recognized holiday
                  list above.
                </p>
                <p>
                  Christmas Eve, New Year's Eve, and the Friday after
                  Thanksgiving are not additional paid holidays. However,
                  office staff may be permitted to work remotely from home on
                  those days, subject to operational needs and management
                  approval.
                </p>
                <p>
                  If a recognized ORCA holiday falls on a Saturday or Sunday,
                  ORCA Rehab may designate an observed holiday for eligible
                  full-time office staff, generally on the preceding Friday
                  or following Monday, subject to operational needs and
                  management approval.
                </p>
                <p>
                  Employees are not eligible to receive duplicate holiday
                  benefits for the same recognized ORCA holiday unless
                  specifically approved by ORCA management.
                </p>

                <h4>III. Hospital-Based Provider Holiday Policy</h4>
                <p>
                  Because patient care responsibilities vary by facility,
                  holiday scheduling for hospital-based providers is
                  determined in coordination with each hospital's
                  operational requirements, patient care needs, provider
                  availability, and ORCA leadership direction.
                </p>
                <p>
                  <strong>
                    A. Providers Assigned to Providence St. Jude, St. Joseph,
                    and St. Mary
                  </strong>
                  <br />
                  Providers assigned to Providence St. Jude, St. Joseph, and
                  St. Mary are expected to rotate holiday coverage with other
                  providers assigned to the facility. Coverage schedules will
                  be arranged by ORCA leadership in a professional and fair
                  manner to maintain uninterrupted patient care.
                </p>
                <p>
                  If a provider is assigned and provides clinical coverage on
                  a recognized ORCA holiday, ORCA Rehab may grant one (1)
                  equivalent PTO day, subject to scheduling approval, patient
                  care needs, facility coverage needs, and operational
                  requirements.
                </p>
                <p>
                  In addition to the six recognized ORCA holidays listed
                  above, providers who are assigned and provide clinical
                  coverage on Christmas Eve or New Year's Eve may be granted
                  one (1) equivalent PTO day, subject to ORCA Rehab approval
                  and operational needs.
                </p>
                <p>
                  Any equivalent PTO granted under this section may be
                  scheduled and used later in the calendar year, subject to
                  scheduling approval, patient care needs, facility coverage
                  needs, and operational requirements.
                </p>
                <p>
                  <strong>B. Providers Assigned to Other Hospital Facilities</strong>
                  <br />
                  This section applies to providers assigned to other
                  hospital facilities, including OC Global, Placentia Linda,
                  and Anaheim Regional Medical Center.
                </p>
                <p>
                  Providers assigned to these hospitals will generally not be
                  required to provide routine holiday coverage but should
                  remain reasonably available in the event of urgent patient
                  matters requiring provider input, coordination, or
                  escalation.
                </p>

                <h4>IV. Non-Hospital Provider Holiday Policy</h4>
                <p>
                  This section applies to providers assigned to skilled
                  nursing facilities, assisted living facilities, clinics,
                  and other non-hospital settings.
                </p>
                <p>
                  Non-hospital providers will generally have their schedules
                  adjusted to accommodate recognized holidays when feasible.
                </p>
                <p>
                  Patient schedules will be coordinated in advance to
                  minimize disruption and allow providers to observe
                  recognized holidays while maintaining appropriate
                  continuity of care.
                </p>
                <p>
                  Providers who are regularly scheduled for administrative
                  work on Wednesdays may have their schedule adjusted during
                  weeks in which a recognized holiday occurs. In those
                  circumstances, providers will generally observe the
                  holiday off and may instead round at their assigned
                  facilities on Wednesday of that week, subject to
                  operational needs and leadership direction.
                </p>
                <p>
                  Supervisors and scheduling staff will work collaboratively
                  with providers to ensure appropriate patient care
                  continuity and timely communication with facilities.
                </p>
                <p>
                  During holidays, ORCA Rehab's after hours exchange service
                  will manage incoming calls and triage urgent concerns.
                  Providers are expected to remain available for urgent
                  patient matters when necessary.
                </p>

                <h4>V. Paid Time Off (PTO) and Paid Sick Leave</h4>
                <p>
                  <em>
                    For purposes of this policy, "full-time employee" means
                    an employee who is regularly scheduled to work the
                    minimum number of hours established by ORCA Rehab for
                    full-time benefit eligibility.
                  </em>
                </p>
                <p>
                  Eligible full-time employees receive eighty (80) hours of
                  paid time off (PTO) per calendar year. PTO is intended for
                  vacation, personal time, scheduled appointments, family
                  needs, rest, and other approved absences from work. PTO
                  accrues over time in accordance with ORCA Rehab's payroll
                  and accrual practices and is not front-loaded unless
                  expressly stated otherwise in writing.
                </p>
                <p>
                  Eligible employees also receive paid sick leave in
                  accordance with applicable California law. Paid sick leave
                  accrues at the rate required by law or at such greater rate
                  as ORCA Rehab may establish. Employees may use paid sick
                  leave for all purposes permitted under applicable law.
                </p>
                <p>
                  Unused paid sick leave may, with prior approval from ORCA
                  Rehab, be converted to PTO at the end of the applicable
                  calendar year. Once converted, such leave shall become
                  accrued PTO and may be carried over subject to the maximum
                  PTO accrual limit. PTO, including any sick leave converted
                  to PTO with ORCA Rehab's approval, may be carried over from
                  year to year. Once an employee's accrued PTO balance
                  reaches one hundred (100) hours, PTO will cease accruing
                  until the balance falls below one hundred (100) hours.
                </p>
                <p>
                  Accrued but unused PTO shall be paid upon separation from
                  employment to the extent required by applicable California
                  law. Paid sick leave that has not been converted to PTO
                  shall not be paid out upon separation except as required by
                  applicable law.
                </p>
                <p>
                  Employees must request planned PTO at least four (4) weeks
                  in advance whenever reasonably possible. All PTO requests
                  are subject to ORCA Rehab's approval and may be approved,
                  denied, modified, postponed, or conditioned based upon
                  staffing requirements, operational needs, patient care
                  needs, provider coverage, facility coverage, scheduling
                  conflicts, pending deadlines, employee role, or other
                  legitimate business considerations. Employees should not
                  make non-refundable travel arrangements until PTO has been
                  approved.
                </p>
                <p>
                  Except with prior written approval from ORCA Rehab,
                  employees generally may not take more than two (2)
                  consecutive weeks of PTO, personal leave, approved sick
                  leave, or any combination thereof.
                </p>
                <p>
                  Employees requesting sick leave should provide reasonable
                  advance notice when the need for leave is foreseeable and,
                  when unforeseeable, shall notify ORCA Rehab as soon as
                  reasonably practicable while complying with the Company's
                  normal attendance and call-out procedures, except where
                  prohibited by law.
                </p>
                <p>
                  ORCA Rehab reserves the right to interpret, administer,
                  amend, suspend, or modify its PTO and paid sick leave
                  policies, including accrual rates, conversion, rollover,
                  approval procedures, maximum accrual limits, documentation
                  requirements, and other administrative provisions, at any
                  time, with or without notice, provided that any such
                  changes comply with applicable federal, state, and local
                  law.
                </p>

                <h4>VI. Documentation</h4>
                <p>
                  ORCA Rehab may request reasonable documentation supporting
                  the need for paid sick leave only to the extent permitted
                  by applicable law. Employees will not be required to
                  disclose private medical information beyond what is
                  legally permitted and reasonably necessary.
                </p>

                <h4>VII. Abuse or Misuse of Leave</h4>
                <p>
                  Employees are expected to use PTO, paid sick leave, and
                  holiday benefits honestly and appropriately. Misuse of PTO,
                  paid sick leave, holiday time, falsification of reasons
                  for leave, failure to follow notice procedures, or abuse of
                  leave may result in corrective action, up to and including
                  termination, consistent with applicable law.
                </p>
                <p>
                  ORCA Rehab will not discipline or retaliate against an
                  employee for properly requesting or using paid sick leave
                  or protected leave in accordance with applicable law.
                </p>

                <h4>VIII. No Retaliation</h4>
                <p>
                  ORCA Rehab prohibits retaliation, discrimination,
                  discipline, or adverse action against any employee for
                  properly requesting, using, or attempting to use paid sick
                  leave or other protected leave in accordance with
                  applicable law.
                </p>
                <p>
                  Employees should report any concern regarding retaliation
                  or interference with protected leave rights to ORCA Rehab
                  leadership or the designated HR contact.
                </p>

                <h4>IX. Coordination With Other Leave Laws</h4>
                <p>
                  PTO and paid sick leave may run concurrently with other
                  legally protected leaves where permitted by law. ORCA
                  Rehab will comply with all applicable federal, state, and
                  local leave laws.
                </p>
                <p>
                  If any local, state, or federal law provides greater rights
                  or benefits than this policy, ORCA Rehab will comply with
                  the applicable legal requirement.
                </p>

                <h4>X. Operational Needs and Policy Administration</h4>
                <p>
                  ORCA Rehab reserves the right to modify schedules, holiday
                  assignments, staffing requirements, provider coverage
                  expectations, facility assignments, rounding schedules,
                  PTO approvals, leave procedures, and other operational
                  requirements based on patient care demands, operational
                  needs, staffing availability, facility expectations, and
                  applicable law.
                </p>
                <p>
                  Any approved holiday time off beyond the provisions
                  outlined in this policy may require the use of accrued
                  PTO, vacation time, or unpaid leave, subject to management
                  approval.
                </p>
                <p>
                  ORCA Rehab retains discretion to interpret, administer,
                  and implement this policy, consistent with applicable law.
                </p>

                <h4>XI. Policy Changes</h4>
                <p>
                  This policy is intended as a guideline only and does not
                  create a contract of employment or guarantee any
                  particular benefit. ORCA Rehab reserves the right to
                  modify, amend, suspend, or discontinue this policy at any
                  time, with or without notice, subject to applicable law.
                  Nothing in this policy alters the at-will employment
                  relationship between ORCA Rehab and its employees.
                </p>

                <h4>Employee Acknowledgment</h4>
                <p>
                  I acknowledge that I have received and reviewed the ORCA
                  Rehab, Inc. Holiday, Paid Time Off, and Paid Sick Leave
                  Policy. I understand that this policy may be modified from
                  time to time, subject to applicable law, and that this
                  policy does not alter the at-will employment relationship.
                </p>
                <p>
                  I further acknowledge that this policy is intended solely
                  as a guideline, does not constitute a contract of
                  employment, and may be modified, amended, suspended, or
                  discontinued by ORCA Rehab at any time, subject to
                  applicable law.
                </p>
              </div>
            </div>

            <p className="policy-scroll-status">
              {hasReadPolicy
                ? "✓ You've reached the end of the policy."
                : "⬇ Scroll to the bottom to continue."}
            </p>

            <label className="form-field">
              <span>Type your full legal name to sign</span>
              <input
                type="text"
                autoComplete="off"
                placeholder={
                  hasReadPolicy
                    ? "e.g. Jane Doe"
                    : "Scroll through the policy above first"
                }
                value={policyForm.fullName}
                onChange={(event) =>
                  setPolicyForm({ fullName: event.target.value })
                }
                disabled={!hasReadPolicy}
                required
              />
              <small>
                By typing your name, you are electronically signing this
                policy agreement.
              </small>
            </label>

            <div className="form-footer">
              <p>All fields are required.</p>

              <button
                className="primary-button"
                type="submit"
                disabled={isSubmitting || !hasReadPolicy}
              >
                {isSubmitting ? "Submitting…" : "Sign and submit"}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
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
            <p className="eyebrow">STEP 1 OF 4</p>
            <h1>Employee Information</h1>
            <p>Please enter your legal information exactly as it appears on official records.</p>
          </div>
        </header>

        <div className="progress-track" aria-label="Onboarding progress">
          <div className="progress-value" style={{ width: "25%" }} />
        </div>

        <form className="employee-form" onSubmit={handleEmployeeSubmit}>
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
              <span>Degree</span>
              <input
                type="text"
                name="degree"
                placeholder="e.g. Nursing, Engineering"
                value={form.degree}
                onChange={(event) => updateField("degree", event.target.value)}
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

          <label className="form-field">
            <span>Driver's license photo</span>
            <input
              type="file"
              name="driverLicensePhoto"
              accept="image/*"
              onChange={handleLicenseChange}
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
            <span>Resume</span>
            <input
              type="file"
              name="resume"
              accept=".pdf,.doc,.docx"
              onChange={handleResumeChange}
              required
            />

            {form.resume && (
              <small className="file-name">{form.resume.name}</small>
            )}
          </label>

          <div className="form-footer">
            <p>All fields are required.</p>

            <button className="primary-button" type="submit">
              Save and continue
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default App;
