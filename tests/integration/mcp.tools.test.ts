import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision } from "../../src/db/decisions.js"
import { handleGetByPath } from "../../src/mcp/tools/getByPath.js"
import { handleGetBySymbol } from "../../src/mcp/tools/getBySymbol.js"
import { handleSearch } from "../../src/mcp/tools/search.js"
import { handleRecord } from "../../src/mcp/tools/record.js"
import { handleCheckChange } from "../../src/mcp/tools/checkChange.js"
import type { WhyCodeRecord } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "whycode-mcp-test-"))
}

function makeRecord(overrides: Partial<WhyCodeRecord> = {}): WhyCodeRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [{ type: "file", path: "src/auth.ts" }],
    title: "Auth token decision", summary: "Use JWT",
    context: "Need stateless auth", decision: "JWT tokens", rationale: "Industry standard",
    constraints: [], alternatives: [], consequences: "Stateless", tags: ["auth"],
    decisionType: "security", confidence: "definitive", author: "test",
    timestamp: new Date().toISOString(),
    agentHints: [{ instruction: "Do not log tokens", scope: "file" }],
    doNotChange: [], reviewTriggers: [],
    ...overrides,
  }
}

describe("MCP tools integration", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  describe("whycode_get_by_path", () => {
    it("returns decisions for a path", () => {
      const db = initDb(tmpdir)
      const r = makeRecord()
      insertDecision(db, r)
      const results = handleGetByPath(db, { path: "src/auth.ts" })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe(r.id)
    })

    it("returns empty array when no decisions", () => {
      const db = initDb(tmpdir)
      expect(handleGetByPath(db, { path: "src/nonexistent.ts" })).toEqual([])
    })

    it("excludes superseded by default", () => {
      const db = initDb(tmpdir)
      insertDecision(db, makeRecord({ status: "superseded" }))
      expect(handleGetByPath(db, { path: "src/auth.ts" })).toHaveLength(0)
    })

    it("includes superseded when flag is set", () => {
      const db = initDb(tmpdir)
      insertDecision(db, makeRecord({ status: "superseded" }))
      expect(handleGetByPath(db, { path: "src/auth.ts", includeSuperseded: true })).toHaveLength(1)
    })
  })

  describe("whycode_get_by_symbol", () => {
    it("finds records by symbol name", () => {
      const db = initDb(tmpdir)
      const r = makeRecord({ anchors: [{ type: "function", path: "src/auth.ts", identifier: "validateToken" }] })
      insertDecision(db, r)
      expect(handleGetBySymbol(db, { symbol: "validateToken" })).toHaveLength(1)
    })

    it("partial match on symbol", () => {
      const db = initDb(tmpdir)
      const r = makeRecord({ anchors: [{ type: "function", path: "src/auth.ts", identifier: "validateJwtToken" }] })
      insertDecision(db, r)
      expect(handleGetBySymbol(db, { symbol: "jwt" })).toHaveLength(1)
    })
  })

  describe("whycode_search", () => {
    it("returns results for a matching query", () => {
      const db = initDb(tmpdir)
      insertDecision(db, makeRecord({ title: "JWT authentication decision" }))
      expect(handleSearch(db, { query: "JWT" }).length).toBeGreaterThan(0)
    })

    it("returns empty for no match", () => {
      const db = initDb(tmpdir)
      insertDecision(db, makeRecord())
      expect(handleSearch(db, { query: "xyzzy_nonexistent_12345" })).toHaveLength(0)
    })
  })

  describe("whycode_record", () => {
    it("creates a new record and returns it", () => {
      const db = initDb(tmpdir)
      const result = handleRecord(db, {
        title: "Agent decision", summary: "Agent made a choice",
        decision: "Use option A", context: "Needed to pick between A and B",
      })
      expect(result.id).toBeDefined()
      expect(result.record.title).toBe("Agent decision")
      expect(result.record.version).toBe(1)
    })
  })

  describe("whycode_check_change", () => {
    it("assesses risk across multiple paths", () => {
      const db = initDb(tmpdir)
      insertDecision(db, makeRecord({ constraints: [{ description: "Never bypass auth", severity: "must", rationale: "Security" }] }))
      const result = handleCheckChange(db, { changeDescription: "Refactor auth layer", affectedPaths: ["src/auth.ts"] })
      expect(result.riskLevel).toBe("high")
      expect(result.warnings.length).toBeGreaterThan(0)
    })
  })
})
