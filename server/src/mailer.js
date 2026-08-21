const nodemailer = require("nodemailer");

function isConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.NOTIFY_EMAIL_TO,
  );
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

module.exports = { notifyNewSubmission };
