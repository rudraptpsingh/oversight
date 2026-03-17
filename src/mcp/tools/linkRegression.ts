import type { Database } from "../../db/adapter.js"
import { searchDecisions } from "../../db/search.js"

export const linkRegressionTool = {
  name: "oversight_link_regression",
  description:
    "Link a CI test failure to an Oversight decision. When decision_id is omitted, uses full-text search to find candidate decisions matching the test name and failure message.",
  inputSchema: {
    type: "object" as const,
    properties: {
      testName: { type: "string", description: "Name of the failing test" },
      commitSha: { type: "string", description: "Git commit SHA where the regression occurred" },
      failureMessage: { type: "string", description: "Test failure message or stack trace excerpt" },
      decisionId: {
        type: "string",
        description: "Explicit decision ID to link to. If omitted, auto-search is used.",
      },
    },
    required: ["testName", "commitSha"],
  },
}

export function handleLinkRegression(
  db: Database,
  input: {
    testName: string
    commitSha: string
    failureMessage?: string
    decisionId?: string
  }
): {
  success: boolean
  regressionId?: number
  decisionId?: string | null
  candidates?: Array<{ id: string; title: string; score?: number }>
  error?: string
} {
  let resolvedDecisionId: string | null = input.decisionId ?? null
  let candidates: Array<{ id: string; title: string; score?: number }> = []

  // Auto-search if no explicit decision_id
  if (!resolvedDecisionId) {
    const query = [input.testName, input.failureMessage].filter(Boolean).join(" ")
    if (query.trim()) {
      const results = searchDecisions(db, { query, limit: 5 })
      candidates = results.map((r) => ({ id: r.id, title: r.title }))
      // Auto-link only if there's a single strong match
      if (candidates.length === 1) {
        resolvedDecisionId = candidates[0].id
      }
    }
  }

  const result = db.prepare(`
    INSERT INTO regression_links (decision_id, commit_sha, test_name, failure_message, resolved, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(resolvedDecisionId, input.commitSha, input.testName, input.failureMessage ?? null, Date.now())

  return {
    success: true,
    regressionId: result.lastInsertRowid as number,
    decisionId: resolvedDecisionId,
    candidates: candidates.length > 0 ? candidates : undefined,
  }
}
