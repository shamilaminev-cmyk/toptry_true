import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioGeoVisibilityYandexMeasurementRequest,
  executePrStudioGeoVisibilityYandexMeasurement,
  parsePrStudioGeoVisibilityYandexMeasurementInput,
} from "../server/prStudioGeoVisibilityYandex.mjs";

test("keeps Yandex GEO measurement neutral and unrestricted to named sites", () => {
  const parsed = parsePrStudioGeoVisibilityYandexMeasurementInput({
    question: "Какие ателье в Москве стоит рассмотреть?",
    language: "ru",
    region: "Москва, Россия",
    brandName: "Bourbaki",
    brandDomain: "bourbaki.ru",
    competitors: ["Example"],
  });
  const request = buildPrStudioGeoVisibilityYandexMeasurementRequest(parsed, "folder-1");
  const serialized = JSON.stringify(request);

  assert.equal(request.folderId, "folder-1");
  assert.equal(request.messages[0].role, "ROLE_USER");
  assert.equal(request.searchType, "SEARCH_TYPE_RU");
  assert.equal("site" in request, false);
  assert.equal("host" in request, false);
  assert.equal("url" in request, false);
  assert.equal(serialized.includes("Bourbaki"), false);
  assert.equal(serialized.includes("bourbaki.ru"), false);
  assert.equal(serialized.includes("Example"), false);
});

test("normalizes Yandex generative answer using only sources marked as used", async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://searchapi.api.cloud.yandex.net/v2/gen/search");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, "Api-Key test-key");
    const body = JSON.parse(init.body);
    assert.equal(body.folderId, "folder-1");
    assert.equal(body.getPartialResults, false);

    return new Response(JSON.stringify([{
      message: {
        role: "ROLE_ASSISTANT",
        content: "### Bourbaki\n\nСтоит рассмотреть как один из вариантов.",
      },
      sources: [
        { url: "https://bourbaki.ru/bespoke_service", title: "Bourbaki", used: true },
        { url: "https://example.com/not-used", title: "Unused", used: false },
      ],
      searchQueries: [
        { text: "bespoke ателье Москва", reqId: "query-1" },
        { text: "лучшие ателье Москва", reqId: "query-2" },
      ],
      isAnswerRejected: false,
      problematicAnswer: false,
    }]), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await executePrStudioGeoVisibilityYandexMeasurement(
    {
      question: "Какие ателье в Москве стоит рассмотреть?",
      language: "ru",
      region: "Москва, Россия",
    },
    { apiKey: "test-key", folderId: "folder-1", fetchImpl },
  );

  assert.equal(result.surfaceKey, "yandex_search_generative_answer");
  assert.equal(result.methodologyKey, "yandex_search_api_gen_search");
  assert.equal(result.methodologyVersion, "2026-08-24.v1");
  assert.equal(
    result.answerText,
    "### Bourbaki\n\nСтоит рассмотреть как один из вариантов.",
  );
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].domain, "bourbaki.ru");
  assert.equal(result.citations.length, 1);
  assert.deepEqual(result.queries, ["bespoke ателье Москва", "лучшие ателье Москва"]);
  assert.equal(result.model, null);
  assert.equal(result.responseId, null);
  assert.deepEqual(result.usage, { searchQueries: 2, usedSources: 1 });
});

test("accepts a direct Yandex GenSearch object for compatibility", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    message: { role: "ROLE_ASSISTANT", content: "Прямой ответ" },
    sources: [{ url: "https://example.com/source", title: "Example", used: true }],
    searchQueries: [{ text: "пример", reqId: "query-1" }],
  }), { status: 200 });

  const result = await executePrStudioGeoVisibilityYandexMeasurement(
    { question: "Кого выбрать?", language: "ru", region: "Россия" },
    { apiKey: "test-key", folderId: "folder-1", fetchImpl },
  );

  assert.equal(result.answerText, "Прямой ответ");
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.queries, ["пример"]);
});

test("rejects Yandex GEO measurement when no grounded source was used", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    message: { role: "ROLE_ASSISTANT", content: "Ответ без источников" },
    sources: [{ url: "https://example.com", title: "Example", used: false }],
    searchQueries: [{ text: "пример", reqId: "query-1" }],
  }), { status: 200 });

  await assert.rejects(
    () => executePrStudioGeoVisibilityYandexMeasurement(
      { question: "Кого выбрать?", language: "ru", region: "Россия" },
      { apiKey: "test-key", folderId: "folder-1", fetchImpl },
    ),
    (error) => {
      assert.equal(error.code, "PR_STUDIO_GEO_YANDEX_GROUNDING_REQUIRED");
      return true;
    },
  );
});
