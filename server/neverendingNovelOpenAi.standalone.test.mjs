import assert from "node:assert/strict";
import test from "node:test";
import {
  NEVERENDING_NOVEL_ARCHITECT_SCHEMA_NAME,
  buildNeverendingNovelStoryArchitectRequest,
  parseNeverendingNovelStoryArchitectInput,
} from "./neverendingNovelOpenAi.mjs";

const validInput = {
  role: "story_architect",
  schemaName:
    NEVERENDING_NOVEL_ARCHITECT_SCHEMA_NAME,
  systemPrompt: "Create a story blueprint.",
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

test("accepts a strict Story Architect prompt bundle", () => {
  const parsed =
    parseNeverendingNovelStoryArchitectInput(validInput);

  assert.equal(parsed.role, "story_architect");
  assert.equal(
    parsed.schemaName,
    "story_architect_output_v0"
  );
});

test("rejects an unknown Story Architect schema name", () => {
  assert.throws(
    () =>
      parseNeverendingNovelStoryArchitectInput({
        ...validInput,
        schemaName: "unknown_schema"
      }),
    /schemaName must be/
  );
});

test("rejects a schema with optional object properties", () => {
  assert.throws(
    () =>
      parseNeverendingNovelStoryArchitectInput({
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
    buildNeverendingNovelStoryArchitectRequest(
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
    "story_architect_output_v0"
  );
  assert.equal(request.text.format.strict, true);
  assert.equal(request.reasoning.effort, "high");
  assert.equal(request.max_output_tokens, 32000);
  assert.equal(request.store, false);
});
