import assert from "node:assert/strict"
import { createStripeConnectResponse } from "../../../app/api/stripe/connect/create/route"

type Profile = {
  id: string
  user_id: string
  email: string
  stripe_connect_account_id: string | null
}

const AUTH_USER = "auth-user"
const OTHER_USER = "other-user"
const request = (body: unknown = {}) =>
  new Request("http://local.test/api/stripe/connect/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

function harness(options: {
  userId?: string | null
  profiles?: Profile[] | null
  profileError?: unknown
  updateError?: unknown
  updateRows?: Array<{ id: string }>
  config?: { stripeSecretKey?: string; appUrl?: string }
  providerError?: Error
} = {}) {
  const calls = {
    adminConstructions: 0,
    stripeConstructions: 0,
    accountCreates: 0,
    linkCreates: 0,
    writes: 0,
    lookupUserIds: [] as string[],
    updateFilters: [] as Array<[string, string]>,
    linkedAccountIds: [] as string[],
  }
  const profiles = options.profiles === undefined
    ? [{ id: "profile-auth", user_id: AUTH_USER, email: "safe@example.test", stripe_connect_account_id: null }]
    : options.profiles

  const admin = {
    from(table: string) {
      assert.equal(table, "profiles")
      return {
        select() {
          return {
            eq(column: string, value: string) {
              assert.equal(column, "user_id")
              calls.lookupUserIds.push(value)
              return {
                async limit(valueLimit: number) {
                  assert.equal(valueLimit, 2)
                  return { data: profiles, error: options.profileError ?? null }
                },
              }
            },
          }
        },
        update() {
          calls.writes += 1
          const chain = {
            eq(column: string, value: string) {
              calls.updateFilters.push([column, value])
              return chain
            },
            async select() {
              return {
                data: options.updateRows ?? [{ id: "profile-auth" }],
                error: options.updateError ?? null,
              }
            },
          }
          return chain
        },
      }
    },
  }

  const dependencies = {
    getAuthenticatedUserId: async () => options.userId === undefined ? AUTH_USER : options.userId,
    getAdminClient: () => {
      calls.adminConstructions += 1
      return admin
    },
    getConfiguration: () => options.config ?? ({ stripeSecretKey: "sk_mock", appUrl: "http://local.test" }),
    createStripeClient: () => {
      calls.stripeConstructions += 1
      return {
        accounts: {
          create: async () => {
            calls.accountCreates += 1
            if (options.providerError) throw options.providerError
            return { id: "acct_new" }
          },
        },
        accountLinks: {
          create: async ({ account }: { account: string }) => {
            calls.linkCreates += 1
            calls.linkedAccountIds.push(account)
            if (options.providerError) throw options.providerError
            return { url: "http://stripe.test/onboarding" }
          },
        },
      } as any
    },
  }

  return { calls, dependencies }
}

async function body(response: Response) {
  return JSON.stringify(await response.json())
}

async function run() {
  // All boundaries are in-memory fakes; replacing fetch makes accidental network use fatal.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error("external network operation forbidden") }
  try {
    const unauthenticated = harness({ userId: null })
    let response = await createStripeConnectResponse(request(), unauthenticated.dependencies)
    assert.equal(response.status, 401)
    assert.equal(unauthenticated.calls.adminConstructions, 0)
    assert.equal(unauthenticated.calls.stripeConstructions, 0)
    assert.equal(unauthenticated.calls.accountCreates, 0)
    assert.equal(unauthenticated.calls.linkCreates, 0)
    assert.equal(unauthenticated.calls.writes, 0)

    const forged = harness()
    response = await createStripeConnectResponse(request({ user_id: OTHER_USER }), forged.dependencies)
    assert.equal(response.status, 200)
    assert.deepEqual(forged.calls.lookupUserIds, [AUTH_USER])
    assert.deepEqual(forged.calls.updateFilters, [["id", "profile-auth"], ["user_id", AUTH_USER]])
    assert.deepEqual(forged.calls.linkedAccountIds, ["acct_new"])
    assert.equal(forged.calls.accountCreates, 1)

    for (const closed of [
      harness({ profiles: [] }),
      harness({ profiles: null }),
      harness({ profiles: [
        { id: "one", user_id: AUTH_USER, email: "a@test", stripe_connect_account_id: null },
        { id: "two", user_id: AUTH_USER, email: "b@test", stripe_connect_account_id: null },
      ] }),
      harness({ profiles: [{ id: "wrong", user_id: OTHER_USER, email: "x@test", stripe_connect_account_id: null }] }),
      harness({ profileError: new Error("raw database lookup secret") }),
    ]) {
      response = await createStripeConnectResponse(request(), closed.dependencies)
      assert.notEqual(response.status, 200)
      assert.equal(closed.calls.stripeConstructions, 0)
      assert.equal(closed.calls.writes, 0)
      assert.doesNotMatch(await body(response), /raw database lookup secret/)
    }

    const missingConfig = harness({ config: { appUrl: "http://local.test" } })
    response = await createStripeConnectResponse(request(), missingConfig.dependencies)
    assert.equal(response.status, 503)
    assert.equal(missingConfig.calls.stripeConstructions, 0)
    assert.equal(missingConfig.calls.accountCreates, 0)

    const existing = harness({ profiles: [{
      id: "profile-auth", user_id: AUTH_USER, email: "safe@example.test", stripe_connect_account_id: "acct_existing",
    }] })
    response = await createStripeConnectResponse(request(), existing.dependencies)
    assert.equal(response.status, 200)
    assert.equal(existing.calls.accountCreates, 0)
    assert.equal(existing.calls.writes, 0)
    assert.deepEqual(existing.calls.linkedAccountIds, ["acct_existing"])

    const updateFailure = harness({ updateError: new Error("raw database write secret") })
    response = await createStripeConnectResponse(request(), updateFailure.dependencies)
    assert.equal(response.status, 500)
    assert.equal(updateFailure.calls.accountCreates, 1)
    assert.equal(updateFailure.calls.linkCreates, 0)
    assert.doesNotMatch(await body(response), /raw database write secret/)

    const providerFailure = harness({
      profiles: [{ id: "profile-auth", user_id: AUTH_USER, email: "safe@example.test", stripe_connect_account_id: "acct_existing" }],
      providerError: new Error("raw provider secret"),
    })
    response = await createStripeConnectResponse(request(), providerFailure.dependencies)
    assert.equal(response.status, 502)
    assert.doesNotMatch(await body(response), /raw provider secret/)
    assert.equal(providerFailure.calls.accountCreates, 0)
    assert.equal(providerFailure.calls.linkCreates, 1)

    console.log("stripeConnectAuthorization: 21 local authorization and boundary assertions passed")
  } finally {
    globalThis.fetch = originalFetch
  }
}

await run()
