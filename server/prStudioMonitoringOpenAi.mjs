import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5-mini";
const MAX_RESULTS = 60;
const MAX_SELECTED_PAGES = 40;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      maxLength: 1_200,
    },
    candidatePages: {
      type: "array",
      minItems: 0,
      maxItems: MAX_SELECTED_PAGES,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: {
            type: "string",
            minLength: 1,
            maxLength: 2_048,
          },
          title: {
            type: "string",
            maxLength: 500,
          },
          excerpt: {
            type: "string",
            maxLength: 1_500,
          },
        },
        required: ["url", "title", "excerpt"],
      },
    },
  },
  required: ["summary", "candidatePages"],
};

export function parsePrStudioMonitoringDiscoveryInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }

  const topicName = cleanString(value.topicName, 240);
  const queryPreview = cleanString(value.queryPreview, 4_000);
  const lookbackDays = boundedInteger(
    value.lookbackDays,
    7,
    1,
    365,
    "lookbackDays",
  );

  if (!topicName) throw invalidInput("topicName is required");
  if (!queryPreview) throw invalidInput("queryPreview is required");

  return {
    topicName,
    queryPreview,
    lookbackDays,
    language: cleanString(value.language, 40) || "ru",
    region: cleanString(value.region, 120) || "RU",
    runetOnly: value.runetOnly === true,
    sourceTypes: stringArray(value.sourceTypes, 20, 80),
    includedDomains: domainArray(value.includedDomains),
    excludedDomains: domainArray(value.excludedDomains),
    brandName: cleanNullableString(value.brandName, 240),
    brandDescription: cleanNullableString(value.brandDescription, 2_000),
    maxResults: boundedInteger(
      value.maxResults,
      50,
      1,
      MAX_RESULTS,
      "maxResults",
    ),
  };
}

export function buildPrStudioMonitoringDiscoveryRequest(parsed) {
  const model =
    String(
      process.env.PR_STUDIO_MONITORING_SEARCH_MODEL
        || process.env.PR_STUDIO_WEB_RESEARCH_MODEL
        || process.env.PR_STUDIO_TEXT_MODEL
        || DEFAULT_MODEL,
    ).trim() || DEFAULT_MODEL;

  const webSearch = {
    type: "web_search",
    search_context_size: "high",
    external_web_access: true,
  };

  if (parsed.includedDomains.length) {
    webSearch.filters = {
      allowed_domains: parsed.includedDomains,
    };
  }

  return {
    model,
    reasoning: { effort: "low" },
    instructions: [
      "You perform recall-first public-web discovery for a PR monitoring system.",
      "You must use web search. Do not answer from model memory.",
      "Your job is to discover a broad set of potentially relevant standalone public pages, not to produce a canonical answer and not to decide whether evidence is sufficient.",
      "Never stop merely because evidence is incomplete. Return the useful candidate pages you can ground in actual web-search results.",
      "Run four to eight materially different searches when the topic supports them. Prefer different retrieval paths rather than lexical variations of one query.",
      "Treat queryPreview as semantic search constraints, not necessarily as one literal finished search string.",
      "Prioritize material published inside the requested lookback period, but do not discard an otherwise relevant candidate merely because its publication date is unclear. PR Studio verifies publication freshness separately after discovery.",
      "Do not treat a recent modification, reindexing, repost signal or search-engine freshness as proof that an old article was newly published.",
      "Return standalone articles, news items, interviews, posts, announcements and other substantive pages. Do not return search-result pages, homepages or generic section indexes unless they are themselves the monitored publication.",
      "Open enough search results to create a useful candidate set instead of stopping after the first plausible result.",
      "candidatePages must contain only URLs encountered through the web-search tool. Do not invent URLs.",
      parsed.runetOnly
        ? "Restrict discovery to the Russian internet and Russian domain zones when possible. PR Studio will deterministically enforce its Runet domain policy after discovery."
        : null,
      parsed.excludedDomains.length
        ? `Do not use these domains: ${parsed.excludedDomains.join(", ")}.`
        : null,
    ].filter(Boolean).join("\n"),
    input: JSON.stringify(parsed),
    tools: [webSearch],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_output_tokens: 3_000,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "pr_studio_monitoring_discovery",
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  };
}

export async function executePrStudioMonitoringDiscovery(
  input,
  options = {},
) {
  const parsed = parsePrStudioMonitoringDiscoveryInput(input);
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();

  if (!apiKey && !options.client) {
    throw notConfigured();
  }

  const client =
    options.client
    || new OpenAI({
      apiKey,
      timeout: 300_000,
      maxRetries: 1,
    });

  const request = buildPrStudioMonitoringDiscoveryRequest(parsed);

  let response;
  try {
    response = await client.responses.create(request);
  } catch (error) {
    throw normalizeProviderError(error);
  }

  if (response?.status && response.status !== "completed") {
    throw invalidResponse(
      `OpenAI monitoring discovery did not complete: ${response.status}`,
    );
  }

  const outputText = extractOutputText(response);
  if (!outputText) {
    throw invalidResponse("OpenAI returned no monitoring discovery output");
  }

  let output;
  try {
    output = JSON.parse(outputText);
  } catch {
    throw invalidResponse(
      "OpenAI returned malformed monitoring discovery JSON",
    );
  }

  const metadata = collectWebSearchMetadata(response);
  const groundedSources = new Map(
    metadata.sources.map((source) => [
      comparableUrl(source.url),
      source,
    ]),
  );

  const selected = [];
  for (
    const candidate of Array.isArray(output?.candidatePages)
      ? output.candidatePages
      : []
  ) {
    const key = comparableUrl(candidate?.url);
    const grounded = key ? groundedSources.get(key) : null;
    if (!grounded) continue;

    selected.push({
      url: grounded.url,
      title:
        cleanNullableString(candidate.title, 500)
        ?? grounded.title,
      citedText:
        cleanNullableString(candidate.excerpt, 1_500),
    });
  }

  const byUrl = new Map();

  for (const candidate of selected) {
    const key = comparableUrl(candidate.url);
    if (key && !byUrl.has(key)) byUrl.set(key, candidate);
  }

  for (const source of metadata.sources) {
    const key = comparableUrl(source.url);
    if (!key || byUrl.has(key)) continue;

    byUrl.set(key, {
      url: source.url,
      title: source.title,
      citedText: null,
    });

    if (byUrl.size >= parsed.maxResults) break;
  }

  return {
    summary:
      cleanString(output?.summary, 1_200)
      || "Monitoring discovery completed",
    sources: [...byUrl.values()].slice(0, parsed.maxResults),
    queries: metadata.queries,
    model: response.model || request.model,
    responseId: response.id || null,
    usage: normalizeUsage(response.usage),
  };
}

function collectWebSearchMetadata(response) {
  const sources = [];
  const queries = [];

  for (
    const item of Array.isArray(response?.output)
      ? response.output
      : []
  ) {
    if (item?.type === "web_search_call") {
      const action =
        item.action && typeof item.action === "object"
          ? item.action
          : {};

      const actionQueries =
        Array.isArray(action.queries)
          ? action.queries
          : typeof action.query === "string"
            ? [action.query]
            : [];

      for (const query of actionQueries) {
        const cleaned = cleanString(query, 500);
        if (cleaned) queries.push(cleaned);
      }

      for (
        const source of Array.isArray(action.sources)
          ? action.sources
          : []
      ) {
        const normalized = normalizeUrlSource(source);
        if (normalized) sources.push(normalized);
      }
    }

    if (
      item?.type !== "message"
      || !Array.isArray(item.content)
    ) {
      continue;
    }

    for (const content of item.content) {
      if (content?.type !== "output_text") continue;

      for (
        const annotation of Array.isArray(content.annotations)
          ? content.annotations
          : []
      ) {
        const normalized = normalizeUrlSource(
          annotation?.url_citation || annotation,
        );
        if (normalized) sources.push(normalized);
      }
    }
  }

  return {
    sources: dedupeSources(sources),
    queries: [...new Set(queries)].slice(0, 20),
  };
}

function normalizeUrlSource(value) {
  if (!value || typeof value !== "object") return null;

  const url = cleanString(value.url, 2_048);
  if (!isPublicWebUrl(url)) return null;

  return {
    url,
    title: cleanNullableString(value.title, 500),
  };
}

function dedupeSources(values) {
  const byUrl = new Map();

  for (const value of values) {
    const key = comparableUrl(value.url);
    if (!key || byUrl.has(key)) continue;
    byUrl.set(key, value);
  }

  return [...byUrl.values()].slice(0, MAX_RESULTS);
}

function comparableUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";

    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (
        /^(utm_|yclid$|gclid$|fbclid$|ref$|source$)/i.test(key)
      ) {
        url.searchParams.delete(key);
      }
    }

    url.hostname = url.hostname.toLowerCase();

    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return "";
  }
}

function isPublicWebUrl(value) {
  try {
    const url = new URL(value);

    return (
      ["http:", "https:"].includes(url.protocol)
      && !url.username
      && !url.password
    );
  } catch {
    return false;
  }
}

function domainArray(value) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((entry) =>
          cleanString(entry, 300)
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .split("/")[0]
            .replace(/^www\./, "")
            .replace(/\.$/, ""),
        )
        .filter(Boolean),
    ),
  ].slice(0, 50);
}

function stringArray(value, maximum, maxLength) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((entry) => cleanString(entry, maxLength))
        .filter(Boolean),
    ),
  ].slice(0, maximum);
}

function extractOutputText(response) {
  if (
    typeof response?.output_text === "string"
    && response.output_text.trim()
  ) {
    return response.output_text.trim();
  }

  const parts = [];

  for (
    const item of Array.isArray(response?.output)
      ? response.output
      : []
  ) {
    if (
      item?.type !== "message"
      || !Array.isArray(item.content)
    ) {
      continue;
    }

    for (const content of item.content) {
      if (
        content?.type === "output_text"
        && typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  return {
    inputTokens: finiteNumberOrNull(usage.input_tokens),
    outputTokens: finiteNumberOrNull(usage.output_tokens),
    totalTokens: finiteNumberOrNull(usage.total_tokens),
    cachedInputTokens: finiteNumberOrNull(
      usage.input_tokens_details?.cached_tokens,
    ),
    reasoningTokens: finiteNumberOrNull(
      usage.output_tokens_details?.reasoning_tokens,
    ),
  };
}

function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function boundedInteger(
  value,
  fallback,
  minimum,
  maximum,
  field,
) {
  if (
    value === undefined
    || value === null
    || value === ""
  ) {
    return fallback;
  }

  if (
    !Number.isInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw invalidInput(`${field} is invalid`);
  }

  return value;
}

function cleanString(value, maxLength) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function cleanNullableString(value, maxLength) {
  const cleaned = cleanString(value, maxLength);
  return cleaned || null;
}

function normalizeProviderError(error) {
  const normalized = new Error(
    error instanceof Error
      ? error.message
      : "OpenAI monitoring discovery failed",
  );

  normalized.code =
    error?.code || "PR_STUDIO_MONITORING_DISCOVERY_UPSTREAM_FAILED";
  normalized.providerStatus =
    typeof error?.status === "number"
      ? error.status
      : null;
  normalized.providerRequestId =
    error?.request_id || error?.requestId || null;

  return normalized;
}

function invalidInput(message) {
  const error = new Error(message);
  error.code = "PR_STUDIO_TRANSPORT_INVALID_INPUT";
  return error;
}

function invalidResponse(message) {
  const error = new Error(message);
  error.code = "PR_STUDIO_MONITORING_DISCOVERY_INVALID_RESPONSE";
  return error;
}

function notConfigured() {
  const error = new Error(
    "OPENAI_API_KEY is not configured on the AI gateway",
  );
  error.code = "PR_STUDIO_OPENAI_NOT_CONFIGURED";
  return error;
}
