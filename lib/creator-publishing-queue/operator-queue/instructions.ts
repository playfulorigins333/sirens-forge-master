import { onlyFansPolicy } from "../policies/onlyfans"
export const OFFICIAL_ONLYFANS_HOME_URL = "https://onlyfans.com/"
export const ONLYFANS_OPERATOR_MANUAL_HANDOFF_INSTRUCTIONS = Object.freeze([
  ...onlyFansPolicy.handoff_checklist,
  "Sirens Forge does not log in, upload, schedule, publish, automate a browser, call unofficial APIs, store credentials, store cookies, or collect OnlyFans session tokens.",
])
export const ONLYFANS_OPERATOR_SAFETY_NOTICE = onlyFansPolicy.disclaimers.join(" ")
