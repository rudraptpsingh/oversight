import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision } from "../../src/db/decisions.js"
import {
  onRespectedCheck,
  onOverride,
  runAutoPromote,
  runAutoDowngrade,
  updateConsistencyScore,
  classifyOverrideIntent,
  recordRespectedConstraints,
} from "../../src/engine/confidence.js"
import type { OversightRecord, Database } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oversight-confidence-test-"))
}

function makeRecord(overrides: Partial<OversightRecord> = {}): OversightRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [{ type: "file", path: "src/core.ts" }],
    title: "Test decision", summary: "Test", context: "Test", decision: "Test",
    rationale: "Testing confidence engine",
    constraints: [{ description: "Must use sync driver", severity: "must", rationale: "Perf" }],
    alternatives: [], consequences: "", tags: [],
    decisionType: "architectural", confidence: "definitive", author: "test",
    timestamp: new Date().toISOString(), agentHints: [], doNotChange: [], reviewTriggers: [],
    ...overrides,
  }
}

function getConstraint(db: Database, id: number) {
  return db.prepare("SELECT * FROM constraints WHERE id = ?").get(id) as {
    id: number; confidence: number; check_count: number; override_count: number
    consistency_score: number; severity: string
  } | undefined
}

function getConstraintIdForDecision(db: Database, decisionId: string): number {
  const row = db.prepare("SELECT id FROM constraints WHERE decision_id = ? LIMIT 1").get(decisionId) as { id: number }
  return row.id
}

describe("confidence engine", () => {
  let tmpdir: string
  let db: Database

  beforeEach(async () => {
    tmpdir = tmpDir()
    db = await initDb(tmpdir)
  })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  // -------------------------------------------------------------------------
  describe("onRespectedCheck (violated=false)", () => {
    it("increments check_count and raises confidence", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      onRespectedCheck(db, cid)

      const c = getConstraint(db, cid)!
      expect(c.check_count).toBe(1)
      expect(c.confidence).toBeCloseTo(0.51, 4) // 0.5 + 0.02*(1-0.5)
    })

    it("writes a check event to confidence history", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      onRespectedCheck(db, cid)

      const row = db.prepare(
        "SELECT event_type FROM constraint_confidence_history WHERE constraint_id = ? ORDER BY id DESC LIMIT 1"
      ).get(cid) as { event_type: string } | undefined
      expect(row?.event_type).toBe("check")
    })

    it("applies exponential smoothing on repeated calls", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      onRespectedCheck(db, cid) // 0.5 → 0.51
      onRespectedCheck(db, cid) // 0.51 → 0.51 + 0.02*(1-0.51) = 0.5198

      const c = getConstraint(db, cid)!
      expect(c.check_count).toBe(2)
      expect(c.confidence).toBeCloseTo(0.5198, 4)
    })
  })

  // -------------------------------------------------------------------------
  describe("onRespectedCheck (violated=true) — Fix 1", () => {
    it("increments check_count but keeps confidence flat", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      onRespectedCheck(db, cid, true)

      const c = getConstraint(db, cid)!
      expect(c.check_count).toBe(1)
      expect(c.confidence).toBeCloseTo(0.5, 6) // unchanged
    })

    it("still writes a history row when violated=true", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      onRespectedCheck(db, cid, true)

      const row = db.prepare(
        "SELECT event_type FROM constraint_confidence_history WHERE constraint_id = ?"
      ).get(cid) as { event_type: string } | undefined
      expect(row).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  describe("onOverride", () => {
    it("decreases confidence by 0.15", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      onOverride(db, cid, "this constraint is outdated and no longer applicable")

      const c = getConstraint(db, cid)!
      expect(c.confidence).toBeCloseTo(0.35, 4) // 0.5 - 0.15
      expect(c.override_count).toBe(1)
    })

    it("floors confidence at 0.05", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      // Set confidence to 0.1 manually, then call override twice
      db.prepare("UPDATE constraints SET confidence = 0.1 WHERE id = ?").run(cid)
      onOverride(db, cid, "wrong constraint")   // 0.1 - 0.15 = max(0.05, -0.05) = 0.05
      onOverride(db, cid, "still wrong")         // floor stays at 0.05

      const c = getConstraint(db, cid)!
      expect(c.confidence).toBeGreaterThanOrEqual(0.05)
    })

    it("inserts an override_event row", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      onOverride(db, cid, "deadline is tight, need to ship faster")

      const row = db.prepare(
        "SELECT intent_class FROM override_events WHERE constraint_id = ?"
      ).get(cid) as { intent_class: string } | undefined
      expect(row?.intent_class).toBe("task_pressure")
    })
  })

  // -------------------------------------------------------------------------
  describe("runAutoPromote", () => {
    it("promotes SHOULD constraint at conf>0.9 and check_count>20 to MUST", async () => {
      const record = makeRecord({
        constraints: [{ description: "Should use caching", severity: "should", rationale: "Perf" }]
      })
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      db.prepare("UPDATE constraints SET confidence = 0.91, check_count = 21 WHERE id = ?").run(cid)

      const promoted = runAutoPromote(db)
      expect(promoted).toContain(cid)

      const c = getConstraint(db, cid)!
      expect(c.severity).toBe("must")
    })

    it("does NOT promote SHOULD constraint below threshold", async () => {
      const record = makeRecord({
        constraints: [{ description: "Should use caching", severity: "should", rationale: "Perf" }]
      })
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      db.prepare("UPDATE constraints SET confidence = 0.85, check_count = 21 WHERE id = ?").run(cid)

      const promoted = runAutoPromote(db)
      expect(promoted).not.toContain(cid)
    })
  })

  // -------------------------------------------------------------------------
  describe("runAutoDowngrade", () => {
    it("downgrades MUST constraint with low confidence and many overrides to SHOULD", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      db.prepare("UPDATE constraints SET confidence = 0.20, override_count = 4 WHERE id = ?").run(cid)

      const downgraded = runAutoDowngrade(db)
      expect(downgraded).toContain(cid)

      const c = getConstraint(db, cid)!
      expect(c.severity).toBe("should")
    })

    it("does NOT downgrade MUST constraint with only 2 overrides", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      db.prepare("UPDATE constraints SET confidence = 0.20, override_count = 2 WHERE id = ?").run(cid)

      const downgraded = runAutoDowngrade(db)
      expect(downgraded).not.toContain(cid)
    })
  })

  // -------------------------------------------------------------------------
  describe("classifyOverrideIntent (pure function)", () => {
    it("classifies task pressure", () => {
      expect(classifyOverrideIntent("deadline is tight")).toBe("task_pressure")
      expect(classifyOverrideIntent("need to ship faster")).toBe("task_pressure")
      expect(classifyOverrideIntent("quick fix for now")).toBe("task_pressure")
    })

    it("classifies disagreement", () => {
      expect(classifyOverrideIntent("this constraint is outdated")).toBe("disagreement")
      expect(classifyOverrideIntent("incorrect rule, no longer applies")).toBe("disagreement")
    })

    it("classifies legitimate exception for long rationale with no pressure keywords", () => {
      const long = "After carefully reviewing the dependency graph and verifying with the security team that this specific use case is exempt from the general rule due to the read-only nature of the operation"
      expect(classifyOverrideIntent(long)).toBe("legitimate_exception")
    })

    it("classifies short ambiguous rationale as unknown", () => {
      expect(classifyOverrideIntent("different case")).toBe("unknown")
    })
  })

  // -------------------------------------------------------------------------
  describe("recordRespectedConstraints — Fix 1 behavior", () => {
    it("increments check_count for MUST constraints in violated set (confidence stays flat)", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      const violatedSet = new Set(["must use sync driver"])
      recordRespectedConstraints(db, [record.id], violatedSet)

      const c = getConstraint(db, cid)!
      expect(c.check_count).toBe(1)
      expect(c.confidence).toBeCloseTo(0.5, 6) // no confidence gain when violated
    })

    it("increments check_count AND raises confidence for SHOULD not in violated set", async () => {
      const record = makeRecord({
        constraints: [{ description: "Should use caching", severity: "should", rationale: "Perf" }]
      })
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      const violatedSet = new Set<string>() // empty — not violated
      recordRespectedConstraints(db, [record.id], violatedSet)

      const c = getConstraint(db, cid)!
      expect(c.check_count).toBe(1)
      expect(c.confidence).toBeGreaterThan(0.5)
    })

    it("is a no-op for empty decisionIds", async () => {
      // Should not throw
      expect(() => recordRespectedConstraints(db, [], new Set())).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  describe("updateConsistencyScore", () => {
    it("reaches 1.0 after 8 consecutive passes", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      for (let i = 0; i < 8; i++) {
        onRespectedCheck(db, cid) // each call records a check event + updates score
      }

      const c = getConstraint(db, cid)!
      expect(c.consistency_score).toBeCloseTo(1.0, 2)
    })

    it("drops toward 0 after overrides", async () => {
      const record = makeRecord()
      insertDecision(db, record)
      const cid = getConstraintIdForDecision(db, record.id)

      // 4 passes then 4 overrides
      for (let i = 0; i < 4; i++) onRespectedCheck(db, cid)
      for (let i = 0; i < 4; i++) onOverride(db, cid, "wrong constraint repeated")

      const c = getConstraint(db, cid)!
      expect(c.consistency_score).toBeLessThan(0.6)
    })
  })
})
