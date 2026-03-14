import Anthropic from "@anthropic-ai/sdk"
import { v4 as uuidv4 } from "uuid"
import type { WhyCodeRecord } from "../types/index.js"

const client = new Anthropic()

const SYSTEM_PROMPT = `You are a software architecture expert helping developers document code decisions.
Given a rough note from a developer, expand it into a complete WhyCodeRecord JSON object.

Return ONLY valid JSON matching this TypeScript interface — no markdown, no preamble, no explanation:

interface WhyCodeRecord {
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

export async function expandWithAI(roughNote: string, author: string): Promise<WhyCodeRecord> {
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

  let parsed: Partial<WhyCodeRecord>
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON object found in response")
    parsed = JSON.parse(jsonMatch[0]) as Partial<WhyCodeRecord>
  } catch {
    raw = await attempt(
      `The previous response was not valid JSON. Please try again and return ONLY valid JSON.\n\nOriginal note: ${roughNote}`
    )
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("AI returned invalid JSON after retry")
    parsed = JSON.parse(jsonMatch[0]) as Partial<WhyCodeRecord>
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
