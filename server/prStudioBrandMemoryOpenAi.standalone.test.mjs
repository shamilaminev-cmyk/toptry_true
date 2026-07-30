import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioBrandMemoryConsolidationInstructions,
  parsePrStudioBrandMemoryConsolidationInput,
  parsePrStudioBrandMemoryInput,
} from "./prStudioBrandMemoryOpenAi.mjs";

test("accepts a bounded website analysis request", () => {
  const parsed = parsePrStudioBrandMemoryInput({
    brand: { name: "Example", description: "A company" },
    sectionKeys: ["identity", "products"],
    questions: [
      {
        questionKey: "identity.official_name",
        question: "What is the official brand name?",
        helpText: null,
      },
    ],
    pages: [
      {
        url: "https://example.com/about",
        title: "About",
        text: "Example makes evidence-backed communication tools.",
      },
    ],
  });
  assert.equal(parsed.brand.name, "Example");
  assert.equal(parsed.pages.length, 1);
  assert.deepEqual(parsed.sectionKeys, ["identity", "products"]);
  assert.equal(parsed.questions[0].questionKey, "identity.official_name");
});

test("rejects non-web page URLs", () => {
  assert.throws(
    () =>
      parsePrStudioBrandMemoryInput({
        brand: { name: "Example" },
        sectionKeys: ["identity"],
        questions: [
          {
            questionKey: "identity.official_name",
            question: "What is the official brand name?",
            helpText: null,
          },
        ],
        pages: [{ url: "file:///etc/passwd", text: "not allowed" }],
      }),
    /HTTP or HTTPS/,
  );
});

test("accepts reviewed claims for conservative consolidation", () => {
  const parsed = parsePrStudioBrandMemoryConsolidationInput({
    brand: { name: "Example" },
    sectionKeys: ["contacts"],
    claims: [
      {
        id: "claim-1",
        sectionKey: "contacts",
        status: "confirmed",
        value: "The office is at 10 Main Street.",
      },
      {
        id: "claim-2",
        sectionKey: "contacts",
        status: "confirmed",
        value: "Office address: 10 Main Street.",
      },
    ],
  });
  assert.equal(parsed.claims.length, 2);
  assert.equal(parsed.claims[0].status, "confirmed");
});

test("instructs consolidation to merge compatible Bourbaki address claims", () => {
  const instructions = buildPrStudioBrandMemoryConsolidationInstructions();

  assert.match(instructions, /fully subsumed by a more complete claim/);
  assert.match(instructions, /compatible partially overlapping claims/);
  assert.match(instructions, /Claims do not need identical factual breadth/);
  assert.match(instructions, /Малая Дмитровка/);
  assert.match(instructions, /should form one group/);
  assert.match(instructions, /Do not merge conflicting dates, prices, numbers/);
  assert.match(instructions, /legal-address claim remains distinct/);
});

test("rejects unsupported consolidation statuses", () => {
  assert.throws(
    () =>
      parsePrStudioBrandMemoryConsolidationInput({
        brand: { name: "Example" },
        sectionKeys: ["contacts"],
        claims: [
          {
            id: "claim-1",
            sectionKey: "contacts",
            status: "confirmed",
            value: "Office address: 10 Main Street.",
          },
          {
            id: "claim-2",
            sectionKey: "contacts",
            status: "outdated",
            value: "Old office address: 9 Main Street.",
          },
        ],
      }),
    /supported review status/,
  );
});

test("accepts mixed review statuses only for incoming ingestion", () => {
  const parsed = parsePrStudioBrandMemoryConsolidationInput({
    mode: "ingestion",
    brand: { name: "Example" },
    sectionKeys: ["contacts"],
    claims: [
      {
        id: "claim-1",
        sectionKey: "contacts",
        status: "confirmed",
        value: "Office address: 10 Main Street.",
        origin: "existing",
      },
      {
        id: "incoming-1",
        sectionKey: "contacts",
        status: "suggested",
        value: "The office is at 10 Main Street.",
        origin: "incoming",
      },
    ],
  });

  assert.equal(parsed.mode, "ingestion");
  assert.equal(parsed.claims[1].origin, "incoming");
});

test("requires an incoming claim in ingestion mode", () => {
  assert.throws(
    () =>
      parsePrStudioBrandMemoryConsolidationInput({
        mode: "ingestion",
        brand: { name: "Example" },
        sectionKeys: ["contacts"],
        claims: [
          {
            id: "claim-1",
            sectionKey: "contacts",
            status: "confirmed",
            value: "Office address: 10 Main Street.",
          },
          {
            id: "claim-2",
            sectionKey: "contacts",
            status: "suggested",
            value: "The office is at 10 Main Street.",
          },
        ],
      }),
    /requires incoming claims/,
  );
});

test("adds ingestion-specific consolidation safeguards", () => {
  const instructions =
    buildPrStudioBrandMemoryConsolidationInstructions("ingestion");

  assert.match(instructions, /pre-review ingestion/);
  assert.match(instructions, /origin is incoming/);
  assert.match(instructions, /review statuses may differ/);
  assert.match(instructions, /compatible partially overlapping claims/);
});
