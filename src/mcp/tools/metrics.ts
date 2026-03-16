import type { Database } from "../../db/adapter.js"
import { computeMetrics } from "../../db/metrics.js"
import type { OversightMetrics } from "../../db/metrics.js"

export const metricsTool = {
  name: "oversight_get_metrics",
  description:
    "Get impact metrics for the decision knowledge base: total decisions, constraint counts, risk assessments, unique files protected, and coverage statistics. Use this to understand how well the codebase is documented.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
}

export function handleGetMetrics(db: Database): OversightMetrics {
  return computeMetrics(db)
}
