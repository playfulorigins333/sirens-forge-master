import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const listSource = fs.readFileSync("app/identities/IdentitiesClient.tsx", "utf8");
const detailSource = fs.readFileSync(
  "app/identities/[id]/IdentityDetailClient.tsx",
  "utf8"
);

test("identity headers provide persistent, responsive navigation", () => {
  assert.match(listSource, /<Link href="\/dashboard">/);
  assert.match(detailSource, /<Link href="\/dashboard">/);
  assert.match(detailSource, /<Link href="\/identities">/);

  assert.match(listSource, /flex flex-wrap items-center/);
  assert.match(detailSource, /<nav\s+className="flex flex-wrap items-center/);
  assert.match(listSource, /flex flex-col gap-4[^\n]*lg:flex-row/);
  assert.match(detailSource, /flex flex-col gap-4[^\n]*lg:flex-row/);
});

test("identity generation and training destinations remain present", () => {
  assert.match(listSource, /return `\/generate\?\$\{params\.toString\(\)\}`/);
  assert.match(detailSource, /return `\/generate\?\$\{params\.toString\(\)\}`/);
  assert.match(listSource, /href="\/lora\/train"/);
  assert.match(detailSource, /`\/lora\/train\?identity=\$\{encodeURIComponent\(identity\.id\)\}`/);
});
