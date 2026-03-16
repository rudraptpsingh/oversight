import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision } from "../../src/db/decisions.js"
import { handleSessionStart } from "../../src/mcp/tools/sessionStart.js"
import { handleSessionEnd } from "../../src/mcp/tools/sessionEnd.js"
import { handleGenerateHandoff } from "../../src/mcp/tools/handoff.js"
import { handleReceiveHandoff } from "../../src/mcp/tools/handoff.js"
import type { OversightRecord } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oversight-handoff-test-"))
}

function makeRecord(overrides: Partial<OversightRecord> = {}): OversightRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [{ type: "file", path: "src/db.ts" }],
    title: "Transaction isolation", summary: "Use serializable isolation",
    context: "Financial data", decision: "SERIALIZABLE isolation level", rationale: "Data integrity",
    constraints: [{ description: "Always use transactions for writes", severity: "must", rationale: "Consistency" }],
    alternatives: [], consequences: "Slower but safe",
    tags: ["database", "transactions"],
    decisionType: "architectural", confidence: "definitive", author: "test",
    timestamp: new Date().toISOString(),
    agentHints: [], doNotChange: ["src/db/connection.ts"], reviewTriggers: [],
    ...overrides,
  }
}

describe("oversight_generate_handoff", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("returns a manifest with generatedAt timestamp", () => {
    const db = initDb(tmpdir)
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.generatedAt).toBeDefined()
    expect(typeof manifest.generatedAt).toBe("string")
  })

  it("includes open constraints from active decisions", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord())
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.openConstraints).toHaveLength(1)
    expect(manifest.openConstraints[0].decisionTitle).toBe("Transaction isolation")
    expect(manifest.openConstraints[0].constraints[0].severity).toBe("must")
  })

  it("includes doNotChange patterns", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord())
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.doNotChangePatterns).toContain("src/db/connection.ts")
  })

  it("deduplicates doNotChange patterns across decisions", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ id: uuidv4(), doNotChange: ["src/core.ts", "src/db/connection.ts"] }))
    insertDecision(db, makeRecord({ id: uuidv4(), doNotChange: ["src/core.ts"] }))
    const { manifest } = handleGenerateHandoff(db, {})
    const count = manifest.doNotChangePatterns.filter((p) => p === "src/core.ts").length
    expect(count).toBe(1)
  })

  it("includes totalDecisions count", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ id: uuidv4() }))
    insertDecision(db, makeRecord({ id: uuidv4() }))
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.totalDecisions).toBe(2)
  })

  it("includes nextTaskHint when provided", () => {
    const db = initDb(tmpdir)
    const { manifest } = handleGenerateHandoff(db, { nextTaskHint: "Optimize query performance" })
    expect(manifest.nextTaskHint).toBe("Optimize query performance")
  })

  it("lastSession is undefined when no sessions exist", () => {
    const db = initDb(tmpdir)
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.lastSession).toBeUndefined()
  })

  it("lastSession uses most recent session when no sessionId provided", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Previous work" })
    handleSessionEnd(db, { sessionId, summary: "Completed migration", handoffNotes: "DB indexes added" })
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.lastSession?.taskDescription).toBe("Previous work")
    expect(manifest.lastSession?.summary).toBe("Completed migration")
    expect(manifest.lastSession?.handoffNotes).toBe("DB indexes added")
  })

  it("lastSession uses provided sessionId over most recent", () => {
    const db = initDb(tmpdir)
    const first = handleSessionStart(db, { taskDescription: "First session" })
    handleSessionEnd(db, { sessionId: first.sessionId, summary: "First done" })
    const second = handleSessionStart(db, { taskDescription: "Second session" })
    handleSessionEnd(db, { sessionId: second.sessionId, summary: "Second done" })
    const { manifest } = handleGenerateHandoff(db, { sessionId: first.sessionId })
    expect(manifest.lastSession?.taskDescription).toBe("First session")
  })

  it("recentSessions lists up to 5 sessions", () => {
    const db = initDb(tmpdir)
    for (let i = 0; i < 7; i++) {
      const { sessionId } = handleSessionStart(db, { taskDescription: `Task ${i}` })
      handleSessionEnd(db, { sessionId, summary: `Done ${i}` })
    }
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.recentSessions.length).toBeLessThanOrEqual(5)
  })

  it("openConstraints includes decision id", () => {
    const db = initDb(tmpdir)
    const record = makeRecord()
    insertDecision(db, record)
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.openConstraints[0].id).toBe(record.id)
  })

  it("excludes superseded decisions from openConstraints", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ status: "superseded" }))
    const { manifest } = handleGenerateHandoff(db, {})
    expect(manifest.openConstraints).toHaveLength(0)
    expect(manifest.totalDecisions).toBe(0)
  })
})

describe("oversight_receive_handoff", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("returns empty previousHandoffNotes when no prior sessions exist", () => {
    const db = initDb(tmpdir)
    const result = handleReceiveHandoff(db, { taskDescription: "New session" })
    expect(result.previousHandoffNotes).toBe("")
  })

  it("returns handoff notes from the last completed session", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Previous" })
    handleSessionEnd(db, { sessionId, summary: "Done", handoffNotes: "Watch out for the cache invalidation bug" })
    const result = handleReceiveHandoff(db, { taskDescription: "Continue work" })
    expect(result.previousHandoffNotes).toBe("Watch out for the cache invalidation bug")
  })

  it("returns handoff notes from abandoned sessions too", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Interrupted" })
    handleSessionEnd(db, { sessionId, summary: "Partial", handoffNotes: "Left off at payment gateway", status: "abandoned" })
    const result = handleReceiveHandoff(db, { taskDescription: "Resume" })
    expect(result.previousHandoffNotes).toBe("Left off at payment gateway")
  })

  it("loads active constraints", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord())
    const result = handleReceiveHandoff(db, { taskDescription: "New agent work" })
    expect(result.openConstraints).toHaveLength(1)
    expect(result.openConstraints[0].decisionTitle).toBe("Transaction isolation")
  })

  it("loads doNotChange patterns", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord())
    const result = handleReceiveHandoff(db, { taskDescription: "New agent work" })
    expect(result.doNotChangePatterns).toContain("src/db/connection.ts")
  })

  it("message includes previous session summary when available", () => {
    const db = initDb(tmpdir)
    const { sessionId } = handleSessionStart(db, { taskDescription: "Before" })
    handleSessionEnd(db, { sessionId, summary: "Migrated users table" })
    const result = handleReceiveHandoff(db, { taskDescription: "After" })
    expect(result.message).toContain("Migrated users table")
  })

  it("message includes decision count", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord())
    const result = handleReceiveHandoff(db, { taskDescription: "Aware agent" })
    expect(result.message).toContain("1 decision(s)")
  })

  it("full pipeline: start → end → receive_handoff preserves notes", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord())

    const session1 = handleSessionStart(db, { agentId: "agent-1", taskDescription: "Phase 1" })
    handleSessionEnd(db, {
      sessionId: session1.sessionId,
      summary: "Added indexes",
      handoffNotes: "Next: add foreign key constraints on orders table",
    })

    const result = handleReceiveHandoff(db, { agentId: "agent-2", taskDescription: "Phase 2" })
    expect(result.previousHandoffNotes).toBe("Next: add foreign key constraints on orders table")
    expect(result.openConstraints).toHaveLength(1)
    expect(result.message).toContain("Added indexes")
  })
})
