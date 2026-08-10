import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioMonitoringDiscoveryRequest,
  executePrStudioMonitoringDiscovery,
  parsePrStudioMonitoringDiscoveryInput,
} from "./prStudioMonitoringOpenAi.mjs";

test("builds recall-first monitoring discovery instead of canonical-answer research", () => {
  const parsed = parsePrStudioMonitoringDiscoveryInput({
    topicName: "Классический костюм",
    queryPreview: "\"классический костюм\" +костюм",
    lookbackDays: 7,
    language: "ru",
    region: "RU",
    runetOnly: true,
    sourceTypes: ["news", "blogs"],
  });

  const request = buildPrStudioMonitoringDiscoveryRequest(parsed);

  assert.equal(request.tools[0].type, "web_search");
  assert.equal(request.tools[0].search_context_size, "high");
  assert.deepEqual(
    request.include,
    ["web_search_call.action.sources"],
  );
  assert.match(request.instructions, /recall-first/);
  assert.match(
    request.instructions,
    /not to produce a canonical answer/,
  );
  assert.match(
    request.instructions,
    /do not discard an otherwise relevant candidate merely because its publication date is unclear/,
  );
  assert.doesNotMatch(
    request.instructions,
    /return outcome insufficient/,
  );
});

test("returns grounded web sources even when they are not all model-selected", async () => {
  const response = {
    status: "completed",
    model: "gpt-5-mini",
    id: "resp_monitoring",
    output_text: JSON.stringify({
      summary: "Found recent tailoring coverage",
      candidatePages: [
        {
          url: "https://example.ru/article-one",
          title: "Классический костюм сегодня",
          excerpt: "Новая публикация о классическом костюме",
        },
      ],
    }),
    output: [
      {
        type: "web_search_call",
        action: {
          queries: [
            "классический костюм Москва",
            "мужской костюм ателье",
          ],
          sources: [
            {
              url: "https://example.ru/article-one",
              title: "Классический костюм сегодня",
            },
            {
              url: "https://second.ru/article-two",
              title: "Мужской костюм и ателье",
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
      topicName: "Классический костюм",
      queryPreview: "\"классический костюм\" +костюм",
      lookbackDays: 7,
    },
    { client },
  );

  assert.equal(result.sources.length, 2);
  assert.equal(
    result.sources[0].url,
    "https://example.ru/article-one",
  );
  assert.match(
    result.sources[0].citedText,
    /Новая публикация/,
  );
  assert.equal(
    result.sources[1].url,
    "https://second.ru/article-two",
  );
  assert.equal(result.sources[1].citedText, null);
  assert.deepEqual(result.queries, [
    "классический костюм Москва",
    "мужской костюм ателье",
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
              query: "ателье Москва",
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
      queryPreview: "\"ателье Москва\" +ателье",
      lookbackDays: 7,
    },
    { client },
  );

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://real.ru/news");
  assert.equal(
    result.sources.some(({ url }) =>
      url.includes("invented.example"),
    ),
    false,
  );
});
