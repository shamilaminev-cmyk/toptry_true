import assert from "node:assert/strict";
import test from "node:test";

import { parsePrStudioBrandMemoryInput } from "./prStudioBrandMemoryOpenAi.mjs";

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
