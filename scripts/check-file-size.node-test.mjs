import assert from "node:assert/strict";
import test from "node:test";
import { checkFileSizes, formatFileSizeReport } from "./check-file-size.mjs";

test("checkFileSizes classifies review and hard-limit files", async () => {
  const result = await checkFileSizes({ roots: ["scripts"], hardLimit: 20, reviewLimit: 5 });
  assert.ok(result.files.length >= 4);
  assert.ok(result.files.every(({ file, lines }) => file.startsWith("scripts/") && lines > 0));
  assert.ok(result.oversized.length > 0);
  assert.match(formatFileSizeReport(result, { hardLimit: 20 }), /error: scripts\//);
});
