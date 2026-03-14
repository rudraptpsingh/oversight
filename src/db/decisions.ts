import Database from "better-sqlite3"
import type { WhyCodeRecord, DecisionStatus } from "../types/index.js"

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
}

function rowToRecord(row: RawRow): WhyCodeRecord {
  return {
    id: row.id,
    version: row.version,
    status: row.status as WhyCodeRecord["status"],
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
    decisionType: row.decision_type as WhyCodeRecord["decisionType"],
    confidence: row.confidence as WhyCodeRecord["confidence"],
    author: row.author,
    timestamp: row.timestamp,
    linkedPR: row.linked_pr ?? undefined,
    linkedIssue: row.linked_issue ?? undefined,
    supersedes: JSON.parse(row.supersedes_json),
    supersededBy: row.superseded_by ?? undefined,
    agentHints: JSON.parse(row.agent_hints_json),
    doNotChange: JSON.parse(row.do_not_change_json),
    reviewTriggers: JSON.parse(row.review_triggers_json),
  }
}

function insertFts(db: Database.Database, record: WhyCodeRecord): void {
  db.prepare(`
    INSERT INTO decisions_fts(decision_id, title, summary, context, decision_text, rationale, tags_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.title,
    record.summary,
    record.context,
    record.decision,
    record.rationale,
    record.tags.join(" ")
  )
}

function deleteFts(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM decisions_fts WHERE decision_id = ?").run(id)
}

export function insertDecision(db: Database.Database, record: WhyCodeRecord): void {
  db.prepare(`
    INSERT INTO decisions (
      id, version, status, anchors_json, title, summary, context, decision, rationale,
      constraints_json, alternatives_json, consequences, tags_json, decision_type,
      confidence, author, timestamp, linked_pr, linked_issue, supersedes_json,
      superseded_by, agent_hints_json, do_not_change_json, review_triggers_json
    ) VALUES (
      @id, @version, @status, @anchors_json, @title, @summary, @context, @decision, @rationale,
      @constraints_json, @alternatives_json, @consequences, @tags_json, @decision_type,
      @confidence, @author, @timestamp, @linked_pr, @linked_issue, @supersedes_json,
      @superseded_by, @agent_hints_json, @do_not_change_json, @review_triggers_json
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
    constraints_json: JSON.stringify(record.constraints),
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
  })

  insertFts(db, record)
}

export function getDecisionById(db: Database.Database, id: string): WhyCodeRecord | null {
  const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as RawRow | undefined
  if (!row) return null
  return rowToRecord(row)
}

export function getDecisionsByPath(db: Database.Database, filePath: string): WhyCodeRecord[] {
  const normalizedPath = filePath.replace(/^\.\//, "").replace(/\\/g, "/")
  const rows = db.prepare("SELECT * FROM decisions").all() as RawRow[]
  return rows
    .map(rowToRecord)
    .filter((record) =>
      record.anchors.some((anchor) => {
        const anchorPath = anchor.path.replace(/^\.\//, "").replace(/\\/g, "/")
        return (
          anchorPath === normalizedPath ||
          normalizedPath.startsWith(anchorPath + "/") ||
          anchorPath.startsWith(normalizedPath + "/")
        )
      })
    )
}

export function getDecisionsByTag(db: Database.Database, tag: string): WhyCodeRecord[] {
  const rows = db.prepare("SELECT * FROM decisions").all() as RawRow[]
  return rows.map(rowToRecord).filter((record) => record.tags.includes(tag))
}

export function getAllDecisions(
  db: Database.Database,
  statusFilter?: DecisionStatus
): WhyCodeRecord[] {
  const rows = statusFilter
    ? (db.prepare("SELECT * FROM decisions WHERE status = ?").all(statusFilter) as RawRow[])
    : (db.prepare("SELECT * FROM decisions").all() as RawRow[])
  return rows.map(rowToRecord)
}

export function updateDecision(
  db: Database.Database,
  id: string,
  updates: Partial<WhyCodeRecord>
): WhyCodeRecord | null {
  const existing = getDecisionById(db, id)
  if (!existing) return null

  const merged = { ...existing, ...updates }
  merged.version = existing.version + 1
  merged.timestamp = new Date().toISOString()

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
      do_not_change_json = @do_not_change_json, review_triggers_json = @review_triggers_json
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
  })

  deleteFts(db, id)
  insertFts(db, merged)

  return merged
}

export function deleteDecision(db: Database.Database, id: string): boolean {
  deleteFts(db, id)
  const result = db.prepare("DELETE FROM decisions WHERE id = ?").run(id)
  return result.changes > 0
}
