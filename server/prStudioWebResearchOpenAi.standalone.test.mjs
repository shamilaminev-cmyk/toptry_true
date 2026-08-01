import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioWebResearchRequest,
  executePrStudioWebResearch,
  parsePrStudioWebResearchInput,
} from "./prStudioWebResearchOpenAi.mjs";

function validInput(overrides = {}) {
  return {
    brand: {
      name: "Atelier Example",
      description: "A bespoke tailoring brand",
    },
    question: {
      questionKey: "contacts.addresses",
      question: "What public address and opening hours are current?",
      helpText: "Use only current public contact information.",
      answerType: "long_text",
      researchPolicy: "corpus_then_official_web",
      volatility: "current",
      currentAnswer: null,
    },
    allowedDomains: ["example.com"],
    maxOutputTokens: 2_000,
    ...overrides,
  };
}

function completedResponse() {
  const outputText = JSON.stringify({
    outcome: "answer",
    answer: "10 Example Street, Moscow. Open daily 10:00–20:00.",
    rationale: "The current contact page states the address and opening hours.",
    confidence: 0.94,
  });
  return {
    id: "resp_web_123",
    model: "gpt-5-mini",
    status: "completed",
    output_text: outputText,
    output: [
      {
        type: "web_search_call",
        action: {
          type: "search",
          queries: ["site:example.com address opening hours"],
          sources: [
            {
              url: "https://example.com/contacts",
              title: "Contacts",
            },
          ],
        },
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: outputText,
            annotations: [
              {
                type: "url_citation",
                start_index: 0,
                end_index: Math.min(40, outputText.length),
                url: "https://example.com/contacts",
                title: "Contacts",
              },
            ],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 300,
      output_tokens: 90,
      total_tokens: 390,
    },
  };
}

test("requires verified domains for official-web research", () => {
  assert.throws(
    () => parsePrStudioWebResearchInput(validInput({ allowedDomains: [] })),
    /requires at least one allowed domain/,
  );
});

test("accepts open-web research without a domain filter", () => {
  const parsed = parsePrStudioWebResearchInput(
    validInput({
      question: {
        ...validInput().question,
        researchPolicy: "corpus_then_open_web",
      },
      allowedDomains: [],
    }),
  );
  assert.equal(parsed.question.researchPolicy, "corpus_then_open_web");
  assert.deepEqual(parsed.allowedDomains, []);
});

test("rejects unsafe or malformed allowed domains", () => {
  assert.throws(
    () => parsePrStudioWebResearchInput(validInput({ allowedDomains: ["https://example.com/path"] })),
    /Invalid allowed domain/,
  );
  assert.throws(
    () => parsePrStudioWebResearchInput(validInput({ allowedDomains: ["localhost"] })),
    /Invalid allowed domain/,
  );
});

test("builds a required live web-search request with official-domain filters", () => {
  const previous = process.env.PR_STUDIO_WEB_RESEARCH_MODEL;
  process.env.PR_STUDIO_WEB_RESEARCH_MODEL = "gateway-controlled-web-model";
  try {
    const request = buildPrStudioWebResearchRequest(
      parsePrStudioWebResearchInput({
        ...validInput(),
        model: "caller-selected-model",
      }),
    );
    assert.equal(request.model, "gateway-controlled-web-model");
    assert.equal(request.tool_choice, "required");
    assert.equal(request.store, false);
    assert.deepEqual(request.include, ["web_search_call.action.sources"]);
    assert.equal(request.tools[0].type, "web_search");
    assert.equal(request.tools[0].external_web_access, true);
    assert.deepEqual(request.tools[0].filters.allowed_domains, ["example.com"]);
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.strict, true);
  } finally {
    if (previous === undefined) delete process.env.PR_STUDIO_WEB_RESEARCH_MODEL;
    else process.env.PR_STUDIO_WEB_RESEARCH_MODEL = previous;
  }
});

test("does not add domain filters to open-web research", () => {
  const request = buildPrStudioWebResearchRequest(
    parsePrStudioWebResearchInput(
      validInput({
        question: {
          ...validInput().question,
          researchPolicy: "corpus_then_open_web",
        },
        allowedDomains: [],
      }),
    ),
  );
  assert.equal("filters" in request.tools[0], false);
});

test("executes through an injected client and returns only cited web metadata", async () => {
  let capturedRequest = null;
  const client = {
    responses: {
      create: async (request) => {
        capturedRequest = request;
        return completedResponse();
      },
    },
  };
  const result = await executePrStudioWebResearch(validInput(), { client });
  assert.equal(result.questionKey, "contacts.addresses");
  assert.equal(result.outcome, "answer");
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].url, "https://example.com/contacts");
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.queries, ["site:example.com address opening hours"]);
  assert.equal(result.usage.totalTokens, 390);
  assert.equal(capturedRequest.tool_choice, "required");
});

test("rejects an answer that has no cited URL", async () => {
  const response = completedResponse();
  response.output = response.output.filter((item) => item.type !== "message");
  const client = { responses: { create: async () => response } };
  await assert.rejects(
    () => executePrStudioWebResearch(validInput(), { client }),
    /has no cited URL/,
  );
});

test("allows an insufficient result without citations", async () => {
  const outputText = JSON.stringify({
    outcome: "insufficient",
    answer: null,
    rationale: "No reliable source tied the claim to this exact brand.",
    confidence: 0.85,
  });
  const client = {
    responses: {
      create: async () => ({
        id: "resp_insufficient",
        model: "gpt-5-mini",
        status: "completed",
        output_text: outputText,
        output: [
          {
            type: "web_search_call",
            action: { type: "search", query: "Atelier Example founders" },
          },
        ],
      }),
    },
  };
  const result = await executePrStudioWebResearch(validInput(), { client });
  assert.equal(result.outcome, "insufficient");
  assert.equal(result.answer, null);
  assert.deepEqual(result.citations, []);
});
