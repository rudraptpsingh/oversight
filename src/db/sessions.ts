import type { Database } from "./adapter.js"
import type { OversightSession } from "../types/index.js"

interface RawSessionRow {
  id: string
  agent_id: string
  task_description: string
  started_at: string
  ended_at: string | null
  status: string
  decisions_recorded_json: string
  checks_performed: number
  summary: string
  handoff_notes: string
}

function rowToSession(row: RawSessionRow): OversightSession {
  return {
    id: row.id,
    agentId: row.agent_id,
    taskDescription: row.task_description,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    status: row.status as OversightSession["status"],
    decisionsRecorded: JSON.parse(row.decisions_recorded_json),
    checksPerformed: row.checks_performed,
    summary: row.summary,
    handoffNotes: row.handoff_notes,
  }
}

export function insertSession(db: Database, session: OversightSession): void {
  db.prepare(`
    INSERT INTO sessions (id, agent_id, task_description, started_at, ended_at, status,
      decisions_recorded_json, checks_performed, summary, handoff_notes)
    VALUES (@id, @agent_id, @task_description, @started_at, @ended_at, @status,
      @decisions_recorded_json, @checks_performed, @summary, @handoff_notes)
  `).run({
    id: session.id,
    agent_id: session.agentId,
    task_description: session.taskDescription,
    started_at: session.startedAt,
    ended_at: session.endedAt ?? null,
    status: session.status,
    decisions_recorded_json: JSON.stringify(session.decisionsRecorded),
    checks_performed: session.checksPerformed,
    summary: session.summary,
    handoff_notes: session.handoffNotes,
  })
}

export function getSessionById(db: Database, id: string): OversightSession | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as RawSessionRow | undefined
  if (!row) return null
  return rowToSession(row)
}

export function updateSession(
  db: Database,
  id: string,
  updates: Partial<OversightSession>
): OversightSession | null {
  const existing = getSessionById(db, id)
  if (!existing) return null
  const merged = { ...existing, ...updates }
  db.prepare(`
    UPDATE sessions SET
      agent_id = @agent_id, task_description = @task_description, started_at = @started_at,
      ended_at = @ended_at, status = @status, decisions_recorded_json = @decisions_recorded_json,
      checks_performed = @checks_performed, summary = @summary, handoff_notes = @handoff_notes
    WHERE id = @id
  `).run({
    id: merged.id,
    agent_id: merged.agentId,
    task_description: merged.taskDescription,
    started_at: merged.startedAt,
    ended_at: merged.endedAt ?? null,
    status: merged.status,
    decisions_recorded_json: JSON.stringify(merged.decisionsRecorded),
    checks_performed: merged.checksPerformed,
    summary: merged.summary,
    handoff_notes: merged.handoffNotes,
  })
  return merged
}

export function getActiveSession(db: Database): OversightSession | null {
  const row = db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get() as RawSessionRow | undefined
  if (!row) return null
  return rowToSession(row)
}

export function getAllSessions(db: Database): OversightSession[] {
  const rows = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC").all() as RawSessionRow[]
  return rows.map(rowToSession)
}
