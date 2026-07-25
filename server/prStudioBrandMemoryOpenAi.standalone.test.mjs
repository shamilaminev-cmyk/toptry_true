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
});

test("rejects non-web page URLs", () => {
  assert.throws(
    () =>
      parsePrStudioBrandMemoryInput({
        brand: { name: "Example" },
        sectionKeys: ["identity"],
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
