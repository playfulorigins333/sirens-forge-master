export const MATERIAL_POLICY_MANIFEST = {
  termsVersion: "terms-2026-09-05-r1",
  privacyVersion: "privacy-2026-09-05-r1",
  acceptableUseVersion: "acceptable-use-2026-08-22-r1",
  materialBundleVersion: "material-policy-2026-09-05-r1",
  acceptanceStatementVersion: "material-policy-acceptance-2026-09-05-r1",
  sourceRevision: "policy-source-2026-09-05-r1",
  sourceSha256: {
    terms: "31b165a7202e880a1ac7dc8fa267c208cd0fa7fa3125bc45cd3a7e8494eac0b6",
    privacy: "551e682e7984c2bffa82dfbd1e1fa938b364d17f454eb5ff4ca2cc4b83e15951",
    acceptableUse: "97c2a420cd76a519e10c2cfb26e4f331b3a99eb25c29fc79d2e3c265c57d459b",
  },
} as const

export const MATERIAL_POLICY_ACCEPTANCE_STATEMENT =
  "I have read and agree to the Terms of Service, Privacy Policy, and Acceptable Use Policy identified by this material policy bundle."

export function materialPolicyBundleEvidence() {
  return "595ae993a8dab470851a849578fae424efdeddf512be44346397b6777dca6be0"
}
