import type { Database } from "../../db/adapter.js"
import { searchDecisions } from "../../db/search.js"
import type { OversightRecord, DecisionType } from "../../types/index.js"

export const searchTool = {
  name: "oversight_search",
  description:
    "Semantic full-text search over all decision records. Use when you need context about a topic before making changes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Search query text" },
      tags: { type: "array", items: { type: "string" }, description: "Optional tag filters" },
      decisionTypes: { type: "array", items: { type: "string" }, description: "Optional decision type filters" },
      limit: { type: "number", description: "Maximum results to return (default 10)" },
    },
    required: ["query"],
  },
}

export function handleSearch(
  db: Database,
  input: { query: string; tags?: string[]; decisionTypes?: string[]; limit?: number }
): OversightRecord[] {
  return searchDecisions(db, {
    query: input.query,
    tags: input.tags,
    decisionTypes: input.decisionTypes as DecisionType[] | undefined,
    limit: input.limit ?? 10,
  })
}
