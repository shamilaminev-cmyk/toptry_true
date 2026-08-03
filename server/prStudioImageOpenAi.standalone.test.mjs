import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  buildPrStudioImageSearchRequest,
  executePrStudioImageGeneration,
  parsePrStudioImageGenerateInput,
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
    context: { brandName: "Bourbaki", title: "Bespoke and MTM" },
  });
  assert.equal(parsed.maxResults, 6);
  assert.equal(parsed.searchQueries.length, 2);
  assert.match(parsed.mainIdea, /individually drafted pattern/);
  const request = buildPrStudioImageSearchRequest(parsed);
  assert.equal(request.tools[0].type, "web_search");
  assert.deepEqual(request.include, ["web_search_call.action.sources"]);
  assert.match(request.instructions, /exact name/);
  assert.match(request.instructions, /generic press-kit templates/);
  assert.equal(request.text.format.schema.required.includes("candidatePages"), true);
  assert.equal(request.text.format.schema.required.includes("queries"), true);
  assert.equal(request.tools[0].search_context_size, "high");
});

test("uses only model-selected pages that exist in web-search sources", () => {
  const sources = [
    { url: "https://example.com/relevant", title: "Relevant" },
    { url: "https://example.com/unrelated", title: "Unrelated" },
  ];
  const selected = selectPrStudioImageSearchSources(sources, [
    { pageUrl: "https://example.com/relevant", reason: "Exact subject" },
    { pageUrl: "https://hallucinated.invalid/page", reason: "Not in sources" },
  ]);
  assert.deepEqual(selected, [sources[0]]);
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
