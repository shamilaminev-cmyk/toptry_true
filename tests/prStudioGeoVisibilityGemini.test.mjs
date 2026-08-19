import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioGeoVisibilityGoogleMeasurementRequest,
  executePrStudioGeoVisibilityGoogleMeasurement,
  parsePrStudioGeoVisibilityGoogleMeasurementInput,
} from "../server/prStudioGeoVisibilityGemini.mjs";

test("keeps Gemini GEO measurement neutral and enables Google Search grounding", () => {
  const parsed = parsePrStudioGeoVisibilityGoogleMeasurementInput({
    question: "Какие ателье в Москве стоит рассмотреть?",
    language: "ru",
    region: "Москва, Россия",
    brandName: "Bourbaki",
    brandDomain: "bourbaki.ru",
    competitors: ["Example"],
  });
  const request = buildPrStudioGeoVisibilityGoogleMeasurementRequest(parsed);
  const serialized = JSON.stringify(request);

  assert.equal(request.contents, "Какие ателье в Москве стоит рассмотреть?");
  assert.deepEqual(request.config.tools, [{ googleSearch: {} }]);
  assert.equal(serialized.includes("Bourbaki"), false);
  assert.equal(serialized.includes("bourbaki.ru"), false);
  assert.equal(serialized.includes("Example"), false);
});

test("normalizes grounded Gemini answer, queries, source-domain evidence and usage", async () => {
  const client = {
    models: {
      async generateContent(request) {
        assert.deepEqual(request.config.tools, [{ googleSearch: {} }]);
        return {
          text: "Bourbaki стоит рассмотреть как один из вариантов.",
          modelVersion: "gemini-3.7-flash",
          responseId: "gemini-response-1",
          candidates: [
            {
              finishReason: "STOP",
              groundingMetadata: {
                webSearchQueries: ["bespoke ателье Москва", "Bourbaki bespoke"],
                groundingChunks: [
                  {
                    web: {
                      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/example",
                      title: "bourbaki.ru",
                    },
                  },
                  {
                    web: {
                      uri: "https://example.com/article",
                      title: "Example article",
                    },
                  },
                ],
                groundingSupports: [
                  {
                    segment: {
                      startIndex: 0,
                      endIndex: 49,
                      text: "Bourbaki стоит рассмотреть как один из вариантов.",
                    },
                    groundingChunkIndices: [0, 1],
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 165,
            thoughtsTokenCount: 15,
            toolUsePromptTokenCount: 20,
          },
        };
      },
    },
  };

  const result = await executePrStudioGeoVisibilityGoogleMeasurement(
    {
      question: "Какие ателье в Москве стоит рассмотреть?",
      language: "ru",
      region: "Москва, Россия",
    },
    { client },
  );

  assert.equal(result.surfaceKey, "google_gemini_search_grounding");
  assert.equal(result.methodologyKey, "gemini_generate_content_google_search");
  assert.equal(result.methodologyVersion, "2026-08-19.v1");
  assert.equal(result.sources[0].domain, "bourbaki.ru");
  assert.equal(result.sources[1].domain, "example.com");
  assert.equal(result.citations.length, 2);
  assert.deepEqual(result.queries, ["bespoke ателье Москва", "Bourbaki bespoke"]);
  assert.equal(result.model, "gemini-3.7-flash");
  assert.equal(result.responseId, "gemini-response-1");
  assert.equal(result.usage.googleSearchQueries, 2);
  assert.equal(result.usage.reasoningTokens, 15);
});

test("rejects a Gemini response when Google Search grounding did not occur", async () => {
  const client = {
    models: {
      async generateContent() {
        return {
          text: "Ungrounded answer",
          modelVersion: "gemini-3.7-flash",
          responseId: "gemini-response-2",
          candidates: [{ finishReason: "STOP" }],
        };
      },
    },
  };

  await assert.rejects(
    () => executePrStudioGeoVisibilityGoogleMeasurement(
      { question: "Кого выбрать?", language: "ru", region: "Россия" },
      { client },
    ),
    (error) => {
      assert.equal(error.code, "PR_STUDIO_GEO_GOOGLE_GROUNDING_REQUIRED");
      return true;
    },
  );
});
