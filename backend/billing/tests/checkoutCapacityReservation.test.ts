import assert from "node:assert/strict";
import { checkoutSessionIdempotencyKey } from "../../../lib/billing/launchCheckoutPolicy";
import { ensureStripeCustomer, getOrCreateStripeCustomer, type CustomerBoundaries } from "../../../lib/stripe/customers";

let assertions = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); assertions += 1; };
class Mutex {
  private tail = Promise.resolve();
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail; let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous; try { return await operation(); } finally { release(); }
  }
}
type Reservation = { id: string; profile: string; tier: string; expires: number; status: "active" | "released"; session?: string };
class TransactionalCapacity {
  private lock = new Mutex(); reservations: Reservation[] = []; entitlements = new Set<string>(); next = 1;
  constructor(readonly max: number) {}
  acquire(profile: string, tier: string, afterLock?: () => Promise<void>) {
    return this.lock.run(async () => {
      if (afterLock) await afterLock();
      this.reservations.forEach((row) => { if (row.status === "active" && row.expires <= Date.now()) row.status = "released"; });
      if ([...this.entitlements].some((value) => value.startsWith(`${profile}:`))) throw new Error("existing_entitlement");
      const effective = this.reservations.find((row) => row.profile === profile && row.status === "active");
      if (effective?.tier !== undefined && effective.tier !== tier) throw new Error("reservation_conflict");
      if (effective) return effective;
      if (this.reservations.filter((row) => row.tier === tier && row.status === "active").length >= this.max) throw new Error("sold_out");
      const row: Reservation = { id: `r${this.next++}`, profile, tier, expires: Date.now() + 86_400_000, status: "active" };
      this.reservations.push(row); return row;
    });
  }
  release(id: string) { const row = this.reservations.find((candidate) => candidate.id === id); if (row) row.status = "released"; }
  associate(id: string, session: string) {
    if (this.reservations.some((row) => row.session === session && row.id !== id)) throw new Error("session_conflict");
    const row = this.reservations.find((candidate) => candidate.id === id); if (!row) throw new Error("missing"); row.session = session;
  }
}

const capacity = new TransactionalCapacity(1);
let unlock!: () => void; const gate = new Promise<void>((resolve) => { unlock = resolve; }); let firstLocked!: () => void;
const locked = new Promise<void>((resolve) => { firstLocked = resolve; });
const first = capacity.acquire("p1", "og_throne", async () => { firstLocked(); await gate; });
await locked; const second = capacity.acquire("p2", "og_throne"); unlock();
const overlap = await Promise.allSettled([first, second]);
equal(overlap.filter((result) => result.status === "fulfilled").length, 1); equal(overlap.filter((result) => result.status === "rejected").length, 1);
const held = await capacity.acquire("p1", "og_throne"); equal((await capacity.acquire("p1", "og_throne")).id, held.id);
await assert.rejects(capacity.acquire("p1", "early_bird"), /reservation_conflict/); assertions += 1;
capacity.release(held.id); const early = await capacity.acquire("p1", "early_bird"); equal(early.tier, "early_bird");
capacity.release(early.id); capacity.entitlements.add("p1:og_throne"); await assert.rejects(capacity.acquire("p1", "early_bird"), /existing_entitlement/); assertions += 1;
capacity.entitlements.clear(); const expiring = await capacity.acquire("p3", "og_throne"); expiring.expires = 0; equal((await capacity.acquire("p4", "og_throne")).profile, "p4");
const association = new TransactionalCapacity(2); const a = await association.acquire("a", "og_throne"), b = await association.acquire("b", "og_throne"); association.associate(a.id, "cs_unique"); assert.throws(() => association.associate(b.id, "cs_unique"), /session_conflict/); assertions += 1;
equal(checkoutSessionIdempotencyKey("reservation"), "launch-checkout:reservation"); equal(Math.floor(a.expires / 1000), Math.floor(a.expires / 1000));

let assigned: string | null = null, created = 0;
const customerBoundary: CustomerBoundaries = {
  createCustomer: async () => ({ id: `cus_${++created}` }),
  assignIfEmpty: async (profileId, userId, customerId) => { if (profileId !== "profile-internal" || userId !== "auth-user" || assigned) return false; assigned = customerId; return true; },
  readCustomer: async (profileId, userId) => profileId === "profile-internal" && userId === "auth-user" ? assigned : null,
};
const compatibility = { resolveProfile: async (id: string) => ({ id, userId: "auth-user", email: "portal@sirens.test", stripeCustomerId: assigned }), customerBoundary };
const portalCustomers = await Promise.all([
  getOrCreateStripeCustomer("profile-internal", undefined, compatibility),
  getOrCreateStripeCustomer("profile-internal", undefined, compatibility),
]);
equal(new Set(portalCustomers).size, 1); equal(assigned, portalCustomers[0]); equal(created >= 1, true);
equal(await getOrCreateStripeCustomer("profile-internal", undefined, compatibility), assigned);
await assert.rejects(ensureStripeCustomer({ id: "another-profile", userId: "auth-user" }, customerBoundary), /customer_unavailable/); assertions += 1;

const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("network forbidden"); };
equal(typeof globalThis.fetch, "function"); globalThis.fetch = originalFetch;
console.log(`checkoutCapacityReservation: ${assertions} assertions passed`);
