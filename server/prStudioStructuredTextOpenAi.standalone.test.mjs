import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioStructuredTextRequest,
  executePrStudioStructuredText,
  parsePrStudioStructuredTextInput,
} from "./prStudioStructuredTextOpenAi.mjs";

function validInput(overrides = {}) {
  return {
    operation: "brand-memory.document-batch-analysis",
    promptVersion: "2026-07-31.v1",
    instructions: "Extract only evidence-backed facts and return strict JSON.",
    input: {
      brand: { name: "Example" },
      fragments: [{ locator: "page:1", text: "Example was founded in 2020." }],
    },
    responseSchema: {
      name: "brand_memory_document_analysis",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          claims: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                value: { type: "string", minLength: 1, maxLength: 4_000 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["value", "confidence"],
            },
          },
        },
        required: ["claims"],
      },
    },
    maxOutputTokens: 2_000,
    ...overrides,
  };
}

test("accepts a bounded PR Studio structured text task", () => {
  const parsed = parsePrStudioStructuredTextInput(validInput());
  assert.equal(parsed.operation, "brand-memory.document-batch-analysis");
  assert.equal(parsed.promptVersion, "2026-07-31.v1");
  assert.equal(parsed.responseSchema.name, "brand_memory_document_analysis");
  assert.equal(parsed.maxOutputTokens, 2_000);
  assert.match(parsed.serializedInput, /founded in 2020/);
});

test("rejects unregistered operations", () => {
  assert.throws(
    () => parsePrStudioStructuredTextInput(validInput({ operation: "arbitrary.raw-proxy" })),
    /operation is not allowed/,
  );
});

test("accepts only the registered Content Studio roles", () => {
  for (const operation of ["content.research", "content.copywrite", "content.edit"]) {
    const parsed = parsePrStudioStructuredTextInput(validInput({ operation }));
    assert.equal(parsed.operation, operation);
  }
  assert.throws(
    () => parsePrStudioStructuredTextInput(validInput({ operation: "content.publish" })),
    /operation is not allowed/,
  );
});

test("routes Content Studio roles to gateway-controlled GPT-5.6 tiers", () => {
  const environmentNames = [
    "PR_STUDIO_TEXT_MODEL",
    "PR_STUDIO_CONTENT_RESEARCH_MODEL",
    "PR_STUDIO_CONTENT_COPYWRITE_MODEL",
    "PR_STUDIO_CONTENT_EDIT_MODEL",
  ];
  const previous = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]]),
  );
  process.env.PR_STUDIO_TEXT_MODEL = "generic-text-model";
  delete process.env.PR_STUDIO_CONTENT_RESEARCH_MODEL;
  delete process.env.PR_STUDIO_CONTENT_COPYWRITE_MODEL;
  delete process.env.PR_STUDIO_CONTENT_EDIT_MODEL;

  try {
    const research = buildPrStudioStructuredTextRequest(
      parsePrStudioStructuredTextInput(validInput({ operation: "content.research" })),
    );
    const copywrite = buildPrStudioStructuredTextRequest(
      parsePrStudioStructuredTextInput(validInput({ operation: "content.copywrite" })),
    );
    const edit = buildPrStudioStructuredTextRequest(
      parsePrStudioStructuredTextInput(validInput({ operation: "content.edit" })),
    );

    assert.equal(research.model, "gpt-5.6-luna");
    assert.equal(research.reasoning.effort, "medium");
    assert.equal(copywrite.model, "gpt-5.6-terra");
    assert.equal(copywrite.reasoning.effort, "high");
    assert.equal(edit.model, "gpt-5.6-sol");
    assert.equal(edit.reasoning.effort, "high");

    process.env.PR_STUDIO_CONTENT_EDIT_MODEL = "custom-editor-model";
    const overriddenEdit = buildPrStudioStructuredTextRequest(
      parsePrStudioStructuredTextInput(validInput({ operation: "content.edit" })),
    );
    assert.equal(overriddenEdit.model, "custom-editor-model");
  } finally {
    for (const name of environmentNames) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("accepts SMART goal review and keeps its model under gateway control", () => {
  const previous = process.env.PR_STUDIO_STRATEGY_SMART_MODEL;
  delete process.env.PR_STUDIO_STRATEGY_SMART_MODEL;

  try {
    const parsed = parsePrStudioStructuredTextInput(
      validInput({ operation: "strategy.smart-review" }),
    );
    const request = buildPrStudioStructuredTextRequest(parsed);

    assert.equal(parsed.operation, "strategy.smart-review");
    assert.equal(request.model, "gpt-5.6-sol");
    assert.equal(request.reasoning.effort, "medium");

    process.env.PR_STUDIO_STRATEGY_SMART_MODEL =
      "custom-strategy-model";

    const overridden =
      buildPrStudioStructuredTextRequest(
        parsePrStudioStructuredTextInput(
          validInput({ operation: "strategy.smart-review" }),
        ),
      );

    assert.equal(
      overridden.model,
      "custom-strategy-model",
    );
    assert.equal(
      overridden.reasoning.effort,
      "medium",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.PR_STUDIO_STRATEGY_SMART_MODEL;
    } else {
      process.env.PR_STUDIO_STRATEGY_SMART_MODEL =
        previous;
    }
  }
});

test("requires strict closed JSON schemas", () => {
  const input = validInput();
  input.responseSchema.schema.additionalProperties = true;
  assert.throws(
    () => parsePrStudioStructuredTextInput(input),
    /additionalProperties must be false/,
  );
});

test("rejects unsupported schema capabilities", () => {
  const input = validInput();
  input.responseSchema.schema.$ref = "#/$defs/result";
  assert.throws(
    () => parsePrStudioStructuredTextInput(input),
    /unsupported schema keyword \$ref/,
  );
});

test("uses medium reasoning for website analysis and synthesis only", () => {
  const websiteBatch = buildPrStudioStructuredTextRequest(
    parsePrStudioStructuredTextInput(
      validInput({ operation: "brand-memory.website-batch-analysis" }),
    ),
  );
  const websiteSynthesis = buildPrStudioStructuredTextRequest(
    parsePrStudioStructuredTextInput(
      validInput({ operation: "brand-memory.website-profile-synthesis" }),
    ),
  );
  const documentBatch = buildPrStudioStructuredTextRequest(
    parsePrStudioStructuredTextInput(validInput()),
  );

  assert.equal(websiteBatch.reasoning.effort, "medium");
  assert.equal(websiteSynthesis.reasoning.effort, "medium");
  assert.equal(documentBatch.reasoning.effort, "low");
});

test("builds a provider request without accepting a caller-selected model", () => {
  const previous = process.env.PR_STUDIO_TEXT_MODEL;
  process.env.PR_STUDIO_TEXT_MODEL = "gateway-controlled-model";
  try {
    const request = buildPrStudioStructuredTextRequest(
      parsePrStudioStructuredTextInput({
        ...validInput(),
        model: "caller-selected-model",
      }),
    );
    assert.equal(request.model, "gateway-controlled-model");
    assert.equal(request.reasoning.effort, "low");
    assert.equal(request.store, false);
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.strict, true);
    assert.equal(request.max_output_tokens, 2_000);
  } finally {
    if (previous === undefined) delete process.env.PR_STUDIO_TEXT_MODEL;
    else process.env.PR_STUDIO_TEXT_MODEL = previous;
  }
});

test("executes through an injected client and returns normalized provider metadata", async () => {
  let capturedRequest = null;
  const client = {
    responses: {
      create: async (request) => {
        capturedRequest = request;
        return {
          id: "resp_test_123",
          model: "gpt-5-mini-2026-07-01",
          output_text: '{"claims":[{"value":"Example was founded in 2020.","confidence":0.95}]}',
          usage: {
            input_tokens: 120,
            output_tokens: 40,
            total_tokens: 160,
            input_tokens_details: { cached_tokens: 20 },
            output_tokens_details: { reasoning_tokens: 10 },
          },
        };
      },
    },
  };

  const result = await executePrStudioStructuredText(validInput(), { client });
  assert.equal(result.operation, "brand-memory.document-batch-analysis");
  assert.equal(result.output.claims[0].confidence, 0.95);
  assert.equal(result.responseId, "resp_test_123");
  assert.equal(result.usage.totalTokens, 160);
  assert.equal(result.usage.cachedInputTokens, 20);
  assert.equal(capturedRequest.store, false);
});

test("rejects incomplete structured output with provider diagnostics", async () => {
  const client = {
    responses: {
      create: async () => ({
        id: "resp_incomplete_123",
        _request_id: "req_incomplete_123",
        model: "gpt-5-mini",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: '{"claims":[',
        output: [{ type: "reasoning" }, { type: "message", content: [] }],
        usage: {
          input_tokens: 300,
          output_tokens: 2_000,
          total_tokens: 2_300,
          output_tokens_details: { reasoning_tokens: 1_900 },
        },
      }),
    },
  };

  await assert.rejects(
    () => executePrStudioStructuredText(validInput(), { client }),
    (error) =>
      error?.code === "PR_STUDIO_TRANSPORT_INCOMPLETE_RESPONSE" &&
      error?.incompleteReason === "max_output_tokens" &&
      error?.providerRequestId === "req_incomplete_123" &&
      error?.usage?.reasoningTokens === 1_900,
  );
});

test("extracts structured output from response items when output_text is absent", async () => {
  const client = {
    responses: {
      create: async () => ({
        id: "resp_items_123",
        model: "gpt-5-mini",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: '{"claims":[{"value":"Example was founded in 2020.","confidence":0.95}]}',
              },
            ],
          },
        ],
      }),
    },
  };

  const result = await executePrStudioStructuredText(validInput(), { client });
  assert.equal(result.output.claims[0].confidence, 0.95);
});

test("rejects malformed provider JSON", async () => {
  const client = {
    responses: {
      create: async () => ({ output_text: "not-json", model: "gpt-5-mini" }),
    },
  };
  await assert.rejects(
    () => executePrStudioStructuredText(validInput(), { client }),
    (error) => error?.code === "PR_STUDIO_TRANSPORT_INVALID_RESPONSE",
  );
});

test("accepts nullable primitive fields without allowing nullable objects", () => {
  const input = validInput();
  input.responseSchema.schema.properties.claims.items.properties.sourceDate = {
    type: ["string", "null"],
    maxLength: 40,
  };
  input.responseSchema.schema.properties.claims.items.required.push("sourceDate");
  assert.doesNotThrow(() => parsePrStudioStructuredTextInput(input));

  input.responseSchema.schema.properties.claims.items.properties.source = {
    type: ["object", "null"],
    additionalProperties: false,
    properties: {},
    required: [],
  };
  input.responseSchema.schema.properties.claims.items.required.push("source");
  assert.throws(
    () => parsePrStudioStructuredTextInput(input),
    /type is not supported/,
  );
});
