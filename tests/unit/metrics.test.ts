import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision } from "../../src/db/decisions.js"
import { computeMetrics, logCheckChange } from "../../src/db/metrics.js"
import { handleCheckChange } from "../../src/mcp/tools/checkChange.js"
import { handleGetMetrics } from "../../src/mcp/tools/metrics.js"
import type { WhyCodeRecord } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "whycode-metrics-test-"))
}

function makeRecord(overrides: Partial<WhyCodeRecord> = {}): WhyCodeRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [{ type: "file", path: "src/auth.ts" }],
    title: "Default decision", summary: "Default",
    context: "Context", decision: "Use X",
    rationale: "Because X is better",
    constraints: [], alternatives: [], consequences: "",
    tags: [], decisionType: "architectural", confidence: "provisional",
    author: "test", timestamp: new Date().toISOString(),
    agentHints: [], doNotChange: [], reviewTriggers: [],
    ...overrides,
  }
}

describe("metrics: computeMetrics", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("returns zeroed metrics for an empty database", () => {
    const db = initDb(tmpdir)
    const m = computeMetrics(db)
    expect(m.decisions.total).toBe(0)
    expect(m.decisions.active).toBe(0)
    expect(m.checkChange.totalChecks).toBe(0)
    expect(m.coverage.decisionsPerProtectedFile).toBe(0)
    expect(m.coverage.constraintDensity).toBe(0)
  })

  it("counts decisions by status correctly", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ status: "active" }))
    insertDecision(db, makeRecord({ status: "active" }))
    insertDecision(db, makeRecord({ status: "deprecated" }))
    insertDecision(db, makeRecord({ status: "superseded" }))
    insertDecision(db, makeRecord({ status: "needs-review" }))

    const m = computeMetrics(db)
    expect(m.decisions.total).toBe(5)
    expect(m.decisions.active).toBe(2)
    expect(m.decisions.deprecated).toBe(1)
    expect(m.decisions.superseded).toBe(1)
    expect(m.decisions.needsReview).toBe(1)
  })

  it("tallies constraints by severity across all decisions", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({
      constraints: [
        { description: "A", severity: "must", rationale: "r" },
        { description: "B", severity: "must", rationale: "r" },
        { description: "C", severity: "should", rationale: "r" },
      ],
    }))
    insertDecision(db, makeRecord({
      constraints: [
        { description: "D", severity: "must", rationale: "r" },
        { description: "E", severity: "should", rationale: "r" },
      ],
    }))
    insertDecision(db, makeRecord({ constraints: [] }))

    const m = computeMetrics(db)
    expect(m.decisions.mustConstraintTotal).toBe(3)
    expect(m.decisions.shouldConstraintTotal).toBe(2)
    expect(m.decisions.withConstraints).toBe(2)
    expect(m.coverage.constraintDensity).toBeCloseTo(5 / 3, 2)
  })

  it("counts unique protected files from anchors", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({
      anchors: [
        { type: "file", path: "src/auth.ts" },
        { type: "file", path: "src/payments.ts" },
      ],
    }))
    insertDecision(db, makeRecord({
      anchors: [
        { type: "file", path: "src/auth.ts" },
      ],
    }))
    insertDecision(db, makeRecord({
      anchors: [
        { type: "file", path: "src/db.ts" },
      ],
    }))

    const m = computeMetrics(db)
    expect(m.decisions.uniqueFilesProtected).toBe(3)
    expect(m.decisions.anchorsTotal).toBe(4)
    expect(m.coverage.decisionsPerProtectedFile).toBeCloseTo(3 / 3, 2)
  })

  it("counts alternatives documented", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({
      alternatives: [
        { description: "Option A", rejectionReason: "Too slow" },
        { description: "Option B", rejectionReason: "Too complex" },
      ],
    }))
    insertDecision(db, makeRecord({
      alternatives: [
        { description: "Option C", rejectionReason: "No support" },
      ],
    }))

    const m = computeMetrics(db)
    expect(m.decisions.alternativesDocumented).toBe(3)
  })

  it("counts decisions with agent hints and doNotChange patterns", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({
      agentHints: [{ instruction: "Do not add retries here", scope: "function" }],
      doNotChange: ["rawPassword"],
    }))
    insertDecision(db, makeRecord({ agentHints: [], doNotChange: [] }))

    const m = computeMetrics(db)
    expect(m.decisions.withAgentHints).toBe(1)
    expect(m.decisions.withDoNotChange).toBe(1)
    expect(m.coverage.agentHintDensity).toBeCloseTo(0.5, 2)
  })

  it("groups decisions by type and confidence", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({ decisionType: "security", confidence: "definitive" }))
    insertDecision(db, makeRecord({ decisionType: "security", confidence: "definitive" }))
    insertDecision(db, makeRecord({ decisionType: "performance", confidence: "provisional" }))

    const m = computeMetrics(db)
    expect(m.decisions.byType["security"]).toBe(2)
    expect(m.decisions.byType["performance"]).toBe(1)
    expect(m.decisions.byConfidence["definitive"]).toBe(2)
    expect(m.decisions.byConfidence["provisional"]).toBe(1)
  })
})

describe("metrics: logCheckChange and aggregation", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("records check_change log entries", () => {
    const db = initDb(tmpdir)
    logCheckChange(db, {
      changeDescription: "Refactor auth",
      affectedPaths: ["src/auth.ts"],
      relevantDecisionIds: ["id-1"],
      mustConstraintCount: 2,
      shouldConstraintCount: 1,
      riskLevel: "high",
      warningCount: 3,
      timestamp: new Date().toISOString(),
    })

    const m = computeMetrics(db)
    expect(m.checkChange.totalChecks).toBe(1)
    expect(m.checkChange.highRiskBlocked).toBe(1)
    expect(m.checkChange.mediumRiskFlagged).toBe(0)
    expect(m.checkChange.lowRiskCleared).toBe(0)
    expect(m.checkChange.totalWarningsIssued).toBe(3)
    expect(m.checkChange.totalMustConstraintHits).toBe(2)
    expect(m.checkChange.uniqueFilesChecked).toBe(1)
  })

  it("aggregates multiple check_change log entries", () => {
    const db = initDb(tmpdir)

    logCheckChange(db, {
      changeDescription: "Change 1",
      affectedPaths: ["src/auth.ts", "src/db.ts"],
      relevantDecisionIds: [],
      mustConstraintCount: 1,
      shouldConstraintCount: 0,
      riskLevel: "high",
      warningCount: 1,
      timestamp: new Date().toISOString(),
    })
    logCheckChange(db, {
      changeDescription: "Change 2",
      affectedPaths: ["src/payments.ts"],
      relevantDecisionIds: [],
      mustConstraintCount: 0,
      shouldConstraintCount: 2,
      riskLevel: "medium",
      warningCount: 2,
      timestamp: new Date().toISOString(),
    })
    logCheckChange(db, {
      changeDescription: "Change 3",
      affectedPaths: ["src/utils.ts"],
      relevantDecisionIds: [],
      mustConstraintCount: 0,
      shouldConstraintCount: 0,
      riskLevel: "low",
      warningCount: 0,
      timestamp: new Date().toISOString(),
    })

    const m = computeMetrics(db)
    expect(m.checkChange.totalChecks).toBe(3)
    expect(m.checkChange.highRiskBlocked).toBe(1)
    expect(m.checkChange.mediumRiskFlagged).toBe(1)
    expect(m.checkChange.lowRiskCleared).toBe(1)
    expect(m.checkChange.totalWarningsIssued).toBe(3)
    expect(m.checkChange.totalMustConstraintHits).toBe(1)
    expect(m.checkChange.uniqueFilesChecked).toBe(4)
  })

  it("handleCheckChange automatically logs to the metrics table", () => {
    const db = initDb(tmpdir)

    insertDecision(db, makeRecord({
      anchors: [{ type: "file", path: "src/auth.ts" }],
      constraints: [{ description: "Must rotate keys", severity: "must", rationale: "Security" }],
    }))

    handleCheckChange(db, {
      changeDescription: "Replace JWT with sessions",
      affectedPaths: ["src/auth.ts"],
    })

    const m = computeMetrics(db)
    expect(m.checkChange.totalChecks).toBe(1)
    expect(m.checkChange.highRiskBlocked).toBe(1)
    expect(m.checkChange.totalMustConstraintHits).toBe(1)
  })
})

describe("metrics: whycode_get_metrics MCP tool", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("returns the same structure as computeMetrics", () => {
    const db = initDb(tmpdir)
    insertDecision(db, makeRecord({
      constraints: [{ description: "A", severity: "must", rationale: "r" }],
      agentHints: [{ instruction: "Hint", scope: "file" }],
      decisionType: "security",
      confidence: "definitive",
    }))

    const direct = computeMetrics(db)
    const viaMcp = handleGetMetrics(db)

    expect(viaMcp.decisions.total).toBe(direct.decisions.total)
    expect(viaMcp.decisions.mustConstraintTotal).toBe(direct.decisions.mustConstraintTotal)
    expect(viaMcp.decisions.withAgentHints).toBe(direct.decisions.withAgentHints)
    expect(viaMcp.checkChange.totalChecks).toBe(direct.checkChange.totalChecks)
    expect(viaMcp.coverage.constraintDensity).toBe(direct.coverage.constraintDensity)
  })

  it("reflects live changes after additional decisions are inserted", () => {
    const db = initDb(tmpdir)

    let m = handleGetMetrics(db)
    expect(m.decisions.total).toBe(0)

    insertDecision(db, makeRecord({ decisionType: "compliance" }))
    m = handleGetMetrics(db)
    expect(m.decisions.total).toBe(1)

    insertDecision(db, makeRecord({ decisionType: "compliance" }))
    insertDecision(db, makeRecord({ decisionType: "security" }))
    m = handleGetMetrics(db)
    expect(m.decisions.total).toBe(3)
    expect(m.decisions.byType["compliance"]).toBe(2)
    expect(m.decisions.byType["security"]).toBe(1)
  })
})
