import dns from "node:dns/promises";
import net from "node:net";
import OpenAI from "openai";
import sharp from "sharp";

const SEARCH_MODEL = "gpt-5-mini";
const IMAGE_MODEL = "gpt-image-2";
const MAX_SEARCH_RESULTS = 8;
const MAX_RESULTS_PER_SOURCE_PAGE = 1;
const MAX_REFERENCES = 4;
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 12_000;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SEARCHABLE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const ASPECT_RATIOS = new Set(["1:1", "4:5", "16:9", "9:16"]);
const COMPOSITIONS = new Set(["single_scene", "product", "process", "interior", "portrait", "collage"]);
const SEARCH_STYLE_STOP_WORDS = new Set([
  "editorial", "illustration", "illustrations", "image", "images", "photo", "photos", "photograph", "photography",
  "premium", "luxury", "official", "article", "cover", "visual", "press", "kit", "newsroom", "media",
  "иллюстрация", "иллюстрации", "изображение", "изображения", "фото", "фотография", "обложка", "статья",
  "премиальный", "редакционный", "официальный", "найти", "для", "про", "или", "and", "the", "for", "with",
]);

const SEARCH_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 1_200 },
    queries: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string", minLength: 3, maxLength: 300 },
    },
    candidatePages: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pageUrl: { type: "string", minLength: 8, maxLength: 2_000 },
          reason: { type: "string", minLength: 1, maxLength: 400 },
        },
        required: ["pageUrl", "reason"],
      },
    },
  },
  required: ["summary", "queries", "candidatePages"],
};

export function parsePrStudioImageSearchInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }
  const query = cleanString(value.query, 800);
  if (!query) throw invalidInput("query is required");
  const maxResults = boundedInteger(value.maxResults, 6, 1, MAX_SEARCH_RESULTS, "maxResults");
  const searchQueries = Array.isArray(value.searchQueries)
    ? [...new Set(value.searchQueries.map((entry) => cleanString(entry, 300)).filter(Boolean))].slice(0, 6)
    : [];
  return {
    query,
    searchQueries,
    maxResults,
    mainIdea: cleanNullableString(value.mainIdea, 1_500),
    mustShow: cleanNullableString(value.mustShow, 2_000),
    avoid: cleanNullableString(value.avoid, 2_000),
    visualDirection: cleanNullableString(value.visualDirection, 80),
    context: {
      brandName: cleanNullableString(value.context?.brandName, 160),
      title: cleanNullableString(value.context?.title, 240),
      summary: cleanNullableString(value.context?.summary, 4_000),
      contentExcerpt: cleanNullableString(value.context?.contentExcerpt, 8_000),
    },
  };
}

export function buildPrStudioImageSearchRequest(parsed) {
  const model = String(process.env.PR_STUDIO_IMAGE_SEARCH_MODEL || process.env.PR_STUDIO_WEB_RESEARCH_MODEL || SEARCH_MODEL).trim() || SEARCH_MODEL;
  return {
    model,
    reasoning: { effort: "low" },
    instructions: [
      "Find webpages containing photographs or illustrations that visually express the main idea of the supplied article, not merely its broad topic.",
      "You must use web search and must not answer from memory.",
      "Treat mainIdea, mustShow, title, named entities and content excerpt as factual subject constraints. Visual-style words such as editorial, premium, illustration, cover or photography are presentation preferences and must not dominate the search.",
      "Use the supplied searchQueries when present, improve them where necessary, and run three to six precise searches. Return the actual queries used in the queries field.",
      "When a named company, person, place, product or material is present, preserve the exact name in multiple searches. For non-English subjects, search in English and the relevant local language when useful.",
      "Prefer the named subject's official site, official publications, primary sources, museums, archives, Wikimedia Commons file pages, and reputable specialist publications. Official pages with unclear reuse rights are still relevant candidates and must not be discarded for that reason.",
      "Reject generic press-kit templates, unrelated newsrooms, concerts, celebrities, animals, abstract graphics and pages that merely contain words such as editorial or illustration.",
      "Look for a strong hero image with one readable subject and a clear connection to the article's argument. Do not select logos, separators, generic banners or tiny thumbnails.",
      "Do not treat a search result as permission to republish an image. The application will separately inspect source and licensing metadata.",
      "In candidatePages return only webpages you actually opened through web search and judged directly relevant. Do not return search-result pages or invented URLs.",
      "If direct image access or licensing is unclear, still return the relevant source page. Technical availability must not erase topical relevance.",
      "Select pages because their hero or article image is likely useful, not merely because their text mentions the subject.",
    ].join("\n"),
    input: JSON.stringify(parsed),
    tools: [{ type: "web_search", search_context_size: "high", external_web_access: true }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_output_tokens: 1_600,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "pr_studio_image_search",
        strict: true,
        schema: SEARCH_RESPONSE_SCHEMA,
      },
    },
  };
}

export async function executePrStudioImageSearch(input, options = {}) {
  const parsed = parsePrStudioImageSearchInput(input);
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey && !options.client) throw notConfigured();
  const client = options.client || new OpenAI({ apiKey, timeout: 300_000, maxRetries: 1 });
  const request = buildPrStudioImageSearchRequest(parsed);
  const response = await client.responses.create(request);
  ensureCompletedResponse(response, "image search");
  const outputText = extractOutputText(response);
  if (!outputText) throw invalidResponse("OpenAI returned no image-search output");
  let selection;
  try {
    selection = JSON.parse(outputText);
  } catch {
    throw invalidResponse("OpenAI returned malformed image-search JSON");
  }
  const sources = collectWebSources(response);
  const selectedSources = selectPrStudioImageSearchSources(sources, selection?.candidatePages);
  const inspected = await Promise.allSettled(
    selectedSources.slice(0, 24).map((source) => inspectSourcePage(source)),
  );
  const inspectedCandidates = [];
  const seenImages = new Set();
  let inspectionFailures = 0;
  for (const result of inspected) {
    if (result.status !== "fulfilled") {
      inspectionFailures += 1;
      continue;
    }
    for (const candidate of Array.isArray(result.value) ? result.value : []) {
      const key = normalizeComparableUrl(candidate.imageUrl);
      if (!key || seenImages.has(key)) continue;
      seenImages.add(key);
      inspectedCandidates.push(candidate);
    }
  }
  const strictRanked = rankPrStudioImageSearchCandidates(inspectedCandidates, parsed, { minimumScore: 1 });
  const fallbackRanked = strictRanked.length
    ? strictRanked
    : rankPrStudioImageSearchCandidates(inspectedCandidates, parsed, { minimumScore: 0.25, requireCoreSubject: true });
  const candidates = dedupePrStudioImageSearchCandidates(fallbackRanked)
    .slice(0, parsed.maxResults)
    .map(({ relevanceScore: _relevanceScore, relevanceText: _relevanceText, ...candidate }) => candidate);
  const usage = normalizeUsage(response.usage) || {};
  const reasonsByUrl = new Map(
    (Array.isArray(selection?.candidatePages) ? selection.candidatePages : [])
      .map((entry) => [normalizeComparableUrl(entry?.pageUrl), cleanNullableString(entry?.reason, 400)])
      .filter(([url]) => Boolean(url)),
  );
  const sourcePages = selectedSources.slice(0, 12).map((source) => ({
    pageUrl: source.url,
    title: source.title || new URL(source.url).hostname,
    reason: reasonsByUrl.get(normalizeComparableUrl(source.url)) || null,
  }));
  return {
    query: parsed.query,
    queries: Array.isArray(selection?.queries) ? selection.queries.map((entry) => cleanString(entry, 300)).filter(Boolean).slice(0, 6) : parsed.searchQueries,
    summary: cleanNullableString(selection?.summary, 1_200),
    sourcePages,
    candidates,
    diagnostics: {
      sourcesFound: sources.length,
      selectedPages: selectedSources.length,
      pagesInspected: inspected.length,
      inspectionFailures,
      imageCandidatesFound: inspectedCandidates.length,
      strictMatches: strictRanked.length,
      fallbackUsed: strictRanked.length === 0 && fallbackRanked.length > 0,
      returnedCandidates: candidates.length,
    },
    model: response.model || request.model,
    responseId: response.id || null,
    usage,
  };
}

export function parsePrStudioImageGenerateInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("Request body must be an object");
  }
  const prompt = cleanString(value.prompt, 8_000);
  if (!prompt) throw invalidInput("prompt is required");
  const aspectRatio = cleanString(value.aspectRatio, 12);
  if (!ASPECT_RATIOS.has(aspectRatio)) throw invalidInput("aspectRatio is invalid");
  const composition = cleanString(value.composition, 24) || "single_scene";
  if (!COMPOSITIONS.has(composition)) throw invalidInput("composition is invalid");
  const references = Array.isArray(value.references) ? value.references : [];
  if (references.length > MAX_REFERENCES) throw invalidInput(`No more than ${MAX_REFERENCES} references are allowed`);
  const normalizedReferences = references.map((reference, index) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      throw invalidInput(`references[${index}] is invalid`);
    }
    const mimeType = cleanString(reference.mimeType, 80).toLowerCase();
    const data = cleanString(reference.data, Math.ceil(MAX_REFERENCE_BYTES * 1.5));
    if (!ALLOWED_MIME_TYPES.has(mimeType) || !data) {
      throw invalidInput(`references[${index}] must be JPEG, PNG or WEBP`);
    }
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES || !validImageSignature(mimeType, bytes)) {
      throw invalidInput(`references[${index}] has invalid image data`);
    }
    return {
      mimeType,
      data,
      name: cleanNullableString(reference.name, 160) || `reference-${index + 1}`,
    };
  });
  return {
    prompt,
    aspectRatio,
    composition,
    references: normalizedReferences,
    mainIdea: cleanNullableString(value.mainIdea, 1_500),
    mustShow: cleanNullableString(value.mustShow, 2_000),
    avoid: cleanNullableString(value.avoid, 2_000),
    visualDirection: cleanNullableString(value.visualDirection, 80),
    context: {
      brandName: cleanNullableString(value.context?.brandName, 160),
      title: cleanNullableString(value.context?.title, 240),
      summary: cleanNullableString(value.context?.summary, 4_000),
      contentExcerpt: cleanNullableString(value.context?.contentExcerpt, 8_000),
    },
  };
}

export async function executePrStudioImageGeneration(input, options = {}) {
  const parsed = parsePrStudioImageGenerateInput(input);
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey && !options.client) throw notConfigured();
  const model = String(process.env.PR_STUDIO_IMAGE_MODEL || IMAGE_MODEL).trim() || IMAGE_MODEL;
  const quality = normalizeQuality(process.env.PR_STUDIO_IMAGE_QUALITY);
  const client = options.client || new OpenAI({ apiKey, timeout: 600_000, maxRetries: 1 });
  const canvas = canvasForAspect(parsed.aspectRatio);
  const compositionInstruction = compositionInstructionFor(parsed.composition);
  const prompt = [
    parsed.mainIdea ? `ARTICLE MAIN IDEA: ${parsed.mainIdea}` : null,
    parsed.context?.title ? `ARTICLE TITLE: ${parsed.context.title}` : null,
    parsed.context?.summary ? `ARTICLE PURPOSE: ${parsed.context.summary}` : null,
    parsed.visualDirection ? `SELECTED VISUAL DIRECTION: ${parsed.visualDirection}` : null,
    parsed.mustShow ? `MUST VISUALLY COMMUNICATE: ${parsed.mustShow}` : null,
    parsed.avoid ? `MUST AVOID: ${parsed.avoid}` : null,
    parsed.prompt,
    "Create a polished editorial image suitable for publication. The image must communicate the article's main argument, not merely show a generic object from the same industry.",
    compositionInstruction,
    parsed.composition === "collage"
      ? "The collage must remain simple, coherent and readable as a small preview."
      : "Use one coherent frame, one dominant visual subject and one clear focal point. Do not create a collage, moodboard, split screen, diptych, triptych, contact sheet, montage or multiple panels.",
    "The image must remain immediately readable at thumbnail size. Avoid scattered props, repeated scenes and competing focal points.",
    "No visible text, captions, logos, signatures or watermarks unless they are naturally present in a supplied reference and explicitly requested.",
    "Avoid generic stock-photo staging, exaggerated luxury clichés and obvious AI artefacts.",
    `Compose for a final ${parsed.aspectRatio} crop and keep important subjects inside the safe central area.`,
  ].filter(Boolean).join("\n");
  let response;
  try {
    const referenceFiles = parsed.references.map(referenceToFile);
    response = parsed.references.length
      ? await client.images.edit({
          model,
          image: referenceFiles.length === 1 ? referenceFiles[0] : referenceFiles,
          prompt,
          size: canvas.providerSize,
          quality,
          background: "opaque",
          output_format: "webp",
          output_compression: 92,
        })
      : await client.images.generate({
          model,
          prompt,
          size: canvas.providerSize,
          quality,
          background: "opaque",
          output_format: "webp",
          output_compression: 92,
        });
  } catch (error) {
    throw normalizeProviderError(error);
  }
  const base64 = typeof response?.data?.[0]?.b64_json === "string" ? response.data[0].b64_json : "";
  if (!base64) throw invalidResponse("OpenAI returned no generated image data");
  const transformed = await sharp(Buffer.from(base64, "base64"))
    .rotate()
    .resize(canvas.width, canvas.height, { fit: "cover", position: "centre" })
    .webp({ quality: 92 })
    .toBuffer();
  return {
    mimeType: "image/webp",
    data: transformed.toString("base64"),
    width: canvas.width,
    height: canvas.height,
    aspectRatio: parsed.aspectRatio,
    model,
    responseId: response?._request_id || response?.request_id || null,
    effectivePrompt: prompt,
  };
}

async function inspectSourcePage(source) {
  const pageUrl = await assertSafePublicUrl(source.url);
  const response = await safeFetch(pageUrl);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const finalUrl = await assertSafePublicUrl(response.url || pageUrl);
  if (contentType.startsWith("image/")) {
    if (!SEARCHABLE_MIME_TYPES.has(contentType.split(";")[0])) return [];
    return [buildCandidate({
      pageUrl: finalUrl,
      imageUrl: finalUrl,
      title: source.title || new URL(finalUrl).hostname,
      author: null,
      license: null,
      description: source.title || "",
      imageAlt: source.title || "",
      rawHtml: "",
      imagePriority: 3,
    })];
  }
  if (!contentType.includes("text/html")) return [];
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_PAGE_BYTES) return [];
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PAGE_BYTES) return [];
  const html = bytes.toString("utf8");
  const title = decodeHtml(metaValue(html, ["og:title", "twitter:title"]) || htmlTitle(html) || source.title || new URL(finalUrl).hostname);
  const author = decodeHtml(metaValue(html, ["author", "article:author", "parsely-author"]) || "") || null;
  const description = decodeHtml(metaValue(html, ["og:description", "twitter:description", "description"]) || "");
  const license = extractImageLicenseEvidence(html, finalUrl);
  const imageInfos = extractImageInfos(html);
  const candidates = [];
  for (const image of imageInfos.slice(0, 8)) {
    try {
      const imageUrl = new URL(decodeHtml(image.src), finalUrl).toString();
      await assertSafePublicUrl(imageUrl);
      candidates.push(buildCandidate({
        pageUrl: finalUrl,
        imageUrl,
        title,
        author,
        license,
        description,
        imageAlt: image.alt,
        rawHtml: html,
        imagePriority: image.priority,
      }));
    } catch {
      continue;
    }
  }
  return candidates;
}

function buildCandidate({ pageUrl, imageUrl, title, author, license, description = "", imageAlt = "", rawHtml: _rawHtml, imagePriority = 0 }) {
  const domain = new URL(pageUrl).hostname.replace(/^www\./, "");
  const decodedTitle = cleanString(decodeHtml(title), 500) || domain;
  const decodedDescription = cleanString(decodeHtml(description), 1_000);
  const decodedAlt = cleanString(decodeHtml(imageAlt), 500);
  const decodedAuthor = cleanNullableString(decodeHtml(author), 300);
  const decodedLicense = cleanNullableString(decodeHtml(license), 500);
  const rights = classifyPrStudioImageRights({
    license: decodedLicense,
    author: decodedAuthor,
    domain,
    pageUrl,
  });
  const suggestedAltText = cleanString(decodedAlt || decodedTitle, 500);
  const suggestedCaption = cleanString(decodedAlt || decodedTitle, 500);
  const suggestedCredit = cleanString(decodedAuthor ? `${decodedAuthor} · ${domain}` : `Источник: ${domain}`, 500);
  return {
    pageUrl,
    imageUrl,
    title: decodedTitle,
    domain,
    author: decodedAuthor,
    license: decodedLicense,
    rightsStatus: rights.status,
    rightsNote: rights.note,
    imageAlt: decodedAlt || null,
    suggestedCaption,
    suggestedAltText,
    suggestedCredit,
    imagePriority,
    relevanceText: [decodedTitle, decodedDescription, decodedAlt, pageUrl, imageUrl].filter(Boolean).join(" "),
  };
}

export function selectPrStudioImageSearchSources(sources, candidatePages) {
  const byUrl = new Map(sources.map((source) => [normalizeComparableUrl(source.url), source]));
  const selected = [];
  const seen = new Set();
  for (const candidate of Array.isArray(candidatePages) ? candidatePages : []) {
    const key = normalizeComparableUrl(candidate?.pageUrl);
    const source = key ? byUrl.get(key) : null;
    if (!source || seen.has(key)) continue;
    seen.add(key);
    selected.push(source);
  }
  return selected.length ? selected : sources;
}

export function dedupePrStudioImageSearchCandidates(candidates) {
  const results = [];
  const perPage = new Map();
  const seenImages = new Set();
  const seenVisuals = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const pageKey = normalizeComparableUrl(candidate?.pageUrl);
    const imageKey = normalizeComparableImageUrl(candidate?.imageUrl);
    const visualKey = visualCandidateKey(candidate);
    if (!imageKey || seenImages.has(imageKey) || (visualKey && seenVisuals.has(visualKey))) continue;
    const pageCount = perPage.get(pageKey) || 0;
    if (pageKey && pageCount >= MAX_RESULTS_PER_SOURCE_PAGE) continue;
    seenImages.add(imageKey);
    if (visualKey) seenVisuals.add(visualKey);
    if (pageKey) perPage.set(pageKey, pageCount + 1);
    results.push(candidate);
  }
  return results;
}

export function rankPrStudioImageSearchCandidates(candidates, parsed, options = {}) {
  const subjectText = [
    parsed?.query,
    parsed?.context?.brandName,
    parsed?.context?.title,
    parsed?.context?.summary,
    parsed?.context?.contentExcerpt,
  ].filter(Boolean).join(" ");
  const subjectTokens = subjectTokensFrom(subjectText);
  const brandPhrase = normalizeSearchText(parsed?.context?.brandName || "");
  const mainIdeaTokens = new Set(subjectTokensFrom(parsed?.mainIdea || parsed?.context?.summary || parsed?.context?.title || parsed?.query || ""));
  const minimumScore = Number.isFinite(options.minimumScore) ? options.minimumScore : 1;
  return candidates
    .map((candidate) => {
      const text = normalizeSearchText(candidate.relevanceText || [candidate.title, candidate.domain, candidate.pageUrl, candidate.imageUrl].join(" "));
      const candidateTokens = new Set(subjectTokensFrom(text));
      let relevanceScore = 0;
      for (const token of subjectTokens) {
        if (candidateTokens.has(token)) relevanceScore += token.length >= 7 ? 1.5 : 1;
      }
      if (brandPhrase && text.includes(brandPhrase)) relevanceScore += 5;
      const domain = String(candidate.domain || "").toLowerCase();
      if (brandPhrase) {
        const compactBrand = brandPhrase.replace(/[^a-z0-9а-яё]/g, "");
        const compactDomain = domain.replace(/[^a-z0-9а-яё]/g, "");
        if (compactBrand.length >= 4 && compactDomain.includes(compactBrand)) relevanceScore += 4;
      }
      if (/commons\.wikimedia\.org|museum|archive|\.gov$|\.edu$/.test(domain)) relevanceScore += 0.35;
      relevanceScore += Math.min(1.2, Number(candidate.imagePriority || 0) * 0.3);
      if (/press[ -]?kit|pod studio|concert|newsroom/.test(text) && relevanceScore < 2) relevanceScore -= 2;
      const hasCoreSubject = brandPhrase
        ? text.includes(brandPhrase) || mainIdeaTokens.size > 0 && [...mainIdeaTokens].some((token) => candidateTokens.has(token))
        : mainIdeaTokens.size === 0 || [...mainIdeaTokens].some((token) => candidateTokens.has(token));
      return { ...candidate, relevanceScore, hasCoreSubject };
    })
    .filter((candidate) => candidate.relevanceScore >= minimumScore && (!options.requireCoreSubject || candidate.hasCoreSubject))
    .map(({ hasCoreSubject: _hasCoreSubject, ...candidate }) => candidate)
    .sort((left, right) => right.relevanceScore - left.relevanceScore);
}

function subjectTokensFrom(value) {
  return [...new Set(normalizeSearchText(value)
    .split(/[^a-z0-9а-яё]+/u)
    .filter((token) => token.length >= 3 && !SEARCH_STYLE_STOP_WORDS.has(token))
    .slice(0, 80))];
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function compositionInstructionFor(composition) {
  if (composition === "product") return "Create one clean product-focused frame with a single dominant object and restrained supporting context.";
  if (composition === "process") return "Create one continuous documentary-style scene showing a single work process in progress.";
  if (composition === "interior") return "Create one coherent interior scene with a clear focal area and no inset views.";
  if (composition === "portrait") return "Create one portrait-led frame with a single principal person and uncluttered context.";
  if (composition === "collage") return "Create a deliberately composed editorial collage only because the user explicitly selected collage composition.";
  return "Create one continuous scene captured as a single photograph or single illustration, not a layout of separate images.";
}

export function classifyPrStudioImageRights({ license, author, domain, pageUrl }) {
  const normalizedLicense = String(license || "").trim();
  const text = normalizedLicense.toLowerCase();
  const softwareLicense = /(?:^|\b)(mit|apache|gpl|gnu|bsd|isc|mpl)(?:\b| license)|bootstrap|source code|software license|github\.com\/twbs|npmjs\.com/i;
  if (softwareLicense.test(text)) {
    return {
      status: "unknown",
      note: "На странице обнаружена лицензия программного кода; она не подтверждает права на изображение",
    };
  }
  if (domain === "commons.wikimedia.org" || domain.endsWith(".wikimedia.org")) {
    return {
      status: "attribution",
      note: normalizedLicense || "Wikimedia Commons: проверьте лицензию конкретного файла и укажите требуемую атрибуцию",
    };
  }
  if (/creative commons|cc[- ]by|public domain|creativecommons\.org\/(?:licenses|publicdomain)/i.test(text)) {
    return {
      status: "attribution",
      note: `${normalizedLicense}. Проверьте, что лицензия относится именно к выбранному изображению`,
    };
  }
  if (author) {
    return {
      status: "attribution",
      note: "Обнаружены сведения об авторе; условия использования конкретного изображения нужно проверить",
    };
  }
  if (normalizedLicense) {
    return {
      status: "unknown",
      note: "На странице обнаружены сведения о правах, но их связь с конкретным изображением не подтверждена",
    };
  }
  if (/^https?:\/\//i.test(String(pageUrl || ""))) {
    return { status: "unknown", note: "Условия использования конкретного изображения не определены автоматически" };
  }
  return { status: "unknown", note: "Условия использования не определены автоматически" };
}

async function safeFetch(url) {
  let current = url;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": "PR-Studio-Illustration-Research/1.0",
        accept: "text/html,image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect without location");
      current = await assertSafePublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }
  throw new Error("Too many redirects");
}

async function assertSafePublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    throw new Error("Unsupported URL");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0") throw new Error("Private host");
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Private address");
  return url.toString();
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized.startsWith("::ffff:127.");
}

function collectWebSources(response) {
  const sources = [];
  const seen = new Set();
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "web_search_call") continue;
    for (const source of Array.isArray(item?.action?.sources) ? item.action.sources : []) {
      const url = cleanString(source?.url, 2_000);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, title: cleanNullableString(source?.title, 500) });
    }
  }
  return sources;
}

function ensureCompletedResponse(response, label) {
  if (response?.status === "incomplete") throw invalidResponse(`OpenAI ${label} response was incomplete`);
  if (response?.status && response.status !== "completed") throw invalidResponse(`OpenAI ${label} response status was ${response.status}`);
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string" && content.text.trim()) return content.text.trim();
    }
  }
  return "";
}

function referenceToFile(reference) {
  const extension = reference.mimeType === "image/png" ? "png" : reference.mimeType === "image/webp" ? "webp" : "jpg";
  return new File([Buffer.from(reference.data, "base64")], `${reference.name}.${extension}`, { type: reference.mimeType });
}

function canvasForAspect(aspectRatio) {
  if (aspectRatio === "16:9") return { providerSize: "1536x1024", width: 1536, height: 864 };
  if (aspectRatio === "4:5") return { providerSize: "1024x1536", width: 1024, height: 1280 };
  if (aspectRatio === "9:16") return { providerSize: "1024x1536", width: 864, height: 1536 };
  return { providerSize: "1024x1024", width: 1024, height: 1024 };
}

function normalizeQuality(value) {
  const normalized = String(value || "medium").trim().toLowerCase();
  return new Set(["low", "medium", "high"]).has(normalized) ? normalized : "medium";
}

function normalizeProviderError(error) {
  if (error?.code === "PR_STUDIO_OPENAI_NOT_CONFIGURED") return error;
  const normalized = new Error(error instanceof Error ? error.message.slice(0, 700) : "Image generation failed");
  normalized.code = "PR_STUDIO_IMAGE_UPSTREAM_FAILED";
  normalized.providerStatus = Number(error?.status || error?.statusCode || 0) || null;
  normalized.providerRequestId = typeof error?.request_id === "string" ? error.request_id : null;
  return normalized;
}

function validImageSignature(mimeType, bytes) {
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function metaValue(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtml(match[1]);
    }
  }
  return null;
}

function htmlTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1].replace(/\s+/g, " ").trim()) : null;
}

function extractImageInfos(html) {
  const results = [];
  const seen = new Set();
  const push = (src, alt = "", priority = 0) => {
    const value = decodeHtml(src || "").trim();
    if (!value || seen.has(value) || /^data:/i.test(value) || /(?:\.svg(?:[?#]|$)|favicon|sprite)/i.test(value)) return;
    seen.add(value);
    results.push({ src: value, alt: decodeHtml(alt || ""), priority });
  };
  push(metaValue(html, ["og:image:secure_url", "og:image"]), metaValue(html, ["og:image:alt"]), 4);
  push(metaValue(html, ["twitter:image", "twitter:image:src"]), metaValue(html, ["twitter:image:alt"]), 3);
  for (const match of html.matchAll(/"(?:contentUrl|image|thumbnailUrl)"\s*:\s*"([^"]+)"/gi)) push(match[1], "", 2);
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = tag.match(/\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1];
    const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1];
    const bestSrcset = srcset ? srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).at(-1) : null;
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] || "";
    const width = Number(tag.match(/\bwidth=["']?(\d+)/i)?.[1] || 0);
    const height = Number(tag.match(/\bheight=["']?(\d+)/i)?.[1] || 0);
    const priority = width * height >= 500_000 ? 2 : width * height >= 150_000 ? 1 : 0;
    push(bestSrcset || src, alt, priority);
    if (results.length >= 12) break;
  }
  return results;
}

function linkRelValue(html, rel) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] || null;
}

function extractImageLicenseEvidence(html, pageUrl) {
  const direct = metaValue(html, ["license", "dc.rights", "dcterms.license"])
    || linkRelValue(html, "license");
  if (!direct) return null;
  const decoded = decodeHtml(direct).replace(/\s+/g, " ").trim();
  if (!decoded) return null;
  if (/mit license|apache license|bootstrap|gnu general public|gpl|bsd license|isc license|github\.com\/twbs|software/i.test(decoded)) {
    return decoded;
  }
  const domain = new URL(pageUrl).hostname.replace(/^www\./, "");
  if (domain === "commons.wikimedia.org" || domain.endsWith(".wikimedia.org")) return decoded;
  if (/creative commons|creativecommons\.org|public domain|cc[- ]by/i.test(decoded)) return decoded;
  return decoded;
}

export function decodePrStudioHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"], ["quot", '"'], ["apos", "'"], ["lt", "<"], ["gt", ">"],
    ["nbsp", " "], ["rsquo", "’"], ["lsquo", "‘"], ["rdquo", "”"], ["ldquo", "“"],
    ["ndash", "–"], ["mdash", "—"], ["hellip", "…"], ["laquo", "«"], ["raquo", "»"],
  ]);
  let decoded = String(value || "").replace(/\\\//g, "/");
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => safeCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_match, decimal) => safeCodePoint(parseInt(decimal, 10)))
      .replace(/&([a-z]+);/gi, (match, name) => named.get(String(name).toLowerCase()) ?? match);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function safeCodePoint(value) {
  try {
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
  } catch {
    return "";
  }
}

function decodeHtml(value) {
  return decodePrStudioHtmlEntities(value);
}

function normalizeComparableImageUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:w|h|width|height|size|quality|q|crop|fit|format|fm|auto)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().toLowerCase();
  } catch {
    return "";
  }
}

function visualCandidateKey(candidate) {
  const urlKey = normalizeComparableImageUrl(candidate?.imageUrl);
  const title = normalizeSearchText(candidate?.title || "").replace(/[^a-z0-9а-яё]+/gu, " ").trim();
  const alt = normalizeSearchText(candidate?.imageAlt || "").replace(/[^a-z0-9а-яё]+/gu, " ").trim();
  const filename = (() => {
    try {
      return new URL(urlKey).pathname.split("/").pop()?.replace(/[-_](?:\d{2,4}x\d{2,4}|\d{2,4})/g, "") || "";
    } catch {
      return "";
    }
  })();
  return [filename, alt || title].filter(Boolean).join("|").slice(0, 800);
}

function normalizeComparableUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return "";
  }
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

function boundedInteger(value, fallback, minimum, maximum, field) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw invalidInput(`${field} is invalid`);
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

function invalidResponse(message) {
  const error = new Error(message);
  error.code = "PR_STUDIO_IMAGE_INVALID_RESPONSE";
  return error;
}

function notConfigured() {
  const error = new Error("OPENAI_API_KEY is not configured on the AI gateway");
  error.code = "PR_STUDIO_OPENAI_NOT_CONFIGURED";
  return error;
}
