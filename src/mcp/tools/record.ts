import type { Database } from "../../db/adapter.js"
import { v4 as uuidv4 } from "uuid"
import { insertDecision, checkForDuplicates, mergeDecisions } from "../../db/decisions.js"
import { readConfig } from "../../utils/config.js"
import type {
  OversightRecord,
  CodeAnchor,
  Constraint,
  AgentHint,
  DecisionType,
  Confidence,
  ConversationSource,
  ConversationOrigin,
} from "../../types/index.js"

export const recordTool = {
  name: "oversight_record",
  description:
    "Record a decision you (the agent) are making or that a user expressed. Use this when making a non-obvious architectural choice. The tool automatically checks for duplicate or similar existing records and will merge instead of creating a duplicate when appropriate. Returns the recorded or merged decision plus any duplicate warnings.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Decision title" },
      summary: { type: "string", description: "One-liner summary" },
      decision: { type: "string", description: "What was decided" },
      context: { type: "string", description: "Why this decision was needed" },
      rationale: { type: "string", description: "Why this over alternatives" },
      anchors: { type: "array", items: { type: "object" }, description: "Code anchors" },
      constraints: { type: "array", items: { type: "object" }, description: "Constraints" },
      alternatives: { type: "array", items: { type: "object" }, description: "Alternatives considered" },
      agentHints: { type: "array", items: { type: "object" }, description: "Hints for AI agents" },
      tags: { type: "array", items: { type: "string" }, description: "Tags" },
      decisionType: { type: "string", description: "Type of decision" },
      confidence: { type: "string", description: "Confidence level" },
      doNotChange: { type: "array", items: { type: "string" }, description: "Patterns agents must not change" },
      reviewTriggers: { type: "array", items: { type: "string" }, description: "Keywords that trigger review" },
      source: {
        type: "object",
        description: "Origin context: where this decision came from (user-chat, agent-decision, pr-discussion, incident, code-review, manual)",
        properties: {
          origin: { type: "string" },
          conversationId: { type: "string" },
          participants: { type: "array", items: { type: "string" } },
          excerpt: { type: "string" },
        },
      },
      allowDuplicate: {
        type: "boolean",
        description: "Force insert even if similar record exists. Default false.",
      },
    },
    required: ["title", "summary", "decision", "context"],
  },
}

export function handleRecord(
  db: Database,
  input: {
    title: string
    summary: string
    decision: string
    context: string
    rationale?: string
    anchors?: CodeAnchor[]
    constraints?: Constraint[]
    alternatives?: Array<{ description: string; rejectionReason: string; tradeoffs?: string }>
    agentHints?: AgentHint[]
    tags?: string[]
    decisionType?: string
    confidence?: string
    doNotChange?: string[]
    reviewTriggers?: string[]
    source?: { origin?: string; conversationId?: string; participants?: string[]; excerpt?: string }
    allowDuplicate?: boolean
  }
): {
  id: string
  record: OversightRecord
  action: "inserted" | "merged" | "skipped"
  duplicateWarning?: string
  similarDecisions?: Array<{ id: string; title: string; score: number }>
} {
  let author = "agent"
  try {
    const config = readConfig()
    author = config.author
  } catch {
    // no config available
  }

  const dupeCheck = checkForDuplicates(db, {
    title: input.title,
    summary: input.summary,
    decision: input.decision,
    tags: input.tags,
  })

  const similarDecisions = dupeCheck.similar.map((s) => ({
    id: s.record.id,
    title: s.record.title,
    score: Math.round(s.score * 100) / 100,
  }))

  if (!input.allowDuplicate && dupeCheck.recommendation === "skip" && dupeCheck.recommendedTargetId) {
    const existing = dupeCheck.similar[0].record
    return {
      id: existing.id,
      record: existing,
      action: "skipped",
      duplicateWarning: `Near-identical decision already exists (score: ${Math.round(dupeCheck.similar[0].score * 100)}%). Returning existing record. Use allowDuplicate=true to force insert.`,
      similarDecisions,
    }
  }

  if (!input.allowDuplicate && dupeCheck.recommendation === "merge" && dupeCheck.recommendedTargetId) {
    const merged = mergeDecisions(db, dupeCheck.recommendedTargetId, {
      constraints: input.constraints,
      agentHints: input.agentHints,
      alternatives: input.alternatives,
      tags: input.tags,
      doNotChange: input.doNotChange,
      reviewTriggers: input.reviewTriggers,
      anchors: input.anchors,
      rationale: input.rationale,
      confidence: (input.confidence as Confidence) ?? undefined,
    })
    if (merged) {
      return {
        id: merged.id,
        record: merged,
        action: "merged",
        duplicateWarning: `Similar decision found (score: ${Math.round(dupeCheck.similar[0].score * 100)}%). Merged new constraints/hints into existing record instead of creating duplicate.`,
        similarDecisions,
      }
    }
  }

  const source: ConversationSource | undefined = input.source
    ? {
        origin: (input.source.origin as ConversationOrigin) ?? "agent-decision",
        conversationId: input.source.conversationId,
        participants: input.source.participants,
        excerpt: input.source.excerpt,
      }
    : { origin: "agent-decision" }

  const record: OversightRecord = {
    id: uuidv4(),
    version: 1,
    status: "active",
    anchors: input.anchors ?? [],
    title: input.title,
    summary: input.summary,
    context: input.context,
    decision: input.decision,
    rationale: input.rationale ?? "",
    constraints: input.constraints ?? [],
    alternatives: input.alternatives ?? [],
    consequences: "",
    tags: input.tags ?? [],
    decisionType: (input.decisionType as DecisionType) ?? "architectural",
    confidence: (input.confidence as Confidence) ?? "provisional",
    author,
    timestamp: new Date().toISOString(),
    agentHints: input.agentHints ?? [],
    doNotChange: input.doNotChange ?? [],
    reviewTriggers: input.reviewTriggers ?? [],
    source,
  }

  insertDecision(db, record)

  const result: {
    id: string
    record: OversightRecord
    action: "inserted" | "merged" | "skipped"
    duplicateWarning?: string
    similarDecisions?: Array<{ id: string; title: string; score: number }>
  } = { id: record.id, record, action: "inserted" }

  if (dupeCheck.hasDuplicates) {
    result.duplicateWarning = `Note: ${dupeCheck.similar.length} similar decision(s) exist. Consider reviewing for possible consolidation.`
    result.similarDecisions = similarDecisions
  }

  return result
}
