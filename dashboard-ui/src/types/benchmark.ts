export type AgentId = "A" | "B"

export interface BenchmarkCase {
  id: string
  title: string
  domain: string
  task: string
  code: string
  decision: string
  violationDescription: string
  checkViolation: (output: string) => boolean
}

export type CaseStatus = "idle" | "running" | "done" | "error"

export interface AgentResult {
  output: string
  violated: boolean
}

export interface CaseResult {
  status: CaseStatus
  agentA?: AgentResult
  agentB?: AgentResult
  error?: string
}

export type CaseStates = Record<string, CaseResult>
