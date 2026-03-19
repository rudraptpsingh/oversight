import type { Database } from "./adapter.js"
import type {
  OversightRecord,
  DecisionStatus,
  SimilarDecision,
  DuplicateCheckResult,
  Constraint,
} from "../types/index.js"

/** Normalize text for comparison: lowercase, collapse whitespace. */
function normalizeDesc(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Deduplicate constraints: merge or remove when one subsumes another.
 * - Exact duplicate (same severity + normalized description): keep one.
 * - One description contains the other: keep the more comprehensive, merge rationales.
 */
export function deduplicateConstraints(constraints: Constraint[]): Constraint[] {
  if (constraints.length <= 1) return [...constraints]

  const bySeverity = new Map<string, Constraint[]>()
  for (const c of constraints) {
    const list = bySeverity.get(c.severity) ?? []
    list.push({ ...c })
    bySeverity.set(c.severity, list)
  }

  const result: Constraint[] = []
  for (const list of bySeverity.values()) {
    const sorted = [...list].sort((a, b) => b.description.length - a.description.length)
    const kept: Constraint[] = []
    for (const c of sorted) {
      const normC = normalizeDesc(c.description)
      const subsumedBy = kept.find((k) => {
        const normK = normalizeDesc(k.description)
        if (normK === normC) {
          k.rationale = [k.rationale, c.rationale].filter(Boolean).join(". ")
          return true
        }
        if (normC.length <= normK.length && normK.includes(normC)) {
          const merged = [k.rationale, c.rationale].filter(Boolean)
          k.rationale = merged.length > 0 ? merged.join(". ") : k.rationale
          return true
        }
        return false
      })
      if (subsumedBy) continue

      const toReplace = kept.find((k) => {
        const normK = normalizeDesc(k.description)
        return normK.length < normC.length && normC.includes(normK)
      })
      if (toReplace) {
        const idx = kept.indexOf(toReplace)
        kept[idx] = {
          ...c,
          rationale: [toReplace.rationale, c.rationale].filter(Boolean).join(". ") || c.rationale,
        }
      } else {
        kept.push(c)
      }
    }
    result.push(...kept)
  }
  return result
}

function matchesGlob(pattern: string, filePath: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, "[^/]")
  return new RegExp(`^${escaped}$`).test(filePath)
}

interface RawRow {
  id: string
  version: number
  status: string
  anchors_json: string
  title: string
  summary: string
  context: string
  decision: string
  rationale: string
  constraints_json: string
  alternatives_json: string
  consequences: string
  tags_json: string
  decision_type: string
  confidence: string
  author: string
  timestamp: string
  linked_pr: string | null
  linked_issue: string | null
  supersedes_json: string
  superseded_by: string | null
  agent_hints_json: string
  do_not_change_json: string
  review_triggers_json: string
  source_json: string | null
}

function rowToRecord(row: RawRow): OversightRecord {
  return {
    id: row.id,
    version: row.version,
    status: row.status as OversightRecord["status"],
    anchors: JSON.parse(row.anchors_json),
    title: row.title,
    summary: row.summary,
    context: row.context,
    decision: row.decision,
    rationale: row.rationale,
    constraints: JSON.parse(row.constraints_json),
    alternatives: JSON.parse(row.alternatives_json),
    consequences: row.consequences,
    tags: JSON.parse(row.tags_json),
    decisionType: row.decision_type as OversightRecord["decisionType"],
    confidence: row.confidence as OversightRecord["confidence"],
    author: row.author,
    timestamp: row.timestamp,
    linkedPR: row.linked_pr ?? undefined,
    linkedIssue: row.linked_issue ?? undefined,
    supersedes: JSON.parse(row.supersedes_json),
    supersededBy: row.superseded_by ?? undefined,
    agentHints: JSON.parse(row.agent_hints_json),
    doNotChange: JSON.parse(row.do_not_change_json),
    reviewTriggers: JSON.parse(row.review_triggers_json),
    source: row.source_json ? JSON.parse(row.source_json) : undefined,
  }
}


/**
 * Sync the materialized constraints table for a decision.
 * Preserves existing confidence/check_count/override_count on update (additive only).
 * Called after every insert or update.
 */
export function syncConstraintsTable(db: Database, decisionId: string, constraints: Constraint[]): void {
  // Get existing rows to preserve confidence/check stats
  const existing = db.prepare(
    "SELECT id, description, severity, confidence, check_count, override_count, consistency_score, last_checked, precondition, invariant, recovery FROM constraints WHERE decision_id = ?"
  ).all(decisionId) as Array<{
    id: number; description: string; severity: string
    confidence: number; check_count: number; override_count: number
    consistency_score: number; last_checked: number | null
    precondition: string | null; invariant: number; recovery: string | null
  }>
  const existingByDesc = new Map(existing.map(r => [r.description.toLowerCase().trim(), r]))

  // Remove constraints no longer present
  const currentDescriptions = new Set(constraints.map(c => c.description.toLowerCase().trim()))
  for (const row of existing) {
    if (!currentDescriptions.has(row.description.toLowerCase().trim())) {
      db.prepare("DELETE FROM constraints WHERE id = ?").run(row.id)
    }
  }

  // Insert or update
  for (const c of constraints) {
    const key = c.description.toLowerCase().trim()
    const prev = existingByDesc.get(key)
    if (prev) {
      // Update severity/rationale/precondition/invariant/recovery — preserve confidence stats
      db.prepare(`
        UPDATE constraints SET severity = ?, rationale = ?, precondition = ?, invariant = ?, recovery = ?
        WHERE id = ?
      `).run(c.severity, c.rationale, (c as ExtendedConstraint).precondition ?? null,
             (c as ExtendedConstraint).invariant ? 1 : 0,
             (c as ExtendedConstraint).recovery ?? null, prev.id)
    } else {
      db.prepare(`
        INSERT INTO constraints (decision_id, description, severity, rationale, confidence, check_count,
          override_count, consistency_score, last_checked, precondition, invariant, recovery)
        VALUES (?, ?, ?, ?, 0.5, 0, 0, 0.5, NULL, ?, ?, ?)
      `).run(decisionId, c.description, c.severity, c.rationale,
             (c as ExtendedConstraint).precondition ?? null,
             (c as ExtendedConstraint).invariant ? 1 : 0,
             (c as ExtendedConstraint).recovery ?? null)
    }
  }
}

interface ExtendedConstraint extends Constraint {
  precondition?: string
  invariant?: boolean
  recovery?: string
}

export function insertDecision(db: Database, record: OversightRecord): void {
  const constraints = deduplicateConstraints(record.constraints ?? [])
  db.prepare(`
    INSERT INTO decisions (
      id, version, status, anchors_json, title, summary, context, decision, rationale,
      constraints_json, alternatives_json, consequences, tags_json, decision_type,
      confidence, author, timestamp, linked_pr, linked_issue, supersedes_json,
      superseded_by, agent_hints_json, do_not_change_json, review_triggers_json, source_json
    ) VALUES (
      @id, @version, @status, @anchors_json, @title, @summary, @context, @decision, @rationale,
      @constraints_json, @alternatives_json, @consequences, @tags_json, @decision_type,
      @confidence, @author, @timestamp, @linked_pr, @linked_issue, @supersedes_json,
      @superseded_by, @agent_hints_json, @do_not_change_json, @review_triggers_json, @source_json
    )
  `).run({
    id: record.id,
    version: record.version,
    status: record.status,
    anchors_json: JSON.stringify(record.anchors),
    title: record.title,
    summary: record.summary,
    context: record.context,
    decision: record.decision,
    rationale: record.rationale,
    constraints_json: JSON.stringify(constraints),
    alternatives_json: JSON.stringify(record.alternatives),
    consequences: record.consequences,
    tags_json: JSON.stringify(record.tags),
    decision_type: record.decisionType,
    confidence: record.confidence,
    author: record.author,
    timestamp: record.timestamp,
    linked_pr: record.linkedPR ?? null,
    linked_issue: record.linkedIssue ?? null,
    supersedes_json: JSON.stringify(record.supersedes ?? []),
    superseded_by: record.supersededBy ?? null,
    agent_hints_json: JSON.stringify(record.agentHints),
    do_not_change_json: JSON.stringify(record.doNotChange),
    review_triggers_json: JSON.stringify(record.reviewTriggers),
    source_json: record.source ? JSON.stringify(record.source) : null,
  })
  syncConstraintsTable(db, record.id, constraints)
}

export function getDecisionById(db: Database, id: string): OversightRecord | null {
  const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as RawRow | undefined
  if (!row) return null
  return rowToRecord(row)
}

export function getDecisionsByPath(db: Database, filePath: string): OversightRecord[] {
  const normalizedPath = filePath.replace(/^\.\//, "").replace(/\\/g, "/")
  const rows = db.prepare("SELECT * FROM decisions").all() as RawRow[]
  return rows
    .map(rowToRecord)
    .filter((record) =>
      record.anchors.some((anchor) => {
        if (anchor.type === "glob") {
          const pattern = anchor.glob ?? anchor.path ?? (anchor as unknown as Record<string, unknown>).file as string | undefined
          if (!pattern) return false
          return matchesGlob(pattern, normalizedPath)
        }
        const rawPath = anchor.path ?? (anchor as unknown as Record<string, unknown>).file as string | undefined
        if (!rawPath) return false
        const anchorPath = rawPath.replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/$/, "")
        return (
          anchorPath === normalizedPath ||
          normalizedPath.startsWith(anchorPath + "/") ||
          anchorPath.startsWith(normalizedPath + "/")
        )
      })
    )
}

export function getDecisionsByTag(db: Database, tag: string): OversightRecord[] {
  const rows = db.prepare("SELECT * FROM decisions").all() as RawRow[]
  return rows.map(rowToRecord).filter((record) => record.tags.includes(tag))
}

export function getAllDecisions(
  db: Database,
  statusFilter?: DecisionStatus
): OversightRecord[] {
  const rows = statusFilter
    ? (db.prepare("SELECT * FROM decisions WHERE status = ?").all(statusFilter) as RawRow[])
    : (db.prepare("SELECT * FROM decisions").all() as RawRow[])
  return rows.map(rowToRecord)
}

export function updateDecision(
  db: Database,
  id: string,
  updates: Partial<OversightRecord>
): OversightRecord | null {
  const existing = getDecisionById(db, id)
  if (!existing) return null

  const merged = { ...existing, ...updates }
  merged.version = existing.version + 1
  merged.timestamp = new Date().toISOString()
  merged.constraints = deduplicateConstraints(merged.constraints ?? [])

  db.prepare(`
    UPDATE decisions SET
      version = @version, status = @status, anchors_json = @anchors_json,
      title = @title, summary = @summary, context = @context, decision = @decision,
      rationale = @rationale, constraints_json = @constraints_json,
      alternatives_json = @alternatives_json, consequences = @consequences,
      tags_json = @tags_json, decision_type = @decision_type, confidence = @confidence,
      author = @author, timestamp = @timestamp, linked_pr = @linked_pr,
      linked_issue = @linked_issue, supersedes_json = @supersedes_json,
      superseded_by = @superseded_by, agent_hints_json = @agent_hints_json,
      do_not_change_json = @do_not_change_json, review_triggers_json = @review_triggers_json,
      source_json = @source_json
    WHERE id = @id
  `).run({
    id: merged.id, version: merged.version, status: merged.status,
    anchors_json: JSON.stringify(merged.anchors), title: merged.title,
    summary: merged.summary, context: merged.context, decision: merged.decision,
    rationale: merged.rationale, constraints_json: JSON.stringify(merged.constraints),
    alternatives_json: JSON.stringify(merged.alternatives), consequences: merged.consequences,
    tags_json: JSON.stringify(merged.tags), decision_type: merged.decisionType,
    confidence: merged.confidence, author: merged.author, timestamp: merged.timestamp,
    linked_pr: merged.linkedPR ?? null, linked_issue: merged.linkedIssue ?? null,
    supersedes_json: JSON.stringify(merged.supersedes ?? []),
    superseded_by: merged.supersededBy ?? null,
    agent_hints_json: JSON.stringify(merged.agentHints),
    do_not_change_json: JSON.stringify(merged.doNotChange),
    review_triggers_json: JSON.stringify(merged.reviewTriggers),
    source_json: merged.source ? JSON.stringify(merged.source) : null,
  })

  syncConstraintsTable(db, merged.id, merged.constraints ?? [])
  return merged
}

export function deleteDecision(db: Database, id: string): boolean {
  db.prepare("DELETE FROM constraints WHERE decision_id = ?").run(id)
  const result = db.prepare("DELETE FROM decisions WHERE id = ?").run(id)
  return result.changes > 0
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  const intersection = new Set([...a].filter((x) => b.has(x)))
  const union = new Set([...a, ...b])
  return intersection.size / union.size
}

export function computeSimilarityScore(
  candidate: OversightRecord,
  incoming: { title: string; summary: string; decision: string; tags?: string[] }
): { score: number; matchReasons: string[] } {
  const matchReasons: string[] = []
  let score = 0

  const titleSim = jaccardSimilarity(tokenize(candidate.title), tokenize(incoming.title))
  if (titleSim > 0.5) {
    matchReasons.push(`Similar title (${Math.round(titleSim * 100)}% token overlap)`)
    score += titleSim * 0.4
  }

  const summarySim = jaccardSimilarity(tokenize(candidate.summary), tokenize(incoming.summary))
  if (summarySim > 0.3) {
    matchReasons.push(`Similar summary (${Math.round(summarySim * 100)}% token overlap)`)
    score += summarySim * 0.3
  }

  const decisionSim = jaccardSimilarity(tokenize(candidate.decision), tokenize(incoming.decision))
  if (decisionSim > 0.3) {
    matchReasons.push(`Similar decision text (${Math.round(decisionSim * 100)}% token overlap)`)
    score += decisionSim * 0.2
  }

  if (incoming.tags && incoming.tags.length > 0 && candidate.tags.length > 0) {
    const sharedTags = candidate.tags.filter((t) => incoming.tags!.includes(t))
    if (sharedTags.length > 0) {
      matchReasons.push(`Shared tags: ${sharedTags.join(", ")}`)
      score += 0.1 * (sharedTags.length / Math.max(candidate.tags.length, incoming.tags.length))
    }
  }

  return { score, matchReasons }
}

export function findSimilarDecisions(
  db: Database,
  incoming: { title: string; summary: string; decision: string; tags?: string[] },
  threshold = 0.35
): SimilarDecision[] {
  const all = getAllDecisions(db, "active")
  const results: SimilarDecision[] = []

  for (const record of all) {
    const { score, matchReasons } = computeSimilarityScore(record, incoming)
    if (score >= threshold) {
      results.push({ record, score, matchReasons })
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5)
}

export function checkForDuplicates(
  db: Database,
  incoming: { title: string; summary: string; decision: string; tags?: string[] }
): DuplicateCheckResult {
  const similar = findSimilarDecisions(db, incoming, 0.35)

  if (similar.length === 0) {
    return { hasDuplicates: false, similar: [], recommendation: "insert" }
  }

  const top = similar[0]

  if (top.score >= 0.75) {
    return {
      hasDuplicates: true,
      similar,
      recommendation: "skip",
      recommendedTargetId: top.record.id,
    }
  }

  if (top.score >= 0.55) {
    return {
      hasDuplicates: true,
      similar,
      recommendation: "merge",
      recommendedTargetId: top.record.id,
    }
  }

  return {
    hasDuplicates: true,
    similar,
    recommendation: "update",
    recommendedTargetId: top.record.id,
  }
}

export function mergeDecisions(
  db: Database,
  targetId: string,
  incomingData: Partial<OversightRecord> & { mergedFromId?: string }
): OversightRecord | null {
  const target = getDecisionById(db, targetId)
  if (!target) return null

  const mergedFromId = incomingData.mergedFromId

  const merged: Partial<OversightRecord> = {
    constraints: deduplicateConstraints(
      mergeUnique(
        target.constraints,
        incomingData.constraints ?? [],
        (a, b) => a.description.toLowerCase() === b.description.toLowerCase()
      )
    ),
    agentHints: mergeUnique(
      target.agentHints,
      incomingData.agentHints ?? [],
      (a, b) => a.instruction.toLowerCase() === b.instruction.toLowerCase()
    ),
    alternatives: mergeUnique(
      target.alternatives,
      incomingData.alternatives ?? [],
      (a, b) => a.description.toLowerCase() === b.description.toLowerCase()
    ),
    tags: [...new Set([...target.tags, ...(incomingData.tags ?? [])])],
    doNotChange: [...new Set([...target.doNotChange, ...(incomingData.doNotChange ?? [])])],
    reviewTriggers: [...new Set([...target.reviewTriggers, ...(incomingData.reviewTriggers ?? [])])],
    anchors: mergeUnique(
      target.anchors,
      incomingData.anchors ?? [],
      (a, b) => a.path === b.path && a.type === b.type && a.identifier === b.identifier
    ),
    supersedes: [
      ...new Set([
        ...(target.supersedes ?? []),
        ...(incomingData.supersedes ?? []),
        ...(mergedFromId ? [mergedFromId] : []),
      ]),
    ],
  }

  if (
    incomingData.rationale &&
    incomingData.rationale.length > (target.rationale?.length ?? 0)
  ) {
    merged.rationale = incomingData.rationale
  }

  if (incomingData.consequences && !target.consequences) {
    merged.consequences = incomingData.consequences
  }

  const confidenceOrder: Record<string, number> = { definitive: 2, provisional: 1, exploratory: 0 }
  if (
    incomingData.confidence &&
    (confidenceOrder[incomingData.confidence] ?? 0) > (confidenceOrder[target.confidence] ?? 0)
  ) {
    merged.confidence = incomingData.confidence
  }

  return updateDecision(db, targetId, merged)
}

function mergeUnique<T>(existing: T[], incoming: T[], isSame: (a: T, b: T) => boolean): T[] {
  const result = [...existing]
  for (const item of incoming) {
    if (!result.some((e) => isSame(e, item))) {
      result.push(item)
    }
  }
  return result
}
