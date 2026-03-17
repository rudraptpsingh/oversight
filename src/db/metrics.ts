import type { Database } from "./adapter.js"
import type { OversightRecord, CheckChangeResult, DecisionType, Confidence, EnforcementOutcome } from "../types/index.js"

export interface CheckChangeLogEntry {
  changeDescription: string
  affectedPaths: string[]
  relevantDecisionIds: string[]
  mustConstraintCount: number
  shouldConstraintCount: number
  riskLevel: "low" | "medium" | "high"
  warningCount: number
  timestamp: string
  enforcementOutcome?: EnforcementOutcome
}

export interface OversightMetrics {
  decisions: {
    total: number
    active: number
    superseded: number
    deprecated: number
    needsReview: number
    byType: Record<DecisionType, number>
    byConfidence: Record<Confidence, number>
    withConstraints: number
    withAgentHints: number
    withDoNotChange: number
    mustConstraintTotal: number
    shouldConstraintTotal: number
    alternativesDocumented: number
    anchorsTotal: number
    uniqueFilesProtected: number
  }
  checkChange: {
    totalChecks: number
    highRiskBlocked: number
    mediumRiskFlagged: number
    lowRiskCleared: number
    totalWarningsIssued: number
    totalMustConstraintHits: number
    uniqueFilesChecked: number
  }
  coverage: {
    decisionsPerProtectedFile: number
    constraintDensity: number
    agentHintDensity: number
  }
}

export function logCheckChange(db: Database, entry: CheckChangeLogEntry): void {
  db.prepare(`
    INSERT INTO check_change_log
      (change_description, affected_paths_json, relevant_decision_ids_json,
       must_constraint_count, should_constraint_count, risk_level, warning_count,
       timestamp, enforcement_outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.changeDescription,
    JSON.stringify(entry.affectedPaths),
    JSON.stringify(entry.relevantDecisionIds),
    entry.mustConstraintCount,
    entry.shouldConstraintCount,
    entry.riskLevel,
    entry.warningCount,
    entry.timestamp,
    entry.enforcementOutcome ?? null,
  )
}

export function computeMetrics(db: Database): OversightMetrics {
  const rows = db.prepare("SELECT * FROM decisions").all() as Array<Record<string, unknown>>

  const typeMap = {} as Record<DecisionType, number>
  const confidenceMap = {} as Record<Confidence, number>
  const protectedFiles = new Set<string>()

  let active = 0, superseded = 0, deprecated = 0, needsReview = 0
  let withConstraints = 0, withAgentHints = 0, withDoNotChange = 0
  let mustTotal = 0, shouldTotal = 0, alternativesTotal = 0, anchorsTotal = 0

  for (const row of rows) {
    const status = row.status as string
    if (status === "active") active++
    else if (status === "superseded") superseded++
    else if (status === "deprecated") deprecated++
    else if (status === "needs-review") needsReview++

    const dType = row.decision_type as DecisionType
    typeMap[dType] = (typeMap[dType] ?? 0) + 1

    const conf = row.confidence as Confidence
    confidenceMap[conf] = (confidenceMap[conf] ?? 0) + 1

    const constraints = JSON.parse(row.constraints_json as string ?? "[]") as Array<{ severity: string }>
    if (constraints.length > 0) withConstraints++
    for (const c of constraints) {
      if (c.severity === "must") mustTotal++
      else if (c.severity === "should") shouldTotal++
    }

    const hints = JSON.parse(row.agent_hints_json as string ?? "[]") as unknown[]
    if (hints.length > 0) withAgentHints++

    const dnc = JSON.parse(row.do_not_change_json as string ?? "[]") as unknown[]
    if (dnc.length > 0) withDoNotChange++

    const alts = JSON.parse(row.alternatives_json as string ?? "[]") as unknown[]
    alternativesTotal += alts.length

    const anchors = JSON.parse(row.anchors_json as string ?? "[]") as Array<{ path: string }>
    anchorsTotal += anchors.length
    for (const a of anchors) {
      if (a.path) protectedFiles.add(a.path)
    }
  }

  const logRows = db.prepare("SELECT * FROM check_change_log").all() as Array<Record<string, unknown>>

  let highRisk = 0, mediumRisk = 0, lowRisk = 0
  let totalWarnings = 0, totalMustHits = 0
  const checkedFiles = new Set<string>()

  for (const row of logRows) {
    const risk = row.risk_level as string
    if (risk === "high") highRisk++
    else if (risk === "medium") mediumRisk++
    else lowRisk++

    totalWarnings += (row.warning_count as number) ?? 0
    totalMustHits += (row.must_constraint_count as number) ?? 0

    const paths = JSON.parse(row.affected_paths_json as string ?? "[]") as string[]
    for (const p of paths) checkedFiles.add(p)
  }

  const totalDecisions = rows.length
  const uniqueFilesProtected = protectedFiles.size

  return {
    decisions: {
      total: totalDecisions,
      active,
      superseded,
      deprecated,
      needsReview,
      byType: typeMap,
      byConfidence: confidenceMap,
      withConstraints,
      withAgentHints,
      withDoNotChange,
      mustConstraintTotal: mustTotal,
      shouldConstraintTotal: shouldTotal,
      alternativesDocumented: alternativesTotal,
      anchorsTotal,
      uniqueFilesProtected,
    },
    checkChange: {
      totalChecks: logRows.length,
      highRiskBlocked: highRisk,
      mediumRiskFlagged: mediumRisk,
      lowRiskCleared: lowRisk,
      totalWarningsIssued: totalWarnings,
      totalMustConstraintHits: totalMustHits,
      uniqueFilesChecked: checkedFiles.size,
    },
    coverage: {
      decisionsPerProtectedFile: uniqueFilesProtected > 0
        ? parseFloat((totalDecisions / uniqueFilesProtected).toFixed(2))
        : 0,
      constraintDensity: totalDecisions > 0
        ? parseFloat(((mustTotal + shouldTotal) / totalDecisions).toFixed(2))
        : 0,
      agentHintDensity: totalDecisions > 0
        ? parseFloat((withAgentHints / totalDecisions).toFixed(2))
        : 0,
    },
  }
}
