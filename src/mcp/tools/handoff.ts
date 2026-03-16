import type { Database } from "../../db/adapter.js"
import { getSessionById, getAllSessions } from "../../db/sessions.js"
import { getAllDecisions } from "../../db/decisions.js"
import type { OversightSession } from "../../types/index.js"

export const generateHandoffTool = {
  name: "oversight_generate_handoff",
  description:
    "Generate a handoff manifest that the next agent session can consume. Includes open constraints, session history, and any handoff notes from the previous session.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sessionId: { type: "string", description: "The current session ID to include in the handoff" },
      nextTaskHint: { type: "string", description: "Optional description of what the next agent should work on" },
    },
    required: [],
  },
}

export function handleGenerateHandoff(
  db: Database,
  input: { sessionId?: string; nextTaskHint?: string }
): {
  manifest: {
    generatedAt: string
    nextTaskHint?: string
    lastSession?: Pick<OversightSession, "id" | "taskDescription" | "summary" | "handoffNotes" | "endedAt">
    openConstraints: Array<{ decisionTitle: string; id: string; constraints: Array<{ severity: string; description: string }> }>
    doNotChangePatterns: string[]
    recentSessions: Array<Pick<OversightSession, "id" | "taskDescription" | "status" | "startedAt" | "endedAt" | "summary">>
    totalDecisions: number
  }
} {
  const allDecisions = getAllDecisions(db, "active")
  const sessions = getAllSessions(db)

  let lastSession: OversightSession | null = null
  if (input.sessionId) {
    lastSession = getSessionById(db, input.sessionId)
  } else if (sessions.length > 0) {
    lastSession = sessions[0]
  }

  const openConstraints = allDecisions
    .filter((d) => d.constraints.length > 0)
    .map((d) => ({
      id: d.id,
      decisionTitle: d.title,
      constraints: d.constraints.map((c) => ({ severity: c.severity, description: c.description })),
    }))

  const doNotChangePatterns = [...new Set(allDecisions.flatMap((d) => d.doNotChange))]

  const recentSessions = sessions.slice(0, 5).map((s) => ({
    id: s.id,
    taskDescription: s.taskDescription,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    summary: s.summary,
  }))

  const manifest = {
    generatedAt: new Date().toISOString(),
    nextTaskHint: input.nextTaskHint,
    lastSession: lastSession
      ? {
          id: lastSession.id,
          taskDescription: lastSession.taskDescription,
          summary: lastSession.summary,
          handoffNotes: lastSession.handoffNotes,
          endedAt: lastSession.endedAt,
        }
      : undefined,
    openConstraints,
    doNotChangePatterns,
    recentSessions,
    totalDecisions: allDecisions.length,
  }

  return { manifest }
}

export const receiveHandoffTool = {
  name: "oversight_receive_handoff",
  description:
    "At the start of a new session, call this to load the handoff manifest from the previous session. Returns everything the previous agent left behind plus all current constraints.",
  inputSchema: {
    type: "object" as const,
    properties: {
      agentId: { type: "string", description: "Identifier for this new agent instance" },
      taskDescription: { type: "string", description: "What this new session will work on" },
    },
    required: ["taskDescription"],
  },
}

export function handleReceiveHandoff(
  db: Database,
  input: { agentId?: string; taskDescription: string }
): {
  newSessionId?: string
  previousHandoffNotes: string
  openConstraints: Array<{ decisionTitle: string; constraints: Array<{ severity: string; description: string }> }>
  doNotChangePatterns: string[]
  message: string
} {
  const sessions = getAllSessions(db)
  const lastCompleted = sessions.find((s) => s.status === "completed" || s.status === "abandoned")

  const allDecisions = getAllDecisions(db, "active")

  const openConstraints = allDecisions
    .filter((d) => d.constraints.length > 0)
    .map((d) => ({
      decisionTitle: d.title,
      constraints: d.constraints.map((c) => ({ severity: c.severity, description: c.description })),
    }))

  const doNotChangePatterns = [...new Set(allDecisions.flatMap((d) => d.doNotChange))]

  const previousHandoffNotes = lastCompleted?.handoffNotes ?? ""
  const prevSummary = lastCompleted?.summary ?? ""

  const messageParts = [
    `Loaded ${allDecisions.length} decision(s) with ${openConstraints.length} having constraints.`,
  ]
  if (prevSummary) messageParts.push(`Previous session: ${prevSummary}`)
  if (previousHandoffNotes) messageParts.push(`Handoff notes: ${previousHandoffNotes}`)

  return {
    previousHandoffNotes,
    openConstraints,
    doNotChangePatterns,
    message: messageParts.join(" | "),
  }
}
