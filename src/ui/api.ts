import type { OversightRecord, OversightMetrics, DecisionStatus, DecisionType } from "./types"

export interface BacklogItem {
  id: string
  type: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  title: string
  evidence: string
  decisionId?: string
  constraintId?: number
  filePath?: string
}

export interface CoverageData {
  coverage_score: number
  coverage_gaps: Array<{ file: string; change_frequency: number; reason: string }>
  total_decisions: number
  avg_confidence: number
  drift_bound: number | null
  outcome_driven_violations: number
}

export interface RegressionRow {
  id: number
  testName: string
  commitSha: string
  decisionId: string | null
  createdAt: number
}

const BASE = "/api"

export async function fetchDecisions(opts?: {
  status?: DecisionStatus
  q?: string
  tags?: string[]
  types?: DecisionType[]
  limit?: number
}): Promise<OversightRecord[]> {
  const params = new URLSearchParams()
  if (opts?.status) params.set("status", opts.status)
  if (opts?.q) params.set("q", opts.q)
  if (opts?.tags?.length) params.set("tags", opts.tags.join(","))
  if (opts?.types?.length) params.set("types", opts.types.join(","))
  if (opts?.limit) params.set("limit", String(opts.limit))
  const qs = params.toString()
  const res = await fetch(`${BASE}/decisions${qs ? "?" + qs : ""}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchDecision(id: string): Promise<OversightRecord> {
  const res = await fetch(`${BASE}/decisions/${id}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function updateDecisionStatus(id: string, status: DecisionStatus): Promise<OversightRecord> {
  const res = await fetch(`${BASE}/decisions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function deleteDecision(id: string): Promise<void> {
  const res = await fetch(`${BASE}/decisions/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function fetchMetrics(): Promise<OversightMetrics> {
  const res = await fetch(`${BASE}/metrics`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function searchDecisions(q: string, limit = 20): Promise<OversightRecord[]> {
  const params = new URLSearchParams({ q, limit: String(limit) })
  const res = await fetch(`${BASE}/search?${params}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchSessionReport(): Promise<unknown> {
  const res = await fetch(`${BASE}/session-report`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchBacklog(): Promise<BacklogItem[]> {
  const res = await fetch(`${BASE}/backlog`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function resolveBacklogItem(id: string): Promise<void> {
  const res = await fetch(`${BASE}/backlog/${encodeURIComponent(id)}/resolve`, { method: "POST" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function fetchCoverage(): Promise<CoverageData> {
  const res = await fetch(`${BASE}/coverage`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchRegressions(): Promise<RegressionRow[]> {
  const res = await fetch(`${BASE}/regressions`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function resolveRegression(id: number): Promise<void> {
  const res = await fetch(`${BASE}/regressions/${id}/resolve`, { method: "POST" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
