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

function criticTask() {
  return {
    operation: "content.editorial-plan-critic",
    promptVersion: "2026-10-06.editorial-plan-critic.v1",
    instructions: "Review the proposed communication program and return a strict quality decision.",
    input: {
      candidate: { title: "Example plan" },
    },
    responseSchema: {
      name: "pr_studio_editorial_plan_critic_v1",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: {
            type: "string",
            enum: ["pass", "reject"],
          },
          summary: {
            type: "string",
            minLength: 1,
            maxLength: 2000,
          },
        },
        required: ["decision", "summary"],
      },
    },
    maxOutputTokens: 32_000,
  };
}

test("routes Editorial Critic through decision-grade Astra with max reasoning", () => {
  const previous = process.env.PR_STUDIO_DECISION_MODEL;
  delete process.env.PR_STUDIO_DECISION_MODEL;

  try {
    const parsed = parsePrStudioStructuredTextInput(criticTask());
    const request = buildPrStudioStructuredTextRequest(parsed);

    assert.equal(parsed.operation, "content.editorial-plan-critic");
    assert.equal(request.model, "gpt-6-astra");
    assert.equal(request.reasoning.effort, "max");
    assert.equal(request.max_output_tokens, 32_000);
    assert.equal(timeoutForOperation(parsed.operation), 600_000);
    assert.equal(maxRetriesForOperation(parsed.operation), 0);
  } finally {
    if (previous === undefined) delete process.env.PR_STUDIO_DECISION_MODEL;
    else process.env.PR_STUDIO_DECISION_MODEL = previous;
  }
});

test("starts and retrieves Editorial Critic through resumable background mode", async () => {
  let createdRequest = null;
  let retrievedId = null;
  const client = {
    responses: {
      create: async (request) => {
        createdRequest = request;
        return {
          id: "resp_editorial_critic_1",
          status: "queued",
          model: "gpt-6-astra",
          usage: null,
        };
      },
      retrieve: async (responseId) => {
        retrievedId = responseId;
        return {
          id: responseId,
          status: "completed",
          model: "gpt-6-astra",
          output_text: JSON.stringify({
            decision: "pass",
            summary: "The plan passes the internal quality gate.",
          }),
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        };
      },
    },
  };

  const started = await startPrStudioStructuredTextBackground(
    criticTask(),
    { client },
  );
  assert.equal(createdRequest.background, true);
  assert.equal(createdRequest.store, true);
  assert.equal(started.status, "queued");
  assert.equal(started.responseId, "resp_editorial_critic_1");

  const completed = await retrievePrStudioStructuredTextBackground(
    {
      operation: "content.editorial-plan-critic",
      promptVersion: "2026-10-06.editorial-plan-critic.v1",
      responseId: started.responseId,
    },
    { client },
  );

  assert.equal(retrievedId, "resp_editorial_critic_1");
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.output, {
    decision: "pass",
    summary: "The plan passes the internal quality gate.",
  });
});
