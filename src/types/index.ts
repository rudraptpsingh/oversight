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
  | "pattern"
export type ConstraintSeverity = "must" | "should" | "avoid"
export type Confidence = "definitive" | "provisional" | "exploratory"

export interface CodeAnchor {
  type: "file" | "function" | "class" | "line-range" | "symbol" | "glob"
  path: string
  identifier?: string
  lineRange?: [number, number]
  glob?: string
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

export type ConversationOrigin = "user-chat" | "agent-decision" | "pr-discussion" | "incident" | "code-review" | "manual" | "code-comment"

export interface ConversationSource {
  origin: ConversationOrigin
  conversationId?: string
  participants?: string[]
  excerpt?: string
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
  source?: ConversationSource
}

export interface SimilarDecision {
  record: OversightRecord
  score: number
  matchReasons: string[]
}

export interface DuplicateCheckResult {
  hasDuplicates: boolean
  similar: SimilarDecision[]
  recommendation: "insert" | "merge" | "update" | "skip"
  recommendedTargetId?: string
}

export interface OversightConfig {
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
  relevantDecisions: OversightRecord[] | SlimDecision[]
  mustConstraints: Constraint[] | SlimConstraint[]
  warnings: string[]
  riskLevel: "low" | "medium" | "high"
  proceed: boolean
  blocked: boolean
  blockReason?: string
}

export interface OversightSession {
  id: string
  agentId: string
  taskDescription: string
  startedAt: string
  endedAt?: string
  status: "active" | "completed" | "abandoned"
  decisionsRecorded: string[]
  checksPerformed: number
  summary: string
  handoffNotes: string
}

export interface EnforcementConfig {
  mode: "advisory" | "blocking"
  blockOnMustViolation: boolean
  blockOnHighRisk: boolean
}

/** Slim constraint (no rationale) — reduces token usage. */
export interface SlimConstraint {
  severity: string
  description: string
}

/** Slim decision — title, constraints, doNotChange only. Use when slim=true. */
export interface SlimDecision {
  title: string
  constraints: SlimConstraint[]
  doNotChange: string[]
  agentHints?: Array<{ instruction: string }>
}
