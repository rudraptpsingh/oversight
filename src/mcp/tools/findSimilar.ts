import type { Database } from "../../db/adapter.js"
import { checkForDuplicates, findSimilarDecisions } from "../../db/decisions.js"
import type { DuplicateCheckResult, SimilarDecision } from "../../types/index.js"

export const findSimilarTool = {
  name: "oversight_find_similar",
  description:
    "Check if a similar decision already exists before recording a new one. Returns similar decisions with match scores and a recommendation (insert/merge/update/skip). Always call this before oversight_record to avoid duplicates.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Title of the decision you plan to record" },
      summary: { type: "string", description: "One-liner summary of the decision" },
      decision: { type: "string", description: "The decision text" },
      tags: { type: "array", items: { type: "string" }, description: "Tags to help match" },
      threshold: {
        type: "number",
        description: "Similarity threshold 0-1. Default 0.35. Higher = stricter matching.",
      },
    },
    required: ["title", "summary", "decision"],
  },
}

export function handleFindSimilar(
  db: Database,
  input: {
    title: string
    summary: string
    decision: string
    tags?: string[]
    threshold?: number
  }
): DuplicateCheckResult & { topMatches: Array<{ id: string; title: string; score: number; matchReasons: string[] }> } {
  const result = checkForDuplicates(db, {
    title: input.title,
    summary: input.summary,
    decision: input.decision,
    tags: input.tags,
  })

  const similar =
    input.threshold !== undefined && input.threshold !== 0.35
      ? findSimilarDecisions(
          db,
          { title: input.title, summary: input.summary, decision: input.decision, tags: input.tags },
          input.threshold
        )
      : result.similar

  return {
    ...result,
    similar,
    topMatches: similar.map((s: SimilarDecision) => ({
      id: s.record.id,
      title: s.record.title,
      score: Math.round(s.score * 100) / 100,
      matchReasons: s.matchReasons,
    })),
  }
}
