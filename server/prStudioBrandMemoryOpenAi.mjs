import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5-mini";
const MAX_PAGES = 50;
const MAX_PAGE_TEXT = 6_000;
const MAX_TOTAL_TEXT = 240_000;

export function parsePrStudioBrandMemoryInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }
  const name = cleanString(value.brand?.name, 160);
  const description = cleanNullableString(value.brand?.description, 2_000);
  if (!name) throw invalidInput("Brand name is required");

  const sectionKeys = Array.isArray(value.sectionKeys)
    ? [...new Set(value.sectionKeys.map((key) => cleanString(key, 80)).filter(Boolean))]
    : [];
  if (!sectionKeys.length || sectionKeys.length > 50) {
    throw invalidInput("Brand Memory section keys are required");
  }

  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > MAX_PAGES) {
    throw invalidInput(`Pages must contain between 1 and ${MAX_PAGES} items`);
  }
  let totalText = 0;
  const pages = value.pages.map((page) => {
    const url = cleanString(page?.url, 2_048);
    const title = cleanNullableString(page?.title, 500);
    const text = cleanString(page?.text, MAX_PAGE_TEXT);
    if (!url || !text) throw invalidInput("Each page must include url and text");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw invalidInput("Each page URL must be valid");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw invalidInput("Each page URL must use HTTP or HTTPS");
    }
    totalText += text.length;
    return { url: parsed.href, title, text };
  });
  if (totalText > MAX_TOTAL_TEXT) throw invalidInput("Website text exceeds the analysis limit");
  return { brand: { name, description }, sectionKeys, pages };
}

export async function analyzePrStudioBrandMemory(input) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    const error = new Error("OpenAI is not configured");
    error.code = "PR_STUDIO_OPENAI_NOT_CONFIGURED";
    throw error;
  }
  const parsed = parsePrStudioBrandMemoryInput(input);
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: String(process.env.PR_STUDIO_TEXT_MODEL || DEFAULT_MODEL).trim(),
    instructions: [
      "You extract evidence-backed Brand Memory claims for a universal PR product.",
      "Use only facts explicitly supported by the supplied website pages.",
      "Do not infer praise, market leadership, audience traits, values, or positioning without evidence.",
      "Return concise atomic claims in the language used by the source.",
      "Every claim must cite one or more exact supplied page URLs and a short supporting excerpt.",
      "Keep prices, dates, addresses, contacts and other changeable facts precise.",
      "Do not merge conflicting facts. Return each conflict as separate claims.",
      "Use only the supplied section keys.",
      "Prefer useful claims over navigation labels, cookie text, boilerplate and duplicated page content.",
    ].join("\n"),
    input: JSON.stringify(parsed),
    text: {
      format: {
        type: "json_schema",
        name: "pr_studio_brand_memory_claims",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            claims: {
              type: "array",
              maxItems: 150,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  sectionKey: { type: "string", enum: parsed.sectionKeys },
                  value: { type: "string", minLength: 1, maxLength: 4_000 },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  sources: {
                    type: "array",
                    minItems: 1,
                    maxItems: 5,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        url: {
                          type: "string",
                          enum: parsed.pages.map((page) => page.url),
                        },
                        excerpt: { type: "string", minLength: 1, maxLength: 2_000 },
                      },
                      required: ["url", "excerpt"],
                    },
                  },
                },
                required: ["sectionKey", "value", "confidence", "sources"],
              },
            },
          },
          required: ["claims"],
        },
      },
    },
  });
  const output = JSON.parse(response.output_text || "{}");
  if (!Array.isArray(output.claims)) {
    const error = new Error("OpenAI returned an invalid Brand Memory response");
    error.code = "PR_STUDIO_OPENAI_INVALID_RESPONSE";
    throw error;
  }
  return {
    claims: output.claims,
    model: response.model || String(process.env.PR_STUDIO_TEXT_MODEL || DEFAULT_MODEL).trim(),
    responseId: response.id || null,
  };
}

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanNullableString(value, maxLength) {
  const cleaned = cleanString(value, maxLength);
  return cleaned || null;
}

function invalidInput(message) {
  const error = new Error(message);
  error.code = "PR_STUDIO_INVALID_INPUT";
  return error;
}
