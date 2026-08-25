const OpenAI = require("openai");

// "mini" tier keeps this cheap — it's a single classification call per
// document, not a task that needs a flagship model. Override via env if a
// different model turns out to work better.
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

let client;

function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    matches: { type: "boolean" },
    reason: { type: "string" },
    expirationDate: { type: ["string", "null"] },
    isExpired: { type: ["boolean", "null"] },
  },
  required: ["matches", "reason", "expirationDate", "isExpired"],
  additionalProperties: false,
};

// Asks a vision-capable model whether an uploaded file actually looks like the
// kind of document it's supposed to be (e.g. catching a driver's license
// uploaded where a DEA certificate was expected). Judges document type only —
// not whether every field on it is correctly filled in.
//
// When `checkExpiration` is set, it's also asked to read the expiration date
// printed on the document itself and judge whether it's expired as of today —
// this is what lets the DEA certificate field skip a separate manually-entered
// expiration date; the AI reads it straight off the document instead.
async function verifyDocument({
  buffer,
  contentType,
  filename,
  expectedDescription,
  checkExpiration,
}) {
  const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;

  const fileContent =
    contentType === "application/pdf"
      ? { type: "input_file", filename: filename || "document.pdf", file_data: dataUri }
      : { type: "input_image", image_url: dataUri };

  const today = new Date().toISOString().slice(0, 10);

  const expirationInstruction = checkExpiration
    ? ` This document should also have a visible expiration date printed on it. Find it, and report it in expirationDate as YYYY-MM-DD. Today's date is ${today} — set isExpired to true if that date is in the past, false if it's still current. If you can't find an expiration date on the document, set expirationDate and isExpired to null.`
    : " This document type doesn't need an expiration check — always set expirationDate and isExpired to null.";

  const response = await getClient().responses.create({
    model: MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `You are reviewing a document uploaded during a healthcare provider's credentialing onboarding. This file is supposed to be: ${expectedDescription}. Look at the attached document and judge only whether it actually is that type/kind of document — not whether every field on it is filled in correctly.${expirationInstruction} Respond with your verdict.`,
          },
          fileContent,
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "document_verdict",
        schema: VERDICT_SCHEMA,
        strict: true,
      },
    },
  });

  return JSON.parse(response.output_text);
}

module.exports = { isConfigured, verifyDocument };
