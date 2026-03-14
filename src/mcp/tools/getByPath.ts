import Database from "better-sqlite3"
import { getDecisionsByPath } from "../../db/decisions.js"
import type { WhyCodeRecord } from "../../types/index.js"

export const getByPathTool = {
  name: "whycode_get_by_path",
  description:
    "Retrieve all WhyCode decision records anchored to a file path. Call this BEFORE modifying any file to understand intentional decisions.",
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
  db: Database.Database,
  input: { path: string; includeSuperseded?: boolean }
): WhyCodeRecord[] {
  const records = getDecisionsByPath(db, input.path)
  if (!input.includeSuperseded) {
    return records.filter((r) => r.status === "active" || r.status === "proposed")
  }
  return records
}
