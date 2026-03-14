export type DecisionStatus = "active" | "superseded" | "deprecated" | "proposed" | "needs-review"
export type DecisionType =
  | "architectural"
  | "algorithmic"
  | "security"
  | "performance"
  | "compatibility"
  | "compliance"
  | "business-logic"
  | "workaround"
  | "deferred"
export type ConstraintSeverity = "must" | "should" | "avoid"
export type Confidence = "definitive" | "provisional" | "exploratory"

export interface CodeAnchor {
  type: "file" | "function" | "class" | "line-range" | "symbol"
  path: string
  identifier?: string
  lineRange?: [number, number]
}

export interface Constraint {
  description: string
  severity: ConstraintSeverity
  rationale: string
}

export interface Alternative {
  description: string
  rejectionReason: string
  tradeoffs?: string
}

export interface AgentHint {
  instruction: string
  scope: "file" | "function" | "pattern"
}

export interface WhyCodeRecord {
  id: string
  version: number
  status: DecisionStatus
  anchors: CodeAnchor[]
  title: string
  summary: string
  context: string
  decision: string
  rationale: string
  constraints: Constraint[]
  alternatives: Alternative[]
  consequences: string
  tags: string[]
  decisionType: DecisionType
  confidence: Confidence
  author: string
  timestamp: string
  linkedPR?: string
  linkedIssue?: string
  supersedes?: string[]
  supersededBy?: string
  agentHints: AgentHint[]
  doNotChange: string[]
  reviewTriggers: string[]
}

export interface WhyCodeConfig {
  version: string
  author: string
  repoRoot: string
  createdAt: string
}

export interface SearchOptions {
  query?: string
  tags?: string[]
  decisionTypes?: DecisionType[]
  status?: DecisionStatus
  limit?: number
}

export interface StalenessResult {
  likelyStale: boolean
  reason: string
  suggestedAction: string
}

export interface CheckChangeResult {
  relevantDecisions: WhyCodeRecord[]
  mustConstraints: Constraint[]
  warnings: string[]
  riskLevel: "low" | "medium" | "high"
}
