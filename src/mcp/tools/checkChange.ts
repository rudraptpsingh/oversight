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
import { recordRespectedConstraints } from "../../engine/confidence.js"
import type {
  OversightRecord,
  Constraint,
  SlimConstraint,
  CheckChangeResult,
  EnforcementOutcome,
} from "../../types/index.js"

/** BM25 retrieval cap — must match seed-bm25-coefficients (topK ≤ 10 in check_change). */
const DEFAULT_TOP_K = 10
/** Files with >= this many violations in last 30 log entries trigger a pre-violation warning. */
const PRE_VIOLATION_THRESHOLD = 3
/** slim=true is the default — agents must opt-in to full response (seed-slim-default). */
const DEFAULT_SLIM = true

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

/** Check recent check_change_log for files with a history of violations. */
function getPreViolationWarning(db: Database, affectedPaths: string[]): string | undefined {
  try {
    const recent = db.prepare(
      "SELECT affected_paths_json FROM check_change_log ORDER BY id DESC LIMIT 30"
    ).all() as Array<{ affected_paths_json: string }>

    const violationCounts = new Map<string, number>()
    for (const row of recent) {
      const paths: string[] = JSON.parse(row.affected_paths_json)
      for (const p of paths) {
        violationCounts.set(p, (violationCounts.get(p) ?? 0) + 1)
      }
    }

    const hotFiles = affectedPaths.filter((p) => (violationCounts.get(p) ?? 0) >= PRE_VIOLATION_THRESHOLD)
    if (hotFiles.length > 0) {
      return `These files have a history of constraint violations (${hotFiles.join(", ")}). Review constraints carefully before proceeding.`
    }
  } catch {
    // best-effort
  }
  return undefined
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
    const decisions = getDecisionsByPath(db, filePath)
    for (const d of decisions) {
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

  let enforcementConfig = { mode: "advisory", blockOnMustViolation: false, blockOnHighRisk: false }
  try {
    enforcementConfig = readEnforcement()
  } catch {
    // advisory by default
  }

  let blocked = false
  let blockReason: string | undefined
  let redirect_hint: string | undefined
  let enforcementOutcome: EnforcementOutcome = "allowed"

  if (mustConstraintsRaw.length > 0) {
    // Build redirect hint from rationale + recovery fields (Normative enforcement per GaaS)
    const firstMust = mustConstraintsRaw[0]
    const hintParts: string[] = []
    if (firstMust.recovery) hintParts.push(firstMust.recovery)
    else if (firstMust.rationale) hintParts.push(`Rationale: ${firstMust.rationale}`)
    if (hintParts.length > 0) redirect_hint = hintParts.join(" — ")

    if (enforcementConfig.mode === "blocking" && enforcementConfig.blockOnMustViolation) {
      blocked = true
      blockReason = `Blocked: ${mustConstraints.length} must-constraint(s) apply. Resolve these before proceeding: ${mustConstraints.map((c) => c.description).join("; ")}`
      enforcementOutcome = "blocked"
    } else {
      enforcementOutcome = redirect_hint ? "redirected" : "warning"
    }
  } else if (shouldConstraintsRaw.length > 0) {
    if (enforcementConfig.mode === "blocking" && enforcementConfig.blockOnHighRisk && riskLevel === "high") {
      blocked = true
      blockReason = "Blocked: change is rated high-risk. Review constraints and get explicit approval before proceeding."
      enforcementOutcome = "blocked"
    } else {
      enforcementOutcome = "warning"
    }
  }

  // Proactive file-history warning (Pro2Guard-inspired)
  const pre_violation_warning = getPreViolationWarning(db, input.affectedPaths)

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
      enforcementOutcome,
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

  // Record confidence updates for non-violated constraints (best-effort, async-safe)
  if (allPathMatched.length > 0) {
    try {
      const violatedDescriptions = new Set(mustConstraintsRaw.map((c) => c.description.toLowerCase().trim()))
      recordRespectedConstraints(db, allPathMatched.map((d) => d.id), violatedDescriptions)
    } catch {
      // confidence tracking is best-effort
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
    enforcement: enforcementOutcome,
    redirect_hint,
    pre_violation_warning,
  }
}
