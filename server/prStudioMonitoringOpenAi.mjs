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
  const queryPreview = cleanNullableString(value.queryPreview, 4_000);
  const exactPhrases = stringArray(value.exactPhrases, 20, 160);
  const anyKeywords = stringArray(value.anyKeywords, 40, 120);
  const requiredKeywords = stringArray(value.requiredKeywords, 20, 120);
  const excludedKeywords = stringArray(value.excludedKeywords, 40, 120);
  const lookbackDays = boundedInteger(
    value.lookbackDays,
    7,
    1,
    365,
    "lookbackDays",
  );

  if (!topicName) throw invalidInput("topicName is required");

  if (
    exactPhrases.length
    + anyKeywords.length
    + requiredKeywords.length === 0
    && !queryPreview
  ) {
    throw invalidInput(
      "Structured monitoring terms or queryPreview are required",
    );
  }

  return {
    topicName,
    queryPreview,
    exactPhrases,
    anyKeywords,
    requiredKeywords,
    excludedKeywords,
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

  const hasStructuredTopic =
    parsed.exactPhrases.length
    + parsed.anyKeywords.length
    + parsed.requiredKeywords.length > 0;

  return {
    model,
    reasoning: { effort: "low" },
    instructions: [
      "You perform recall-first public-web discovery for a PR monitoring system.",
      "You must use web search. Do not answer from model memory.",
      "Your job is to discover genuinely useful PR-monitoring signals, not to produce a canonical answer and not to decide whether evidence is sufficient.",
      "The structured topic fields exactPhrases, anyKeywords, requiredKeywords and excludedKeywords are the authoritative description of what the user wants monitored.",
      hasStructuredTopic
        ? "queryPreview, if present, is legacy display text only. Do not treat it as a finished Boolean search query and do not copy its syntax into every search."
        : "This is a legacy request without structured topic fields. Use queryPreview only as fallback semantic guidance and still create materially different searches.",
      "Before searching, infer the monitoring intent from the topic itself. Distinguish direct entity or brand mentions, broader market or editorial topics, and reputation/review topics.",
      "Run four to eight materially different searches when the topic supports them. Search different semantic angles, not lexical rewrites of one phrase.",
      "For a broad market or editorial topic, useful angles can include direct terminology, adjacent terminology and synonyms, news and events, launches or collaborations, interviews and expert commentary, trend or market analysis, and relevant organizations or people. Use only angles that actually fit the topic.",
      "For a direct entity or brand mention topic, stay narrow around the named entity and its explicit variants. Do not broaden it into generic industry coverage.",
      "brandName and brandDescription are application context only. Never add the brand to an independent market or editorial search unless the structured topic itself explicitly mentions that brand or unmistakably refers to it.",
      "requiredKeywords are topic constraints. Preserve their meaning when selecting candidate pages. excludedKeywords and excludedDomains are hard exclusions.",
      "sourceTypes describe preferred source classes. media means editorial or news media; blogs means authored editorial or expert posts; sites means substantive standalone pages on organization, company or expert sites; search is the discovery transport and is not itself a page category.",
      "Generic business directories, maps, review aggregators, classifieds, service marketplaces, homepages, generic service landing pages, tag pages and search-result pages are not PR signals and must not appear in candidatePages unless the topic explicitly asks for reviews, reputation, ratings, locations, directories or listings.",
      "Prefer standalone articles, news items, interviews, opinion or expert pieces, announcements, event pages and other substantive pages whose content itself constitutes a monitoring signal.",
      "Prioritize material published inside the requested lookback period, but do not discard an otherwise relevant candidate merely because its publication date is unclear. PR Studio verifies publication freshness separately after discovery.",
      "Do not treat a recent modification, reindexing, repost signal or search-engine freshness as proof that an old article was newly published.",
      "Open enough search results to evaluate the page itself before placing it in candidatePages.",
      "candidatePages is the editorially selected monitoring result set. Include only directly relevant pages you would actually show to a PR professional.",
      "candidatePages must contain only URLs encountered through the web-search tool. Do not invent URLs.",
      parsed.runetOnly
        ? "For this run, select only sources from the Russian internet and Russian domain zones. Do not spend search effort on foreign-domain sources that PR Studio will reject deterministically."
        : null,
      parsed.includedDomains.length
        ? `Use only these explicitly allowed domains: ${parsed.includedDomains.join(", ")}.`
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
    if (!key || byUrl.has(key)) continue;

    byUrl.set(key, candidate);

    if (byUrl.size >= parsed.maxResults) break;
  }

  return {
    summary:
      cleanString(output?.summary, 1_200)
      || "Monitoring discovery completed",
    sources: [...byUrl.values()],
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
