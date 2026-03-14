import Database from "better-sqlite3"
import { v4 as uuidv4 } from "uuid"
import { insertDecision } from "../../db/decisions.js"
import { readConfig } from "../../utils/config.js"
import type { WhyCodeRecord, CodeAnchor, Constraint, AgentHint, DecisionType, Confidence } from "../../types/index.js"

export const recordTool = {
  name: "whycode_record",
  description:
    "Record a decision you (the agent) are making. Use this when making a non-obvious architectural choice.",
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
      agentHints: { type: "array", items: { type: "object" }, description: "Hints for AI agents" },
      tags: { type: "array", items: { type: "string" }, description: "Tags" },
      decisionType: { type: "string", description: "Type of decision" },
      confidence: { type: "string", description: "Confidence level" },
    },
    required: ["title", "summary", "decision", "context"],
  },
}

export function handleRecord(
  db: Database.Database,
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
  }
): { id: string; record: WhyCodeRecord } {
  let author = "agent"
  try {
    const config = readConfig()
    author = config.author
  } catch {
    // no config available
  }

  const record: WhyCodeRecord = {
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
  }

  insertDecision(db, record)
  return { id: record.id, record }
}
