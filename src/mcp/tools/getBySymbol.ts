import type { Database } from "../../db/adapter.js"
import { getAllDecisions } from "../../db/decisions.js"
import type { OversightRecord } from "../../types/index.js"

export const getBySymbolTool = {
  name: "oversight_get_by_symbol",
  description:
    "Retrieve decisions for a specific function, class, or symbol. Use when refactoring or renaming a named code element.",
  inputSchema: {
    type: "object" as const,
    properties: {
      symbol: { type: "string", description: "Function or class name to search for" },
      path: { type: "string", description: "Optional: narrow search to a specific file" },
    },
    required: ["symbol"],
  },
}

export function handleGetBySymbol(
  db: Database,
  input: { symbol: string; path?: string }
): OversightRecord[] {
  const all = getAllDecisions(db)
  const symbolLower = input.symbol.toLowerCase()

  return all.filter((record) =>
    record.anchors.some((anchor) => {
      const identifierMatch = anchor.identifier?.toLowerCase().includes(symbolLower) ?? false
      const pathMatch = input.path
        ? anchor.path.replace(/^\.\//, "") === input.path.replace(/^\.\//, "")
        : true
      return identifierMatch && pathMatch
    })
  )
}
