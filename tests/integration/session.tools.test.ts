import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision } from "../../src/db/decisions.js"
import { getSessionById, getAllSessions } from "../../src/db/sessions.js"
import { handleSessionStart } from "../../src/mcp/tools/sessionStart.js"
import { handleSessionEnd } from "../../src/mcp/tools/sessionEnd.js"
import type { OversightRecord } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oversight-session-test-"))
}

function makeRecord(overrides: Partial<OversightRecord> = {}): OversightRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [{ type: "file", path: "src/api.ts" }],
    title: "API rate limiting", summary: "Use token bucket",
    context: "High traffic API", decision: "Token bucket algorithm", rationale: "Proven approach",
    constraints: [{ description: "Never skip rate limiting", severity: "must", rationale: "Security" }],
    alternatives: [], consequences: "Predictable throughput",
    tags: ["api", "rate-limiting"],
    decisionType: "performance", confidence: "definitive", author: "test",
    timestamp: new Date().toISOString(),
    agentHints: [], doNotChange: ["src/rate-limiter.ts"], reviewTriggers: [],
    ...overrides,
  }
}

describe("oversight_session_start", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("creates a new session and returns a sessionId", () => {
    const db = initDb(tmpdir)
    const result = handleSessionStart(db, { taskDescription: "Refactor payment service" })
    expect(result.sessionId).toBeDefined()
    expect(typeof result.sessionId).toBe("string")
    expect(result.message).toContain("Session started")
  })

  it("returns empty constraints when no decisions exist", () => {
    const db = initDb(tmpdir)
    const result = handleSessionStart(db, { taskDescription: "Greenfield work" })
    expect(result.activeConstraints).toEqual([])
    expect(result.doNotChangePatterns).toEqual([])
    expect(result.totalDecisions).toBe(0)
  })

  it("loads active constraints from existing decisions", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord())
    const result = handleSessionStart(db, { taskDescription: "Add new endpoint" })
    expect(result.totalDecisions).toBe(1)
    expect(result.activeConstraints).toHaveLength(1)
    expect(result.activeConstraints[0].decisionTitle).toBe("API rate limiting")
    expect(result.activeConstraints[0].constraints[0].severity).toBe("must")
  })

  it("loads doNotChange patterns from decisions", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord())
    const result = handleSessionStart(db, { taskDescription: "Modify auth layer" })
    expect(result.doNotChangePatterns).toContain("src/rate-limiter.ts")
  })

  it("deduplicates doNotChange patterns across decisions", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ id: uuidv4(), doNotChange: ["src/core.ts", "src/rate-limiter.ts"] }))
    insertDecision(db, makeRecord({ id: uuidv4(), doNotChange: ["src/core.ts"] }))
    const result = handleSessionStart(db, { taskDescription: "Audit code" })
    const coreCount = result.doNotChangePatterns.filter((p) => p === "src/core.ts").length
    expect(coreCount).toBe(1)
  })

  it("abandons a pre-existing active session when starting a new one", () => {
    const db = initDb(tmpdir)
    const first = handleSessionStart(db, { taskDescription: "First task" })
    handleSessionStart(db, { taskDescription: "Second task" })
    const firstSession = getSessionById(db, first.sessionId)
    expect(firstSession?.status).toBe("abandoned")
  })

  it("persists the session to the database", () => {
    const db = initDb(tmpdir)
    const result = handleSessionStart(db, { agentId: "claude-abc", taskDescription: "Write tests" })
    const session = getSessionById(db, result.sessionId)
    expect(session).not.toBeNull()
    expect(session?.agentId).toBe("claude-abc")
    expect(session?.taskDescription).toBe("Write tests")
    expect(session?.status).toBe("active")
  })

  it("only returns constraints from active decisions (not superseded)", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ status: "superseded" }))
    const result = handleSessionStart(db, { taskDescription: "Check old decisions" })
    expect(result.totalDecisions).toBe(0)
    expect(result.activeConstraints).toHaveLength(0)
  })
})

describe("oversight_session_end", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("marks a session as completed", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Fix bug" })
    const result = handleSessionEnd(db, { sessionId, summary: "Fixed the null pointer bug" })
    expect(result.success).toBe(true)
    expect(result.session?.status).toBe("completed")
  })

  it("persists the summary to the database", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Refactor" })
    handleSessionEnd(db, { sessionId, summary: "Refactored payment module" })
    const session = getSessionById(db, sessionId)
    expect(session?.summary).toBe("Refactored payment module")
  })

  it("persists handoff notes to the database", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Partial work" })
    handleSessionEnd(db, { sessionId, summary: "Got halfway", handoffNotes: "Continue from line 42 in payment.ts" })
    const session = getSessionById(db, sessionId)
    expect(session?.handoffNotes).toBe("Continue from line 42 in payment.ts")
  })

  it("records endedAt timestamp", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Quick task" })
    handleSessionEnd(db, { sessionId, summary: "Done" })
    const session = getSessionById(db, sessionId)
    expect(session?.endedAt).toBeDefined()
    expect(typeof session?.endedAt).toBe("string")
  })

  it("can mark a session as abandoned", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Long task" })
    const result = handleSessionEnd(db, { sessionId, summary: "Interrupted", status: "abandoned" })
    expect(result.session?.status).toBe("abandoned")
  })

  it("returns failure when session id is not found", () => {
    const db = initDb(tmpdir)
    const result = handleSessionEnd(db, { sessionId: "nonexistent-id", summary: "Done" })
    expect(result.success).toBe(false)
    expect(result.session).toBeNull()
    expect(result.message).toContain("not found")
  })

  it("message includes decisions recorded count", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Record decisions" })
    const result = handleSessionEnd(db, { sessionId, summary: "Done" })
    expect(result.message).toContain("0 decisions")
  })
})
