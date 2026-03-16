import type { Database } from "../../db/adapter.js"
import { getDecisionsByPath } from "../../db/decisions.js"
import { logCheckChange } from "../../db/metrics.js"
import { readEnforcement } from "../../utils/config.js"
import { getActiveSession, updateSession } from "../../db/sessions.js"
import type { OversightRecord, Constraint, CheckChangeResult } from "../../types/index.js"

export const checkChangeTool = {
  name: "oversight_check_change",
  description:
    "Before making a significant change, get all relevant decisions and a risk assessment. Use this for multi-file refactors. In blocking mode (enforcement.json), returns proceed=false when must-constraints are violated.",
  inputSchema: {
    type: "object" as const,
    properties: {
      changeDescription: { type: "string", description: "Description of the planned change" },
      affectedPaths: { type: "array", items: { type: "string" }, description: "File paths that will be modified" },
      sessionId: { type: "string", description: "Optional session ID to track this check in the session" },
    },
    required: ["changeDescription", "affectedPaths"],
  },
}

export function handleCheckChange(
  db: Database,
  input: { changeDescription: string; affectedPaths: string[]; sessionId?: string }
): CheckChangeResult {
  const allDecisions: OversightRecord[] = []
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

  let enforcement = { mode: "advisory", blockOnMustViolation: false, blockOnHighRisk: false }
  try {
    enforcement = readEnforcement()
  } catch {
    // advisory by default
  }

  let blocked = false
  let blockReason: string | undefined

  if (enforcement.mode === "blocking") {
    if (enforcement.blockOnMustViolation && mustConstraints.length > 0) {
      blocked = true
      blockReason = `Blocked: ${mustConstraints.length} must-constraint(s) would be violated. Resolve these before proceeding: ${mustConstraints.map((c) => c.description).join("; ")}`
    } else if (enforcement.blockOnHighRisk && riskLevel === "high") {
      blocked = true
      blockReason = `Blocked: change is rated high-risk. Review constraints and get explicit approval before proceeding.`
    }
  }

  try {
    logCheckChange(db, {
      changeDescription: input.changeDescription,
      affectedPaths: input.affectedPaths,
      relevantDecisionIds: allDecisions.map((d) => d.id),
      mustConstraintCount: mustConstraints.length,
      shouldConstraintCount: shouldConstraints.length,
      riskLevel,
      warningCount: warnings.length,
      timestamp: new Date().toISOString(),
    })
  } catch {
    // metrics logging is best-effort
  }

  if (input.sessionId) {
    try {
      const session = getActiveSession(db)
      if (session && session.id === input.sessionId) {
        updateSession(db, input.sessionId, { checksPerformed: session.checksPerformed + 1 })
      }
    } catch {
      // session tracking is best-effort
    }
  }

  return {
    relevantDecisions: allDecisions,
    mustConstraints,
    warnings,
    riskLevel,
    proceed: !blocked,
    blocked,
    blockReason,
  }
}
