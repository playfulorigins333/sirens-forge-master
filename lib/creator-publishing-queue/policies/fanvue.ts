import { deepFreezePolicy, type PlatformPolicy } from "./schema"

export const fanvuePolicy = deepFreezePolicy({
  platform: "fanvue", display_name: "Fanvue", mode: "direct_api", enabled_for_queue: false,
  policy_version: "fanvue-reference-2026-07-10-v1", policy_effective_date: "2026-07-10",
  source_references: [
    { label: "Internal Fanvue lock checkpoint", internal_path: "docs/fanvue-lock-checkpoint-2026-07-09.md" },
    { label: "Fanvue ready-to-unlock checklist", internal_path: "docs/autopost/fanvue-ready-to-unlock-checklist.md" },
    { label: "Fanvue platform registry", internal_path: "lib/autopost/platformRegistry.ts" },
  ],
  core_rule: "Fanvue remains a direct API provider integration reference. This policy metadata does not alter posting behavior, locks, server-status gates, or public/live controls.",
  disclosure_policy: { disclosure_required_for_ai: false, allowed_signifiers: [], default_disclosure: null, disclosure_position: "not_applicable", disclosure_removable: true, copy_caption_must_include_disclosure: false, disclosure_cures_prohibited_ai: false, notes: ["Reference metadata only; existing Fanvue controls remain authoritative."] },
  ai_policy: { allowed: [], requires: [], hard_blocked: [], manual_review: [] },
  creator_verification_policy: { required: true, requirements: ["Use existing Fanvue provider/account controls; not modified by this policy metadata."] },
  co_performer_policy: { required: true, requirements: ["Use existing compliance requirements outside this reference policy."] },
  blocked_categories: [], manual_review_categories: [], allowed_categories: ["provider integration exists", "policy/config remains separate", "existing frozen/locked state remains authoritative"],
  handoff_checklist: [],
  operator_attestation: "Fanvue is not routed through Creator Publishing Queue manual handoff by this policy metadata.",
  posted_confirmation: "Fanvue posting confirmation remains governed by existing Fanvue production implementation, unchanged by this task.",
  disclaimers: ["Fanvue policy metadata is reference-only for this task and does not modify the existing Fanvue direct API implementation."],
  capabilities: { direct_posting: true, manual_handoff: false, native_scheduling: false, internal_scheduling: false, text_posts: true, image_posts: true, video_posts: true, ppv_or_locked_posts: false, visibility_controls: false, provider_post_id: true, platform_credentials: true, platform_sessions: false, browser_automation: false, unofficial_api: false, dm_automation: false, fan_interaction_automation: false, remote_post_verification: false, final_url_human_entry: false, proof_screenshot_optional: false },
  forbidden_capabilities: ["manual queue routing", "manual handoff mode", "unfreezing public/live controls from policy config"],
  reference_only: true,
  integration_notes: ["Do not modify Fanvue API code.", "Do not modify Fanvue posting behavior.", "Do not alter Fanvue locks or server-status gates.", "Do not route Fanvue through the manual queue."],
} as const satisfies PlatformPolicy)
