import type { Database } from "../../db/adapter.js"
import { retrieveConstraintsForEdit, recordToSlim } from "../../db/retrieval.js"
import type { RetrievedRecord } from "../../db/retrieval.js"
import type { SlimDecision } from "../../types/index.js"

export const retrieveConstraintsTool = {
  name: "oversight_retrieve_constraints",
  description:
    "Retrieve constraints for an edit using path filter + BM25 ranking. Use slim=true to reduce tokens.",
  inputSchema: {
    type: "object" as const,
    properties: {
      paths: { type: "array", items: { type: "string" }, description: "File path(s) being edited" },
      query: { type: "string", description: "Query for BM25 ranking" },
      topK: { type: "number", description: "Max records (default 10)" },
      slim: { type: "boolean", description: "Return minimal format — reduces tokens" },
      includeSuperseded: { type: "boolean", description: "Include superseded (default false)" },
    },
    required: ["paths"],
  },
}

export function handleRetrieveConstraints(
  db: Database,
  input: { paths: string[]; query?: string; topK?: number; slim?: boolean; includeSuperseded?: boolean }
): RetrievedRecord[] | Array<{ record: SlimDecision; score: number }> {
  const retrieved = retrieveConstraintsForEdit(db, {
    paths: input.paths,
    query: input.query,
    topK: input.topK ?? 10,
    includeSuperseded: input.includeSuperseded ?? false,
  })
  if (input.slim) {
    return retrieved.map((r) => ({ record: recordToSlim(r.record), score: r.score }))
  }
  return retrieved
}
