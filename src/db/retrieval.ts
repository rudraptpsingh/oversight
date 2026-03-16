import type { Database } from "./adapter.js"
import { getDecisionsByPath } from "./decisions.js"
import { getAllDecisions } from "./decisions.js"
import type { OversightRecord, SlimDecision, SlimConstraint } from "../types/index.js"

/** Default BM25 k1 (term frequency saturation). */
const BM25_K1 = 1.5
/** Default BM25 b (length normalization). */
const BM25_B = 0.75

/**
 * Tokenize text for BM25: lowercase, split on non-alphanumeric, filter short tokens.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

/**
 * Build searchable text from an OversightRecord for indexing.
 */
function recordToText(record: OversightRecord): string {
  const parts: string[] = [
    record.title,
    record.summary,
    record.decision,
    record.context,
    record.rationale,
    ...record.constraints.map((c) => `${c.description} ${c.rationale}`),
  ]
  return parts.filter(Boolean).join(" ")
}

/**
 * BM25 score for a document given a query.
 * Uses standard BM25 formula: IDF(q) * (f(q,D) * (k1+1)) / (f(q,D) + k1 * (1 - b + b * |D|/avgdl))
 */
function bm25Score(
  docTokens: string[],
  queryTokens: string[],
  docFreq: Map<string, number>,
  N: number,
  avgDocLen: number,
  k1 = BM25_K1,
  b = BM25_B
): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0

  const docLen = docTokens.length
  const termFreq = new Map<string, number>()
  for (const t of docTokens) {
    termFreq.set(t, (termFreq.get(t) ?? 0) + 1)
  }

  let score = 0
  const seen = new Set<string>()
  for (const q of queryTokens) {
    if (seen.has(q)) continue
    seen.add(q)

    const nq = docFreq.get(q) ?? 0
    const idf = Math.log((N - nq + 0.5) / (nq + 0.5) + 1)
    const tf = termFreq.get(q) ?? 0
    const norm = 1 - b + b * (docLen / avgDocLen)
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * norm))
  }
  return score
}

export interface RetrieveOptions {
  /** Paths being edited (required for path filter). */
  paths: string[]
  /** Query text for BM25 ranking (change description, diff, intent). */
  query?: string
  /** Max number of records to return (default 10). */
  topK?: number
  /** Include superseded decisions (default false). */
  includeSuperseded?: boolean
}

export interface RetrievedRecord {
  record: OversightRecord
  score: number
}

/**
 * Retrieve constraints for an edit using path filter + BM25 ranking.
 *
 * Flow:
 * 1. Path filter — get decisions whose anchors match any of the paths
 * 2. BM25 ranking — index constraint text and rank by relevance to query
 * 3. Top-K — return highest-ranked records
 */
export function retrieveConstraintsForEdit(
  db: Database,
  options: RetrieveOptions
): RetrievedRecord[] {
  const { paths, query, topK = 10, includeSuperseded = false } = options

  // Path filter: collect all path-matching decisions
  const seen = new Map<string, OversightRecord>()
  for (const p of paths) {
    const basename = p.split("/").pop() ?? p
    const records = getDecisionsByPath(db, p)
    const extra = basename !== p ? getDecisionsByPath(db, basename) : []
    for (const r of [...records, ...extra]) {
      if (!seen.has(r.id)) {
        seen.set(r.id, r)
      }
    }
  }

  let candidates = Array.from(seen.values())
  if (!includeSuperseded) {
    candidates = candidates.filter(
      (r) => r.status === "active" || r.status === "proposed"
    )
  }

  if (candidates.length === 0) return []

  // If no query, return path-matched records (up to topK), no BM25
  if (!query || query.trim().length === 0) {
    return candidates.slice(0, topK).map((r) => ({ record: r, score: 1 }))
  }

  // BM25: index documents
  const docs = candidates.map((r) => ({
    record: r,
    tokens: tokenize(recordToText(r)),
  }))

  const N = docs.length
  const totalLen = docs.reduce((s, d) => s + d.tokens.length, 0)
  const avgDocLen = N > 0 ? totalLen / N : 0

  // Document frequency: number of docs containing each term
  const docFreq = new Map<string, number>()
  for (const d of docs) {
    const unique = new Set(d.tokens)
    for (const t of unique) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
    }
  }

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) {
    return docs.slice(0, topK).map((d) => ({ record: d.record, score: 1 }))
  }

  const scored = docs.map((d) => ({
    record: d.record,
    score: bm25Score(
      d.tokens,
      queryTokens,
      docFreq,
      N,
      avgDocLen
    ),
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/** Convert record to slim format (title, constraints, doNotChange only). */
export function recordToSlim(record: OversightRecord): SlimDecision {
  return {
    title: record.title,
    constraints: record.constraints.map((c) => ({ severity: c.severity, description: c.description })),
    doNotChange: record.doNotChange ?? [],
    agentHints:
      record.agentHints?.length > 0
        ? record.agentHints.map((h) => ({ instruction: h.instruction }))
        : undefined,
  }
}

/** Deduplicate constraints by description (keep first occurrence per severity+description). */
export function dedupeConstraintsByDescription<T extends { severity: string; description: string }>(
  constraints: T[]
): T[] {
  const seen = new Set<string>()
  return constraints.filter((c) => {
    const key = `${c.severity}:${c.description.toLowerCase().trim()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Retrieve constraints ranked by query (no path filter). Uses BM25 over all active decisions.
 * For session start: returns top-K most relevant constraints to the task.
 */
export function retrieveConstraintsByQuery(
  db: Database,
  options: { query: string; topK?: number }
): RetrievedRecord[] {
  const { query, topK = 20 } = options
  const candidates = getAllDecisions(db, "active").filter(
    (r) => r.constraints.length > 0 || r.doNotChange.length > 0
  )
  if (candidates.length === 0) return []
  if (!query || query.trim().length === 0) {
    return candidates.slice(0, topK).map((r) => ({ record: r, score: 1 }))
  }
  const docs = candidates.map((r) => ({
    record: r,
    tokens: tokenize(recordToText(r)),
  }))
  const N = docs.length
  const totalLen = docs.reduce((s, d) => s + d.tokens.length, 0)
  const avgDocLen = N > 0 ? totalLen / N : 0
  const docFreq = new Map<string, number>()
  for (const d of docs) {
    for (const t of new Set(d.tokens)) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
    }
  }
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) {
    return docs.slice(0, topK).map((d) => ({ record: d.record, score: 1 }))
  }
  const scored = docs.map((d) => ({
    record: d.record,
    score: bm25Score(d.tokens, queryTokens, docFreq, N, avgDocLen),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
