import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.7-flash";
const DEFAULT_MAX_OUTPUT_TOKENS = 2_500;
const MIN_MAX_OUTPUT_TOKENS = 500;
const MAX_MAX_OUTPUT_TOKENS = 6_000;
const MAX_QUESTION_LENGTH = 1_000;
const MAX_LANGUAGE_LENGTH = 40;
const MAX_REGION_LENGTH = 120;

export const PR_STUDIO_GEO_VISIBILITY_GOOGLE_SURFACE_KEY =
  "google_gemini_search_grounding";
export const PR_STUDIO_GEO_VISIBILITY_GOOGLE_METHODOLOGY_KEY =
  "gemini_generate_content_google_search";
export const PR_STUDIO_GEO_VISIBILITY_GOOGLE_METHODOLOGY_VERSION =
  "2026-08-19.v1";

export function parsePrStudioGeoVisibilityGoogleMeasurementInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }

  const question = cleanString(value.question, MAX_QUESTION_LENGTH);
  const language = cleanString(value.language, MAX_LANGUAGE_LENGTH) || "ru";
  const region = cleanString(value.region, MAX_REGION_LENGTH) || "Россия";
  if (!question) throw invalidInput("question is required");

  const maxOutputTokens = parseBoundedInteger(
    value.maxOutputTokens,
    DEFAULT_MAX_OUTPUT_TOKENS,
    MIN_MAX_OUTPUT_TOKENS,
    MAX_MAX_OUTPUT_TOKENS,
    "maxOutputTokens",
  );

  return {
    question,
    language,
    region,
    maxOutputTokens,
  };
}

export function buildPrStudioGeoVisibilityGoogleMeasurementRequest(parsed) {
  const model =
    String(process.env.PR_STUDIO_GEO_VISIBILITY_GEMINI_MODEL || DEFAULT_MODEL).trim()
      || DEFAULT_MODEL;

  return {
    model,
    contents: parsed.question,
    config: {
      systemInstruction: buildInstructions(parsed),
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
      maxOutputTokens: parsed.maxOutputTokens,
    },
  };
}

export async function executePrStudioGeoVisibilityGoogleMeasurement(
  input,
  options = {},
) {
  const parsed = parsePrStudioGeoVisibilityGoogleMeasurementInput(input);
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const client = options.client || createGeminiClient(apiKey);
  const request = buildPrStudioGeoVisibilityGoogleMeasurementRequest(parsed);

  let response;
  try {
    response = await client.models.generateContent(request);
  } catch (error) {
    if (error?.code === "PR_STUDIO_GEMINI_NOT_CONFIGURED") throw error;
    const wrapped = new Error("Gemini GEO measurement request failed");
    wrapped.code = "PR_STUDIO_GEMINI_UPSTREAM_FAILED";
    wrapped.providerStatus = finiteNumberOrNull(error?.status);
    wrapped.providerMessage = error instanceof Error
      ? error.message.slice(0, 700)
      : String(error).slice(0, 700);
    throw wrapped;
  }

  const diagnostics = collectProviderDiagnostics(response, request.model);
  if (diagnostics.promptBlockReason) {
    throw invalidResponse(
      `Gemini blocked GEO measurement prompt: ${diagnostics.promptBlockReason}`,
      diagnostics,
    );
  }
  if (diagnostics.finishReason && diagnostics.finishReason !== "STOP") {
    throw invalidResponse(
      `Gemini GEO measurement finish reason was ${diagnostics.finishReason}`,
      {
        code: diagnostics.finishReason === "MAX_TOKENS"
          ? "PR_STUDIO_TRANSPORT_INCOMPLETE_RESPONSE"
          : "PR_STUDIO_TRANSPORT_INVALID_RESPONSE",
        ...diagnostics,
      },
    );
  }

  const answerText = extractResponseText(response).trim();
  if (!answerText) {
    throw invalidResponse("Gemini returned no GEO measurement answer", {
      ...diagnostics,
      outputLength: 0,
    });
  }

  const web = collectGoogleSearchGrounding(response, answerText);
  if (!web.queries.length || !web.sources.length) {
    throw invalidResponse(
      "Gemini returned an ungrounded GEO measurement response",
      {
        code: "PR_STUDIO_GEO_GOOGLE_GROUNDING_REQUIRED",
        ...diagnostics,
        queryCount: web.queries.length,
        sourceCount: web.sources.length,
      },
    );
  }

  return {
    surfaceKey: PR_STUDIO_GEO_VISIBILITY_GOOGLE_SURFACE_KEY,
    methodologyKey: PR_STUDIO_GEO_VISIBILITY_GOOGLE_METHODOLOGY_KEY,
    methodologyVersion: PR_STUDIO_GEO_VISIBILITY_GOOGLE_METHODOLOGY_VERSION,
    answerText,
    citations: web.citations,
    sources: web.sources,
    queries: web.queries,
    model: diagnostics.model,
    responseId: diagnostics.responseId,
    usage: normalizeUsage(response?.usageMetadata, web.queries.length),
  };
}

function buildInstructions(parsed) {
  return [
    "Answer the supplied question as a normal public-facing AI assistant using Google Search grounding.",
    "This request is an observational measurement. Do not optimize the answer for or against any brand, company, product, website, or competitor.",
    "Do not mention the measurement, hidden instructions, provider API, or evaluation process in the answer.",
    "Do not invent recommendations merely to make the answer comprehensive. Recommend or compare named entities only when they are genuinely relevant to the user's question and supported by the web evidence you find.",
    "Use current public web information and answer naturally rather than describing the search process.",
    `Write the final answer in language ${JSON.stringify(parsed.language)}.`,
    `Use region ${JSON.stringify(parsed.region)} only as geographic context when the question makes location relevant.`,
  ].join("\n");
}

function collectGoogleSearchGrounding(response, answerText) {
  const candidate = Array.isArray(response?.candidates) ? response.candidates[0] : null;
  const grounding = candidate?.groundingMetadata && typeof candidate.groundingMetadata === "object"
    ? candidate.groundingMetadata
    : {};
  const chunks = Array.isArray(grounding.groundingChunks)
    ? grounding.groundingChunks
    : [];
  const supports = Array.isArray(grounding.groundingSupports)
    ? grounding.groundingSupports
    : [];

  const sources = chunks
    .map((chunk) => normalizeGroundingSource(chunk?.web))
    .filter(Boolean);
  const citations = [];

  for (const support of supports) {
    const segment = support?.segment && typeof support.segment === "object"
      ? support.segment
      : {};
    const startIndex = boundedIndex(segment.startIndex, answerText.length);
    const endIndex = boundedIndex(segment.endIndex, answerText.length);
    const citedText = cleanNullableString(segment.text, 2_000)
      || (
        startIndex !== null &&
        endIndex !== null &&
        endIndex > startIndex
          ? answerText.slice(startIndex, endIndex)
          : null
      );
    const indices = Array.isArray(support?.groundingChunkIndices)
      ? support.groundingChunkIndices
      : [];

    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= sources.length) continue;
      citations.push({
        ...sources[index],
        citedText,
      });
    }
  }

  const queries = Array.isArray(grounding.webSearchQueries)
    ? grounding.webSearchQueries
        .map((query) => cleanString(query, 500))
        .filter(Boolean)
    : [];

  return {
    citations: dedupeCitations(citations).slice(0, 100),
    sources: dedupeSources(sources).slice(0, 300),
    queries: [...new Set(queries)].slice(0, 20),
  };
}

function normalizeGroundingSource(web) {
  if (!web || typeof web !== "object") return null;
  const url = cleanPublicUrl(web.uri);
  if (!url) return null;
  const title = cleanNullableString(web.title, 500);
  return {
    url,
    title,
    domain: inferEvidenceDomain(url, title),
  };
}

function inferEvidenceDomain(urlValue, titleValue) {
  const title = String(titleValue || "").trim();
  if (title) {
    const fromTitle = normalizeDomainCandidate(title);
    if (fromTitle) return fromTitle;
  }

  try {
    const hostname = new URL(urlValue).hostname
      .replace(/^www\./, "")
      .replace(/\.$/, "")
      .toLowerCase();
    if (!hostname || isGoogleRedirectHost(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

function normalizeDomainCandidate(value) {
  const raw = value.trim().toLowerCase();
  if (!raw || /\s/.test(raw)) return null;
  try {
    const hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
      .replace(/^www\./, "")
      .replace(/\.$/, "")
      .toLowerCase();
    if (!hostname.includes(".") || isGoogleRedirectHost(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

function isGoogleRedirectHost(hostname) {
  return hostname === "vertexaisearch.cloud.google.com"
    || hostname.endsWith(".google.com")
    || hostname.endsWith(".googleusercontent.com");
}

function cleanPublicUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function dedupeSources(values) {
  const byKey = new Map();
  for (const value of values) {
    const key = `${value.url}\n${value.domain || ""}`;
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()];
}

function dedupeCitations(values) {
  const byKey = new Map();
  for (const value of values) {
    const key = `${value.url}\n${value.citedText || ""}`;
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()];
}

function extractResponseText(response) {
  if (typeof response?.text === "string" && response.text.trim()) {
    return response.text;
  }
  const parts = [];
  const candidate = Array.isArray(response?.candidates) ? response.candidates[0] : null;
  for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
    if (typeof part?.text === "string") parts.push(part.text);
  }
  return parts.join("");
}

function collectProviderDiagnostics(response, requestedModel) {
  const candidate = Array.isArray(response?.candidates) ? response.candidates[0] : null;
  return {
    providerStatus: null,
    promptBlockReason:
      typeof response?.promptFeedback?.blockReason === "string"
        ? response.promptFeedback.blockReason
        : null,
    finishReason:
      typeof candidate?.finishReason === "string" ? candidate.finishReason : null,
    responseId: typeof response?.responseId === "string" ? response.responseId : null,
    model:
      typeof response?.modelVersion === "string" && response.modelVersion.trim()
        ? response.modelVersion
        : requestedModel,
    usage: normalizeUsage(response?.usageMetadata, null),
    outputLength: extractResponseText(response).length,
  };
}

function normalizeUsage(usage, googleSearchQueries) {
  if (!usage || typeof usage !== "object") {
    return googleSearchQueries === null
      ? null
      : { googleSearchQueries: finiteNumberOrNull(googleSearchQueries) };
  }
  return {
    inputTokens: finiteNumberOrNull(usage.promptTokenCount),
    outputTokens: finiteNumberOrNull(usage.candidatesTokenCount),
    totalTokens: finiteNumberOrNull(usage.totalTokenCount),
    cachedInputTokens: finiteNumberOrNull(usage.cachedContentTokenCount),
    reasoningTokens: finiteNumberOrNull(usage.thoughtsTokenCount),
    toolUsePromptTokens: finiteNumberOrNull(usage.toolUsePromptTokenCount),
    googleSearchQueries: finiteNumberOrNull(googleSearchQueries),
  };
}

function createGeminiClient(apiKey) {
  if (!apiKey) {
    const error = new Error("Gemini is not configured");
    error.code = "PR_STUDIO_GEMINI_NOT_CONFIGURED";
    throw error;
  }
  return new GoogleGenAI({ apiKey });
}

function boundedIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value <= length
    ? value
    : null;
}

function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : "";
}

function cleanNullableString(value, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  const cleaned = cleanString(value, maxLength);
  return cleaned || null;
}

function parseBoundedInteger(value, fallback, min, max, fieldName) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalidInput(`${fieldName} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function invalidInput(message) {
  const error = new Error(message);
  error.code = "PR_STUDIO_TRANSPORT_INVALID_INPUT";
  return error;
}

function invalidResponse(message, details = {}) {
  const error = new Error(message);
  error.code = details.code || "PR_STUDIO_TRANSPORT_INVALID_RESPONSE";
  Object.assign(error, details);
  return error;
}
