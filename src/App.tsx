import { useEffect, useState } from "react";
import type { ChangeEvent, SubmitEvent } from "react";
import logo from "./assets/orca-logo.png";
import { API_BASE_URL } from "./apiConfig";
import "./App.css";

type Page = "welcome" | "employee-info" | "bank-info" | "additional-info";

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
  { label: "Success", page: "additional-info", submitted: true },
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

  const handleAdditionalSubmit = async (
    event: SubmitEvent<HTMLFormElement>,
  ) => {
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

    setIsSubmitting(true);

    try {
      const formData = new FormData();

      formData.append(
        "employee",
        JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          dateOfBirth: form.dateOfBirth,
          phone: form.phone.replace(/\D/g, ""),
          address: form.address,
          degree: form.degree,
          ssn: form.ssn.replace(/\D/g, ""),
        }),
      );
      formData.append("bank", JSON.stringify(bankForm));
      formData.append("additional", JSON.stringify(additionalForm));

      if (form.driverLicensePhoto) {
        formData.append("driverLicensePhoto", form.driverLicensePhoto);
      }
      if (form.resume) {
        formData.append("resume", form.resume);
      }

      const response = await fetch(`${API_BASE_URL}/api/onboarding/submit`, {
        method: "POST",
        body: formData,
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
            submitted. Our team will follow up with the next steps of
            onboarding.
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
              <p className="eyebrow">STEP 2 OF 3</p>
              <h1>Direct Deposit Information</h1>
              <p>
                Please enter your bank account details for direct deposit
                payroll setup.
              </p>
            </div>
          </header>

          <div className="progress-track" aria-label="Onboarding progress">
            <div className="progress-value" style={{ width: "66%" }} />
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
              <p className="eyebrow">STEP 3 OF 3</p>
              <h1>Additional Information</h1>
              <p>
                A few more required details: emergency contact, work
                eligibility, and tax withholding.
              </p>
            </div>
          </header>

          <div className="progress-track" aria-label="Onboarding progress">
            <div className="progress-value" style={{ width: "100%" }} />
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

              <button
                className="primary-button"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting…" : "Submit"}
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
            <p className="eyebrow">STEP 1 OF 3</p>
            <h1>Employee Information</h1>
            <p>Please enter your legal information exactly as it appears on official records.</p>
          </div>
        </header>

        <div className="progress-track" aria-label="Onboarding progress">
          <div className="progress-value" style={{ width: "33%" }} />
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
