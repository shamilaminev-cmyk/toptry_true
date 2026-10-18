import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioStructuredTextRequest,
  maxRetriesForOperation,
  parsePrStudioStructuredTextInput,
  retrievePrStudioStructuredTextBackground,
  startPrStudioStructuredTextBackground,
  timeoutForOperation,
} from "./prStudioStructuredTextOpenAi.mjs";

function directionTask(operation) {
  const isCritic = operation === "content.editorial-directions-critic";
  return {
    operation,
    promptVersion: isCritic
      ? "2026-10-18.editorial-directions-critic.v1"
      : "2026-10-18.editorial-directions.v1",
    instructions: isCritic
      ? "Evaluate four communication directions as an independent Creative Critic."
      : "Generate four genuinely different communication directions.",
    input: {
      brand: { name: "Example" },
    },
    responseSchema: {
      name: isCritic
        ? "pr_studio_editorial_direction_critic_v1"
        : "pr_studio_editorial_direction_set_v1",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          value: {
            type: "string",
            minLength: 1,
            maxLength: 100,
          },
        },
        required: ["value"],
      },
    },
    maxOutputTokens: isCritic ? 10_000 : 18_000,
  };
}

test("routes direction discovery and Creative Critic through decision-grade Astra", () => {
  const previous = process.env.PR_STUDIO_DECISION_MODEL;
  delete process.env.PR_STUDIO_DECISION_MODEL;

  try {
    for (const operation of [
      "content.editorial-directions-draft",
      "content.editorial-directions-critic",
    ]) {
      const parsed = parsePrStudioStructuredTextInput(directionTask(operation));
      const request = buildPrStudioStructuredTextRequest(parsed);

      assert.equal(parsed.operation, operation);
      assert.equal(request.model, "gpt-6-astra");
      assert.equal(request.reasoning.effort, "max");
      assert.equal(
        request.max_output_tokens,
        operation === "content.editorial-directions-draft"
          ? 18_000
          : 10_000,
      );
      assert.equal(timeoutForOperation(operation), 600_000);
      assert.equal(maxRetriesForOperation(operation), 0);
    }
  } finally {
    if (previous === undefined) delete process.env.PR_STUDIO_DECISION_MODEL;
    else process.env.PR_STUDIO_DECISION_MODEL = previous;
  }
});

test("enforces operation-specific output ceilings for direction work", () => {
  for (const [operation, ceiling] of [
    ["content.editorial-directions-draft", 18_000],
    ["content.editorial-directions-critic", 10_000],
  ]) {
    assert.equal(
      parsePrStudioStructuredTextInput(
        directionTask(operation),
      ).maxOutputTokens,
      ceiling,
    );

    assert.throws(
      () =>
        parsePrStudioStructuredTextInput({
          ...directionTask(operation),
          maxOutputTokens: ceiling + 1,
        }),
      /maxOutputTokens must be an integer between 256 and/,
    );
  }
});

test("starts direction discovery in resumable background mode", async () => {
  let createdRequest = null;
  const client = {
    responses: {
      create: async (request) => {
        createdRequest = request;
        return {
          id: "resp_editorial_directions_1",
          status: "queued",
          model: "gpt-6-astra",
          usage: null,
        };
      },
    },
  };

  const result = await startPrStudioStructuredTextBackground(
    directionTask("content.editorial-directions-draft"),
    { client },
  );

  assert.equal(createdRequest.background, true);
  assert.equal(createdRequest.store, true);
  assert.equal(result.status, "queued");
  assert.equal(result.responseId, "resp_editorial_directions_1");
  assert.equal(result.output, null);
});

test("starts Creative Critic in resumable background mode", async () => {
  let createdRequest = null;
  const client = {
    responses: {
      create: async (request) => {
        createdRequest = request;
        return {
          id: "resp_editorial_directions_critic_1",
          status: "queued",
          model: "gpt-6-astra",
          usage: null,
        };
      },
    },
  };

  const result = await startPrStudioStructuredTextBackground(
    directionTask("content.editorial-directions-critic"),
    { client },
  );

  assert.equal(createdRequest.background, true);
  assert.equal(createdRequest.store, true);
  assert.equal(result.status, "queued");
  assert.equal(
    result.responseId,
    "resp_editorial_directions_critic_1",
  );
  assert.equal(result.output, null);
});

test("retrieves direction discovery without creating another response", async () => {
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
      operation: "content.editorial-directions-draft",
      promptVersion: "2026-10-18.editorial-directions.v1",
      responseId: "resp_editorial_directions_2",
    },
    { client },
  );

  assert.equal(retrievedId, "resp_editorial_directions_2");
  assert.equal(result.status, "in_progress");
  assert.equal(result.output, null);
});

test("retrieves Creative Critic without creating another response", async () => {
  let retrievedId = null;
  const client = {
    responses: {
      retrieve: async (responseId) => {
        retrievedId = responseId;
        return {
          id: responseId,
          status: "completed",
          model: "gpt-6-astra",
          output_text: JSON.stringify({ value: "pass" }),
          usage: {
            input_tokens: 100,
            output_tokens: 30,
            total_tokens: 130,
          },
        };
      },
    },
  };

  const result = await retrievePrStudioStructuredTextBackground(
    {
      operation: "content.editorial-directions-critic",
      promptVersion: "2026-10-18.editorial-directions-critic.v1",
      responseId: "resp_editorial_directions_critic_2",
    },
    { client },
  );

  assert.equal(retrievedId, "resp_editorial_directions_critic_2");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { value: "pass" });
});

test("keeps unrelated structured operations out of background mode", async () => {
  await assert.rejects(
    () =>
      startPrStudioStructuredTextBackground(
        {
          ...directionTask("content.editorial-directions-draft"),
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
    /Background structured text is allowed only for Editorial Planner operations/,
  );
});
