import type { Database } from "../../db/adapter.js"
import { extractDecisionsFromConversation, type ConversationMessage } from "../../ai/capture.js"
import { checkForDuplicates, insertDecision, mergeDecisions } from "../../db/decisions.js"
import { readConfig } from "../../utils/config.js"
import type { ConversationSource, ConversationOrigin, OversightRecord } from "../../types/index.js"

export const captureConversationTool = {
  name: "oversight_capture_conversation",
  description:
    "Automatically extract and record all architectural decisions from a conversation transcript. Pass the full conversation (user + agent messages) and the tool will identify decisions, check for duplicates, and record or merge them. Returns a summary of all decisions found and what action was taken for each.",
  inputSchema: {
    type: "object" as const,
    properties: {
      messages: {
        type: "array",
        description: "The conversation messages to analyze",
        items: {
          type: "object",
          properties: {
            role: { type: "string", description: "user or assistant" },
            content: { type: "string", description: "Message content" },
          },
          required: ["role", "content"],
        },
      },
      source: {
        type: "object",
        description: "Where this conversation came from",
        properties: {
          origin: {
            type: "string",
            description: "user-chat | agent-decision | pr-discussion | incident | code-review | manual",
          },
          conversationId: { type: "string", description: "Optional ID linking to the conversation" },
          participants: { type: "array", items: { type: "string" }, description: "People involved" },
        },
        required: ["origin"],
      },
    },
    required: ["messages", "source"],
  },
}

interface CaptureResult {
  total: number
  inserted: number
  merged: number
  skipped: number
  decisions: Array<{
    title: string
    action: "inserted" | "merged" | "skipped"
    id: string
    duplicateWarning?: string
  }>
  errors: string[]
}

export async function handleCaptureConversation(
  db: Database,
  input: {
    messages: Array<{ role: string; content: string }>
    source: { origin: string; conversationId?: string; participants?: string[] }
  }
): Promise<CaptureResult> {
  let author = "agent"
  try {
    const config = readConfig()
    author = config.author
  } catch {
    // no config
  }

  const source: ConversationSource = {
    origin: input.source.origin as ConversationOrigin,
    conversationId: input.source.conversationId,
    participants: input.source.participants,
  }

  const messages: ConversationMessage[] = input.messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }))

  const result: CaptureResult = {
    total: 0,
    inserted: 0,
    merged: 0,
    skipped: 0,
    decisions: [],
    errors: [],
  }

  let extracted: OversightRecord[]
  try {
    extracted = await extractDecisionsFromConversation(messages, source, author)
  } catch (err) {
    result.errors.push(`Extraction failed: ${String(err)}`)
    return result
  }

  result.total = extracted.length

  for (const record of extracted) {
    try {
      const dupeCheck = checkForDuplicates(db, {
        title: record.title,
        summary: record.summary,
        decision: record.decision,
        tags: record.tags,
      })

      if (dupeCheck.recommendation === "skip" && dupeCheck.recommendedTargetId) {
        result.skipped++
        result.decisions.push({
          title: record.title,
          action: "skipped",
          id: dupeCheck.recommendedTargetId,
          duplicateWarning: `Near-identical record exists (score: ${Math.round(dupeCheck.similar[0].score * 100)}%)`,
        })
        continue
      }

      if (dupeCheck.recommendation === "merge" && dupeCheck.recommendedTargetId) {
        const merged = mergeDecisions(db, dupeCheck.recommendedTargetId, {
          constraints: record.constraints,
          agentHints: record.agentHints,
          alternatives: record.alternatives,
          tags: record.tags,
          doNotChange: record.doNotChange,
          reviewTriggers: record.reviewTriggers,
          anchors: record.anchors,
          rationale: record.rationale,
          confidence: record.confidence,
        })
        if (merged) {
          result.merged++
          result.decisions.push({
            title: record.title,
            action: "merged",
            id: merged.id,
            duplicateWarning: `Merged into existing record (score: ${Math.round(dupeCheck.similar[0].score * 100)}%)`,
          })
          continue
        }
      }

      insertDecision(db, record)
      result.inserted++
      result.decisions.push({ title: record.title, action: "inserted", id: record.id })
    } catch (err) {
      result.errors.push(`Failed to save "${record.title}": ${String(err)}`)
    }
  }

  return result
}
