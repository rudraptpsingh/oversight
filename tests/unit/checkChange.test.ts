import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision } from "../../src/db/decisions.js"
import { handleCheckChange } from "../../src/mcp/tools/checkChange.js"
import type { WhyCodeRecord } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "whycode-checkchange-test-"))
}

function makeRecord(overrides: Partial<WhyCodeRecord> = {}): WhyCodeRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [{ type: "file", path: "src/auth.ts" }],
    title: "Auth decision", summary: "Auth summary", context: "Context",
    decision: "Use JWT", rationale: "Standard", constraints: [], alternatives: [],
    consequences: "", tags: [], decisionType: "security", confidence: "definitive",
    author: "test", timestamp: new Date().toISOString(), agentHints: [], doNotChange: [], reviewTriggers: [],
    ...overrides,
  }
}

describe("handleCheckChange", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("returns low risk when no constraints", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ constraints: [] }))
    const result = handleCheckChange(db, { changeDescription: "refactor auth", affectedPaths: ["src/auth.ts"] })
    expect(result.riskLevel).toBe("low")
    expect(result.relevantDecisions).toHaveLength(1)
  })

  it("returns high risk with must constraints", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ constraints: [{ description: "Never log passwords", severity: "must", rationale: "Security" }] }))
    const result = handleCheckChange(db, { changeDescription: "change auth logging", affectedPaths: ["src/auth.ts"] })
    expect(result.riskLevel).toBe("high")
    expect(result.mustConstraints).toHaveLength(1)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it("returns medium risk with should constraints", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ constraints: [{ description: "Prefer bcrypt", severity: "should", rationale: "Best practice" }] }))
    const result = handleCheckChange(db, { changeDescription: "change password hashing", affectedPaths: ["src/auth.ts"] })
    expect(result.riskLevel).toBe("medium")
  })

  it("deduplicates decisions across multiple paths", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ anchors: [{ type: "file", path: "src/auth.ts" }] }))
    const result = handleCheckChange(db, { changeDescription: "big refactor", affectedPaths: ["src/auth.ts", "src/auth.ts"] })
    expect(result.relevantDecisions).toHaveLength(1)
  })

  it("returns empty result when no matching decisions", () => {
    const db = initDb(tmpdir)
    const result = handleCheckChange(db, { changeDescription: "change something", affectedPaths: ["src/unrelated.ts"] })
    expect(result.relevantDecisions).toHaveLength(0)
    expect(result.riskLevel).toBe("low")
  })
})
