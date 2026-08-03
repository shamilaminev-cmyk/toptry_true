import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  buildPrStudioImageSearchRequest,
  executePrStudioImageGeneration,
  parsePrStudioImageGenerateInput,
  parsePrStudioImageSearchInput,
} from "./prStudioImageOpenAi.mjs";

test("accepts bounded editorial image search input", () => {
  const parsed = parsePrStudioImageSearchInput({
    query: "bespoke tailoring workshop editorial photograph",
    maxResults: 6,
    context: { brandName: "Bourbaki", title: "Bespoke and MTM" },
  });
  assert.equal(parsed.maxResults, 6);
  const request = buildPrStudioImageSearchRequest(parsed);
  assert.equal(request.tools[0].type, "web_search");
  assert.deepEqual(request.include, ["web_search_call.action.sources"]);
});

test("rejects unsupported generation aspect ratios and oversized reference sets", () => {
  assert.throws(() => parsePrStudioImageGenerateInput({ prompt: "x", aspectRatio: "3:2" }));
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
  const client = {
    images: {
      generate: async (request) => {
        assert.equal(request.model, "gpt-image-2");
        assert.equal(request.size, "1536x1024");
        return { data: [{ b64_json: generatedWebp.toString("base64") }] };
      },
    },
  };
  const result = await executePrStudioImageGeneration(
    { prompt: "A quiet tailoring atelier", aspectRatio: "16:9", references: [] },
    { client },
  );
  assert.equal(result.aspectRatio, "16:9");
  assert.equal(result.width, 1536);
  assert.equal(result.height, 864);
  assert.equal(result.mimeType, "image/webp");
  assert.ok(result.data.length > 10);
});
