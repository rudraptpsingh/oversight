import type { Database } from "../../db/adapter.js"
import { getSessionById, updateSession } from "../../db/sessions.js"
import type { OversightSession } from "../../types/index.js"

export const sessionEndTool = {
  name: "oversight_session_end",
  description:
    "Call at the end of a session to record what was done and any notes for the next agent. This creates a handoff record so future agents know what changed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sessionId: { type: "string", description: "The session ID returned by oversight_session_start" },
      summary: { type: "string", description: "Brief summary of what was accomplished" },
      handoffNotes: {
        type: "string",
        description: "Notes for the next agent: what is in progress, what to watch out for, open questions",
      },
      status: {
        type: "string",
        enum: ["completed", "abandoned"],
        description: "completed if work is done, abandoned if interrupted",
      },
    },
    required: ["sessionId", "summary"],
  },
}

export function handleSessionEnd(
  db: Database,
  input: { sessionId: string; summary: string; handoffNotes?: string; status?: string }
): { success: boolean; session: OversightSession | null; message: string } {
  const session = getSessionById(db, input.sessionId)
  if (!session) {
    return { success: false, session: null, message: `Session ${input.sessionId} not found` }
  }

  const updated = updateSession(db, input.sessionId, {
    status: (input.status as OversightSession["status"]) ?? "completed",
    endedAt: new Date().toISOString(),
    summary: input.summary,
    handoffNotes: input.handoffNotes ?? "",
  })

  return {
    success: true,
    session: updated,
    message: `Session ended. Recorded ${updated?.decisionsRecorded.length ?? 0} decisions and ${updated?.checksPerformed ?? 0} checks.`,
  }
}
