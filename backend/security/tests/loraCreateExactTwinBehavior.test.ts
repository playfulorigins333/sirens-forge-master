import assert from "node:assert/strict";
import test, { mock } from "node:test";

const twinA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const twinB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const owner = "owner-user";

type Scenario = "success" | "race" | "nondraft" | "wrong-owner";
let scenario: Scenario = "success";
let operations: string[] = [];

mock.module(new URL("../../../lib/subscription-checker.ts", import.meta.url).href, {
  namedExports: { ensureActiveSubscription: async () => ({ ok: true, user: { id: owner } }) },
});
mock.module(new URL("../../../lib/supabaseAdmin.ts", import.meta.url).href, {
  namedExports: {
    getSupabaseAdmin: () => ({
      from(table: string) {
        assert.equal(table, "user_loras");
        const filters: Record<string, unknown> = {};
        let kind: "lookup" | "update" | "insert" = "lookup";
        const chain: any = {
          select(columns: string) { operations.push(`${kind}:select:${columns}`); return chain; },
          update() { kind = "update"; operations.push("update"); return chain; },
          insert() { kind = "insert"; operations.push("insert"); return chain; },
          eq(column: string, value: unknown) { filters[column] = value; operations.push(`${kind}:eq:${column}:${String(value)}`); return chain; },
          order() { operations.push("fallback-order"); return chain; },
          limit() { operations.push("fallback-limit"); return chain; },
          single: async () => ({ data: null, error: null }),
          maybeSingle: async () => {
            if (kind === "update") return scenario === "success" ? { data: { id: twinA, status: "draft" }, error: null } : { data: null, error: null };
            operations.push(`lookup:${String(filters.id)}:${String(filters.user_id)}`);
            if (scenario === "wrong-owner") return { data: null, error: null };
            return { data: { id: twinA, user_id: owner, status: scenario === "nondraft" ? "queued" : "draft" }, error: null };
          },
        };
        return chain;
      },
    }),
  },
});

const { POST } = await import(new URL("../../../app/api/lora/create/route.ts", import.meta.url).href);
function request() { return new Request("http://localhost/api/lora/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identityName: "Twin A", description: "same twin", lora_id: twinA }) }); }
function reset(next: Scenario) { scenario = next; operations = []; }
function assertNoFallbackOrSubstitution() {
  assert(!operations.includes("insert"), "explicit Twin must never insert");
  assert(!operations.includes("fallback-order") && !operations.includes("fallback-limit"), "explicit Twin must never perform fallback draft lookup");
  assert(!operations.some((entry) => entry.includes(twinB)), "Twin B must never be selected or updated");
}

test("owned exact draft performs returned-row CAS", async () => { reset("success"); const response = await POST(request()); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { lora_id: twinA, reused: true, status: "draft" }); assert(operations.includes(`update:eq:id:${twinA}`)); assertNoFallbackOrSubstitution(); });
test("exact draft CAS race fails closed", async () => { reset("race"); const response = await POST(request()); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "LORA_NOT_DRAFT" }); assertNoFallbackOrSubstitution(); });
test("already nondraft exact Twin is rejected before update", async () => { reset("nondraft"); const response = await POST(request()); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "LORA_NOT_DRAFT" }); assert(!operations.includes("update")); assertNoFallbackOrSubstitution(); });
test("wrong-owner explicit Twin is bounded and never substituted", async () => { reset("wrong-owner"); const response = await POST(request()); assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: "LORA_NOT_FOUND" }); assert(!operations.includes("update")); assertNoFallbackOrSubstitution(); });
test("owned Twin B is irrelevant when exact Twin A is requested", async () => { reset("success"); const response = await POST(request()); assert.equal((await response.json()).lora_id, twinA); assertNoFallbackOrSubstitution(); });
