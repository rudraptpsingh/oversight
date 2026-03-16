import type { Database } from "../../db/adapter.js"
import { retrieveConstraintsForEdit, recordToSlim } from "../../db/retrieval.js"
import type { OversightRecord, SlimDecision } from "../../types/index.js"

export const getByPathTool = {
  name: "oversight_get_by_path",
  description:
    "Retrieve Oversight decisions for file path(s). Call ONCE with all paths you plan to edit (paths: ['a.ts','b.ts']) to avoid extra roundtrips. Use slim=true to reduce token usage.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Single path (legacy)" },
      paths: { type: "array", items: { type: "string" }, description: "Multiple paths — preferred: batch all paths in one call" },
      query: { type: "string", description: "Optional: rank by relevance to this text (edit intent, diff)" },
      topK: { type: "number", description: "Max results (default 10)" },
      slim: { type: "boolean", description: "Return minimal format (title, constraints, doNotChange) — reduces tokens" },
      includeSuperseded: { type: "boolean", description: "Include superseded decisions (default false)" },
    },
    required: [],
  },
}

export function handleGetByPath(
  db: Database,
  input: { path?: string; paths?: string[]; query?: string; topK?: number; slim?: boolean; includeSuperseded?: boolean }
): OversightRecord[] | SlimDecision[] {
  const pathsRaw = input.paths
  const single = input.path != null ? input.path : ""
  const paths: string[] =
    Array.isArray(pathsRaw) && pathsRaw.length > 0 ? pathsRaw : single ? [single] : []

  if (paths.length === 0) return []

  const retrieved = retrieveConstraintsForEdit(db, {
    paths,
    query: input.query,
    topK: input.topK ?? 10,
    includeSuperseded: input.includeSuperseded ?? false,
  })

  const records = retrieved.map((r) => r.record)
  return input.slim ? records.map(recordToSlim) : records
}
