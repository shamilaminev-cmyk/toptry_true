import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_REASONING_EFFORT = "low";
const DEFAULT_MAX_OUTPUT_TOKENS = 2_500;
const MIN_MAX_OUTPUT_TOKENS = 500;
const MAX_MAX_OUTPUT_TOKENS = 6_000;
const MAX_DOMAINS = 20;
const OPENAI_TIMEOUT_MS = 300_000;
const OPENAI_MAX_RETRIES = 1;

const RESEARCH_POLICIES = new Set([
  "corpus_then_official_web",
  "corpus_then_open_web",
]);
const VOLATILITIES = new Set(["stable", "evolving", "current"]);
const ANSWER_TYPES = new Set(["short_text", "long_text", "list", "date", "url"]);

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    outcome: {
      type: "string",
      enum: ["answer", "insufficient"],
    },
    answer: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 1_500,
    },
    rationale: {
      type: "string",
      minLength: 1,
      maxLength: 1_200,
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
  },
  required: ["outcome", "answer", "rationale", "confidence"],
};

export function parsePrStudioWebResearchInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }

  const brandName = cleanString(value.brand?.name, 160);
  const brandDescription = cleanNullableString(value.brand?.description, 2_000);
  if (!brandName) throw invalidInput("Brand name is required");

  const questionKey = cleanString(value.question?.questionKey, 120);
  const question = cleanString(value.question?.question, 1_000);
  const helpText = cleanNullableString(value.question?.helpText, 2_000);
  const answerType = cleanString(value.question?.answerType, 40);
  const researchPolicy = cleanString(value.question?.researchPolicy, 60);
  const volatility = cleanString(value.question?.volatility, 40);
  const currentAnswer = cleanNullableString(value.question?.currentAnswer, 4_000);

  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(questionKey)) {
    throw invalidInput("question.questionKey is invalid");
  }
  if (!question) throw invalidInput("question.question is required");
  if (!ANSWER_TYPES.has(answerType)) {
    throw invalidInput("question.answerType is invalid");
  }
  if (!RESEARCH_POLICIES.has(researchPolicy)) {
    throw invalidInput("question.researchPolicy does not allow web research");
  }
  if (!VOLATILITIES.has(volatility)) {
    throw invalidInput("question.volatility is invalid");
  }

  const allowedDomains = parseDomains(value.allowedDomains);
  if (
    researchPolicy === "corpus_then_official_web" &&
    allowedDomains.length === 0
  ) {
    throw invalidInput("Official web research requires at least one allowed domain");
  }

  const maxOutputTokens = parseBoundedInteger(
    value.maxOutputTokens,
    DEFAULT_MAX_OUTPUT_TOKENS,
    MIN_MAX_OUTPUT_TOKENS,
    MAX_MAX_OUTPUT_TOKENS,
    "maxOutputTokens",
  );

  return {
    brand: {
      name: brandName,
      description: brandDescription,
    },
    question: {
      questionKey,
      question,
      helpText,
      answerType,
      researchPolicy,
      volatility,
      currentAnswer,
    },
    allowedDomains,
    maxOutputTokens,
  };
}

export function buildPrStudioWebResearchRequest(parsed) {
  const model =
    String(
      process.env.PR_STUDIO_WEB_RESEARCH_MODEL ||
        process.env.PR_STUDIO_TEXT_MODEL ||
        DEFAULT_MODEL,
    ).trim() || DEFAULT_MODEL;
  const webSearch = {
    type: "web_search",
    search_context_size: "medium",
    external_web_access: true,
  };
  if (parsed.question.researchPolicy === "corpus_then_official_web") {
    webSearch.filters = { allowed_domains: parsed.allowedDomains };
  }

  return {
    model,
    reasoning: { effort: DEFAULT_REASONING_EFFORT },
    instructions: buildInstructions(parsed),
    input: JSON.stringify({
      brand: parsed.brand,
      question: parsed.question,
      allowedDomains: parsed.allowedDomains,
    }),
    tools: [webSearch],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_output_tokens: parsed.maxOutputTokens,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "pr_studio_targeted_web_research",
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  };
}

export async function executePrStudioWebResearch(input, options = {}) {
  const parsed = parsePrStudioWebResearchInput(input);
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const client = options.client || createOpenAiClient(apiKey);
  const request = buildPrStudioWebResearchRequest(parsed);
  const response = await client.responses.create(request);
  const diagnostics = collectProviderDiagnostics(response);

  if (response?.status === "incomplete") {
    throw invalidResponse(
      `OpenAI response was incomplete: ${diagnostics.incompleteReason || "unknown_reason"}`,
      {
        code: "PR_STUDIO_WEB_RESEARCH_INCOMPLETE_RESPONSE",
        ...diagnostics,
      },
    );
  }
  if (response?.status && response.status !== "completed") {
    throw invalidResponse(`OpenAI response status was ${response.status}`, {
      code: "PR_STUDIO_WEB_RESEARCH_INVALID_RESPONSE",
      ...diagnostics,
    });
  }

  const refusal = extractRefusal(response);
  if (refusal) {
    throw invalidResponse("OpenAI refused web research", {
      code: "PR_STUDIO_WEB_RESEARCH_REFUSAL",
      ...diagnostics,
    });
  }

  const outputText = extractOutputText(response);
  if (!outputText) {
    throw invalidResponse("OpenAI returned no web research output", {
      ...diagnostics,
      outputLength: 0,
    });
  }

  let output;
  try {
    output = JSON.parse(outputText);
  } catch {
    throw invalidResponse("OpenAI returned malformed web research JSON", {
      ...diagnostics,
      outputLength: outputText.length,
    });
  }
  const normalized = normalizeResearchOutput(output);
  const metadata = collectWebSearchMetadata(response, outputText);
  if (normalized.outcome === "answer" && metadata.citations.length === 0) {
    throw invalidResponse("Web research answer has no cited URL", {
      ...diagnostics,
      outputLength: outputText.length,
    });
  }

  return {
    questionKey: parsed.question.questionKey,
    researchPolicy: parsed.question.researchPolicy,
    outcome: normalized.outcome,
    answer: normalized.answer,
    rationale: normalized.rationale,
    confidence: normalized.confidence,
    citations: metadata.citations,
    sources: metadata.sources,
    queries: metadata.queries,
    model: response.model || request.model,
    responseId: response.id || null,
    usage: normalizeUsage(response.usage),
  };
}

function buildInstructions(parsed) {
  return [
    "You perform narrowly targeted web research for one canonical brand-profile question.",
    "You must use the supplied web search tool. Do not answer from model memory.",
    "Return only facts supported by current web results and cited URLs.",
    "If evidence is insufficient, conflicting, stale, or cannot be tied confidently to this exact brand, return outcome insufficient and answer null.",
    "Do not infer legal names, founders, awards, biographies, contacts, social accounts, addresses, hours, or public figures from weak name similarity.",
    "Prefer primary and first-party sources. For current facts, prefer the newest clearly dated evidence.",
    "Keep the answer concise and reusable as a canonical reference answer, not a research report.",
    "For short_text, date, or url answers, return one direct line. For list answers, return a compact list. For long_text, normally use one to three compact sentences.",
    "The rationale should explain the evidence quality and any limitations without introducing uncited facts.",
    parsed.question.researchPolicy === "corpus_then_official_web"
      ? `Search only the verified official domains supplied by the application: ${parsed.allowedDomains.join(", ")}.`
      : "Open-web research is allowed, but primary sources should still be preferred over directories, aggregators, reposts, and unsourced profiles.",
  ].join("\n");
}

function normalizeResearchOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse("OpenAI returned an invalid web research object");
  }
  const outcome = cleanString(value.outcome, 30);
  const answer = cleanNullableString(value.answer, 1_500);
  const rationale = cleanString(value.rationale, 1_200);
  const confidence = value.confidence;
  if (!new Set(["answer", "insufficient"]).has(outcome)) {
    throw invalidResponse("OpenAI returned an invalid web research outcome");
  }
  if (!rationale || typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw invalidResponse("OpenAI returned incomplete web research metadata");
  }
  if (confidence < 0 || confidence > 1) {
    throw invalidResponse("OpenAI returned web research confidence outside 0..1");
  }
  if ((outcome === "answer") !== Boolean(answer)) {
    throw invalidResponse("Web research outcome and answer do not match");
  }
  return { outcome, answer, rationale, confidence };
}

function collectWebSearchMetadata(response, outputText) {
  const citations = [];
  const sources = [];
  const queries = [];

  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type === "web_search_call") {
      const action = item.action && typeof item.action === "object" ? item.action : {};
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

function dedupeByUrl(values) {
  const byUrl = new Map();
  for (const value of values) {
    if (!byUrl.has(value.url)) byUrl.set(value.url, value);
  }
  return [...byUrl.values()];
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

function parseDomains(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_DOMAINS) {
    throw invalidInput(`allowedDomains must contain at most ${MAX_DOMAINS} domains`);
  }
  const domains = [];
  for (const item of value) {
    const domain = cleanString(item, 253).toLowerCase().replace(/\.$/, "");
    if (!isPublicDomain(domain)) {
      throw invalidInput(`Invalid allowed domain: ${domain || "empty"}`);
    }
    domains.push(domain);
  }
  return [...new Set(domains)];
}

function isPublicDomain(value) {
  if (!value || value.includes(":") || value.includes("/") || value.includes("@")) {
    return false;
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
    return false;
  }
  return !(
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value.endsWith(".internal")
  );
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

function boundedIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value <= length ? value : null;
}

function parseBoundedInteger(value, fallback, minimum, maximum, field) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalidInput(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
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
  error.code = "PR_STUDIO_TRANSPORT_INVALID_INPUT";
  return error;
}

function invalidResponse(message, details = {}) {
  const error = new Error(message);
  error.code = details.code || "PR_STUDIO_WEB_RESEARCH_INVALID_RESPONSE";
  for (const [key, value] of Object.entries(details)) {
    if (key !== "code") error[key] = value;
  }
  return error;
}
