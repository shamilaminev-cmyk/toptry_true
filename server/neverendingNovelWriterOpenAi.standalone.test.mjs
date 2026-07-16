import assert from "node:assert/strict";
import test from "node:test";
import {
  NEVERENDING_NOVEL_WRITER_SCHEMA_NAME,
  buildNeverendingNovelWriterRequest,
  parseNeverendingNovelWriterInput,
} from "./neverendingNovelWriterOpenAi.mjs";

const validInput = {
  role: "writer",
  schemaName:
    NEVERENDING_NOVEL_WRITER_SCHEMA_NAME,
  systemPrompt: "Write a complete prose draft for one accepted chapter.",
  userPrompt: "Reader request.",
  responseJsonSchema: {
    type: "object",
    properties: {
      title: {
        type: "string"
      },
      progressionSystem: {
        anyOf: [
          {
            type: "object",
            properties: {
              name: {
                type: "string"
              }
            },
            required: [
              "name"
            ],
            additionalProperties: false
          },
          {
            type: "null"
          }
        ]
      }
    },
    required: [
      "title",
      "progressionSystem"
    ],
    additionalProperties: false
  }
};

test("accepts a strict Writer prompt bundle", () => {
  const parsed =
    parseNeverendingNovelWriterInput(validInput);

  assert.equal(parsed.role, "writer");
  assert.equal(
    parsed.schemaName,
    "writer_output_v0"
  );
});

test("rejects an unknown Writer schema name", () => {
  assert.throws(
    () =>
      parseNeverendingNovelWriterInput({
        ...validInput,
        schemaName: "unknown_schema"
      }),
    /schemaName must be/
  );
});

test("rejects a schema with optional object properties", () => {
  assert.throws(
    () =>
      parseNeverendingNovelWriterInput({
        ...validInput,
        responseJsonSchema: {
          type: "object",
          properties: {
            title: {
              type: "string"
            }
          },
          required: [],
          additionalProperties: false
        }
      }),
    /All object properties must be required/
  );
});

test("builds a Responses API strict JSON Schema request", () => {
  const request =
    buildNeverendingNovelWriterRequest(
      validInput,
      {
        model: "test-model",
        reasoningEffort: "high",
        maxOutputTokens: 32000
      }
    );

  assert.equal(request.model, "test-model");
  assert.equal(
    request.text.format.type,
    "json_schema"
  );
  assert.equal(
    request.text.format.name,
    "writer_output_v0"
  );
  assert.equal(request.text.format.strict, true);
  assert.equal(request.reasoning.effort, "high");
  assert.equal(request.max_output_tokens, 32000);
  assert.equal(request.background, true);
  assert.equal(request.store, false);
});
