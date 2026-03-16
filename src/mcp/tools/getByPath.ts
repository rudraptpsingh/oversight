import type { Database } from "../../db/adapter.js"
import { getDecisionsByPath } from "../../db/decisions.js"
import type { OversightRecord } from "../../types/index.js"

export const getByPathTool = {
  name: "oversight_get_by_path",
  description:
    "Retrieve all Oversight decision records anchored to a file path. Call this BEFORE modifying any file to understand intentional decisions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Relative file path from repo root" },
      includeSuperseded: { type: "boolean", description: "Include superseded decisions (default false)" },
    },
    required: ["path"],
  },
}

export function handleGetByPath(
  db: Database,
  input: { path: string; includeSuperseded?: boolean }
): OversightRecord[] {
  const records = getDecisionsByPath(db, input.path)
  if (!input.includeSuperseded) {
    return records.filter((r) => r.status === "active" || r.status === "proposed")
  }
  return records
}
