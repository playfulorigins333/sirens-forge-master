import { createHash } from "node:crypto"
import { AI_TWIN_CONSENT_TEXT } from "./copy"

export function getAiTwinConsentTextSha256() { return createHash("sha256").update(AI_TWIN_CONSENT_TEXT, "utf8").digest("hex") }
