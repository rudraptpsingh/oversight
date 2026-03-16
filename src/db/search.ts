import type { Database } from "./adapter.js"
import type { OversightRecord, SearchOptions } from "../types/index.js"
import { getAllDecisions } from "./decisions.js"

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
  }
}

export function searchDecisions(db: Database, options: SearchOptions): OversightRecord[] {
  const limit = options.limit ?? 10
  let candidates = getAllDecisions(db)

  if (options.query) {
    const q = options.query.toLowerCase()
    candidates = candidates.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.summary.toLowerCase().includes(q) ||
      r.decision.toLowerCase().includes(q) ||
      r.context.toLowerCase().includes(q) ||
      r.rationale.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q))
    )
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
  const deduped: OversightRecord[] = []
  for (const r of candidates) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      deduped.push(r)
    }
  }

  return deduped.slice(0, limit)
}
