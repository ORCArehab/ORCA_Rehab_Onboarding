const nodemailer = require("nodemailer");

// Whether the transporter itself can be built at all — independent of
// NOTIFY_EMAIL_TO, which only matters for the HR notification below, not for
// sending an applicant a password reset link.
function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function isConfigured() {
  return isSmtpConfigured() && Boolean(process.env.NOTIFY_EMAIL_TO);
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function notifyNewSubmission({ firstName, lastName }) {
  if (!isConfigured()) {
    console.warn(
      "Email notifications aren't configured (see server/.env.example) — skipping notification.",
    );
    return;
  }

  const transporter = createTransport();
  const dashboardUrl = process.env.ADMIN_DASHBOARD_URL || "http://localhost:5173/admin";

  await transporter.sendMail({
    from: process.env.NOTIFY_EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL_TO,
    subject: `New onboarding submission: ${firstName} ${lastName}`,
    text: `${firstName} ${lastName} just completed onboarding.\n\nView details here:\n${dashboardUrl}`,
  });
}

async function sendPasswordResetEmail({ to, firstName, resetUrl }) {
  if (!isSmtpConfigured()) {
    throw new Error(
      "SMTP isn't configured (see server/.env.example) — cannot send the password reset email.",
    );
  }

  const transporter = createTransport();

  await transporter.sendMail({
    from: process.env.NOTIFY_EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject: "Reset your ORCA Rehab onboarding password",
    text: `Hi ${firstName},\n\nSomeone requested a password reset for your ORCA Rehab onboarding account. If this was you, click the link below to set a new password (this link expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
  });
}

module.exports = { notifyNewSubmission, sendPasswordResetEmail };
