import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5-mini";
const MAX_PAGES = 50;
const MAX_PAGE_TEXT = 6_000;
const MAX_TOTAL_TEXT = 240_000;
const MAX_CONSOLIDATION_CLAIMS = 250;
const MAX_CLAIM_TEXT = 4_000;
const MAX_CONSOLIDATION_TEXT = 240_000;

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

export function parsePrStudioBrandMemoryConsolidationInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }
  const name = cleanString(value.brand?.name, 160);
  if (!name) throw invalidInput("Brand name is required");

  const sectionKeys = Array.isArray(value.sectionKeys)
    ? [...new Set(value.sectionKeys.map((key) => cleanString(key, 80)).filter(Boolean))]
    : [];
  if (!sectionKeys.length || sectionKeys.length > 50) {
    throw invalidInput("Brand Memory section keys are required");
  }
  const allowedSections = new Set(sectionKeys);
  const allowedStatuses = new Set(["suggested", "confirmed", "rejected"]);

  if (
    !Array.isArray(value.claims) ||
    value.claims.length < 2 ||
    value.claims.length > MAX_CONSOLIDATION_CLAIMS
  ) {
    throw invalidInput(
      `Claims must contain between 2 and ${MAX_CONSOLIDATION_CLAIMS} items`,
    );
  }

  const ids = new Set();
  let totalText = 0;
  const claims = value.claims.map((claim) => {
    const id = cleanString(claim?.id, 100);
    const sectionKey = cleanString(claim?.sectionKey, 80);
    const status = cleanString(claim?.status, 20);
    const claimValue = cleanString(claim?.value, MAX_CLAIM_TEXT);
    if (!id || ids.has(id)) throw invalidInput("Each claim ID must be unique");
    if (!allowedSections.has(sectionKey)) {
      throw invalidInput("Each claim must use a supplied section key");
    }
    if (!allowedStatuses.has(status)) {
      throw invalidInput("Each claim must use a supported review status");
    }
    if (!claimValue) throw invalidInput("Each claim must include a value");
    ids.add(id);
    totalText += claimValue.length;
    return { id, sectionKey, status, value: claimValue };
  });
  if (totalText > MAX_CONSOLIDATION_TEXT) {
    throw invalidInput("Claim text exceeds the consolidation limit");
  }

  return { brand: { name }, sectionKeys, claims };
}

export async function consolidatePrStudioBrandMemory(input) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    const error = new Error("OpenAI is not configured");
    error.code = "PR_STUDIO_OPENAI_NOT_CONFIGURED";
    throw error;
  }
  const parsed = parsePrStudioBrandMemoryConsolidationInput(input);
  const client = new OpenAI({ apiKey });
  const claimIds = parsed.claims.map((claim) => claim.id);
  const response = await client.responses.create({
    model: String(process.env.PR_STUDIO_TEXT_MODEL || DEFAULT_MODEL).trim(),
    instructions: [
      "You conservatively consolidate duplicate Brand Memory claims.",
      "Return a group only when every member has the same sectionKey, the same review status, and the same factual meaning.",
      "Different wording, punctuation, or repeated boilerplate may be consolidated.",
      "Overlapping lists may be consolidated only when they describe the same list scope; canonicalValue may combine only items explicitly present in member claims.",
      "Never add facts, infer facts, or broaden the scope.",
      "Do not merge a legal address with an atelier, shop, office, showroom, or contact address unless the claims explicitly identify the same place and role.",
      "Do not merge conflicting dates, prices, numbers, names, addresses, contacts, product scopes, or other qualifiers.",
      "When uncertain, leave claims separate.",
      "Every claim ID may occur in at most one returned group.",
      "canonicalValue must be the clearest complete formulation supported only by that group's member claims and must remain in the source language.",
      "Do not return singleton groups.",
    ].join("\n"),
    input: JSON.stringify(parsed),
    text: {
      format: {
        type: "json_schema",
        name: "pr_studio_brand_memory_consolidation",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            groups: {
              type: "array",
              maxItems: 125,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  memberIds: {
                    type: "array",
                    minItems: 2,
                    maxItems: 50,
                    items: { type: "string", enum: claimIds },
                  },
                  canonicalValue: {
                    type: "string",
                    minLength: 1,
                    maxLength: MAX_CLAIM_TEXT,
                  },
                },
                required: ["memberIds", "canonicalValue"],
              },
            },
          },
          required: ["groups"],
        },
      },
    },
  });
  const output = JSON.parse(response.output_text || "{}");
  if (!Array.isArray(output.groups)) {
    const error = new Error("OpenAI returned an invalid Brand Memory consolidation");
    error.code = "PR_STUDIO_OPENAI_INVALID_RESPONSE";
    throw error;
  }
  return {
    groups: output.groups,
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
