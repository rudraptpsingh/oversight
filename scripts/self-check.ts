#!/usr/bin/env tsx
/**
 * Post-commit self-analysis script.
 * Run automatically from git post-commit hook.
 * Writes .oversight/session-report.json with system health metrics.
 */
import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { findOversightDir } from "../src/utils/config.js"
import { openDatabase } from "../src/db/adapter.js"
import { getAllDecisions } from "../src/db/decisions.js"
import { generateBacklog } from "../src/self/backlog-generator.js"
import { runAutoPromote, runAutoDowngrade, computeDriftBound } from "../src/engine/confidence.js"

interface SessionReport {
  generatedAt: string
  constraint_snapshot?: Record<number, number>  // constraintId → confidence (for next diff)
  summary: {
    decision_quality_avg: number
    coverage_score: number
    avg_confidence: number
    avg_consistency_score: number
    total_decisions: number
    total_constraints: number
    drift_bound: number | null
    outcome_driven_violations: number
  }
  confidence_deltas: Array<{
    constraintId: number
    description: string
    decisionId: string
    prevConfidence: number
    newConfidence: number
    delta: number
  }>
  coverage_gaps: Array<{
    file: string
    change_frequency: number
    reason: string
  }>
  stale_decisions: Array<{
    id: string
    title: string
    daysSinceUpdate: number
    suggestedAction: string
  }>
  regression_links: Array<{
    id: number
    testName: string
    commitSha: string
    decisionId: string | null
    createdAt: number
  }>
  override_events: Array<{
    id: number
    constraintId: number | null
    decisionId: string | null
    rationale: string
    intentClass: string
    createdAt: number
  }>
  unreliable_constraints: Array<{
    constraintId: number
    description: string
    decisionId: string
    consistency_score: number
  }>
  backlog: Array<{
    id: string
    type: string
    priority: string
    title: string
    evidence: string
    decisionId?: string
  }>
  auto_promoted: number[]
  auto_downgraded: number[]
}

function getRecentlyChangedFiles(): string[] {
  try {
    const result = execSync("git diff --name-only HEAD^ HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo ''", {
      encoding: "utf-8",
    })
    return result.split("\n").map((f) => f.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function getGitFiles(): string[] {
  try {
    return execSync("git ls-files 2>/dev/null", { encoding: "utf-8" })
      .split("\n").map(f => f.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function scoreDecisionQuality(d: { constraints: unknown[]; agentHints: unknown[]; rationale: string; confidence: string; alternatives: unknown[] }): number {
  let score = 0
  if (d.constraints.length > 0) score += 0.3
  if (d.agentHints.length > 0) score += 0.2
  if (d.rationale && d.rationale.length > 20) score += 0.2
  if (d.confidence === "definitive") score += 0.2
  if (d.alternatives.length > 0) score += 0.1
  return score
}

async function main(): Promise<void> {
  const oversightDir = findOversightDir(process.cwd())
  if (!oversightDir) {
    process.stderr.write("Oversight not initialized — skipping self-check.\n")
    process.exit(0)
  }

  const dbPath = path.join(oversightDir, "decisions.db")
  if (!fs.existsSync(dbPath)) {
    process.stderr.write("No decisions.db found — skipping self-check.\n")
    process.exit(0)
  }

  const db = await openDatabase(dbPath)

  // Run auto-promote / auto-downgrade
  const auto_promoted = runAutoPromote(db)
  const auto_downgraded = runAutoDowngrade(db)

  const allDecisions = getAllDecisions(db, "active")
  const recentFiles = getRecentlyChangedFiles()
  const gitFiles = getGitFiles()
  const gitFileCount = gitFiles.length

  // --- Summary ---
  const qualityScores = allDecisions.map((d) => scoreDecisionQuality(d as Parameters<typeof scoreDecisionQuality>[0]))
  const decision_quality_avg = qualityScores.length > 0
    ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
    : 0

  // Coverage: count git-tracked files matched by at least one anchor (same logic as getDecisionsByPath)
  const coveredFiles = new Set<string>()
  for (const f of gitFiles) {
    const nf = f.replace(/^\.\//, "").replace(/\\/g, "/")
    const covered = allDecisions.some(d => d.anchors.some(a => {
      if (a.type === "glob") {
        const pattern = (a.glob ?? a.path)
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*")
          .replace(/\u0000/g, ".*").replace(/\?/g, "[^/]")
        return new RegExp(`^${pattern}$`).test(nf)
      }
      const ap = a.path.replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/$/, "")
      return ap === nf || nf.startsWith(ap + "/") || ap.startsWith(nf + "/")
    }))
    if (covered) coveredFiles.add(nf)
  }
  const coverage_score = gitFileCount > 0
    ? Math.min(100, Math.round((coveredFiles.size / gitFileCount) * 100))
    : 0

  const constraintStats = db.prepare(
    "SELECT AVG(confidence) as avg_conf, AVG(consistency_score) as avg_consistency, COUNT(*) as cnt FROM constraints"
  ).get() as { avg_conf: number | null; avg_consistency: number | null; cnt: number }

  const avg_confidence = constraintStats.avg_conf ?? 0
  const avg_consistency_score = constraintStats.avg_consistency ?? 0
  const total_constraints = constraintStats.cnt

  // Drift bound: global across all decisions
  let globalDriftBound: number | null = null
  try {
    const totals = db.prepare(
      "SELECT SUM(check_count) as tc, SUM(override_count) as to_ FROM constraints"
    ).get() as { tc: number | null; to_: number | null }
    const tc = totals.tc ?? 0
    const to_ = totals.to_ ?? 0
    if (tc > 0) {
      const alpha = to_ / tc
      const promotes = db.prepare(
        "SELECT COUNT(*) as cnt FROM constraint_confidence_history WHERE event_type = 'promote'"
      ).get() as { cnt: number }
      const gamma = to_ > 0 ? (promotes.cnt / to_) : 1
      globalDriftBound = gamma > 0 ? alpha / gamma : null
    }
  } catch { /* best-effort */ }

  const outcomeDrivenViolations = db.prepare(
    "SELECT COUNT(*) as cnt FROM override_events WHERE intent_class = 'task_pressure'"
  ).get() as { cnt: number }

  // --- Confidence deltas (compare to previous report's constraint_snapshot) ---
  const currentConstraints = db.prepare(
    "SELECT id, description, decision_id, confidence FROM constraints"
  ).all() as Array<{ id: number; description: string; decision_id: string; confidence: number }>

  const confidence_deltas: SessionReport["confidence_deltas"] = []
  try {
    const reportPath = path.join(oversightDir, "session-report.json")
    if (fs.existsSync(reportPath)) {
      const prevReport = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as SessionReport
      // Use constraint_snapshot if present, fall back to confidence_deltas for backwards compat
      const prevMap: Map<number, number> = prevReport.constraint_snapshot
        ? new Map(Object.entries(prevReport.constraint_snapshot).map(([k, v]) => [Number(k), v as number]))
        : new Map(prevReport.confidence_deltas?.map((d) => [d.constraintId, d.newConfidence]) ?? [])

      for (const c of currentConstraints) {
        const prevConf = prevMap.get(c.id)
        if (prevConf !== undefined && Math.abs(c.confidence - prevConf) > 0.001) {
          confidence_deltas.push({
            constraintId: c.id,
            description: c.description,
            decisionId: c.decision_id,
            prevConfidence: prevConf,
            newConfidence: c.confidence,
            delta: c.confidence - prevConf,
          })
        }
      }
    }
  } catch { /* best-effort */ }

  // Build snapshot of current confidences for next diff
  const constraint_snapshot: Record<number, number> = {}
  for (const c of currentConstraints) constraint_snapshot[c.id] = c.confidence

  // --- Coverage gaps ---
  const coverage_gaps: SessionReport["coverage_gaps"] = recentFiles
    .filter((f) => !coveredFiles.has(f.replace(/^\.\//, "").replace(/\\/g, "/")))
    .map((f) => ({
      file: f,
      change_frequency: 1,
      reason: "No anchored decision for this file",
    }))

  // --- Stale decisions ---
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const staleRows = db.prepare(
    "SELECT id, title, timestamp FROM decisions WHERE status = 'active' AND timestamp < ?"
  ).all(ninetyDaysAgo) as Array<{ id: string; title: string; timestamp: string }>

  const stale_decisions = staleRows.map((r) => {
    const daysSinceUpdate = Math.floor((Date.now() - new Date(r.timestamp).getTime()) / (1000 * 60 * 60 * 24))
    return {
      id: r.id,
      title: r.title,
      daysSinceUpdate,
      suggestedAction: daysSinceUpdate > 180 ? "Review or deprecate" : "Review and update",
    }
  })

  // --- Regression links ---
  const regression_links = db.prepare(
    "SELECT id, test_name, commit_sha, decision_id, created_at FROM regression_links WHERE resolved = 0 ORDER BY created_at DESC LIMIT 20"
  ).all() as Array<{ id: number; test_name: string; commit_sha: string; decision_id: string | null; created_at: number }>

  // --- Override events (last 30 days) ---
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const override_events = db.prepare(
    "SELECT id, constraint_id, decision_id, rationale, intent_class, created_at FROM override_events WHERE created_at > ? ORDER BY created_at DESC LIMIT 50"
  ).all(thirtyDaysAgo) as Array<{
    id: number; constraint_id: number | null; decision_id: string | null
    rationale: string; intent_class: string; created_at: number
  }>

  // --- Unreliable constraints (consistency_score < 0.5) ---
  const unreliable_constraints = db.prepare(
    "SELECT id, description, decision_id, consistency_score FROM constraints WHERE consistency_score < 0.5 AND check_count >= 4 ORDER BY consistency_score ASC LIMIT 20"
  ).all() as Array<{ id: number; description: string; decision_id: string; consistency_score: number }>

  // --- Backlog ---
  const backlog = generateBacklog(db, recentFiles)

  const report: SessionReport = {
    generatedAt: new Date().toISOString(),
    constraint_snapshot,
    summary: {
      decision_quality_avg: Math.round(decision_quality_avg * 100) / 100,
      coverage_score,
      avg_confidence: Math.round(avg_confidence * 1000) / 1000,
      avg_consistency_score: Math.round(avg_consistency_score * 1000) / 1000,
      total_decisions: allDecisions.length,
      total_constraints,
      drift_bound: globalDriftBound !== null ? Math.round(globalDriftBound * 1000) / 1000 : null,
      outcome_driven_violations: outcomeDrivenViolations.cnt,
    },
    confidence_deltas,
    coverage_gaps,
    stale_decisions,
    regression_links: regression_links.map((r) => ({
      id: r.id,
      testName: r.test_name,
      commitSha: r.commit_sha,
      decisionId: r.decision_id,
      createdAt: r.created_at,
    })),
    override_events: override_events.map((e) => ({
      id: e.id,
      constraintId: e.constraint_id,
      decisionId: e.decision_id,
      rationale: e.rationale,
      intentClass: e.intent_class,
      createdAt: e.created_at,
    })),
    unreliable_constraints: unreliable_constraints.map((c) => ({
      constraintId: c.id,
      description: c.description,
      decisionId: c.decision_id,
      consistency_score: c.consistency_score,
    })),
    backlog,
    auto_promoted,
    auto_downgraded,
  }

  const reportPath = path.join(oversightDir, "session-report.json")
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8")

  const backlogCritical = backlog.filter((b) => b.priority === "CRITICAL").length
  const backlogHigh = backlog.filter((b) => b.priority === "HIGH").length

  process.stdout.write(
    `Oversight self-check complete. Coverage: ${coverage_score}%, Avg confidence: ${(avg_confidence * 100).toFixed(1)}%, Backlog: ${backlog.length} items (${backlogCritical} critical, ${backlogHigh} high).\n`
  )

  if (auto_promoted.length > 0) {
    process.stdout.write(`Auto-promoted ${auto_promoted.length} constraint(s) to MUST.\n`)
  }
  if (auto_downgraded.length > 0) {
    process.stdout.write(`Auto-downgraded ${auto_downgraded.length} constraint(s) to SHOULD.\n`)
  }
}

main().catch((err) => {
  process.stderr.write(`Oversight self-check failed: ${String(err)}\n`)
  process.exit(0) // non-fatal — don't block commits
})
