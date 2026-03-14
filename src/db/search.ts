import Database from "better-sqlite3"
import type { WhyCodeRecord, SearchOptions } from "../types/index.js"
import { getAllDecisions } from "./decisions.js"

interface FtsRow {
  decision_id: string
  rank: number
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

export function searchDecisions(db: Database.Database, options: SearchOptions): WhyCodeRecord[] {
  const limit = options.limit ?? 10
  let candidates: WhyCodeRecord[]

  if (options.query) {
    const ftsRows = db
      .prepare(
        `SELECT decision_id, rank FROM decisions_fts WHERE decisions_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(options.query, limit * 3) as FtsRow[]

    const ids = ftsRows.map((r) => r.decision_id)
    if (ids.length === 0) {
      candidates = []
    } else {
      const placeholders = ids.map(() => "?").join(",")
      const rows = db
        .prepare(`SELECT * FROM decisions WHERE id IN (${placeholders})`)
        .all(...ids) as RawRow[]

      const idOrder = new Map(ids.map((id, i) => [id, i]))
      candidates = rows
        .map(rowToRecord)
        .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0))
    }
  } else {
    candidates = getAllDecisions(db)
  }

  if (options.status) {
    candidates = candidates.filter((r) => r.status === options.status)
  }

  if (options.tags && options.tags.length > 0) {
    candidates = candidates.filter((r) => options.tags!.some((tag) => r.tags.includes(tag)))
  }

  if (options.decisionTypes && options.decisionTypes.length > 0) {
    candidates = candidates.filter((r) => options.decisionTypes!.includes(r.decisionType))
  }

  const seen = new Set<string>()
  const deduped: WhyCodeRecord[] = []
  for (const r of candidates) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      deduped.push(r)
    }
  }

  return deduped.slice(0, limit)
}
