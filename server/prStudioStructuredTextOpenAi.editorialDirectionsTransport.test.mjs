import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("returns terminal incomplete background responses without hiding the provider reason", async () => {
  const source = await readFile(
    new URL("./index.mjs", import.meta.url),
    "utf8",
  );

  const start = source.indexOf(
    'app.post("/internal/ai/pr-studio/text/structured/background/retrieve"',
  );

  assert.ok(start >= 0);

  const retrieve = source.slice(start, start + 7000);

  assert.match(
    retrieve,
    /code === "PR_STUDIO_TRANSPORT_INCOMPLETE_RESPONSE"/,
  );
  assert.match(
    retrieve,
    /terminalIncomplete\s*\?\s*422/s,
  );
  assert.match(
    retrieve,
    /status === 400 \|\| terminalIncomplete\s*\?\s*error\.message/s,
  );
});
