import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioMonitoringDiscoveryRequest,
  executePrStudioMonitoringDiscovery,
  parsePrStudioMonitoringDiscoveryInput,
} from "./prStudioMonitoringOpenAi.mjs";

test("builds semantic query planning from structured monitoring terms", () => {
  const parsed = parsePrStudioMonitoringDiscoveryInput({
    topicName: "Ателье Москвы",
    queryPreview: "\"ателье Москва\" +ателье site:.ru",
    exactPhrases: ["ателье Москва"],
    anyKeywords: ["bespoke", "индивидуальный пошив"],
    requiredKeywords: ["ателье"],
    excludedKeywords: [],
    lookbackDays: 7,
    language: "ru",
    region: "RU",
    runetOnly: true,
    sourceTypes: ["search", "media", "blogs", "sites"],
    brandName: "Ателье Bourbaki тест10",
  });

  const request = buildPrStudioMonitoringDiscoveryRequest(parsed);

  assert.equal(request.tools[0].type, "web_search");
  assert.equal(request.tools[0].search_context_size, "high");
  assert.deepEqual(
    request.include,
    ["web_search_call.action.sources"],
  );

  assert.match(request.instructions, /structured topic fields/);
  assert.match(request.instructions, /different semantic angles/);
  assert.match(request.instructions, /legacy display text only/);
  assert.match(
    request.instructions,
    /Never add the brand to an independent market or editorial search/,
  );
  assert.match(request.instructions, /Generic business directories/);
  assert.match(
    request.instructions,
    /search is the discovery transport and is not itself a page category/,
  );
  assert.match(
    request.instructions,
    /candidatePages is the editorially selected monitoring result set/,
  );

  assert.doesNotMatch(
    request.instructions,
    /Treat queryPreview as semantic search constraints/,
  );
});

test("keeps queryPreview as a backward-compatible legacy fallback", () => {
  const parsed = parsePrStudioMonitoringDiscoveryInput({
    topicName: "Классический костюм",
    queryPreview: "\"классический костюм\" +костюм",
    lookbackDays: 7,
  });

  assert.equal(parsed.exactPhrases.length, 0);
  assert.equal(parsed.anyKeywords.length, 0);
  assert.equal(parsed.requiredKeywords.length, 0);

  const request = buildPrStudioMonitoringDiscoveryRequest(parsed);

  assert.match(
    request.instructions,
    /legacy request without structured topic fields/,
  );
});

test("returns only model-selected grounded monitoring candidates", async () => {
  const response = {
    status: "completed",
    model: "gpt-5-mini",
    id: "resp_monitoring",
    output_text: JSON.stringify({
      summary: "Found useful editorial coverage",
      candidatePages: [
        {
          url: "https://example.ru/article-one",
          title: "Новое московское ателье",
          excerpt: "Редакционный материал об открытии нового ателье.",
        },
      ],
    }),
    output: [
      {
        type: "web_search_call",
        action: {
          queries: [
            "новое ателье Москва открытие",
            "индивидуальный пошив Москва интервью",
          ],
          sources: [
            {
              url: "https://example.ru/article-one",
              title: "Новое московское ателье",
            },
            {
              url: "https://directory.ru/moscow/atelier",
              title: "Каталог ателье Москвы",
            },
          ],
        },
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    },
  };

  const client = {
    responses: {
      create: async () => response,
    },
  };

  const result = await executePrStudioMonitoringDiscovery(
    {
      topicName: "Ателье Москвы",
      exactPhrases: ["ателье Москва"],
      requiredKeywords: ["ателье"],
      lookbackDays: 7,
      sourceTypes: ["search", "media", "blogs", "sites"],
    },
    { client },
  );

  assert.equal(result.sources.length, 1);
  assert.equal(
    result.sources[0].url,
    "https://example.ru/article-one",
  );
  assert.match(
    result.sources[0].citedText,
    /Редакционный материал/,
  );
  assert.equal(
    result.sources.some(({ url }) =>
      url.includes("directory.ru"),
    ),
    false,
  );

  assert.deepEqual(result.queries, [
    "новое ателье Москва открытие",
    "индивидуальный пошив Москва интервью",
  ]);
});

test("does not admit invented candidate URLs outside grounded web sources", async () => {
  const client = {
    responses: {
      create: async () => ({
        status: "completed",
        model: "gpt-5-mini",
        id: "resp_grounding",
        output_text: JSON.stringify({
          summary: "Discovery complete",
          candidatePages: [
            {
              url: "https://invented.example/fake",
              title: "Invented",
              excerpt: "Must not be trusted",
            },
          ],
        }),
        output: [
          {
            type: "web_search_call",
            action: {
              query: "ателье Москва интервью",
              sources: [
                {
                  url: "https://real.ru/news",
                  title: "Реальная публикация",
                },
              ],
            },
          },
        ],
      }),
    },
  };

  const result = await executePrStudioMonitoringDiscovery(
    {
      topicName: "Ателье Москвы",
      exactPhrases: ["ателье Москва"],
      requiredKeywords: ["ателье"],
      lookbackDays: 7,
    },
    { client },
  );

  assert.equal(result.sources.length, 0);
  assert.equal(
    result.sources.some(({ url }) =>
      url.includes("invented.example"),
    ),
    false,
  );
});
