import assert from "node:assert/strict";
import test from "node:test";
import {
  NEVERENDING_NOVEL_CHAPTER_PLANNER_SCHEMA_NAME,
  buildNeverendingNovelChapterPlannerRequest,
  parseNeverendingNovelChapterPlannerInput,
} from "./neverendingNovelChapterPlannerOpenAi.mjs";

const validInput = {
  role: "chapter_planner",
  schemaName:
    NEVERENDING_NOVEL_CHAPTER_PLANNER_SCHEMA_NAME,
  systemPrompt: "Create a scene-level plan for one chapter.",
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

test("accepts a strict Chapter Planner prompt bundle", () => {
  const parsed =
    parseNeverendingNovelChapterPlannerInput(validInput);

  assert.equal(parsed.role, "chapter_planner");
  assert.equal(
    parsed.schemaName,
    "chapter_planner_output_v0"
  );
});

test("rejects an unknown Chapter Planner schema name", () => {
  assert.throws(
    () =>
      parseNeverendingNovelChapterPlannerInput({
        ...validInput,
        schemaName: "unknown_schema"
      }),
    /schemaName must be/
  );
});

test("rejects a schema with optional object properties", () => {
  assert.throws(
    () =>
      parseNeverendingNovelChapterPlannerInput({
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
    buildNeverendingNovelChapterPlannerRequest(
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
    "chapter_planner_output_v0"
  );
  assert.equal(request.text.format.strict, true);
  assert.equal(request.reasoning.effort, "high");
  assert.equal(request.max_output_tokens, 32000);
  assert.equal(request.background, true);
  assert.equal(request.store, false);
});
