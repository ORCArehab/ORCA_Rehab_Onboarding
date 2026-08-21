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
  },
  required: ["matches", "reason"],
  additionalProperties: false,
};

// Asks a vision-capable model whether an uploaded file actually looks like the
// kind of document it's supposed to be (e.g. catching a driver's license
// uploaded where a DEA certificate was expected). Judges document type only —
// not whether every field on it is correctly filled in.
async function verifyDocument({ buffer, contentType, filename, expectedDescription }) {
  const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;

  const fileContent =
    contentType === "application/pdf"
      ? { type: "input_file", filename: filename || "document.pdf", file_data: dataUri }
      : { type: "input_image", image_url: dataUri };

  const response = await getClient().responses.create({
    model: MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `You are reviewing a document uploaded during a healthcare provider's credentialing onboarding. This file is supposed to be: ${expectedDescription}. Look at the attached document and judge only whether it actually is that type/kind of document — not whether every field on it is filled in correctly or current. Respond with your verdict.`,
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
