import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  buildPrStudioImageReviewRequest,
  buildPrStudioImageSearchRequest,
  classifyPrStudioImageRights,
  decodePrStudioHtmlEntities,
  dedupePrStudioImageSearchCandidates,
  limitPrStudioImageSearchCandidatesByPage,
  executePrStudioImageGeneration,
  executePrStudioImageReview,
  executePrStudioImageSearch,
  parsePrStudioImageGenerateInput,
  parsePrStudioImageReviewInput,
  parsePrStudioImageSearchInput,
  rankPrStudioImageSearchCandidates,
  selectPrStudioImageSearchSources,
} from "./prStudioImageOpenAi.mjs";

test("accepts bounded editorial image search input", () => {
  const parsed = parsePrStudioImageSearchInput({
    query: "bespoke tailoring workshop editorial photograph",
    maxResults: 6,
    mainIdea: "Bespoke differs from MTM through an individually drafted pattern and iterative fittings.",
    mustShow: "individual pattern work and fitting",
    searchQueries: ["bespoke individual pattern fitting", "Savile Row bespoke fitting"],
    excludedDomains: ["bourbaki.ru", "https://www.example.com/path"],
    context: { brandName: "Bourbaki", title: "Bespoke and MTM" },
  });
  assert.equal(parsed.maxResults, 6);
  assert.equal(parsed.searchQueries.length, 2);
  assert.deepEqual(parsed.excludedDomains, ["bourbaki.ru", "example.com"]);
  assert.match(parsed.mainIdea, /individually drafted pattern/);
  const previousSearchModel = process.env.PR_STUDIO_IMAGE_SEARCH_MODEL;
  delete process.env.PR_STUDIO_IMAGE_SEARCH_MODEL;
  const request = buildPrStudioImageSearchRequest(parsed);
  if (previousSearchModel === undefined) delete process.env.PR_STUDIO_IMAGE_SEARCH_MODEL;
  else process.env.PR_STUDIO_IMAGE_SEARCH_MODEL = previousSearchModel;
  assert.equal(request.model, "gpt-5.6");
  assert.equal(request.tools[0].type, "web_search");
  assert.deepEqual(request.tools[0].search_content_types, ["image"]);
  assert.equal(request.tools[0].image_settings.caption, true);
  assert.ok(request.tools[0].image_settings.max_results >= 8);
  assert.match(request.instructions, /Search directly for image results/);
  assert.deepEqual(request.include, ["web_search_call.action.sources", "web_search_call.results"]);
  assert.match(request.instructions, /exact name/);
  assert.match(request.instructions, /generic press-kit templates/);
  assert.match(request.instructions, /Do not search for or prefer a particular aspect ratio/);
  assert.match(request.instructions, /publication photo editor/);
  assert.match(request.instructions, /semantic coverage constraints/);
  assert.match(request.instructions, /must stay inside the user-selected semantic coverage/);
  assert.match(request.instructions, /not branching into other themes/);
  assert.match(request.instructions, /When only one semantic direction is selected/);
  assert.match(request.instructions, /grounded in explicit facts/);
  assert.match(request.instructions, /Do not assume any particular visual archetype/);
  assert.match(request.instructions, /Derive the scene from this article itself/);
  assert.match(request.instructions, /materially different visual hypothesis/);
  assert.match(request.instructions, /caption were removed/);
  assert.match(request.instructions, /different named entity to substitute/);
  assert.match(request.instructions, /bourbaki\.ru/);
  assert.equal(request.text.format.schema.required.includes("candidatePages"), true);
  assert.equal(request.text.format.schema.required.includes("queries"), true);
  assert.equal(request.tools[0].search_context_size, "high");
});

test("returns native web image results without requiring HTML page discovery", async () => {
  const imageUrl = "https://cdn.example.com/loro-piana-family-1924.jpg";
  const sourceWebsiteUrl = "https://example.com/loro-piana-history";

  const client = {
    responses: {
      create: async () => ({
        status: "completed",
        model: "gpt-5-mini",
        id: "resp_native_image_search",
        output_text: JSON.stringify({
          summary: "Found a directly relevant historical image.",
          queries: ["Loro Piana history 1924"],
          candidatePages: [],
        }),
        output: [
          {
            type: "web_search_call",
            action: { sources: [] },
            results: [
              {
                type: "image_result",
                image_url: imageUrl,
                thumbnail_url: "https://cdn.example.com/loro-piana-family-1924-thumb.jpg",
                source_website_url: sourceWebsiteUrl,
                caption: "Loro Piana family historical photograph 1924",
              },
            ],
          },
        ],
      }),
    },
  };

  const result = await executePrStudioImageSearch({
    query: '"Loro Piana" history and heritage',
    searchQueries: ['"Loro Piana" history and heritage'],
    maxResults: 2,
    mainIdea: "The history and development of Loro Piana.",
    mustShow: "Visual evidence of the selected history and heritage theme.",
    context: {
      brandName: "Loro Piana",
      title: "Loro Piana",
      summary: "History and heritage of Loro Piana",
    },
  }, { client });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].imageUrl, imageUrl);
  assert.equal(result.candidates[0].pageUrl, sourceWebsiteUrl);
  assert.equal(result.candidates[0].imageAlt, "Loro Piana family historical photograph 1924");
  assert.equal(result.sourcePages.some(({ pageUrl }) => pageUrl === sourceWebsiteUrl), true);
  assert.equal(result.diagnostics.pagesInspected, 0);
  assert.equal(result.diagnostics.nativeImageResultsFound, 1);
  assert.equal(result.diagnostics.htmlImageCandidatesFound, 0);
});

test("prioritizes model-selected pages without hiding other grounded image sources", () => {
  const sources = [
    { url: "https://example.com/relevant", title: "Relevant" },
    { url: "https://example.com/unrelated", title: "Unrelated" },
  ];
  const selected = selectPrStudioImageSearchSources(sources, [
    { pageUrl: "https://example.com/relevant", reason: "Exact subject" },
    { pageUrl: "https://hallucinated.invalid/page", reason: "Not in sources" },
  ]);
  assert.deepEqual(selected, [sources[0], sources[1]]);
});

test("filters unrelated web-image candidates and ranks exact subject matches first", () => {
  const parsed = parsePrStudioImageSearchInput({
    query: "Loro Piana wool cashmere fabric tailoring",
    maxResults: 6,
    context: {
      brandName: "Loro Piana",
      title: "Loro Piana: from Piedmont tradition to fabrics for bespoke",
      summary: "Italian textile production and tailoring cloth",
    },
  });
  const ranked = rankPrStudioImageSearchCandidates([
    {
      title: "Official Press Kit | Nicoletta Rosellini",
      domain: "example.com",
      pageUrl: "https://example.com/press-kit",
      imageUrl: "https://example.com/press.jpg",
      relevanceText: "Official Press Kit Nicoletta Rosellini concert media",
    },
    {
      title: "Loro Piana textile mill and fine wool fabrics",
      domain: "loropiana.com",
      pageUrl: "https://www.loropiana.com/textiles",
      imageUrl: "https://www.loropiana.com/wool.jpg",
      relevanceText: "Loro Piana textile mill fine wool cashmere fabric tailoring",
    },
    {
      title: "Wikimedia Commons deer photograph",
      domain: "commons.wikimedia.org",
      pageUrl: "https://commons.wikimedia.org/deer",
      imageUrl: "https://upload.wikimedia.org/deer.jpg",
      relevanceText: "deer wildlife green field",
    },
  ], parsed);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].domain, "loropiana.com");
  assert.ok(ranked[0].relevanceScore >= 5);
});


test("keeps a relevant low-score official candidate as a controlled fallback", () => {
  const parsed = parsePrStudioImageSearchInput({
    query: "Loro Piana textile tradition bespoke",
    mainIdea: "Loro Piana connects Piedmont textile tradition and modern fine cloth used in bespoke tailoring.",
    context: { title: "Loro Piana", summary: "Piedmont textile tradition and bespoke fabrics" },
  });
  const ranked = rankPrStudioImageSearchCandidates([
    {
      title: "Loro Piana textile heritage",
      domain: "loropiana.com",
      pageUrl: "https://www.loropiana.com/textile-heritage",
      imageUrl: "https://www.loropiana.com/heritage.webp",
      relevanceText: "Loro Piana Piedmont textile heritage fine cloth",
      imagePriority: 1,
    },
  ], parsed, { minimumScore: 0.25, requireCoreSubject: true });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].domain, "loropiana.com");
});

test("decodes HTML entities and does not mistake software licenses for image rights", () => {
  assert.equal(decodePrStudioHtmlEntities("L&amp;rsquo;arredamento &rsquo; &#8212;"), "L’arredamento ’ —");
  assert.equal(decodePrStudioHtmlEntities("L&rsquo;arredamento"), "L’arredamento");
  const rights = classifyPrStudioImageRights({
    license: "Licensed under MIT https://github.com/twbs/bootstrap/blob/main/LICENSE",
    author: null,
    domain: "example.com",
    pageUrl: "https://example.com/article",
  });
  assert.equal(rights.status, "unknown");
  assert.match(rights.note, /программного кода/);
});

test("keeps ranked backup images per source page while removing resized duplicates", () => {
  const candidates = dedupePrStudioImageSearchCandidates([
    { pageUrl: "https://example.com/story", imageUrl: "https://cdn.example.com/photo-1600x1000.jpg?w=1600", title: "First", imageAlt: "loom", relevanceScore: 10 },
    { pageUrl: "https://example.com/story", imageUrl: "https://cdn.example.com/photo-1080x1350.jpg?w=1080", title: "Second", imageAlt: "loom", relevanceScore: 9 },
    { pageUrl: "https://example.com/story", imageUrl: "https://cdn.example.com/workers.jpg", title: "Workers", imageAlt: "workers handling cloth", relevanceScore: 8 },
    { pageUrl: "https://other.example.com/story", imageUrl: "https://cdn.example.com/photo-1600x1000.jpg?w=800", title: "Duplicate", imageAlt: "loom", relevanceScore: 7 },
  ]);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map(({ title }) => title), ["First", "Workers"]);
  const limited = limitPrStudioImageSearchCandidatesByPage([
    ...candidates,
    { pageUrl: "https://second.example.com/story", imageUrl: "https://second.example.com/hero.jpg", title: "Second page" },
    { pageUrl: "https://third.example.com/story", imageUrl: "https://third.example.com/hero.jpg", title: "Third page" },
  ], 2);
  assert.equal(new Set(limited.map(({ pageUrl }) => pageUrl)).size, 2);
  assert.equal(limited.some(({ title }) => title === "Workers"), true);
});


test("reviews actual image pixels without creating an all-rejected dead end", async () => {
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 80, g: 90, b: 100 } } }).webp().toBuffer();
  const parsed = parsePrStudioImageReviewInput({
    mainIdea: "The article connects fine cloth selection with bespoke craft.",
    targetAspectRatio: "16:9",
    themes: [
      {
        id: "history",
        title: "History and heritage",
        mustShow: "Visible historical evidence",
        mustAvoid: "A contemporary scene without historical evidence",
      },
      {
        id: "application",
        title: "Bespoke application",
        mustShow: "A person actively selecting or working with cloth",
        mustAvoid: "An unrelated historical artifact",
      },
    ],
    candidates: [
      { id: "a", mimeType: "image/webp", data: image.toString("base64"), title: "Fabric sample book" },
      { id: "b", mimeType: "image/webp", data: image.toString("base64"), title: "Atelier interior" },
    ],
  });
  const previousReviewModel = process.env.PR_STUDIO_IMAGE_REVIEW_MODEL;
  delete process.env.PR_STUDIO_IMAGE_REVIEW_MODEL;
  const request = buildPrStudioImageReviewRequest(parsed);
  if (previousReviewModel === undefined) delete process.env.PR_STUDIO_IMAGE_REVIEW_MODEL;
  else process.env.PR_STUDIO_IMAGE_REVIEW_MODEL = previousReviewModel;
  assert.equal(request.model, "gpt-5-mini");
  assert.equal(request.max_output_tokens, 6_000);
  assert.equal(request.input[0].content.filter((entry) => entry.type === "input_image").length, 2);
  assert.match(request.instructions, /Do not reject every image/);
  assert.match(request.instructions, /native aspect ratio differs/);
  assert.equal(request.input[0].content[0].text.includes("targetAspectRatio"), true);
  assert.equal(parsed.themes.length, 2);
  assert.equal(request.input[0].content[0].text.includes("Bespoke application"), true);
  assert.match(request.instructions, /compare every candidate independently against every supplied theme/);
  const client = { responses: { create: async () => ({
    status: "completed",
    model: "gpt-5-mini",
    id: "resp_review",
    output_text: JSON.stringify({
      summary: "Neither is ideal",
      evaluations: [
        {
          id: "a",
          mainIdeaScore: 20,
          topicScore: 20,
          readabilityScore: 50,
          cropScore: 80,
          bestThemeId: "history",
          bestThemeScore: 20,
          themeScores: [
            { themeId: "history", score: 20 },
            { themeId: "application", score: 10 },
          ],
          verdict: "reject",
          reason: "Weak",
        },
        {
          id: "b",
          mainIdeaScore: 65,
          topicScore: 82,
          readabilityScore: 60,
          cropScore: 70,
          bestThemeId: "application",
          bestThemeScore: 82,
          themeScores: [
            { themeId: "history", score: 8 },
            { themeId: "application", score: 82 },
          ],
          verdict: "usable",
          reason: "Visible cloth selection belongs to the application theme",
        },
      ],
    }),
  }) } };
  const result = await executePrStudioImageReview({
    mainIdea: "The article connects fine cloth selection with bespoke craft.",
    targetAspectRatio: "16:9",
    themes: parsed.themes,
    candidates: parsed.candidates,
  }, { client });
  assert.equal(result.evaluations.some((entry) => entry.verdict !== "reject"), true);
  assert.equal(result.evaluations.find((entry) => entry.id === "b").bestThemeId, "application");
  assert.equal(result.evaluations.find((entry) => entry.id === "b").bestThemeScore, 82);
  assert.equal(result.evaluations.find((entry) => entry.id === "b").themeScores.length, 2);
});

test("rejects unsupported generation aspect ratios and oversized reference sets", () => {
  assert.throws(() => parsePrStudioImageGenerateInput({ prompt: "x", aspectRatio: "3:2" }));
  assert.throws(() => parsePrStudioImageGenerateInput({ prompt: "x", aspectRatio: "1:1", composition: "moodboard" }));
  assert.throws(() => parsePrStudioImageGenerateInput({
    prompt: "x",
    aspectRatio: "1:1",
    references: Array.from({ length: 5 }, () => ({ mimeType: "image/png", data: "AA==" })),
  }));
});

test("generates and crops a publication image through an injected OpenAI client", async () => {
  const generatedWebp = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 32, g: 48, b: 64, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
  let providerPrompt = "";
  const client = {
    images: {
      generate: async (request) => {
        assert.equal(request.model, "gpt-image-2");
        assert.equal(request.size, "1536x1024");
        providerPrompt = request.prompt;
        return { data: [{ b64_json: generatedWebp.toString("base64") }] };
      },
    },
  };
  const result = await executePrStudioImageGeneration(
    {
      prompt: "A quiet tailoring atelier",
      mainIdea: "The article explains how an individual cloth choice connects textile heritage with bespoke craft.",
      mustShow: "a tailor selecting fine suiting cloth from a professional sample book",
      avoid: "generic linen, raw interior fabric, logos",
      visualDirection: "process",
      context: { title: "Loro Piana", summary: "Textile tradition and bespoke cloth" },
      aspectRatio: "16:9",
      composition: "single_scene",
      references: [],
    },
    { client },
  );
  assert.equal(result.aspectRatio, "16:9");
  assert.equal(result.width, 1536);
  assert.equal(result.height, 864);
  assert.equal(result.mimeType, "image/webp");
  assert.ok(result.data.length > 10);
  assert.match(providerPrompt, /one dominant visual subject/);
  assert.match(providerPrompt, /Do not create a collage/);
  assert.match(providerPrompt, /thumbnail size/);
  assert.match(providerPrompt, /ARTICLE MAIN IDEA/);
  assert.match(providerPrompt, /textile heritage with bespoke craft/);
  assert.match(providerPrompt, /MUST VISUALLY COMMUNICATE/);
  assert.match(result.effectivePrompt, /ARTICLE TITLE: Loro Piana/);
});
