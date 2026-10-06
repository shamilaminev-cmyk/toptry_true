import assert from "node:assert/strict";
import test from "node:test";

import {
  retrievePrStudioStructuredTextBackground,
  startPrStudioStructuredTextBackground,
} from "./prStudioStructuredTextOpenAi.mjs";

function editorialTask() {
  return {
    operation: "content.editorial-plan-draft",
    promptVersion: "2026-10-06.editorial-plan-draft.v1",
    instructions: "Return a strict editorial plan object.",
    input: {
      brand: { name: "Example" },
    },
    responseSchema: {
      name: "editorial_plan",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            minLength: 1,
            maxLength: 100,
          },
        },
        required: ["title"],
      },
    },
    maxOutputTokens: 64_000,
  };
}

test("starts Editorial Planner through OpenAI background mode", async () => {
  const previous = process.env.PR_STUDIO_DECISION_MODEL;
  delete process.env.PR_STUDIO_DECISION_MODEL;
  let request;

  const client = {
    responses: {
      create: async (value) => {
        request = value;
        return {
          id: "resp_background_1",
          status: "queued",
          model: "gpt-6-astra",
          usage: null,
        };
      },
    },
  };

  try {
    const result = await startPrStudioStructuredTextBackground(
      editorialTask(),
      { client },
    );

    assert.equal(request.model, "gpt-6-astra");
    assert.equal(request.reasoning.effort, "max");
    assert.equal(request.max_output_tokens, 64_000);
    assert.equal(request.background, true);
    assert.equal(request.store, true);

    assert.equal(result.status, "queued");
    assert.equal(result.responseId, "resp_background_1");
    assert.equal(result.output, null);
  } finally {
    if (previous === undefined) delete process.env.PR_STUDIO_DECISION_MODEL;
    else process.env.PR_STUDIO_DECISION_MODEL = previous;
  }
});

test("retrieves a running Editorial Planner background response without creating another response", async () => {
  let retrievedId = null;
  const client = {
    responses: {
      retrieve: async (responseId) => {
        retrievedId = responseId;
        return {
          id: responseId,
          status: "in_progress",
          model: "gpt-6-astra",
          usage: null,
        };
      },
    },
  };

  const result = await retrievePrStudioStructuredTextBackground(
    {
      operation: "content.editorial-plan-draft",
      promptVersion: "2026-10-06.editorial-plan-draft.v1",
      responseId: "resp_background_2",
    },
    { client },
  );

  assert.equal(retrievedId, "resp_background_2");
  assert.equal(result.status, "in_progress");
  assert.equal(result.output, null);
});

test("normalizes a completed Editorial Planner background response", async () => {
  const client = {
    responses: {
      retrieve: async (responseId) => ({
        id: responseId,
        status: "completed",
        model: "gpt-6-astra",
        output_text: JSON.stringify({
          title: "Editorial plan",
        }),
        usage: {
          input_tokens: 120,
          output_tokens: 80,
          total_tokens: 200,
        },
      }),
    },
  };

  const result = await retrievePrStudioStructuredTextBackground(
    {
      operation: "content.editorial-plan-draft",
      promptVersion: "2026-10-06.editorial-plan-draft.v1",
      responseId: "resp_background_3",
    },
    { client },
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, {
    title: "Editorial plan",
  });
  assert.equal(result.responseId, "resp_background_3");
  assert.equal(result.model, "gpt-6-astra");
});

test("does not expose background mode to ordinary structured-text operations", async () => {
  await assert.rejects(
    () =>
      startPrStudioStructuredTextBackground(
        {
          ...editorialTask(),
          operation: "content.edit",
          maxOutputTokens: 6_000,
        },
        {
          client: {
            responses: {
              create: async () => {
                throw new Error("must not be called");
              },
            },
          },
        },
      ),
    /Background structured text is allowed only for content\.editorial-plan-draft/,
  );
});
