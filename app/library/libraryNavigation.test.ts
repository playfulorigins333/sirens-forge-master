import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("app/library/LibraryClient.tsx", "utf8");
const header = source.match(/function LibraryHeader\(\) \{([\s\S]*?)\n\}/)?.[1];

test("Library header provides persistent navigation and responsive wrapping", () => {
  assert.ok(header, "expected the LibraryHeader source");
  assert.match(header, /<Link href="\/dashboard">[\s\S]*?Dashboard[\s\S]*?<\/Link>/);
  assert.doesNotMatch(header.match(/<Link href="\/dashboard"[^>]*>/)?.[0] ?? "", /hidden/);
  assert.match(header, /flex flex-col gap-4[^\n]*lg:flex-row/);
  assert.match(header, /flex flex-wrap items-center/);
  assert.match(header, /<Link href="\/generate">[\s\S]*?Create New Content[\s\S]*?<\/Link>/);
  assert.match(header, /Creation Loop Hub/);
});

test("Library reuse, filtering, and downloads remain unchanged", () => {
  assert.match(source, /const VAULT_REUSE_HANDOFF_STORAGE_KEY = "sirensforge:vault_identity_reuse";/);
  assert.match(source, /source: "vault"/);
  assert.match(source, /function downloadFile\(/);
  assert.match(source, /const filtered = useMemo\(\(\) => \{/);
});
