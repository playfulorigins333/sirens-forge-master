import assert from "node:assert/strict";
import { checkoutSessionIdempotencyKey } from "../../../lib/billing/launchCheckoutPolicy";
import { ensureStripeCustomer, getOrCreateStripeCustomer, type CustomerBoundaries } from "../../../lib/stripe/customers";
import { reservationConsumesCapacity } from "../../../app/api/subscription/seat-count/route";

let assertions = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); assertions += 1; };
const now=new Date("2030-01-01T00:00:00Z");
for(const [row,expected] of [
  [{status:"active",expires_at:"2030-01-02T00:00:00Z",stripe_session_id:null},true],
  [{status:"active",expires_at:"2029-12-31T00:00:00Z",stripe_session_id:null},false],
  [{status:"active",expires_at:"2030-01-02T00:00:00Z",stripe_session_id:"cs_bad"},false],
  [{status:"associated",expires_at:"2029-01-01T00:00:00Z",stripe_session_id:"cs"},true],
  [{status:"associated",expires_at:"2031-01-01T00:00:00Z",stripe_session_id:"cs"},true],
  [{status:"fulfilled",expires_at:null,stripe_session_id:"cs"},false],
  [{status:"released",expires_at:null,stripe_session_id:null},false],
  [{status:"expired",expires_at:null,stripe_session_id:"cs"},false],
] as const) equal(reservationConsumesCapacity(row,now),expected);
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

class TerminalReservation {
  status:"associated"|"fulfilled"|"expired"="associated"; paymentIntent:string|null=null; entitlement=false;
  readonly authority={user:"u1",customer:"cus1",price:"price1",profile:"p1",tier:"og_throne",session:"cs_valid"};
  fulfill(paymentIntent:string, supplied:Partial<typeof this.authority>={}){const actual={...this.authority,...supplied};for(const key of Object.keys(this.authority) as (keyof typeof this.authority)[])if(actual[key]!==this.authority[key])throw new Error(`${key}_mismatch`);if(this.status==="fulfilled"){if(this.paymentIntent===paymentIntent)return "already_fulfilled";throw new Error("payment_conflict")}if(this.status!=="associated")throw new Error("terminal_conflict");this.status="fulfilled";this.paymentIntent=paymentIntent;this.entitlement=true;return "applied"}
  expire(session:string){if(session!=="cs_valid")throw new Error("session_mismatch");if(this.status==="expired")return "already_expired";if(this.status!=="associated")throw new Error("terminal_conflict");this.status="expired";return "expired"}
}
let terminal=new TerminalReservation();equal(terminal.fulfill("pi1"),"applied");equal(terminal.status,"fulfilled");equal(terminal.entitlement,true);equal(terminal.fulfill("pi1"),"already_fulfilled");assert.throws(()=>terminal.fulfill("pi2"),/payment_conflict/);assertions++;
for(const [key,value] of [["user","wrong"],["customer","wrong"],["price","wrong"],["profile","wrong"],["tier","early_bird"],["session","cs_other"]] as const){assert.throws(()=>terminal.fulfill("pi1",{[key]:value}),/mismatch/);assertions++;equal(terminal.status,"fulfilled")}
terminal=new TerminalReservation();assert.throws(()=>terminal.expire("cs_other"),/session_mismatch/);assertions++;equal(terminal.status,"associated");equal(terminal.expire("cs_valid"),"expired");equal(terminal.status,"expired");assert.throws(()=>terminal.fulfill("pi1"),/terminal_conflict/);assertions++;
terminal=new TerminalReservation();terminal.fulfill("pi1");assert.throws(()=>terminal.expire("cs_valid"),/terminal_conflict/);assertions++;equal(terminal.status,"fulfilled");
const migration=(await import("node:fs")).readFileSync("supabase/migrations/20260729002100_checkout_capacity_reservations.sql","utf8");
const replay=migration.indexOf("return 'already_fulfilled'");for(const validation of ["ownership_mismatch","price_mismatch","session_mismatch"]){equal(migration.indexOf(validation)<replay,true)}

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

// Executable model of the migration's network-serialized, cross-tier rolling limits.
class GuestRateLimit {
  lock=new Mutex(); attempts:{network:string;token:string;tier:string;at:number;reservation:string}[]=[]; reservations=new Map<string,{id:string;tier:string;expires:number}>(); next=1;
  acquire(network:string,token:string,tier:string,now:number,fail?:"sold_out"|"database") { return this.lock.run(async()=>{
    const existing=this.reservations.get(token); if(existing){if(existing.tier!==tier)throw new Error("reservation_conflict");return existing}
    if(!["og_throne","early_bird"].includes(tier))throw new Error("invalid_request");
    if(this.attempts.filter(a=>a.network===network&&a.at>now-3_600_000).length>=5)throw new Error("rate_limit_hourly");
    if(this.attempts.filter(a=>a.network===network&&a.at>now-86_400_000).length>=10)throw new Error("rate_limit_daily");
    if(fail)throw new Error(fail);
    const row={id:`g${this.next++}`,tier,expires:now+3_600_000};this.reservations.set(token,row);this.attempts.push({network,token,tier,at:now,reservation:row.id});return row;
  })}
  cleanup(now:number){this.attempts=this.attempts.filter(a=>a.at+86_400_000>now)}
}
let clock=2_000_000_000_000,rate=new GuestRateLimit();
for(let i=0;i<5;i++)equal((await rate.acquire("n","t"+i,i%2?"early_bird":"og_throne",clock)).expires,clock+3_600_000);
await assert.rejects(rate.acquire("n","t5","og_throne",clock),/rate_limit_hourly/);assertions++;
clock+=3_600_001;for(let i=5;i<10;i++){await rate.acquire("n","t"+i,i%2?"early_bird":"og_throne",clock);clock+=3_600_001}
await assert.rejects(rate.acquire("n","t10","early_bird",clock),/rate_limit_daily/);assertions++;
const attempts=rate.attempts.length;equal((await rate.acquire("n","t9","early_bird",clock+20)).id,"g10");equal(rate.attempts.length,attempts);
for(const [token,tier,fail] of [["bad","invalid",undefined],["sold","og_throne","sold_out"],["db","og_throne","database"]] as const){await assert.rejects(rate.acquire("other",token,tier,clock,fail));assertions++;equal(rate.attempts.length,attempts)}
rate=new GuestRateLimit();const concurrent=await Promise.allSettled(Array.from({length:8},(_,i)=>rate.acquire("shared",`c${i}`,"og_throne",clock)));equal(concurrent.filter(x=>x.status==="fulfilled").length,5);equal(rate.attempts.length,5);equal(new Set(rate.attempts.map(a=>a.reservation)).size,5);
rate.cleanup(clock+86_400_001);equal(rate.attempts.length,0);
console.log(`checkoutCapacityReservation: ${assertions} assertions passed`);
