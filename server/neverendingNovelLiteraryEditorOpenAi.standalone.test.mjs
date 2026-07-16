import assert from "node:assert/strict";
import test from "node:test";
import {
  NEVERENDING_NOVEL_LITERARY_EDITOR_SCHEMA_NAME,
  buildNeverendingNovelLiteraryEditorRequest,
  parseNeverendingNovelLiteraryEditorInput,
} from "./neverendingNovelLiteraryEditorOpenAi.mjs";

const validInput = {
  role: "literary_editor",
  schemaName:
    NEVERENDING_NOVEL_LITERARY_EDITOR_SCHEMA_NAME,
  systemPrompt:
    "Edit one complete accepted Writer draft without changing canon.",
  userPrompt:
    "Editorial request.",
  responseJsonSchema: {
    type: "object",
    properties: {
      editedDraft: {
        type: "object",
        properties: {
          title: {
            type: "string"
          }
        },
        required: [
          "title"
        ],
        additionalProperties: false
      },
      editorialReport: {
        anyOf: [
          {
            type: "object",
            properties: {
              summary: {
                type: "string"
              }
            },
            required: [
              "summary"
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
      "editedDraft",
      "editorialReport"
    ],
    additionalProperties: false
  }
};

test(
  "accepts a strict Literary Editor prompt bundle",
  () => {
    const parsed =
      parseNeverendingNovelLiteraryEditorInput(
        validInput
      );

    assert.equal(
      parsed.role,
      "literary_editor"
    );

    assert.equal(
      parsed.schemaName,
      "literary_editor_output_v0"
    );
  }
);

test(
  "rejects an unknown Literary Editor schema name",
  () => {
    assert.throws(
      () =>
        parseNeverendingNovelLiteraryEditorInput({
          ...validInput,
          schemaName:
            "unknown_schema"
        }),
      /schemaName must be/
    );
  }
);

test(
  "rejects a schema with optional object properties",
  () => {
    assert.throws(
      () =>
        parseNeverendingNovelLiteraryEditorInput({
          ...validInput,
          responseJsonSchema: {
            type: "object",
            properties: {
              editedDraft: {
                type: "string"
              }
            },
            required: [],
            additionalProperties: false
          }
        }),
      /All object properties must be required/
    );
  }
);

test(
  "builds a Responses API strict JSON Schema request",
  () => {
    const request =
      buildNeverendingNovelLiteraryEditorRequest(
        validInput,
        {
          model: "test-model",
          reasoningEffort: "high",
          maxOutputTokens: 32000
        }
      );

    assert.equal(
      request.model,
      "test-model"
    );

    assert.equal(
      request.text.format.type,
      "json_schema"
    );

    assert.equal(
      request.text.format.name,
      "literary_editor_output_v0"
    );

    assert.equal(
      request.text.format.strict,
      true
    );

    assert.equal(
      request.reasoning.effort,
      "high"
    );

    assert.equal(
      request.max_output_tokens,
      32000
    );

    assert.equal(
      request.background,
      true
    );

    assert.equal(
      request.store,
      false
    );
  }
);
