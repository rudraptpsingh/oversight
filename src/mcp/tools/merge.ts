import type { Database } from "../../db/adapter.js"
import { mergeDecisions, getDecisionById } from "../../db/decisions.js"
import type { OversightRecord } from "../../types/index.js"

export const mergeTool = {
  name: "oversight_merge",
  description:
    "Merge a source decision into a target decision. All unique constraints, agent hints, alternatives, tags, anchors, and other fields from the source are absorbed into the target. The source decision is then marked as superseded. Use this to consolidate duplicate or overlapping decisions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      targetId: {
        type: "string",
        description: "ID of the decision to merge INTO (the one that survives)",
      },
      sourceId: {
        type: "string",
        description: "ID of the decision to merge FROM (will be marked superseded)",
      },
    },
    required: ["targetId", "sourceId"],
  },
}

export function handleMerge(
  db: Database,
  input: { targetId: string; sourceId: string }
): { merged: OversightRecord; superseded: OversightRecord } | { error: string } {
  const target = getDecisionById(db, input.targetId)
  if (!target) return { error: `Target decision not found: ${input.targetId}` }

  const source = getDecisionById(db, input.sourceId)
  if (!source) return { error: `Source decision not found: ${input.sourceId}` }

  if (input.targetId === input.sourceId) return { error: "Cannot merge a decision into itself" }

  const merged = mergeDecisions(db, input.targetId, {
    constraints: source.constraints,
    agentHints: source.agentHints,
    alternatives: source.alternatives,
    tags: source.tags,
    doNotChange: source.doNotChange,
    reviewTriggers: source.reviewTriggers,
    anchors: source.anchors,
    rationale: source.rationale,
    confidence: source.confidence,
    consequences: source.consequences,
    mergedFromId: source.id,
  })

  if (!merged) return { error: "Merge failed: could not update target" }

  const superseded = db
    .prepare(`UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE id = ?`)
    .run(input.targetId, input.sourceId)

  if (superseded.changes === 0) return { error: "Could not mark source as superseded" }

  const updatedSource = getDecisionById(db, input.sourceId)

  return {
    merged,
    superseded: updatedSource ?? source,
  }
}
