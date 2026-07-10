import { deepFreezePolicy, type PlatformPolicy } from "./schema"

const capabilities = {
  direct_posting: false, manual_handoff: true, native_scheduling: true, internal_scheduling: true,
  text_posts: true, image_posts: true, video_posts: true, ppv_or_locked_posts: true, visibility_controls: true,
  provider_post_id: false, platform_credentials: false, platform_sessions: false, browser_automation: false,
  unofficial_api: false, dm_automation: false, fan_interaction_automation: false, remote_post_verification: false,
  final_url_human_entry: true, proof_screenshot_optional: true,
} as const

export const onlyFansPolicy = deepFreezePolicy({
  platform: "onlyfans",
  display_name: "OnlyFans",
  mode: "manual_handoff",
  enabled_for_queue: true,
  policy_version: "onlyfans-manual-handoff-2026-07-10-v1",
  policy_effective_date: "2026-07-10",
  source_references: [
    { label: "OnlyFans Terms of Service", url: "https://onlyfans.com/terms" },
    { label: "OnlyFans Acceptable Use Policy", url: "https://onlyfans.com/acceptable-use-policy" },
    { label: "OnlyFans Terms of Service AI-generated-content disclosure clause", url: "https://onlyfans.com/terms" },
  ],
  core_rule: "Sirens Forge prepares content and tasks only. A creator or authorized human operator manually publishes inside OnlyFans.",
  disclosure_policy: {
    disclosure_required_for_ai: true,
    allowed_signifiers: ["#ai", "#AIGenerated"],
    default_disclosure: "#ai",
    disclosure_position: "start",
    disclosure_removable: false,
    copy_caption_must_include_disclosure: true,
    disclosure_cures_prohibited_ai: false,
    notes: ["Required AI disclosure is forced at the beginning of copied captions."],
  },
  ai_policy: {
    allowed: ["AI-generated, AI-enhanced, or AI-altered content clearly depicting the verified creator", "AI twin content trained on and resembling the verified creator", "real photos", "retouched real photos", "AI upscales of real photos", "non-photorealistic content associated with the verified creator"],
    requires: ["creator verification attestation", "AI twin consent for AI twin content", "clear and conspicuous AI disclosure", "forced disclosure at the beginning of the caption", "use #ai or #AIGenerated"],
    hard_blocked: ["fictional explicit AI persona that cannot match a verified creator", "composite AI persona", "third-party deepfake", "unauthorized face swap", "recognizable second person without required release/verification", "missing creator verification", "missing AI twin consent", "missing required AI disclosure", "youth-coded or underage language", "non-consensual content", "incest/family roleplay", "public nudity where prohibited", "prohibited drugs or harmful illegal activity", "other existing hard-block categories from the researched matrix"],
    manual_review: ["creator likeness drift", "heavy alteration making the creator difficult to recognize", "AI outfit/body-adjacent edits", "second-person content even where a release is claimed", "ambiguous background people", "degradation/CNC/borderline-consent language", "weapons or blood where context matters"],
  },
  creator_verification_policy: { required: true, requirements: ["Creator must be verified before content is prepared for use with OnlyFans."] },
  co_performer_policy: { required: true, requirements: ["Recognizable co-performers require release/verification before handoff."] },
  blocked_categories: ["underage/youth-coded", "non-consensual", "incest/family roleplay", "third-party deepfake", "unauthorized face swap", "missing verification", "missing required AI disclosure"],
  manual_review_categories: ["likeness drift", "heavy AI alteration", "AI outfit/body-adjacent edits", "second person", "ambiguous background people", "borderline consent language", "weapons or blood context"],
  allowed_categories: ["internal content preparation", "internal scheduling", "manual handoff", "copy caption", "download owned media", "human-entered final post URL", "optional private proof screenshot"],
  handoff_checklist: ["Log into OnlyFans manually through the official website or app.", "Upload the media from the Sirens Forge package.", "Paste the provided caption exactly.", "Do not remove #ai or #AIGenerated.", "Set visibility and pricing manually.", "Publish immediately or use OnlyFans’ own scheduler.", "Paste the post URL back into Sirens Forge if available.", "Confirm manual publishing."],
  operator_attestation: "I confirm that I am authorized by the creator to access and operate this platform account, that I will publish this content manually through the platform’s official website or app, and that I will not use bots, scripts, automation tools, or unofficial APIs to do so.",
  posted_confirmation: "I confirm that I personally and manually published this content through the platform’s official interface, that the caption was posted as provided including any required AI disclosure, and that publishing complied with the platform’s Terms of Service.",
  disclaimers: ["Sirens Forge is an independent content-management tool. It is not affiliated with, endorsed by, sponsored by, or partnered with OnlyFans or Fenix International Limited. Platform names and trademarks belong to their respective owners and are used solely to identify the platforms on which creators publish.", "Sirens Forge prepares content packages, compliance checks, and internal task schedules only. All publishing is performed manually by the creator or their authorized human operator directly inside the platform’s official website or app. Sirens Forge takes no action on OnlyFans."],
  capabilities,
  forbidden_capabilities: ["direct posting", "OnlyFans API calls", "credential storage", "session/cookie storage", "browser automation", "unofficial APIs", "remote URL fetch/validation", "automated DMs", "automated PPV messaging", "fan-interaction automation"],
} as const satisfies PlatformPolicy)
