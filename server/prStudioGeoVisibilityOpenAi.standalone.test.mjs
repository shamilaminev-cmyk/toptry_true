import assert from "node:assert/strict";
import test from "node:test";

import {
  PR_STUDIO_GEO_VISIBILITY_METHODOLOGY_KEY,
  PR_STUDIO_GEO_VISIBILITY_METHODOLOGY_VERSION,
  PR_STUDIO_GEO_VISIBILITY_SURFACE_KEY,
  buildPrStudioGeoVisibilityMeasurementRequest,
  executePrStudioGeoVisibilityMeasurement,
  parsePrStudioGeoVisibilityMeasurementInput,
} from "./prStudioGeoVisibilityOpenAi.mjs";

function validInput(overrides = {}) {
  return {
    question: "Какие компании стоит рассмотреть для этой услуги в России?",
    language: "ru",
    region: "Россия",
    ...overrides,
  };
}

function completedResponse() {
  const answerText =
    "Можно рассмотреть Example One и Example Two; выбор зависит от задачи.";
  return {
    id: "resp_geo_measure_123",
    model: "gpt-5.6",
    status: "completed",
    output_text: answerText,
    output: [
      {
        type: "web_search_call",
        action: {
          type: "search",
          queries: ["компании услуга Россия"],
          sources: [
            {
              url: "https://example-one.ru/service",
              title: "Example One",
            },
            {
              url: "https://example-two.ru/",
              title: "Example Two",
            },
          ],
        },
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: answerText,
            annotations: [
              {
                type: "url_citation",
                start_index: 0,
                end_index: 26,
                url: "https://example-one.ru/service",
                title: "Example One",
              },
            ],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 120,
      output_tokens: 60,
      total_tokens: 180,
    },
  };
}

test("builds a neutral free-text live-web measurement without brand metadata", () => {
  const previous = process.env.PR_STUDIO_GEO_VISIBILITY_MODEL;
  process.env.PR_STUDIO_GEO_VISIBILITY_MODEL = "gateway-controlled-geo-model";
  try {
    const parsed = parsePrStudioGeoVisibilityMeasurementInput({
      ...validInput(),
      brandName: "Must Not Reach Prompt",
      competitors: ["Must Not Reach Prompt Either"],
      model: "caller-selected-model",
    });
    const request = buildPrStudioGeoVisibilityMeasurementRequest(parsed);

    assert.equal(request.model, "gateway-controlled-geo-model");
    assert.equal(request.tool_choice, "required");
    assert.equal(request.store, false);
    assert.deepEqual(request.include, ["web_search_call.action.sources"]);
    assert.equal(request.tools[0].type, "web_search");
    assert.equal(request.tools[0].external_web_access, true);
    assert.equal("text" in request, false);
    assert.equal(request.input, validInput().question);
    assert.doesNotMatch(request.instructions, /Must Not Reach Prompt/);
    assert.match(request.instructions, /observational measurement/);
    assert.match(request.instructions, /Do not optimize the answer for or against any brand/);
  } finally {
    if (previous === undefined) delete process.env.PR_STUDIO_GEO_VISIBILITY_MODEL;
    else process.env.PR_STUDIO_GEO_VISIBILITY_MODEL = previous;
  }
});

test("returns the exact answer plus grounded citations sources queries and provenance", async () => {
  let capturedRequest = null;
  const client = {
    responses: {
      create: async (request) => {
        capturedRequest = request;
        return completedResponse();
      },
    },
  };

  const result = await executePrStudioGeoVisibilityMeasurement(validInput(), {
    client,
  });

  assert.equal(result.answerText, completedResponse().output_text);
  assert.equal(result.surfaceKey, PR_STUDIO_GEO_VISIBILITY_SURFACE_KEY);
  assert.equal(result.methodologyKey, PR_STUDIO_GEO_VISIBILITY_METHODOLOGY_KEY);
  assert.equal(
    result.methodologyVersion,
    PR_STUDIO_GEO_VISIBILITY_METHODOLOGY_VERSION,
  );
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].url, "https://example-one.ru/service");
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.queries, ["компании услуга Россия"]);
  assert.equal(result.model, "gpt-5.6");
  assert.equal(result.responseId, "resp_geo_measure_123");
  assert.equal(result.usage.totalTokens, 180);
  assert.equal(capturedRequest.tool_choice, "required");
});

test("rejects invalid inputs and incomplete provider answers", async () => {
  assert.throws(
    () => parsePrStudioGeoVisibilityMeasurementInput({ question: "" }),
    /question is required/,
  );
  assert.throws(
    () =>
      parsePrStudioGeoVisibilityMeasurementInput(
        validInput({ maxOutputTokens: 99 }),
      ),
    /maxOutputTokens/,
  );

  const response = completedResponse();
  response.status = "incomplete";
  response.incomplete_details = { reason: "max_output_tokens" };
  const client = { responses: { create: async () => response } };
  await assert.rejects(
    () => executePrStudioGeoVisibilityMeasurement(validInput(), { client }),
    /was incomplete/,
  );
});
