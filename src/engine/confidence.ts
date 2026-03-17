import type { Database } from "../db/adapter.js"

const HISTORY_EVENT_CHECK = "check"
const HISTORY_EVENT_OVERRIDE = "override"
const HISTORY_EVENT_PROMOTE = "promote"
const HISTORY_EVENT_DOWNGRADE = "downgrade"

/** Rolling window for pass^N consistency score per Π-Bench (τ-Bench paper). Must stay at 8. */
const CONSISTENCY_WINDOW = 8

/**
 * Called after a constraint passes check_change without violation.
 * Exponential smoothing: conf += 0.02 * (1 - conf)  — asymptotes to 1.0
 */
export function onRespectedCheck(db: Database, constraintId: number): void {
  const row = db.prepare("SELECT confidence, check_count FROM constraints WHERE id = ?").get(constraintId) as
    | { confidence: number; check_count: number }
    | undefined
  if (!row) return

  const newConf = row.confidence + 0.02 * (1 - row.confidence)
  const now = Date.now()

  db.prepare(
    "UPDATE constraints SET confidence = ?, check_count = check_count + 1, last_checked = ? WHERE id = ?"
  ).run(newConf, now, constraintId)

  updateConsistencyScore(db, constraintId, true)

  db.prepare(
    "INSERT INTO constraint_confidence_history (constraint_id, confidence, recorded_at, event_type) VALUES (?, ?, ?, ?)"
  ).run(constraintId, newConf, now, HISTORY_EVENT_CHECK)
}

/**
 * Called when an agent deliberately overrides a constraint.
 * conf = max(0.05, conf - 0.15) — floor prevents zeroing
 */
export function onOverride(db: Database, constraintId: number, rationale: string, commitSha?: string): void {
  const row = db.prepare("SELECT confidence, override_count, decision_id FROM constraints WHERE id = ?").get(constraintId) as
    | { confidence: number; override_count: number; decision_id: string }
    | undefined
  if (!row) return

  const newConf = Math.max(0.05, row.confidence - 0.15)
  const intentClass = classifyOverrideIntent(rationale)
  const now = Date.now()

  db.prepare(
    "UPDATE constraints SET confidence = ?, override_count = override_count + 1, last_checked = ? WHERE id = ?"
  ).run(newConf, now, constraintId)

  updateConsistencyScore(db, constraintId, false)

  db.prepare(
    "INSERT INTO constraint_confidence_history (constraint_id, confidence, recorded_at, event_type) VALUES (?, ?, ?, ?)"
  ).run(constraintId, newConf, now, HISTORY_EVENT_OVERRIDE)

  db.prepare(
    "INSERT INTO override_events (constraint_id, decision_id, commit_sha, rationale, intent_class, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(constraintId, row.decision_id, commitSha ?? null, rationale, intentClass, now)
}

/**
 * Auto-promote: SHOULD → MUST when confidence > 0.9 AND check_count > 20.
 * Called from self-check.ts after each commit.
 * Returns list of promoted constraint IDs.
 */
export function runAutoPromote(db: Database): number[] {
  const candidates = db.prepare(
    "SELECT id FROM constraints WHERE severity = 'should' AND confidence > 0.9 AND check_count > 20"
  ).all() as Array<{ id: number }>

  const promoted: number[] = []
  for (const row of candidates) {
    db.prepare("UPDATE constraints SET severity = 'must' WHERE id = ?").run(row.id)
    db.prepare(
      "INSERT INTO constraint_confidence_history (constraint_id, confidence, recorded_at, event_type) SELECT id, confidence, ?, ? FROM constraints WHERE id = ?"
    ).run(Date.now(), HISTORY_EVENT_PROMOTE, row.id)
    promoted.push(row.id)
  }
  return promoted
}

/**
 * Auto-downgrade: MUST → SHOULD when confidence < 0.25 AND override_count > 3.
 * Called from self-check.ts after each commit.
 * Returns list of downgraded constraint IDs.
 */
export function runAutoDowngrade(db: Database): number[] {
  const candidates = db.prepare(
    "SELECT id FROM constraints WHERE severity = 'must' AND confidence < 0.25 AND override_count > 3"
  ).all() as Array<{ id: number }>

  const downgraded: number[] = []
  for (const row of candidates) {
    db.prepare("UPDATE constraints SET severity = 'should' WHERE id = ?").run(row.id)
    db.prepare(
      "INSERT INTO constraint_confidence_history (constraint_id, confidence, recorded_at, event_type) SELECT id, confidence, ?, ? FROM constraints WHERE id = ?"
    ).run(Date.now(), HISTORY_EVENT_DOWNGRADE, row.id)
    downgraded.push(row.id)
  }
  return downgraded
}

/**
 * Rolling pass^N consistency score over last CONSISTENCY_WINDOW checks.
 * Stored as REAL in constraints.consistency_score.
 */
export function updateConsistencyScore(db: Database, constraintId: number, passed: boolean): void {
  const history = db.prepare(
    "SELECT event_type FROM constraint_confidence_history WHERE constraint_id = ? ORDER BY recorded_at DESC LIMIT ?"
  ).all(constraintId, CONSISTENCY_WINDOW) as Array<{ event_type: string }>

  // Prepend current result
  const events = [passed ? HISTORY_EVENT_CHECK : HISTORY_EVENT_OVERRIDE, ...history.map((h) => h.event_type)]
  const window = events.slice(0, CONSISTENCY_WINDOW)
  const passCount = window.filter((e) => e === HISTORY_EVENT_CHECK).length
  const score = window.length > 0 ? passCount / window.length : 0.5

  db.prepare("UPDATE constraints SET consistency_score = ? WHERE id = ?").run(score, constraintId)
}

/**
 * Classify override intent from rationale text.
 * Used for outcome-driven violation detection (ODCV-Bench).
 */
export function classifyOverrideIntent(
  rationale: string
): "legitimate_exception" | "task_pressure" | "disagreement" | "unknown" {
  const lower = rationale.toLowerCase()

  const taskPressurePatterns = ["deadline", "faster", "simpler", "need to", "have to", "must finish", "quick", "urgent", "time constraint"]
  const disagreementPatterns = ["incorrect", "outdated", "wrong", "disagree", "not applicable", "no longer", "obsolete", "bad constraint"]

  if (taskPressurePatterns.some((p) => lower.includes(p))) return "task_pressure"
  if (disagreementPatterns.some((p) => lower.includes(p))) return "disagreement"
  if (rationale.length > 50) return "legitimate_exception"
  return "unknown"
}

/**
 * Compute drift bound D* = α/γ for a decision.
 * α = override_count / check_count (drift rate)
 * γ = auto-strengthen events / override_events (recovery rate)
 * Returns null if insufficient data.
 */
export function computeDriftBound(db: Database, decisionId: string): number | null {
  const totals = db.prepare(
    "SELECT SUM(check_count) as total_checks, SUM(override_count) as total_overrides FROM constraints WHERE decision_id = ?"
  ).get(decisionId) as { total_checks: number | null; total_overrides: number | null }

  const totalChecks = totals.total_checks ?? 0
  const totalOverrides = totals.total_overrides ?? 0
  if (totalChecks === 0) return null

  const alpha = totalOverrides / totalChecks

  const promotes = db.prepare(
    "SELECT COUNT(*) as cnt FROM constraint_confidence_history WHERE event_type = ? AND constraint_id IN (SELECT id FROM constraints WHERE decision_id = ?)"
  ).get(HISTORY_EVENT_PROMOTE, decisionId) as { cnt: number }

  const gamma = totalOverrides > 0 ? (promotes.cnt / totalOverrides) : 1
  if (gamma === 0) return null

  return alpha / gamma
}

/**
 * Batch-call onRespectedCheck for all constraints matching the given descriptions + decision IDs.
 * Used by checkChange after returning results (non-violated constraints).
 */
export function recordRespectedConstraints(
  db: Database,
  decisionIds: string[],
  violatedDescriptions: Set<string>
): void {
  if (decisionIds.length === 0) return
  const placeholders = decisionIds.map(() => "?").join(", ")
  const rows = db.prepare(
    `SELECT id, description FROM constraints WHERE decision_id IN (${placeholders})`
  ).all(...decisionIds) as Array<{ id: number; description: string }>

  for (const row of rows) {
    if (!violatedDescriptions.has(row.description.toLowerCase().trim())) {
      onRespectedCheck(db, row.id)
    }
  }
}
