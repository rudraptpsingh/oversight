import Database from "better-sqlite3"
import { getDecisionsByPath } from "../../db/decisions.js"
import type { WhyCodeRecord, Constraint, CheckChangeResult } from "../../types/index.js"

export const checkChangeTool = {
  name: "whycode_check_change",
  description:
    "Before making a significant change, get all relevant decisions and a risk assessment. Use this for multi-file refactors.",
  inputSchema: {
    type: "object" as const,
    properties: {
      changeDescription: { type: "string", description: "Description of the planned change" },
      affectedPaths: { type: "array", items: { type: "string" }, description: "File paths that will be modified" },
    },
    required: ["changeDescription", "affectedPaths"],
  },
}

export function handleCheckChange(
  db: Database.Database,
  input: { changeDescription: string; affectedPaths: string[] }
): CheckChangeResult {
  const allDecisions: WhyCodeRecord[] = []
  const seen = new Set<string>()

  for (const filePath of input.affectedPaths) {
    const decisions = getDecisionsByPath(db, filePath)
    for (const d of decisions) {
      if (!seen.has(d.id)) {
        seen.add(d.id)
        allDecisions.push(d)
      }
    }
  }

  const mustConstraints: Constraint[] = []
  const shouldConstraints: Constraint[] = []
  const warnings: string[] = []

  for (const d of allDecisions) {
    for (const c of d.constraints) {
      if (c.severity === "must") {
        mustConstraints.push(c)
        warnings.push(`[MUST] ${c.description} (from "${d.title}")`)
      } else if (c.severity === "should") {
        shouldConstraints.push(c)
        warnings.push(`[SHOULD] ${c.description} (from "${d.title}")`)
      }
    }
    if (d.doNotChange.length > 0) {
      warnings.push(`Do-not-change patterns in "${d.title}": ${d.doNotChange.join(", ")}`)
    }
  }

  let riskLevel: "low" | "medium" | "high" = "low"
  if (mustConstraints.length > 0) riskLevel = "high"
  else if (shouldConstraints.length > 0) riskLevel = "medium"

  return { relevantDecisions: allDecisions, mustConstraints, warnings, riskLevel }
}
