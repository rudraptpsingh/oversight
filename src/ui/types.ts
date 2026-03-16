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

export interface OversightRecord {
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

export interface OversightMetrics {
  decisions: {
    total: number
    active: number
    superseded: number
    deprecated: number
    needsReview: number
    byType: Partial<Record<DecisionType, number>>
    byConfidence: Partial<Record<Confidence, number>>
    withConstraints: number
    withAgentHints: number
    withDoNotChange: number
    mustConstraintTotal: number
    shouldConstraintTotal: number
    alternativesDocumented: number
    anchorsTotal: number
    uniqueFilesProtected: number
  }
  checkChange: {
    totalChecks: number
    highRiskBlocked: number
    mediumRiskFlagged: number
    lowRiskCleared: number
    totalWarningsIssued: number
    totalMustConstraintHits: number
    uniqueFilesChecked: number
  }
  coverage: {
    decisionsPerProtectedFile: number
    constraintDensity: number
    agentHintDensity: number
  }
}
