const DEFAULT_ENDPOINT = "https://searchapi.api.cloud.yandex.net/v2/gen/search";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_QUESTION_LENGTH = 1_000;
const MAX_LANGUAGE_LENGTH = 40;
const MAX_REGION_LENGTH = 120;

export const PR_STUDIO_GEO_VISIBILITY_YANDEX_SURFACE_KEY =
  "yandex_search_generative_answer";
export const PR_STUDIO_GEO_VISIBILITY_YANDEX_METHODOLOGY_KEY =
  "yandex_search_api_gen_search";
export const PR_STUDIO_GEO_VISIBILITY_YANDEX_METHODOLOGY_VERSION =
  "2026-08-24.v1";

export function parsePrStudioGeoVisibilityYandexMeasurementInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }

  const question = cleanString(value.question, MAX_QUESTION_LENGTH);
  const language = cleanString(value.language, MAX_LANGUAGE_LENGTH) || "ru";
  const region = cleanString(value.region, MAX_REGION_LENGTH) || "Россия";
  if (!question) throw invalidInput("question is required");

  return { question, language, region };
}

export function buildPrStudioGeoVisibilityYandexMeasurementRequest(parsed, folderId) {
  return {
    messages: [{ role: "ROLE_USER", content: buildUserMessage(parsed) }],
    folderId,
    fixMisspell: true,
    enableNrfmDocs: false,
    enableRichStructuredAnswer: false,
    getPartialResults: false,
    searchType: yandexSearchTypeForLanguage(parsed.language),
  };
}

export async function executePrStudioGeoVisibilityYandexMeasurement(
  input,
  options = {},
) {
  const parsed = parsePrStudioGeoVisibilityYandexMeasurementInput(input);
  const apiKey = String(
    options.apiKey ?? process.env.YANDEX_SEARCH_API_KEY ?? "",
  ).trim();
  const folderId = String(
    options.folderId ?? process.env.YANDEX_SEARCH_FOLDER_ID ?? "",
  ).trim();

  if (!apiKey || !folderId) {
    const error = new Error("Yandex Search API GEO measurement is not configured");
    error.code = "PR_STUDIO_YANDEX_NOT_CONFIGURED";
    throw error;
  }

  const request = buildPrStudioGeoVisibilityYandexMeasurementRequest(parsed, folderId);
  const fetchImpl = options.fetchImpl || fetch;
  const endpoint = String(options.endpoint || DEFAULT_ENDPOINT);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
  );

  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Api-Key ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    payload = await response.json().catch(() => null);
  } catch (error) {
    const wrapped = new Error("Yandex Search API GEO measurement request failed");
    wrapped.code = "PR_STUDIO_YANDEX_UPSTREAM_FAILED";
    wrapped.providerMessage = error instanceof Error
      ? error.message.slice(0, 700)
      : String(error).slice(0, 700);
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }

  if (!response?.ok) {
    const wrapped = new Error("Yandex Search API GEO measurement request failed");
    wrapped.code = "PR_STUDIO_YANDEX_UPSTREAM_FAILED";
    wrapped.providerStatus = Number.isFinite(Number(response?.status))
      ? Number(response.status)
      : null;
    wrapped.providerMessage = extractProviderMessage(payload);
    throw wrapped;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidResponse("Yandex Search API returned an invalid GEO response");
  }
  if (payload.isAnswerRejected === true) {
    throw invalidResponse("Yandex Search API rejected GEO measurement answer", {
      code: "PR_STUDIO_TRANSPORT_REFUSAL",
    });
  }
  if (payload.problematicAnswer === true) {
    throw invalidResponse("Yandex Search API marked GEO measurement answer as problematic");
  }

  const answerText = cleanOutputText(payload?.message?.content, 30_000);
  if (!answerText) {
    throw invalidResponse("Yandex Search API returned no GEO measurement answer");
  }

  const allSources = Array.isArray(payload.sources)
    ? payload.sources.map(normalizeSource).filter(Boolean)
    : [];
  const usedSources = dedupeSources(
    allSources.filter((source) => source.used === true),
  ).slice(0, 300);
  const queries = Array.isArray(payload.searchQueries)
    ? payload.searchQueries
        .map((query) => cleanString(query?.text, 500))
        .filter(Boolean)
    : [];
  const uniqueQueries = [...new Set(queries)].slice(0, 20);

  if (!usedSources.length || !uniqueQueries.length) {
    throw invalidResponse(
      "Yandex Search API returned an ungrounded GEO measurement response",
      {
        code: "PR_STUDIO_GEO_YANDEX_GROUNDING_REQUIRED",
        sourceCount: usedSources.length,
        queryCount: uniqueQueries.length,
      },
    );
  }

  const evidence = usedSources.map(({ url, title, domain }) => ({
    url,
    title,
    domain,
  }));

  return {
    surfaceKey: PR_STUDIO_GEO_VISIBILITY_YANDEX_SURFACE_KEY,
    methodologyKey: PR_STUDIO_GEO_VISIBILITY_YANDEX_METHODOLOGY_KEY,
    methodologyVersion: PR_STUDIO_GEO_VISIBILITY_YANDEX_METHODOLOGY_VERSION,
    answerText,
    citations: evidence.slice(0, 100),
    sources: evidence,
    queries: uniqueQueries,
    model: null,
    responseId: null,
    usage: {
      searchQueries: uniqueQueries.length,
      usedSources: usedSources.length,
    },
  };
}

function buildUserMessage(parsed) {
  return [
    "Ответьте на вопрос как обычный публичный AI-помощник, используя актуальную информацию из поиска Яндекса.",
    "Не оптимизируйте ответ за или против какого-либо бренда, компании, продукта, сайта или конкурента.",
    "Не придумывайте рекомендации ради полноты списка: называйте сущности только когда они действительно релевантны вопросу и подтверждаются найденной информацией.",
    `Язык ответа: ${parsed.language}.`,
    `Географический контекст: ${parsed.region}.`,
    "",
    parsed.question,
  ].join("\n");
}

function yandexSearchTypeForLanguage(language) {
  return String(language || "").trim().toLowerCase().startsWith("ru")
    ? "SEARCH_TYPE_RU"
    : "SEARCH_TYPE_COM";
}

function normalizeSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = cleanPublicUrl(value.url);
  if (!url) return null;
  return {
    url,
    title: cleanNullableString(value.title, 500),
    domain: inferDomain(url),
    used: value.used === true,
  };
}

function inferDomain(urlValue) {
  try {
    return new URL(urlValue).hostname
      .replace(/^www\./, "")
      .replace(/\.$/, "")
      .toLowerCase() || null;
  } catch {
    return null;
  }
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
  const byUrl = new Map();
  for (const value of values) {
    if (!byUrl.has(value.url)) byUrl.set(value.url, value);
  }
  return [...byUrl.values()];
}

function cleanOutputText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanNullableString(value, maxLength) {
  const cleaned = cleanString(value, maxLength);
  return cleaned || null;
}

function extractProviderMessage(payload) {
  const candidates = [
    payload?.message,
    payload?.error?.message,
    payload?.error,
    payload?.description,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 700);
    }
  }
  return null;
}

function invalidInput(message) {
  const error = new Error(message);
  error.code = "PR_STUDIO_TRANSPORT_INVALID_INPUT";
  return error;
}

function invalidResponse(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, {
    code: details.code || "PR_STUDIO_TRANSPORT_INVALID_RESPONSE",
    ...details,
  });
  return error;
}
