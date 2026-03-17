import fs from "fs"
import path from "path"
import type { Database } from "../../db/adapter.js"
import { v4 as uuidv4 } from "uuid"
import { insertSession, getActiveSession } from "../../db/sessions.js"
import { getAllDecisions } from "../../db/decisions.js"
import { retrieveConstraintsByQuery } from "../../db/retrieval.js"
import { findOversightDir } from "../../utils/config.js"
import type { OversightSession } from "../../types/index.js"

const SESSION_TOP_K = 20

export const sessionStartTool = {
  name: "oversight_session_start",
  description:
    "Call at the start of every agent session. Loads constraints ranked by relevance to your task (BM25). Use topK to limit results and reduce tokens.",
  inputSchema: {
    type: "object" as const,
    properties: {
      agentId: { type: "string", description: "Identifier for this agent instance" },
      taskDescription: { type: "string", description: "What you are about to work on (used for BM25 ranking)" },
      topK: { type: "number", description: "Max constraint groups to return (default 20)" },
    },
    required: ["taskDescription"],
  },
}

interface SessionReportSummary {
  decision_quality_avg: number
  coverage_score: number
  avg_confidence: number
  total_decisions: number
  total_constraints: number
  drift_bound: number | null
  outcome_driven_violations: number
}

function loadReportSummary(): SessionReportSummary | null {
  try {
    const dir = findOversightDir()
    if (!dir) return null
    const reportPath = path.join(dir, "session-report.json")
    if (!fs.existsSync(reportPath)) return null
    const raw = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as { summary?: SessionReportSummary }
    return raw.summary ?? null
  } catch {
    return null
  }
}

export function handleSessionStart(
  db: Database,
  input: { agentId?: string; taskDescription: string; topK?: number }
): {
  sessionId: string
  message: string
  activeConstraints: Array<{ decisionTitle: string; constraints: Array<{ severity: string; description: string }> }>
  doNotChangePatterns: string[]
  totalDecisions: number
  reportSummary: SessionReportSummary | null
} {
  const existing = getActiveSession(db)
  if (existing) {
    try {
      db.prepare("UPDATE sessions SET status = 'abandoned', ended_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        existing.id
      )
    } catch {
      // best effort
    }
  }

  const sessionId = uuidv4()
  const session: OversightSession = {
    id: sessionId,
    agentId: input.agentId ?? "agent",
    taskDescription: input.taskDescription,
    startedAt: new Date().toISOString(),
    status: "active",
    decisionsRecorded: [],
    checksPerformed: 0,
    summary: "",
    handoffNotes: "",
  }
  insertSession(db, session)

  const allDecisions = getAllDecisions(db, "active")
  const topK = input.topK ?? SESSION_TOP_K

  const retrieved = retrieveConstraintsByQuery(db, {
    query: input.taskDescription,
    topK,
  })

  const seenDesc = new Set<string>()
  const activeConstraints = retrieved
    .map((r) => r.record)
    .filter((d) => d.constraints.length > 0)
    .map((d) => ({
      decisionTitle: d.title,
      constraints: d.constraints
        .map((c) => ({ severity: c.severity, description: c.description }))
        .filter((c) => {
          const key = `${c.severity}:${c.description.toLowerCase().trim()}`
          if (seenDesc.has(key)) return false
          seenDesc.add(key)
          return true
        }),
    }))
    .filter((ac) => ac.constraints.length > 0)

  const doNotChangePatterns = [...new Set(retrieved.flatMap((r) => r.record.doNotChange))]
  const reportSummary = loadReportSummary()

  return {
    sessionId,
    message: `Session started. Loaded ${activeConstraints.length} relevant constraint group(s) from ${allDecisions.length} total. Review activeConstraints and doNotChangePatterns before making changes.`,
    activeConstraints,
    doNotChangePatterns,
    totalDecisions: allDecisions.length,
    reportSummary,
  }
}
