import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision } from "../../src/db/decisions.js"
import { retrieveConstraintsForEdit, retrieveConstraintsByQuery } from "../../src/db/retrieval.js"
import type { OversightRecord } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oversight-retrieval-test-"))
}

function makeRecord(overrides: Partial<OversightRecord> = {}): OversightRecord {
  return {
    id: uuidv4(),
    version: 1,
    status: "active",
    anchors: [{ type: "file", path: "src/auth.ts" }],
    title: "Auth JWT decision",
    summary: "Use JWT with algorithms for verification",
    context: "Stateless auth",
    decision: "Always use jwt.verify with algorithms specified",
    rationale: "Prevents algorithm confusion attacks",
    constraints: [],
    alternatives: [],
    consequences: "",
    tags: [],
    decisionType: "security",
    confidence: "definitive",
    author: "test",
    timestamp: new Date().toISOString(),
    agentHints: [],
    doNotChange: [],
    reviewTriggers: [],
    ...overrides,
  }
}

describe("retrieveConstraintsForEdit", () => {
  let tmpdir: string

  beforeEach(() => {
    tmpdir = tmpDir()
  })
  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true })
  })

  it("returns path-matched decisions", async () => {
    const db = await initDb(tmpdir)
    insertDecision(db, makeRecord({ anchors: [{ type: "file", path: "src/auth.ts" }] }))
    const result = retrieveConstraintsForEdit(db, { paths: ["src/auth.ts"], topK: 10 })
    expect(result).toHaveLength(1)
    expect(result[0].record.title).toBe("Auth JWT decision")
  })

  it("returns empty when no path matches", async () => {
    const db = await initDb(tmpdir)
    insertDecision(db, makeRecord({ anchors: [{ type: "file", path: "src/auth.ts" }] }))
    const result = retrieveConstraintsForEdit(db, { paths: ["src/unrelated.ts"], topK: 10 })
    expect(result).toHaveLength(0)
  })

  it("BM25 ranks by query relevance", async () => {
    const db = await initDb(tmpdir)
    insertDecision(
      db,
      makeRecord({
        id: "r1",
        anchors: [{ type: "file", path: "src/auth.ts" }],
        title: "JWT verification",
        decision: "Use jwt.verify with algorithms",
      })
    )
    insertDecision(
      db,
      makeRecord({
        id: "r2",
        anchors: [{ type: "file", path: "src/auth.ts" }],
        title: "Password hashing",
        decision: "Use bcrypt for password storage",
      })
    )
    const result = retrieveConstraintsForEdit(db, {
      paths: ["src/auth.ts"],
      query: "jwt verify algorithms",
      topK: 10,
    })
    expect(result).toHaveLength(2)
    expect(result[0].record.id).toBe("r1")
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score)
  })

  it("respects topK limit", async () => {
    const db = await initDb(tmpdir)
    for (let i = 0; i < 5; i++) {
      insertDecision(
        db,
        makeRecord({
          anchors: [{ type: "file", path: "src/auth.ts" }],
          title: `Decision ${i}`,
        })
      )
    }
    const result = retrieveConstraintsForEdit(db, {
      paths: ["src/auth.ts"],
      topK: 2,
    })
    expect(result).toHaveLength(2)
  })

  it("excludes superseded by default", async () => {
    const db = await initDb(tmpdir)
    insertDecision(db, makeRecord({ id: "active", status: "active" }))
    insertDecision(db, makeRecord({ id: "superseded", status: "superseded" }))
    const result = retrieveConstraintsForEdit(db, {
      paths: ["src/auth.ts"],
      includeSuperseded: false,
      topK: 10,
    })
    expect(result.map((r) => r.record.id)).toContain("active")
    expect(result.map((r) => r.record.id)).not.toContain("superseded")
  })

  it("includes superseded when flag set", async () => {
    const db = await initDb(tmpdir)
    insertDecision(db, makeRecord({ id: "active", status: "active" }))
    insertDecision(db, makeRecord({ id: "superseded", status: "superseded" }))
    const result = retrieveConstraintsForEdit(db, {
      paths: ["src/auth.ts"],
      includeSuperseded: true,
      topK: 10,
    })
    expect(result).toHaveLength(2)
  })

  it("retrieveConstraintsByQuery ranks by query (no path filter)", async () => {
    const db = await initDb(tmpdir)
    insertDecision(
      db,
      makeRecord({ id: "a", title: "JWT auth", decision: "Use jwt.verify", constraints: [{ description: "Must verify", severity: "must", rationale: "" }] })
    )
    insertDecision(
      db,
      makeRecord({ id: "b", title: "Redis cache", decision: "Use Redis", constraints: [{ description: "Must connect", severity: "must", rationale: "" }] })
    )
    const result = retrieveConstraintsByQuery(db, { query: "jwt verify auth", topK: 5 })
    expect(result).toHaveLength(2)
    expect(result[0].record.title).toBe("JWT auth")
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score)
  })

  it("recordToSlim returns minimal format", async () => {
    const db = await initDb(tmpdir)
    const { recordToSlim } = await import("../../src/db/retrieval.js")
    const record = makeRecord({
      title: "Test",
      constraints: [{ description: "Must X", severity: "must", rationale: "Reason" }],
      doNotChange: ["pattern"],
    })
    const slim = recordToSlim(record)
    expect(slim.title).toBe("Test")
    expect(slim.constraints).toHaveLength(1)
    expect(slim.constraints[0]).toEqual({ severity: "must", description: "Must X" })
    expect(slim.constraints[0]).not.toHaveProperty("rationale")
    expect(slim.doNotChange).toEqual(["pattern"])
  })
})
