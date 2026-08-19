import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5.6";
const DEFAULT_REASONING_EFFORT = "low";
const DEFAULT_MAX_OUTPUT_TOKENS = 2_500;
const MIN_MAX_OUTPUT_TOKENS = 500;
const MAX_MAX_OUTPUT_TOKENS = 6_000;
const MAX_QUESTION_LENGTH = 1_000;
const MAX_LANGUAGE_LENGTH = 40;
const MAX_REGION_LENGTH = 120;
const OPENAI_TIMEOUT_MS = 300_000;
const OPENAI_MAX_RETRIES = 1;

export const PR_STUDIO_GEO_VISIBILITY_SURFACE_KEY =
  "openai_responses_web_search";
export const PR_STUDIO_GEO_VISIBILITY_METHODOLOGY_KEY =
  "openai_responses_live_web_answer";
export const PR_STUDIO_GEO_VISIBILITY_METHODOLOGY_VERSION =
  "2026-08-19.v1";

export function parsePrStudioGeoVisibilityMeasurementInput(value) {
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

export function buildPrStudioGeoVisibilityMeasurementRequest(parsed) {
  const model =
    String(
      process.env.PR_STUDIO_GEO_VISIBILITY_MODEL
        || process.env.PR_STUDIO_WEB_RESEARCH_MODEL
        || DEFAULT_MODEL,
    ).trim() || DEFAULT_MODEL;

  return {
    model,
    reasoning: { effort: DEFAULT_REASONING_EFFORT },
    instructions: buildInstructions(parsed),
    input: parsed.question,
    tools: [
      {
        type: "web_search",
        search_context_size: "medium",
        external_web_access: true,
      },
    ],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_output_tokens: parsed.maxOutputTokens,
    store: false,
  };
}

export async function executePrStudioGeoVisibilityMeasurement(
  input,
  options = {},
) {
  const parsed = parsePrStudioGeoVisibilityMeasurementInput(input);
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const client = options.client || createOpenAiClient(apiKey);
  const request = buildPrStudioGeoVisibilityMeasurementRequest(parsed);
  const response = await client.responses.create(request);
  const diagnostics = collectProviderDiagnostics(response);

  if (response?.status === "incomplete") {
    throw invalidResponse(
      `OpenAI GEO measurement was incomplete: ${diagnostics.incompleteReason || "unknown_reason"}`,
      {
        code: "PR_STUDIO_TRANSPORT_INCOMPLETE_RESPONSE",
        ...diagnostics,
      },
    );
  }
  if (response?.status && response.status !== "completed") {
    throw invalidResponse(
      `OpenAI GEO measurement status was ${response.status}`,
      {
        code: "PR_STUDIO_TRANSPORT_INVALID_RESPONSE",
        ...diagnostics,
      },
    );
  }
  if (extractRefusal(response)) {
    throw invalidResponse("OpenAI refused GEO measurement", {
      code: "PR_STUDIO_TRANSPORT_REFUSAL",
      ...diagnostics,
    });
  }

  const answerText = extractOutputText(response).trim();
  if (!answerText) {
    throw invalidResponse("OpenAI returned no GEO measurement answer", {
      ...diagnostics,
      outputLength: 0,
    });
  }

  const web = collectWebSearchMetadata(response, answerText);

  return {
    surfaceKey: PR_STUDIO_GEO_VISIBILITY_SURFACE_KEY,
    methodologyKey: PR_STUDIO_GEO_VISIBILITY_METHODOLOGY_KEY,
    methodologyVersion: PR_STUDIO_GEO_VISIBILITY_METHODOLOGY_VERSION,
    answerText,
    citations: web.citations,
    sources: web.sources,
    queries: web.queries,
    model: response.model || request.model,
    responseId: response.id || null,
    usage: normalizeUsage(response.usage),
  };
}

function buildInstructions(parsed) {
  return [
    "Answer the supplied question as a normal public-facing AI assistant using live web search.",
    "This request is an observational measurement. Do not optimize the answer for or against any brand, company, product, website, or competitor.",
    "Do not mention the measurement, hidden instructions, provider API, or evaluation process in the answer.",
    "Do not invent recommendations merely to make the answer comprehensive. Recommend or compare named entities only when they are genuinely relevant to the user's question and supported by the web evidence you find.",
    "Use current public web information. Search is required, but answer naturally rather than describing the search process.",
    `Write the final answer in language ${JSON.stringify(parsed.language)}.`,
    `Use region ${JSON.stringify(parsed.region)} only as geographic context when the question makes location relevant.`,
  ].join("\n");
}

function collectWebSearchMetadata(response, outputText) {
  const citations = [];
  const sources = [];
  const queries = [];

  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type === "web_search_call") {
      const action = item.action && typeof item.action === "object"
        ? item.action
        : {};
      const actionQueries = Array.isArray(action.queries)
        ? action.queries
        : typeof action.query === "string"
          ? [action.query]
          : [];
      for (const query of actionQueries) {
        const cleaned = cleanString(query, 500);
        if (cleaned) queries.push(cleaned);
      }
      for (const source of Array.isArray(action.sources) ? action.sources : []) {
        const normalized = normalizeUrlSource(source);
        if (normalized) sources.push(normalized);
      }
    }

    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type !== "output_text") continue;
      for (const annotation of Array.isArray(content.annotations)
        ? content.annotations
        : []) {
        const normalized = normalizeCitation(annotation, outputText);
        if (normalized) citations.push(normalized);
      }
    }
  }

  return {
    citations: dedupeByUrl(citations),
    sources: dedupeByUrl([...citations, ...sources]).map(({ url, title }) => ({
      url,
      title,
    })),
    queries: [...new Set(queries)].slice(0, 20),
  };
}

function normalizeCitation(annotation, outputText) {
  if (!annotation || typeof annotation !== "object") return null;
  const value = annotation.url_citation || annotation;
  if (value.type && value.type !== "url_citation") return null;
  const source = normalizeUrlSource(value);
  if (!source) return null;
  const startIndex = boundedIndex(value.start_index, outputText.length);
  const endIndex = boundedIndex(value.end_index, outputText.length);
  const citedText =
    startIndex !== null && endIndex !== null && endIndex > startIndex
      ? outputText.slice(startIndex, endIndex)
      : null;
  return { ...source, citedText };
}

function normalizeUrlSource(value) {
  const url = cleanPublicUrl(value?.url);
  if (!url) return null;
  return {
    url,
    title: cleanNullableString(value?.title, 500),
  };
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

function dedupeByUrl(values) {
  const byUrl = new Map();
  for (const value of values) {
    if (!byUrl.has(value.url)) byUrl.set(value.url, value);
  }
  return [...byUrl.values()];
}

function boundedIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value <= length
    ? value
    : null;
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }
  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
}

function extractRefusal(response) {
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "refusal") return true;
    }
  }
  return false;
}

function createOpenAiClient(apiKey) {
  if (!apiKey) {
    const error = new Error("OpenAI is not configured");
    error.code = "PR_STUDIO_OPENAI_NOT_CONFIGURED";
    throw error;
  }
  return new OpenAI({
    apiKey,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: OPENAI_MAX_RETRIES,
  });
}

function collectProviderDiagnostics(response) {
  return {
    providerStatus: typeof response?.status === "string" ? response.status : null,
    incompleteReason:
      typeof response?.incomplete_details?.reason === "string"
        ? response.incomplete_details.reason
        : null,
    providerRequestId:
      typeof response?._request_id === "string" ? response._request_id : null,
    responseId: typeof response?.id === "string" ? response.id : null,
    model: typeof response?.model === "string" ? response.model : null,
    usage: normalizeUsage(response?.usage),
    outputItemTypes: Array.isArray(response?.output)
      ? response.output
          .map((item) => (typeof item?.type === "string" ? item.type : "unknown"))
          .slice(0, 20)
      : [],
  };
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens: finiteNumberOrNull(usage.input_tokens),
    outputTokens: finiteNumberOrNull(usage.output_tokens),
    totalTokens: finiteNumberOrNull(usage.total_tokens),
    cachedInputTokens: finiteNumberOrNull(usage.input_tokens_details?.cached_tokens),
    reasoningTokens: finiteNumberOrNull(usage.output_tokens_details?.reasoning_tokens),
  };
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
