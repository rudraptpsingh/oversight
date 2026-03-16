import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import {
  insertDecision, getDecisionById, getDecisionsByPath,
  getAllDecisions, updateDecision, deleteDecision,
  deduplicateConstraints,
} from "../../src/db/decisions.js"
import { searchDecisions } from "../../src/db/search.js"
import type { OversightRecord } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oversight-test-"))
}

function makeRecord(overrides: Partial<OversightRecord> = {}): OversightRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [{ type: "file", path: "src/auth/validator.ts" }],
    title: "Use JWT for authentication", summary: "JWT tokens for stateless auth",
    context: "We need stateless authentication", decision: "Use JWT",
    rationale: "Scalable and standard",
    constraints: [{ description: "Must rotate keys monthly", severity: "must", rationale: "Security" }],
    alternatives: [], consequences: "Enables horizontal scaling", tags: ["auth", "security"],
    decisionType: "security", confidence: "definitive", author: "test-author",
    timestamp: new Date().toISOString(), agentHints: [], doNotChange: [], reviewTriggers: [],
    ...overrides,
  }
}

describe("DB operations", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("inserts and retrieves a record by id", () => {
    const db = initDb(tmpdir)
    const record = makeRecord()
    insertDecision(db, record)
    const fetched = getDecisionById(db, record.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(record.id)
    expect(fetched!.title).toBe(record.title)
    expect(fetched!.constraints).toHaveLength(1)
    expect(fetched!.tags).toEqual(["auth", "security"])
  })

  it("returns null for non-existent id", () => {
    const db = initDb(tmpdir)
    expect(getDecisionById(db, "nonexistent")).toBeNull()
  })

  it("gets decisions by file path", () => {
    const db = initDb(tmpdir)
    const r1 = makeRecord({ anchors: [{ type: "file", path: "src/auth/validator.ts" }] })
    const r2 = makeRecord({ anchors: [{ type: "file", path: "src/user/service.ts" }] })
    insertDecision(db, r1)
    insertDecision(db, r2)
    const results = getDecisionsByPath(db, "src/auth/validator.ts")
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(r1.id)
  })

  it("matches parent directory paths", () => {
    const db = initDb(tmpdir)
    const r = makeRecord({ anchors: [{ type: "file", path: "src/auth" }] })
    insertDecision(db, r)
    const results = getDecisionsByPath(db, "src/auth/validator.ts")
    expect(results).toHaveLength(1)
  })

  it("gets all decisions with status filter", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ status: "active" }))
    insertDecision(db, makeRecord({ status: "deprecated" }))
    const active = getAllDecisions(db, "active")
    expect(active).toHaveLength(1)
    expect(active[0].status).toBe("active")
  })

  it("updates a decision", () => {
    const db = initDb(tmpdir)
    const record = makeRecord()
    insertDecision(db, record)
    const updated = updateDecision(db, record.id, { title: "Updated Title" })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe("Updated Title")
    expect(updated!.version).toBe(2)
  })

  it("deletes a decision", () => {
    const db = initDb(tmpdir)
    const record = makeRecord()
    insertDecision(db, record)
    const deleted = deleteDecision(db, record.id)
    expect(deleted).toBe(true)
    expect(getDecisionById(db, record.id)).toBeNull()
  })

  it("full-text search finds records", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ title: "JWT authentication", summary: "Use JWT for tokens" }))
    insertDecision(db, makeRecord({ title: "Database pooling", summary: "Connection pool config" }))
    const results = searchDecisions(db, { query: "JWT" })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain("JWT")
  })

  it("search filters by tags", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ tags: ["auth", "security"] }))
    insertDecision(db, makeRecord({ tags: ["database"] }))
    const results = searchDecisions(db, { tags: ["auth"] })
    expect(results).toHaveLength(1)
  })

  it("deduplicates constraints on insert (subsumed)", () => {
    const db = initDb(tmpdir)
    const record = makeRecord({
      constraints: [
        {
          severity: "must",
          description: "Never replace token-bucket with a simple counter or fixed-window limiter",
          rationale: "Fixed windows allow burst abuse",
        },
        {
          severity: "must",
          description: "Never replace token-bucket with a simple counter",
          rationale: "Burst abuse",
        },
      ],
    })
    insertDecision(db, record)
    const fetched = getDecisionById(db, record.id)
    expect(fetched!.constraints).toHaveLength(1)
    expect(fetched!.constraints[0].description).toContain("fixed-window")
    expect(fetched!.constraints[0].rationale).toContain("Fixed windows")
    expect(fetched!.constraints[0].rationale).toContain("Burst abuse")
  })

  it("deduplicates constraints on update", () => {
    const db = initDb(tmpdir)
    const record = makeRecord({
      constraints: [
        { severity: "must", description: "Use Redis", rationale: "Distributed" },
      ],
    })
    insertDecision(db, record)
    updateDecision(db, record.id, {
      constraints: [
        { severity: "must", description: "Use Redis", rationale: "Distributed" },
        { severity: "must", description: "Use Redis for counters", rationale: "Sync across instances" },
      ],
    })
    const fetched = getDecisionById(db, record.id)
    expect(fetched!.constraints).toHaveLength(1)
    expect(fetched!.constraints[0].description).toContain("Redis for counters")
    expect(fetched!.constraints[0].rationale).toMatch(/Distributed|Sync/)
  })
})

describe("deduplicateConstraints", () => {
  it("removes exact duplicates", () => {
    const constraints = [
      { severity: "must" as const, description: "Same rule", rationale: "Reason" },
      { severity: "must" as const, description: "Same rule", rationale: "Reason" },
    ]
    const out = deduplicateConstraints(constraints)
    expect(out).toHaveLength(1)
  })

  it("keeps longer when one subsumes the other", () => {
    const constraints = [
      {
        severity: "must" as const,
        description: "Never replace token-bucket with a simple counter or fixed-window limiter",
        rationale: "Fixed windows allow burst abuse",
      },
      {
        severity: "must" as const,
        description: "Never replace token-bucket with a simple counter",
        rationale: "Burst abuse",
      },
    ]
    const out = deduplicateConstraints(constraints)
    expect(out).toHaveLength(1)
    expect(out[0].description).toContain("fixed-window")
    expect(out[0].rationale).toContain("Fixed windows")
    expect(out[0].rationale).toContain("Burst abuse")
  })

  it("preserves different severities", () => {
    const constraints = [
      { severity: "must" as const, description: "Rule A", rationale: "A" },
      { severity: "should" as const, description: "Rule B", rationale: "B" },
    ]
    const out = deduplicateConstraints(constraints)
    expect(out).toHaveLength(2)
  })

  it("leaves unrelated constraints unchanged", () => {
    const constraints = [
      { severity: "must" as const, description: "Never use SQL string interpolation", rationale: "SQLi" },
      { severity: "must" as const, description: "Never replace SQLite with cloud DB", rationale: "Offline" },
    ]
    const out = deduplicateConstraints(constraints)
    expect(out).toHaveLength(2)
  })
})
