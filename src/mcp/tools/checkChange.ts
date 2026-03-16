import type { Database } from "../../db/adapter.js"
import { getDecisionsByPath } from "../../db/decisions.js"
import {
  retrieveConstraintsForEdit,
  recordToSlim,
  dedupeConstraintsByDescription,
} from "../../db/retrieval.js"
import { logCheckChange } from "../../db/metrics.js"
import { readEnforcement } from "../../utils/config.js"
import { getActiveSession, updateSession } from "../../db/sessions.js"
import type {
  OversightRecord,
  Constraint,
  SlimConstraint,
  CheckChangeResult,
} from "../../types/index.js"

const DEFAULT_TOP_K = 10

export const checkChangeTool = {
  name: "oversight_check_change",
  description:
    "Before making a significant change, get all relevant decisions and a risk assessment. Use slim=true to reduce token usage.",
  inputSchema: {
    type: "object" as const,
    properties: {
      changeDescription: { type: "string", description: "Description of the planned change" },
      affectedPaths: { type: "array", items: { type: "string" }, description: "File paths that will be modified" },
      sessionId: { type: "string", description: "Optional session ID to track this check in the session" },
      topK: { type: "number", description: "Max decisions in relevantDecisions (default 10)" },
      slim: { type: "boolean", description: "Return minimal format — reduces tokens" },
    },
    required: ["changeDescription", "affectedPaths"],
  },
}

export function handleCheckChange(
  db: Database,
  input: {
    changeDescription: string
    affectedPaths: string[]
    sessionId?: string
    topK?: number
    slim?: boolean
  }
): CheckChangeResult {
  const topK = input.topK ?? DEFAULT_TOP_K

  // 1. Path filter: get ALL path-matched decisions for enforcement (must not miss any must-constraints)
  const allPathMatched: OversightRecord[] = []
  const seen = new Set<string>()
  for (const filePath of input.affectedPaths) {
    const basename = filePath.split("/").pop() ?? filePath
    const decisions = getDecisionsByPath(db, filePath)
    const extra = basename !== filePath ? getDecisionsByPath(db, basename) : []
    for (const d of [...decisions, ...extra]) {
      if (!seen.has(d.id) && (d.status === "active" || d.status === "proposed")) {
        seen.add(d.id)
        allPathMatched.push(d)
      }
    }
  }

  // 2. BM25-ranked top-K for response (saves tokens; enforcement uses full set)
  const retrieved = retrieveConstraintsForEdit(db, {
    paths: input.affectedPaths,
    query: input.changeDescription,
    topK,
    includeSuperseded: false,
  })
  const relevantRecords = retrieved.map((r) => r.record)
  const relevantDecisions = input.slim
    ? relevantRecords.map(recordToSlim)
    : relevantRecords

  const mustConstraintsRaw: Constraint[] = []
  const shouldConstraintsRaw: Constraint[] = []
  const warnings: string[] = []

  for (const d of allPathMatched) {
    for (const c of d.constraints) {
      if (c.severity === "must") {
        mustConstraintsRaw.push(c)
        warnings.push(`[MUST] ${c.description} (from "${d.title}")`)
      } else if (c.severity === "should") {
        shouldConstraintsRaw.push(c)
        warnings.push(`[SHOULD] ${c.description} (from "${d.title}")`)
      }
    }
    if (d.doNotChange.length > 0) {
      warnings.push(`Do-not-change patterns in "${d.title}": ${d.doNotChange.join(", ")}`)
    }
  }

  const mustConstraints = input.slim
    ? (dedupeConstraintsByDescription(
        mustConstraintsRaw.map((c) => ({ severity: c.severity, description: c.description }))
      ) as SlimConstraint[])
    : dedupeConstraintsByDescription(mustConstraintsRaw)
  const shouldConstraints = input.slim
    ? dedupeConstraintsByDescription(
        shouldConstraintsRaw.map((c) => ({ severity: c.severity, description: c.description }))
      )
    : dedupeConstraintsByDescription(shouldConstraintsRaw)

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
    if (enforcement.blockOnMustViolation && mustConstraintsRaw.length > 0) {
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
      relevantDecisionIds: allPathMatched.map((d) => d.id),
      mustConstraintCount: mustConstraintsRaw.length,
      shouldConstraintCount: shouldConstraintsRaw.length,
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
    relevantDecisions,
    mustConstraints,
    warnings,
    riskLevel,
    proceed: !blocked,
    blocked,
    blockReason,
  }
}
