import assert from "node:assert/strict"
import test from "node:test"
import {
  creatorDomStyleRequirement,
  creatorDomStyleTransitionRequirement,
  creatorReplyDirectionMessage,
  creatorReplyDirectionSystemMessage,
  creatorRoleTransitionRequirement,
  normalizedCreatorDirection,
} from "../../../lib/sirens-mind/chat-construction"

test("named Dom styles resolve to distinct behavioral requirements", () => {
  const findom = creatorDomStyleRequirement("Rewrite this with confident Findomme energy.")
  assert.match(findom, /ACTIVE DOM STYLE: FINDOMME/)
  assert.match(findom, /tribute, tipping, paid privilege\/access, gifts, reimbursement, spending/)
  assert.match(findom, /Do not flatten this into generic bossiness/)

  const mommy = creatorDomStyleRequirement("Make me a Mommy Domme here.")
  assert.match(mommy, /ACTIVE DOM STYLE: MOMMY DOMME/)
  assert.match(mommy, /nurturing\/caretaking authority/)
  assert.doesNotMatch(mommy, /ACTIVE DOM STYLE: FINDOMME/)

  const soft = creatorDomStyleRequirement("Keep it soft Domme.")
  assert.match(soft, /ACTIVE DOM STYLE: SOFT DOMME/)
  assert.match(soft, /warm, playful, reassuring, patient, or affectionate/)

  const goddess = creatorDomStyleRequirement("Give it Goddess energy.")
  assert.match(goddess, /ACTIVE DOM STYLE: GODDESS/)
  assert.match(goddess, /worship, reverence, privilege, devotion/)

  const bratTamer = creatorDomStyleRequirement("Switch to brat tamer energy.")
  assert.match(bratTamer, /ACTIVE DOM STYLE: BRAT TAMER/)
  assert.match(bratTamer, /challenges, correction, consequences/)

  const strict = creatorDomStyleRequirement("Make her a strict Domme.")
  assert.match(strict, /ACTIVE DOM STYLE: STRICT \/ DISCIPLINARIAN DOMME/)
  assert.match(strict, /standards, rules, correction, accountability/)

  const femdom = creatorDomStyleRequirement("Use confident Femdom energy.")
  assert.match(femdom, /ACTIVE DOM STYLE: FEMDOM \/ DOMME/)
  assert.match(femdom, /Do not automatically convert generic Femdom into Findom, Mommy Domme, Goddess/)
})

test("generic dominance does not invent a specialized Dom style", () => {
  assert.equal(creatorDomStyleRequirement("Make it more dominant, but not mean."), "")
  assert.equal(creatorDomStyleRequirement("Take more control."), "")
  const normalized = normalizedCreatorDirection("Make it more dominant, but not mean.")
  assert.doesNotMatch(normalized, /ACTIVE DOM STYLE:/)
})

test("named Dom style is promoted into the active Creator Direction requirement", () => {
  const normalized = normalizedCreatorDirection("Rewrite this with confident Findomme energy.")
  assert.match(normalized, /Rewrite this with confident Findomme energy\./)
  assert.match(normalized, /ACTIVE DOM STYLE: FINDOMME \/ FINANCIAL DOMINATION/)
  assert.match(normalized, /financial power exchange materially recognizable/)
})

test("tone-only Creator Direction preserves the active role persona kink and Dom style", () => {
  const direction = "Keep the control but make it warmer and more playful."
  assert.equal(creatorDomStyleRequirement(direction), "")

  const system = creatorReplyDirectionSystemMessage(direction)
  assert.match(system, /supersedes ONLY the creator-side dimensions it explicitly changes/)
  assert.match(system, /Preserve the current creator role, persona, kink\/dynamic, and specialized Dom style/)
  assert.match(system, /tone-only rewrite must keep the existing specialized Dom style recognizable/)

  const draft = "Start by sending a tribute that shows me how serious you are. Then we'll see if you've earned more of my attention."
  const task = creatorReplyDirectionMessage(direction, draft)
  assert.match(task, /Preserve the draft's creator role, persona, kink\/dynamic, and specialized Dom style/)
  assert.match(task, /NOT a request to change persona, role, kink, or Dom style/)
  assert.match(task, /CURRENT CREATOR-STYLE AUTHORITY/)
  assert.match(task, /tribute/)
  assert.match(task, /unrequested creator role\/persona\/kink\/Dom-style dimensions were preserved/)
})

test("explicit male Brat Tamer switch ignores excluded Findom Goddess and Mommy mentions", () => {
  const direction = "Switch the creator to a male Brat Tamer. Confident, amused, teasing, and firmly in control. Drop the Mommy Domme, Goddess, and Findomme dynamics unless the subscriber actually established one of them."

  const active = creatorDomStyleRequirement(direction)
  assert.match(active, /ACTIVE DOM STYLE: BRAT TAMER/)
  assert.doesNotMatch(active, /ACTIVE DOM STYLE: FINDOMME/)
  assert.doesNotMatch(active, /ACTIVE DOM STYLE: MOMMY DOMME/)
  assert.doesNotMatch(active, /ACTIVE DOM STYLE: GODDESS/)

  const transition = creatorDomStyleTransitionRequirement(direction)
  assert.match(transition, /STYLE TRANSITION REQUIREMENT/)
  assert.match(transition, /replaces conflicting prior creator Dom styles\/dynamics/)
  assert.match(transition, /Do not carry over Findom tribute\/payment\/access-gating, Mommy framing, Goddess framing/)

  const role = creatorRoleTransitionRequirement(direction)
  assert.match(role, /ACTIVE CREATOR ROLE: MALE/)
  assert.match(role, /Retire conflicting prior female-coded creator titles\/personas such as Mommy, Goddess, or Domme/)

  const normalized = normalizedCreatorDirection(direction)
  assert.match(normalized, /ACTIVE DOM STYLE: BRAT TAMER/)
  assert.doesNotMatch(normalized, /ACTIVE DOM STYLE: FINDOMME/)
  assert.match(normalized, /STYLE TRANSITION REQUIREMENT/)
  assert.match(normalized, /ACTIVE CREATOR ROLE: MALE/)

  const system = creatorReplyDirectionSystemMessage(direction)
  assert.match(system, /newly named choice becomes authoritative and conflicting prior creator-side choices are retired/)

  const draft = "Serve your Goddess with a generous tribute first. Then we'll see if you've earned more attention."
  const task = creatorReplyDirectionMessage(direction, draft)
  assert.match(task, /retire incompatible prior creator-side role\/persona\/style markers and mechanics/)
  assert.match(task, /explicitly replaced creator-side dimensions no longer leak from the prior draft/)
  assert.match(task, /tribute/)
})
