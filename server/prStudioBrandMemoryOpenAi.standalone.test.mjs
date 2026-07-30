import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrStudioBrandMemoryConsolidationInstructions,
  parsePrStudioBrandMemoryConsolidationInput,
  parsePrStudioBrandMemoryInput,
  normalizePrStudioBrandMemoryOutput,
} from "./prStudioBrandMemoryOpenAi.mjs";

test("accepts a bounded website analysis request", () => {
  const parsed = parsePrStudioBrandMemoryInput({
    brand: { name: "Example", description: "A company" },
    sectionKeys: ["identity", "products"],
    questions: [
      {
        questionKey: "identity.official_name",
        sectionKey: "identity",
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
            sectionKey: "identity",
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


test("normalizes profile answers separately from additional claims", () => {
  const parsed = parsePrStudioBrandMemoryInput({
    brand: { name: "Example" },
    sectionKeys: ["identity", "products"],
    questions: [
      {
        questionKey: "identity.official_name",
        sectionKey: "identity",
        question: "What is the official brand name?",
        helpText: null,
      },
    ],
    pages: [{ url: "https://example.com/about", text: "Example is the official name." }],
  });
  const claims = normalizePrStudioBrandMemoryOutput(parsed, {
    profileAnswers: [
      {
        sectionKey: "identity",
        questionKey: "identity.official_name",
        value: "Example",
        confidence: 0.99,
        sources: [{ url: "https://example.com/about", excerpt: "Example" }],
      },
    ],
    additionalClaims: [
      {
        sectionKey: "products",
        value: "The company offers a workshop tour.",
        confidence: 0.8,
        sources: [{ url: "https://example.com/about", excerpt: "workshop tour" }],
      },
    ],
  });
  assert.equal(claims[0].questionKey, "identity.official_name");
  assert.equal(claims[0].memoryRole, "profile");
  assert.equal(claims[1].questionKey, null);
  assert.equal(claims[1].memoryRole, "additional");
});

test("rejects a profile answer assigned to the wrong section", () => {
  const parsed = parsePrStudioBrandMemoryInput({
    brand: { name: "Example" },
    sectionKeys: ["identity", "products"],
    questions: [
      {
        questionKey: "identity.official_name",
        sectionKey: "identity",
        question: "What is the official brand name?",
        helpText: null,
      },
    ],
    pages: [{ url: "https://example.com/about", text: "Example is the official name." }],
  });
  assert.throws(
    () => normalizePrStudioBrandMemoryOutput(parsed, {
      profileAnswers: [
        {
          sectionKey: "products",
          questionKey: "identity.official_name",
          value: "Example",
          confidence: 0.99,
          sources: [{ url: "https://example.com/about", excerpt: "Example" }],
        },
      ],
      additionalClaims: [],
    }),
    /invalid Brand Memory response/,
  );
});


test("requires question-focused concise profile answers", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("./prStudioBrandMemoryOpenAi.mjs", import.meta.url), "utf8"),
  );

  assert.match(source, /answer only its selected question/);
  assert.match(source, /one to three sentences/);
  assert.match(source, /Do not write a general brand summary/);
  assert.match(source, /maxLength: 1_200/);
});
