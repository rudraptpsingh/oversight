import type { Database } from "../db/adapter.js"

/** Priority order is fixed: CRITICAL > HIGH > MEDIUM > LOW — per seed-backlog-priority-order. */
export type BacklogPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
export type BacklogType =
  | "STRENGTHEN"
  | "CAPTURE"
  | "RESOLVE_REGRESSION"
  | "PROMOTE"
  | "REVIEW"

export interface BacklogItem {
  id: string
  type: BacklogType
  priority: BacklogPriority
  title: string
  evidence: string
  decisionId?: string
  constraintId?: number
  filePath?: string
}

interface ConstraintRow {
  id: number
  decision_id: string
  description: string
  severity: string
  confidence: number
  check_count: number
  override_count: number
}

interface RegressionRow {
  id: number
  decision_id: string | null
  test_name: string
  commit_sha: string
}

interface DecisionRow {
  id: string
  title: string
  timestamp: string
  anchors_json: string
}

/**
 * Generate prioritized backlog items from DB signals.
 * Called by self-check.ts after each commit.
 */
export function generateBacklog(
  db: Database,
  recentlyChangedFiles: string[] = []
): BacklogItem[] {
  const items: BacklogItem[] = []

  // 1. STRENGTHEN: override_rate > 0.3 on any constraint
  try {
    const candidates = db.prepare(
      "SELECT id, decision_id, description, severity, confidence, check_count, override_count FROM constraints WHERE check_count > 3"
    ).all() as ConstraintRow[]

    for (const c of candidates) {
      const overrideRate = c.override_count / c.check_count
      if (overrideRate > 0.3) {
        items.push({
          id: `strengthen-${c.id}`,
          type: "STRENGTHEN",
          priority: "HIGH",
          title: `Strengthen constraint: "${c.description.slice(0, 60)}"`,
          evidence: `Override rate ${Math.round(overrideRate * 100)}% (${c.override_count}/${c.check_count} checks). Constraint may be too strict or unclear.`,
          decisionId: c.decision_id,
          constraintId: c.id,
        })
      }
    }
  } catch { /* best-effort */ }

  // 2. CAPTURE: recently changed files with no anchored decision
  try {
    const anchoredPaths = new Set<string>()
    const decisions = db.prepare("SELECT anchors_json FROM decisions WHERE status = 'active'").all() as Array<{ anchors_json: string }>
    for (const d of decisions) {
      const anchors: Array<{ path: string }> = JSON.parse(d.anchors_json)
      for (const a of anchors) anchoredPaths.add(a.path)
    }

    for (const file of recentlyChangedFiles) {
      const isAnchored = [...anchoredPaths].some(
        (p) => file.includes(p) || p.includes(file)
      )
      if (!isAnchored) {
        items.push({
          id: `capture-${file.replace(/[^a-z0-9]/gi, "-")}`,
          type: "CAPTURE",
          priority: "HIGH",
          title: `Capture decision for frequently changed file: ${file}`,
          evidence: `File has recent commits but no anchored decision. Run 'oversight capture ${file}'.`,
          filePath: file,
        })
      }
    }
  } catch { /* best-effort */ }

  // 3. RESOLVE_REGRESSION: unresolved regression_links entries
  try {
    const regressions = db.prepare(
      "SELECT id, decision_id, test_name, commit_sha FROM regression_links WHERE resolved = 0"
    ).all() as RegressionRow[]

    for (const r of regressions) {
      items.push({
        id: `regression-${r.id}`,
        type: "RESOLVE_REGRESSION",
        priority: "CRITICAL",
        title: `Unresolved regression: ${r.test_name}`,
        evidence: `Test "${r.test_name}" failed at commit ${r.commit_sha.slice(0, 8)}. Linked to decision: ${r.decision_id ?? "unknown"}.`,
        decisionId: r.decision_id ?? undefined,
      })
    }
  } catch { /* best-effort */ }

  // 4. PROMOTE: SHOULD constraints ready to become MUST
  try {
    const promotable = db.prepare(
      "SELECT id, decision_id, description FROM constraints WHERE severity = 'should' AND confidence > 0.9 AND check_count > 20"
    ).all() as Array<{ id: number; decision_id: string; description: string }>

    for (const c of promotable) {
      items.push({
        id: `promote-${c.id}`,
        type: "PROMOTE",
        priority: "MEDIUM",
        title: `Promote to MUST: "${c.description.slice(0, 60)}"`,
        evidence: `Confidence > 90% with > 20 checks. This constraint is reliably respected — consider promoting to MUST.`,
        decisionId: c.decision_id,
        constraintId: c.id,
      })
    }
  } catch { /* best-effort */ }

  // 5. REVIEW: decisions not updated in 90 days with recent file activity
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const stale = db.prepare(
      "SELECT id, title, timestamp, anchors_json FROM decisions WHERE status = 'active' AND timestamp < ?"
    ).all(ninetyDaysAgo) as DecisionRow[]

    for (const d of stale) {
      let hasRecentActivity = false
      try {
        const anchors: Array<{ path: string }> = JSON.parse(d.anchors_json)
        hasRecentActivity = anchors.some((a) => recentlyChangedFiles.some((f) => f.includes(a.path) || a.path.includes(f)))
      } catch { /* skip */ }

      if (hasRecentActivity) {
        items.push({
          id: `review-${d.id}`,
          type: "REVIEW",
          priority: "LOW",
          title: `Review stale decision: "${d.title}"`,
          evidence: `Decision last updated ${new Date(d.timestamp).toDateString()} (>90 days ago) but anchored files have recent commits.`,
          decisionId: d.id,
        })
      }
    }
  } catch { /* best-effort */ }

  // Sort: CRITICAL > HIGH > MEDIUM > LOW
  const priorityOrder: Record<BacklogPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  return items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
}
