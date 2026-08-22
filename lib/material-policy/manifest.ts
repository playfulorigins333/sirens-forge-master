export const MATERIAL_POLICY_MANIFEST = {
  termsVersion: "terms-2026-08-22-r1",
  privacyVersion: "privacy-2026-08-22-r1",
  acceptableUseVersion: "acceptable-use-2026-08-22-r1",
  materialBundleVersion: "material-policy-2026-08-22-r1",
  acceptanceStatementVersion: "material-policy-acceptance-2026-08-22-r1",
  sourceRevision: "policy-source-2026-08-22-r1",
  sourceSha256: {
    terms: "b2160d8b3bb4311262644aa4a599a72587ec3e4b22ba3435453301d0766951e0",
    privacy: "5e3c0b968eb596606542473c6ebecb64ff693aef8a2042950becdae067199a70",
    acceptableUse: "97c2a420cd76a519e10c2cfb26e4f331b3a99eb25c29fc79d2e3c265c57d459b",
  },
} as const

export const MATERIAL_POLICY_ACCEPTANCE_STATEMENT =
  "I have read and agree to the Terms of Service, Privacy Policy, and Acceptable Use Policy identified by this material policy bundle."

export function materialPolicyBundleEvidence() {
  return "fac8d21b3a1f62eba47c01a32b84a7b492e5a2b4f21f5be86669a6eb4f7b23a3"
}
