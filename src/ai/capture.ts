import Anthropic from "@anthropic-ai/sdk"
import { v4 as uuidv4 } from "uuid"
import type { OversightRecord, ConversationSource } from "../types/index.js"

// Model selection: must be claude-sonnet-4-5 or newer. Never Haiku — per seed-ai-capture-model.
// Override via OVERSIGHT_AI_MODEL env var if needed.
const AI_MODEL = process.env.OVERSIGHT_AI_MODEL ?? "claude-sonnet-4-5-20251001"
const client = new Anthropic()

const SYSTEM_PROMPT = `You are a software architecture expert helping developers document code decisions.
Given a rough note from a developer, expand it into a complete OversightRecord JSON object.

Return ONLY valid JSON matching this TypeScript interface — no markdown, no preamble, no explanation:

interface OversightRecord {
  id: string                    // Generate a new UUID v4
  version: number               // Always 1 for new records
  status: "active" | "superseded" | "deprecated" | "proposed" | "needs-review"
  anchors: Array<{
    type: "file" | "function" | "class" | "line-range" | "symbol"
    path: string
    identifier?: string
    lineRange?: [number, number]
  }>
  title: string
  summary: string
  context: string
  decision: string
  rationale: string
  constraints: Array<{
    description: string
    severity: "must" | "should" | "avoid"
    rationale: string
  }>
  alternatives: Array<{
    description: string
    rejectionReason: string
    tradeoffs?: string
  }>
  consequences: string
  tags: string[]
  decisionType: "architectural" | "algorithmic" | "security" | "performance" | "compatibility" | "compliance" | "business-logic" | "workaround" | "deferred"
  confidence: "definitive" | "provisional" | "exploratory"
  author: string
  timestamp: string
  agentHints: Array<{
    instruction: string
    scope: "file" | "function" | "pattern"
  }>
  doNotChange: string[]
  reviewTriggers: string[]
}`

export async function expandWithAI(roughNote: string, author: string): Promise<OversightRecord> {
  const attempt = async (userMessage: string): Promise<string> => {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })
    const block = response.content[0]
    if (block.type !== "text") throw new Error("Unexpected response type from AI")
    return block.text
  }

  let raw = await attempt(roughNote)

  let parsed: Partial<OversightRecord>
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON object found in response")
    parsed = JSON.parse(jsonMatch[0]) as Partial<OversightRecord>
  } catch {
    raw = await attempt(
      `The previous response was not valid JSON. Please try again and return ONLY valid JSON.\n\nOriginal note: ${roughNote}`
    )
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("AI returned invalid JSON after retry")
    parsed = JSON.parse(jsonMatch[0]) as Partial<OversightRecord>
  }

  if (!parsed.title || !parsed.summary || !parsed.decision || !parsed.context) {
    throw new Error("AI response missing required fields: title, summary, decision, context")
  }

  return {
    id: uuidv4(),
    version: 1,
    status: parsed.status ?? "active",
    anchors: parsed.anchors ?? [],
    title: parsed.title,
    summary: parsed.summary,
    context: parsed.context,
    decision: parsed.decision,
    rationale: parsed.rationale ?? "",
    constraints: parsed.constraints ?? [],
    alternatives: parsed.alternatives ?? [],
    consequences: parsed.consequences ?? "",
    tags: parsed.tags ?? [],
    decisionType: parsed.decisionType ?? "architectural",
    confidence: parsed.confidence ?? "provisional",
    author,
    timestamp: new Date().toISOString(),
    linkedPR: parsed.linkedPR,
    linkedIssue: parsed.linkedIssue,
    supersedes: parsed.supersedes ?? [],
    supersededBy: parsed.supersededBy,
    agentHints: parsed.agentHints ?? [],
    doNotChange: parsed.doNotChange ?? [],
    reviewTriggers: parsed.reviewTriggers ?? [],
  }
}

export interface ConversationMessage {
  role: "user" | "assistant"
  content: string
}

export interface ExtractedDecision {
  record: Omit<OversightRecord, "id" | "version" | "author" | "timestamp" | "status">
  confidence: number
  extractionReason: string
}

const CONVERSATION_EXTRACT_SYSTEM = `You are an expert at identifying architectural decisions and constraints from conversations between users and AI agents.

Analyze the conversation and extract ALL distinct decisions, constraints, or architectural choices that were expressed or agreed upon.

A decision worth capturing is one where:
- A user states a requirement, constraint, or preference about how code should work
- An AI agent agrees to or implements a particular approach
- There is an explicit or implicit "we will do X" or "we must not do Y" conclusion
- A trade-off is made consciously

Return a JSON array of decisions. For each, use this structure:
{
  "extractionReason": "why this was captured (quote the relevant part of the conversation)",
  "confidence": 0.0-1.0,
  "record": {
    "title": "short decision title",
    "summary": "one-liner",
    "context": "why this came up",
    "decision": "what was decided",
    "rationale": "reasoning provided",
    "constraints": [{"description":"...", "severity":"must|should|avoid", "rationale":"..."}],
    "alternatives": [],
    "consequences": "",
    "tags": [],
    "decisionType": "architectural|algorithmic|security|performance|compatibility|compliance|business-logic|workaround|deferred",
    "confidence": "definitive|provisional|exploratory",
    "anchors": [],
    "agentHints": [],
    "doNotChange": [],
    "reviewTriggers": []
  }
}

Return ONLY valid JSON array. No markdown, no preamble. Return [] if no decisions found.`

export async function extractDecisionsFromConversation(
  messages: ConversationMessage[],
  source: ConversationSource,
  author: string
): Promise<OversightRecord[]> {
  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n\n")

  const attempt = async (userMsg: string): Promise<string> => {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      system: CONVERSATION_EXTRACT_SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    })
    const block = response.content[0]
    if (block.type !== "text") throw new Error("Unexpected response type")
    return block.text
  }

  let raw = await attempt(
    `Extract all architectural decisions from this conversation:\n\n${conversationText}`
  )

  let parsed: ExtractedDecision[]
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return []
    parsed = JSON.parse(match[0]) as ExtractedDecision[]
  } catch {
    raw = await attempt(
      `The previous response was not valid JSON array. Return ONLY a JSON array.\n\nConversation:\n${conversationText}`
    )
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
      parsed = JSON.parse(match[0]) as ExtractedDecision[]
    } catch {
      return []
    }
  }

  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((item) => item.record?.title && item.record?.summary && item.record?.decision && item.record?.context)
    .map((item) => ({
      id: uuidv4(),
      version: 1,
      status: "active" as const,
      anchors: item.record.anchors ?? [],
      title: item.record.title,
      summary: item.record.summary,
      context: item.record.context,
      decision: item.record.decision,
      rationale: item.record.rationale ?? "",
      constraints: item.record.constraints ?? [],
      alternatives: item.record.alternatives ?? [],
      consequences: item.record.consequences ?? "",
      tags: item.record.tags ?? [],
      decisionType: item.record.decisionType ?? "architectural",
      confidence: item.record.confidence ?? "provisional",
      author,
      timestamp: new Date().toISOString(),
      agentHints: item.record.agentHints ?? [],
      doNotChange: item.record.doNotChange ?? [],
      reviewTriggers: item.record.reviewTriggers ?? [],
      source,
    }))
}
