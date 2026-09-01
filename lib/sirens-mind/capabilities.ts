import fs from "node:fs"
import path from "node:path"
import { listVaultsForMode, type Mode } from "../../prompts/nsfw_gpt/vault_registry"
import { listMacrosForMode } from "../../prompts/nsfw_gpt/macro_registry"

export class CapabilityCatalogUnavailableError extends Error {}
function content(kind: "vaults" | "macros", id: string) {
  try {
    const value = fs.readFileSync(path.join(process.cwd(), "prompts", "nsfw_gpt", kind, `${id}.txt`), "utf8").trim()
    if (!value) throw new Error("empty")
    return value
  } catch { throw new CapabilityCatalogUnavailableError("Canonical capability catalog unavailable") }
}
export function buildCapabilityCatalog(mode: Mode): string {
  const vaults = listVaultsForMode(mode).map((v) => `VAULT: ${v.label}\nInternal ID: ${v.id}\nCategory: ${v.category}\nDescription: ${v.description ?? "Creative capability layer."}\nRecipe:\n${content("vaults", v.id)}`)
  const macros = listMacrosForMode(mode).map((m) => `MACRO: ${m.label}\nInternal ID: ${m.id}\nCategory: ${m.category}\nDescription: ${m.description}\nRecipe:\n${content("macros", m.id)}`)
  return [`# REAL CURRENT-MODE CAPABILITY CATALOG (${mode})`, ...vaults, ...macros].join("\n\n")
}
