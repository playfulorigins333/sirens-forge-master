import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");
const libraryClient = read("app/library/LibraryClient.tsx");
const libraryPage = read("app/library/page.tsx");
const dashboard = read("app/dashboard/page.tsx");
const account = read("app/account/page.tsx");
const billing = read("app/billing/page.tsx");
const generate = read("app/generate/page.tsx");
const header = libraryClient.match(/function LibraryHeader\(\) \{([\s\S]*?)\n\}/)?.[1];

const obsoleteCreatorCopy = [
  "Sirens Forge — Vault",
  "Your Vault is not just storage.",
  "Your vault is empty",
  "Vault Controls",
  "Open Vault",
  "deeper into your Vault",
  "Save, review, and reuse your best content in the Vault",
  "Generated captions for selected Vault assets",
  "cannot be saved to the Vault yet",
  "logged in to save to the Vault",
  "Could not find or create your Vault collection.",
  "Save to Vault failed.",
  "Save to Vault",
  "Saved to Vault",
  "Vault Pack Builder",
  "reusable pack in your Vault",
  "Create Vault Pack",
];

test("Library creator-facing naming uses Creation Loop", () => {
  assert.ok(header, "expected the LibraryHeader source");
  assert.match(header, /Creation Loop Hub/);
  assert.match(libraryPage, /title: "Sirens Forge — Creation Loop"/);
  assert.match(libraryClient, /Creation Loop Controls/);
  assert.match(libraryClient, /Your Creation Loop is empty/);
});

test("Library header provides persistent navigation and responsive wrapping", () => {
  assert.match(header!, /<Link href="\/dashboard">[\s\S]*?Dashboard[\s\S]*?<\/Link>/);
  assert.doesNotMatch(header!.match(/<Link href="\/dashboard"[^>]*>/)?.[0] ?? "", /hidden/);
  assert.match(header!, /flex flex-col gap-4[^\n]*lg:flex-row/);
  assert.match(header!, /flex flex-wrap items-center/);
  assert.match(header!, /<Link href="\/generate">[\s\S]*?Create New Content[\s\S]*?<\/Link>/);
});

test("Dashboard, Account, Billing, and Generate use Creation Loop copy", () => {
  assert.match(dashboard, /Open Creation Loop/);
  assert.match(account, /Open Creation Loop/);
  assert.match(billing, /in the Creation Loop/);
  assert.match(generate, /Save to Creation Loop/);
  assert.match(generate, /Saved to Creation Loop/);
});

test("Obsolete creator-facing Vault phrases are absent", () => {
  const creatorSources = [libraryClient, libraryPage, dashboard, account, billing, generate];
  for (const phrase of obsoleteCreatorCopy) {
    assert.ok(creatorSources.every((source) => !source.includes(phrase)), `obsolete copy remains: ${phrase}`);
  }
});

test("Protected routes, values, filtering, and downloads remain unchanged", () => {
  assert.match(libraryClient, /href="\/library"/);
  assert.match(libraryClient, /const VAULT_REUSE_HANDOFF_STORAGE_KEY = "sirensforge:vault_identity_reuse";/);
  assert.match(libraryClient, /source: "vault"/);
  assert.match(generate, /name: "My Vault"/);
  assert.match(libraryClient, /function downloadFile\(/);
  assert.match(libraryClient, /const filtered = useMemo\(\(\) => \{/);
});
