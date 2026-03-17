import fs from "fs"
import path from "path"
import { getOversightDir } from "../../utils/config.js"

export const getSessionReportTool = {
  name: "oversight_get_session_report",
  description:
    "Returns the latest self-check session report (.oversight/session-report.json). Contains confidence deltas, coverage gaps, stale decisions, backlog, and drift bound.",
  inputSchema: {
    type: "object" as const,
    properties: {
      summaryOnly: {
        type: "boolean",
        description: "Return only the summary section to reduce tokens (default false)",
      },
    },
    required: [],
  },
}

export function handleGetSessionReport(
  _: unknown,
  input: { summaryOnly?: boolean }
): { found: boolean; report?: unknown; summary?: unknown; error?: string } {
  try {
    const oversightDir = getOversightDir()
    const reportPath = path.join(oversightDir, "session-report.json")

    if (!fs.existsSync(reportPath)) {
      return { found: false, error: "No session report found. Run 'git commit' or 'npx tsx scripts/self-check.ts' to generate one." }
    }

    const raw = fs.readFileSync(reportPath, "utf-8")
    const report = JSON.parse(raw) as Record<string, unknown>

    if (input.summaryOnly) {
      return { found: true, summary: report.summary }
    }

    return { found: true, report }
  } catch (err) {
    return { found: false, error: String(err) }
  }
}
