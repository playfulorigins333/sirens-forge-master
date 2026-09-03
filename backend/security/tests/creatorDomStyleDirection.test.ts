import assert from "node:assert/strict"
import test from "node:test"
import {
  creatorDomStyleRequirement,
  creatorReplyDirectionMessage,
  creatorReplyDirectionSystemMessage,
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
