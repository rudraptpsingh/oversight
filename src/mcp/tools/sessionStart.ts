import type { Database } from "../../db/adapter.js"
import { v4 as uuidv4 } from "uuid"
import { insertSession, getActiveSession } from "../../db/sessions.js"
import { getAllDecisions } from "../../db/decisions.js"
import type { OversightSession } from "../../types/index.js"

export const sessionStartTool = {
  name: "oversight_session_start",
  description:
    "Call at the start of every agent session. Loads all active architectural constraints and returns them so you never repeat past mistakes. Also marks any previous session as abandoned if still open.",
  inputSchema: {
    type: "object" as const,
    properties: {
      agentId: { type: "string", description: "Identifier for this agent instance (e.g. 'claude-session-abc')" },
      taskDescription: { type: "string", description: "What you are about to work on" },
    },
    required: ["taskDescription"],
  },
}

export function handleSessionStart(
  db: Database,
  input: { agentId?: string; taskDescription: string }
): {
  sessionId: string
  message: string
  activeConstraints: Array<{ decisionTitle: string; constraints: Array<{ severity: string; description: string }> }>
  doNotChangePatterns: string[]
  totalDecisions: number
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

  const activeConstraints = allDecisions
    .filter((d) => d.constraints.length > 0)
    .map((d) => ({
      decisionTitle: d.title,
      constraints: d.constraints.map((c) => ({ severity: c.severity, description: c.description })),
    }))

  const doNotChangePatterns = allDecisions.flatMap((d) => d.doNotChange)

  return {
    sessionId,
    message: `Session started. Loaded ${allDecisions.length} decision(s) with ${activeConstraints.length} having constraints. Review activeConstraints and doNotChangePatterns before making changes.`,
    activeConstraints,
    doNotChangePatterns: [...new Set(doNotChangePatterns)],
    totalDecisions: allDecisions.length,
  }
}
