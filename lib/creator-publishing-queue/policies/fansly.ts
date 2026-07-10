import { deepFreezePolicy, type PlatformPolicy } from "./schema"

const capabilities = {
  direct_posting: false, manual_handoff: true, native_scheduling: true, internal_scheduling: true,
  text_posts: true, image_posts: true, video_posts: true, ppv_or_locked_posts: true, visibility_controls: true,
  provider_post_id: false, platform_credentials: false, platform_sessions: false, browser_automation: false,
  unofficial_api: false, dm_automation: false, fan_interaction_automation: false, remote_post_verification: false,
  final_url_human_entry: true, proof_screenshot_optional: true,
} as const

export const fanslyPolicy = deepFreezePolicy({
  platform: "fansly", display_name: "Fansly", mode: "manual_handoff", enabled_for_queue: false,
  policy_version: "fansly-manual-handoff-2026-07-10-v1", policy_effective_date: "2026-07-10",
  source_references: [
    { label: "Fansly Terms of Service", url: "https://fansly.com/terms" },
    { label: "Fansly AI-generated content help article", url: "https://help.fansly.com/en/articles/12315578-ai-generated-content-on-fansly" },
    { label: "Fansly co-performer verification help article", url: "https://help.fansly.com/en/articles/10544523-how-to-verify-and-publish-content-featuring-others-on-fansly" },
    { label: "Fansly posting and post scheduling help article", url: "https://help.fansly.com/en/articles/12315636-posting" },
  ],
  core_rule: "Fansly is manual handoff only. Direct autopost is not allowed in this product.",
  disclosure_policy: { disclosure_required_for_ai: false, allowed_signifiers: [], default_disclosure: null, disclosure_position: "not_applicable", disclosure_removable: true, copy_caption_must_include_disclosure: false, disclosure_cures_prohibited_ai: false, notes: ["No platform-mandated disclosure makes prohibited AI permissible.", "Internal transparency disclosure may be recommended for allowed AI-assisted edits.", "Disclosure does not override a hard block.", "Photorealistic AI remains blocked even if labeled."] },
  ai_policy: {
    allowed: ["real photos and videos", "conventionally retouched real photos", "AI upscales of real captures", "clearly non-photorealistic illustration/cartoon/anime content only where the account is flagged as virtual-entity registered and real-ID verified behind the persona"],
    requires: ["virtual-entity registration and real-ID verification behind the persona for clearly non-photorealistic content"],
    hard_blocked: ["photorealistic AI twin content", "LoRA-generated photorealistic content", "lifelike synthetic humans", "photorealistic diffusion output", "deepfakes", "face swaps", "fictional photorealistic AI personas", "disclosure used as an attempted workaround", "missing creator verification", "missing co-performer verification", "youth-coded content", "non-consensual content", "incest/family roleplay", "intoxication/hypnosis/lack-of-capacity content", "prohibited public nudity", "prohibited drugs", "blood", "weapons unless an existing researched exception is explicitly represented", "any other hard-block category from the researched Fansly matrix"],
    manual_review: ["AI background edits", "AI outfit edits", "AI lighting edits", "body-adjacent AI edits", "any edit where AI contribution may be more than cosmetic", "borderline lifelike stylized content", "co-performer content pending verification confirmation"],
    non_photorealistic_requires_virtual_entity_registration: true,
  },
  creator_verification_policy: { required: true, requirements: ["Creator/account holder real-ID verification is required before handoff."] },
  co_performer_policy: { required: true, requirements: ["Co-performer verification confirmation is required before handoff."] },
  blocked_categories: ["photorealistic AI", "LoRA-generated photorealistic content", "lifelike synthetic humans", "deepfakes", "face swaps", "missing verification", "underage/youth-coded", "non-consensual", "incest/family roleplay", "intoxication/hypnosis/lack-of-capacity", "prohibited public nudity", "prohibited drugs", "blood", "weapons without represented exception"],
  manual_review_categories: ["AI background edits", "AI outfit edits", "AI lighting edits", "body-adjacent AI edits", "more-than-cosmetic AI contribution", "borderline lifelike stylized content", "co-performer pending verification"],
  allowed_categories: ["internal preparation", "internal scheduling", "manual handoff", "Fansly native scheduler used manually", "copy caption", "download owned media", "human-entered final post URL", "optional private proof screenshot"],
  handoff_checklist: ["Confirm the item contains no photorealistic or lifelike AI-generated content.", "Log into Fansly manually through the official website or app.", "Upload the media from the Sirens Forge package.", "Paste the provided caption.", "Set visibility, pricing, and schedule manually.", "Publish manually or use Fansly’s own scheduler.", "Paste the post URL back into Sirens Forge if available.", "Confirm manual publishing."],
  operator_attestation: "I confirm that I am authorized by the creator to access and operate this platform account and that I will publish this content manually through the platform’s official website or app without bots, scripts, automation tools, private APIs, or unofficial APIs.",
  posted_confirmation: "I confirm that I personally and manually published this content through the platform’s official interface and that I did not publish photorealistic or lifelike AI-generated content.",
  disclaimers: ["Fansly prohibits photorealistic AI-generated content even when labeled as AI. Only real photos or videos, conventionally edited content, and clearly non-photorealistic artwork may be eligible. Final compliance responsibility remains with the account holder.", "Do not publish this item if it contains photorealistic or lifelike AI-generated content. Disclosure does not make prohibited AI content permissible on Fansly."],
  capabilities,
  forbidden_capabilities: ["direct posting", "Fansly private API calls", "apiv3.fansly.com", "apifansly.com", "fansly-api.com", "credential/session/cookie storage", "browser automation", "unofficial APIs", "automated DMs", "automated fan interaction", "remote post verification"],
} as const satisfies PlatformPolicy)
