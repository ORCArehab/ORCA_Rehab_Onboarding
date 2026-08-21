const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const PDFDocument = require("pdfkit");
const { downloadFile } = require("./storage");

// A fixed document (not something each new hire uploads) that's identical
// for every NP/PA submission, so it's checked into the repo and read from
// disk rather than Supabase Storage.
const SUPERVISING_PHYSICIAN_PDF = fs.readFileSync(
  path.join(__dirname, "..", "assets", "supervising-physician-information.pdf"),
);

// Windows-illegal filename characters — the ZIP is meant to be extracted on
// whatever OS HR uses, so strip them regardless of platform.
function sanitizeForPath(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
}

function extensionFromPath(path) {
  const match = /\.[a-z0-9]+$/i.exec(path || "");
  return match ? match[0] : "";
}

// "2029-08-31" -> "8-31-29". The reference folder's date format uses "/"
// ("DEA Certificate Expires 8/31/29"), but "/" is the path separator inside a
// ZIP archive — embedding it in an entry name would silently create extra
// subfolders instead of a literal slash, so "-" stands in for it here.
function formatShortDate(dateStr) {
  if (!dateStr) return null;

  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return null;

  return `${Number(month)}-${Number(day)}-${year.slice(-2)}`;
}

function generatePdf(title, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown();
    doc.fontSize(11);

    for (const line of lines) {
      doc.text(line || " ");
      doc.moveDown(0.4);
    }

    doc.end();
  });
}

// Builds the credentialing document ZIP for one submission, matching ORCA's
// existing manual folder structure:
//
//   {Last} {Role}, {First}- Non Billing/
//   └── Dr. {Last}'s Personal Folder/
//       ├── 1. CAQH, NPPES, PECOS Login Information, NPI_{Last},{First}.pdf   (generated)
//       ├── 2. Board Certificate_{Last},{First}.{ext}
//       ├── 3. DEA Certificate[ Expires M/D/YY]_{Last},{First}.{ext}
//       ├── 4. {Degree}_{Last},{First}.{ext}
//       ├── 5. Professional Liability_{Last},{First}.{ext}
//       ├── 6. State License_{Last},{First}.{ext}
//       ├── 7. Resume (CV)_{Last},{First}.{ext}
//       ├── 8. Driving License_{Last},{First}.{ext}
//       ├── 9. SSN, DOB, SOB, Home Address_{Last},{First}.pdf                 (generated)
//       ├── 10. Supervising Physician Information_{Last},{First}.pdf          (fixed file, NP/PA only)
//       ├── 11. BLS Certificate_{Last},{First}.{ext}
//       └── 12. ACLS Certificate_{Last},{First}.{ext}                         (only if attached)
//
// Every uploaded document's extension follows whatever the new hire actually
// uploaded (e.g. resume as .docx) rather than being forced to .pdf.
async function buildCredentialingZip(submission) {
  const { employee } = submission;
  const lastName = sanitizeForPath(employee.lastName);
  const firstName = sanitizeForPath(employee.firstName);
  const personName = `${lastName},${firstName}`;

  const rootFolderName = `${lastName} ${employee.providerRole}, ${firstName}- Non Billing`;
  const personalFolderName = `Dr. ${lastName}'s Personal Folder`;

  const zip = new JSZip();
  const folder = zip.folder(rootFolderName).folder(personalFolderName);

  async function addUploadedFile(number, label, path) {
    if (!path) return;

    const downloaded = await downloadFile(path);
    if (!downloaded) return;

    folder.file(`${number}. ${label}_${personName}${extensionFromPath(path)}`, downloaded.buffer);
  }

  const loginsPdf = await generatePdf("CAQH, NPPES, PECOS Login Information & NPI", [
    `Provider: ${employee.firstName} ${employee.lastName}`,
    "",
    `NPI: ${employee.npi}`,
    "",
    `CAQH Username: ${employee.caqhUsername}`,
    `CAQH Password: ${employee.caqhPassword}`,
    "",
    `NPPES Username: ${employee.nppesUsername}`,
    `NPPES Password: ${employee.nppesPassword}`,
    "",
    `PECOS Username: ${employee.pecosUsername}`,
    `PECOS Password: ${employee.pecosPassword}`,
  ]);
  folder.file(`1. CAQH, NPPES, PECOS Login Information, NPI_${personName}.pdf`, loginsPdf);

  await addUploadedFile(2, "Board Certificate", submission.boardCertificatePath);

  const deaExpires = formatShortDate(employee.deaExpiration);
  await addUploadedFile(
    3,
    `DEA Certificate${deaExpires ? ` Expires ${deaExpires}` : ""}`,
    submission.deaCertificatePath,
  );

  await addUploadedFile(4, sanitizeForPath(employee.degree) || "Degree", submission.degreeCertificatePath);
  await addUploadedFile(5, "Professional Liability", submission.professionalLiabilityPath);
  await addUploadedFile(6, "State License", submission.stateMedicalLicensePath);
  await addUploadedFile(7, "Resume (CV)", submission.resumePath);
  await addUploadedFile(8, "Driving License", submission.driverLicensePath);

  const identityPdf = await generatePdf("SSN, DOB, SOB, Home Address", [
    `Provider: ${employee.firstName} ${employee.lastName}`,
    "",
    `SSN: ${employee.ssn}`,
    `Date of Birth: ${employee.dateOfBirth}`,
    `State of Birth: ${employee.stateOfBirth}`,
    `Home Address: ${employee.address}`,
  ]);
  folder.file(`9. SSN, DOB, SOB, Home Address_${personName}.pdf`, identityPdf);

  if (employee.providerRole === "NP" || employee.providerRole === "PA") {
    folder.file(
      `10. Supervising Physician Information_${personName}.pdf`,
      SUPERVISING_PHYSICIAN_PDF,
    );
  }

  await addUploadedFile(11, "BLS Certificate", submission.blsCertificatePath);
  await addUploadedFile(12, "ACLS Certificate", submission.aclsCertificatePath);

  return {
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
    filename: `${rootFolderName}.zip`,
  };
}

module.exports = { buildCredentialingZip };
