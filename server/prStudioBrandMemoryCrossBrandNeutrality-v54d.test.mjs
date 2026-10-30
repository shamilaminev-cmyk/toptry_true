import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("v54d consolidation instruction uses a fictional example, not a customer", () => {
  const prompt = readFileSync(new URL("./prStudioBrandMemoryOpenAi.mjs", import.meta.url), "utf8");
  const start = prompt.indexOf("export function buildPrStudioBrandMemoryConsolidationInstructions");
  const end = prompt.indexOf("export async function consolidatePrStudioBrandMemory", start);
  assert.ok(start >= 0 && end > start);
  const instructions = prompt.slice(start, end);
  assert.doesNotMatch(instructions, /bourbaki|малая дмитровка|atelier|bespoke|tailor|пошив|ателье/i);
  assert.match(instructions, /fictional organization and address/);
  assert.match(instructions, /Never add facts, infer facts, or broaden the scope/);
});
