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
