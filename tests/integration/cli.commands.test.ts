import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision, getAllDecisions } from "../../src/db/decisions.js"
import { writeConfig, writeEnforcement, readEnforcement } from "../../src/utils/config.js"
import { generateOversightMd } from "../../src/utils/generateMarkdown.js"
import { handleCheckChange } from "../../src/mcp/tools/checkChange.js"
import { searchDecisions } from "../../src/db/search.js"
import type { OversightRecord, OversightConfig } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oversight-cli-test-"))
}

function setupOversightDir(base: string): string {
  const oversightDir = path.join(base, ".oversight")
  fs.mkdirSync(oversightDir, { recursive: true })
  const config: OversightConfig = {
    projectName: "test-project",
    author: "test-author",
    createdAt: new Date().toISOString(),
    version: "1",
  }
  fs.writeFileSync(path.join(oversightDir, "config.json"), JSON.stringify(config, null, 2))
  return oversightDir
}

function makeRecord(overrides: Partial<OversightRecord> = {}): OversightRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [{ type: "file", path: "src/payments.ts" }],
    title: "PCI compliance for payment data",
    summary: "Never log raw card numbers",
    context: "Payment processing with PCI requirements",
    decision: "Mask all PAN data in logs",
    rationale: "Regulatory compliance",
    constraints: [
      { description: "Never log raw card numbers", severity: "must", rationale: "PCI DSS" },
      { description: "Use TLS 1.2+", severity: "should", rationale: "Security" },
    ],
    alternatives: [], consequences: "Need custom masking logic",
    tags: ["pci", "security", "payments"],
    decisionType: "compliance", confidence: "definitive", author: "test",
    timestamp: new Date().toISOString(),
    agentHints: [{ instruction: "Always mask PAN before logging", scope: "file" }],
    doNotChange: ["src/payments/masking.ts"],
    reviewTriggers: ["PCI audit", "card scheme change"],
    ...overrides,
  }
}

describe("generate command logic (generateOversightMd)", () => {
  it("produces a markdown file with OVERSIGHT.md header", async () => {
    const md = generateOversightMd([makeRecord()])
    expect(md).toContain("# OVERSIGHT.md")
  })

  it("includes must constraints in Hard Constraints section", async () => {
    const md = generateOversightMd([makeRecord()])
    expect(md).toContain("## Hard Constraints (must)")
    expect(md).toContain("Never log raw card numbers")
  })

  it("includes should constraints in Soft Constraints section", async () => {
    const md = generateOversightMd([makeRecord()])
    expect(md).toContain("## Soft Constraints (should)")
    expect(md).toContain("Use TLS 1.2+")
  })

  it("includes doNotChange patterns", async () => {
    const md = generateOversightMd([makeRecord()])
    expect(md).toContain("## Do-Not-Change Patterns")
    expect(md).toContain("src/payments/masking.ts")
  })

  it("includes decision summaries section", async () => {
    const md = generateOversightMd([makeRecord()])
    expect(md).toContain("## Decision Summaries")
    expect(md).toContain("### PCI compliance for payment data")
  })

  it("includes agent hints in the decision summary", async () => {
    const md = generateOversightMd([makeRecord()])
    expect(md).toContain("Always mask PAN before logging")
  })

  it("only includes active decisions", async () => {
    const records = [
      makeRecord({ id: uuidv4(), title: "Active one" }),
      makeRecord({ id: uuidv4(), title: "Superseded one", status: "superseded" }),
    ]
    const md = generateOversightMd(records)
    expect(md).toContain("Active one")
    expect(md).not.toContain("Superseded one")
  })

  it("produces empty sections when no decisions exist", async () => {
    const md = generateOversightMd([])
    expect(md).toContain("# OVERSIGHT.md")
    expect(md).not.toContain("## Hard Constraints")
    expect(md).not.toContain("## Decision Summaries")
  })

  it("generate writes OVERSIGHT.md to disk when decisions exist", async () => {
    const base = tmpDir()
    try {
      const oversightDir = setupOversightDir(base)
      const db = await initDb(oversightDir)
      insertDecision(db, makeRecord())

      const decisions = getAllDecisions(db, "active")
      const markdown = generateOversightMd(decisions)
      const outputPath = path.join(base, "OVERSIGHT.md")
      fs.writeFileSync(outputPath, markdown, "utf-8")

      expect(fs.existsSync(outputPath)).toBe(true)
      const content = fs.readFileSync(outputPath, "utf-8")
      expect(content).toContain("# OVERSIGHT.md")
      expect(content).toContain("PCI compliance for payment data")
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})

describe("export command logic", () => {
  let base: string
  let oversightDir: string

  beforeEach(() => {
    base = tmpDir()
    oversightDir = setupOversightDir(base)
  })
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

  it("exports active decisions to JSON structure", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord())

    const decisions = getAllDecisions(db, "active")
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), count: decisions.length, decisions }, null, 2)
    const parsed = JSON.parse(json)

    expect(parsed.count).toBe(1)
    expect(parsed.decisions).toHaveLength(1)
    expect(parsed.decisions[0].title).toBe("PCI compliance for payment data")
    expect(parsed.exportedAt).toBeDefined()
  })

  it("exports all statuses when status=all", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4() }))
    insertDecision(db, makeRecord({ id: uuidv4(), status: "superseded" }))
    insertDecision(db, makeRecord({ id: uuidv4(), status: "deprecated" }))

    const all = getAllDecisions(db)
    expect(all.length).toBe(3)
  })

  it("exports only active decisions by default", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4() }))
    insertDecision(db, makeRecord({ id: uuidv4(), status: "superseded" }))

    const active = getAllDecisions(db, "active")
    expect(active.length).toBe(1)
  })

  it("writes JSON file to disk", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord())

    const decisions = getAllDecisions(db, "active")
    const outPath = path.join(base, "decisions-export.json")
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), count: decisions.length, decisions }, null, 2)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, json, "utf-8")

    expect(fs.existsSync(outPath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(outPath, "utf-8"))
    expect(content.count).toBe(1)
  })
})

describe("list command logic", () => {
  let base: string
  let oversightDir: string

  beforeEach(() => {
    base = tmpDir()
    oversightDir = setupOversightDir(base)
  })
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

  it("returns active decisions by default", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4() }))
    insertDecision(db, makeRecord({ id: uuidv4(), status: "superseded" }))

    const active = getAllDecisions(db, "active")
    expect(active).toHaveLength(1)
  })

  it("filters by tag", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4(), tags: ["pci", "security"] }))
    insertDecision(db, makeRecord({ id: uuidv4(), tags: ["performance"] }))

    const all = getAllDecisions(db, "active")
    const filtered = all.filter((r) => r.tags.includes("pci"))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].tags).toContain("pci")
  })

  it("filters by decision type", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4(), decisionType: "compliance" }))
    insertDecision(db, makeRecord({ id: uuidv4(), decisionType: "performance" }))

    const all = getAllDecisions(db, "active")
    const compliance = all.filter((r) => r.decisionType === "compliance")
    expect(compliance).toHaveLength(1)
  })

  it("returns empty array when no records exist", async () => {
    const db = await initDb(oversightDir)
    expect(getAllDecisions(db, "active")).toHaveLength(0)
  })
})

describe("check command logic (handleCheckChange)", () => {
  let base: string
  let oversightDir: string

  beforeEach(() => {
    base = tmpDir()
    oversightDir = setupOversightDir(base)
  })
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

  it("flags high risk when path has must constraints", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord())

    const result = handleCheckChange(db, {
      changeDescription: "Modify payment logging",
      affectedPaths: ["src/payments.ts"],
    })

    expect(result.riskLevel).toBe("high")
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.mustConstraints.length).toBeGreaterThan(0)
  })

  it("returns low risk for paths with no decisions", async () => {
    const db = await initDb(oversightDir)
    const result = handleCheckChange(db, {
      changeDescription: "Add unit test",
      affectedPaths: ["tests/new.test.ts"],
    })
    expect(result.riskLevel).toBe("low")
    expect(result.warnings).toHaveLength(0)
  })

  it("proceed is true for low-risk changes", async () => {
    const db = await initDb(oversightDir)
    const result = handleCheckChange(db, {
      changeDescription: "Rename variable",
      affectedPaths: ["src/utils/helper.ts"],
    })
    expect(result.proceed).toBe(true)
  })

  it("includes relevant decisions in the result", async () => {
    const db = await initDb(oversightDir)
    const r = makeRecord()
    insertDecision(db, r)

    const result = handleCheckChange(db, {
      changeDescription: "Edit payments module",
      affectedPaths: ["src/payments.ts"],
    })

    const ids = result.relevantDecisions.map((d) => d.id)
    expect(ids).toContain(r.id)
  })
})

describe("enforce command logic (readEnforcement / writeEnforcement)", () => {
  let base: string

  beforeEach(() => {
    base = tmpDir()
    setupOversightDir(base)
  })
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

  it("defaults to advisory mode when no enforcement.json exists", async () => {
    const cfg = readEnforcement(base)
    expect(cfg.mode).toBe("advisory")
    expect(cfg.blockOnMustViolation).toBe(false)
    expect(cfg.blockOnHighRisk).toBe(false)
  })

  it("enables blocking mode after enforce on", async () => {
    writeEnforcement({ mode: "blocking", blockOnMustViolation: true, blockOnHighRisk: false }, base)
    const cfg = readEnforcement(base)
    expect(cfg.mode).toBe("blocking")
    expect(cfg.blockOnMustViolation).toBe(true)
  })

  it("enables strict blocking mode", async () => {
    writeEnforcement({ mode: "blocking", blockOnMustViolation: true, blockOnHighRisk: true }, base)
    const cfg = readEnforcement(base)
    expect(cfg.blockOnHighRisk).toBe(true)
  })

  it("disables blocking after enforce off", async () => {
    writeEnforcement({ mode: "blocking", blockOnMustViolation: true, blockOnHighRisk: true }, base)
    writeEnforcement({ mode: "advisory", blockOnMustViolation: false, blockOnHighRisk: false }, base)
    const cfg = readEnforcement(base)
    expect(cfg.mode).toBe("advisory")
    expect(cfg.blockOnMustViolation).toBe(false)
  })

  it("persists enforcement.json to disk", async () => {
    writeEnforcement({ mode: "blocking", blockOnMustViolation: true, blockOnHighRisk: false }, base)
    const enfPath = path.join(base, ".oversight", "enforcement.json")
    expect(fs.existsSync(enfPath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(enfPath, "utf-8"))
    expect(content.mode).toBe("blocking")
  })

  it("blocked is true in blocking mode with must violations", async () => {
    const oversightDir = path.join(base, ".oversight")
    writeEnforcement({ mode: "blocking", blockOnMustViolation: true, blockOnHighRisk: false }, base)
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord())

    const orig = process.cwd()
    process.chdir(base)
    try {
      const result = handleCheckChange(db, {
        changeDescription: "Touch payments",
        affectedPaths: ["src/payments.ts"],
      })
      expect(result.blocked).toBe(true)
      expect(result.blockReason).toBeDefined()
    } finally {
      process.chdir(orig)
    }
  })

  it("not blocked in advisory mode even with must violations", async () => {
    const oversightDir = path.join(base, ".oversight")
    writeEnforcement({ mode: "advisory", blockOnMustViolation: false, blockOnHighRisk: false }, base)
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord())

    const orig = process.cwd()
    process.chdir(base)
    try {
      const result = handleCheckChange(db, {
        changeDescription: "Touch payments",
        affectedPaths: ["src/payments.ts"],
      })
      expect(result.blocked).toBe(false)
    } finally {
      process.chdir(orig)
    }
  })
})

describe("search command logic (searchDecisions)", () => {
  let base: string
  let oversightDir: string

  beforeEach(() => {
    base = tmpDir()
    oversightDir = setupOversightDir(base)
  })
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

  it("returns empty array when no decisions exist", async () => {
    const db = await initDb(oversightDir)
    const results = searchDecisions(db, { query: "rate limiting" })
    expect(results).toHaveLength(0)
  })

  it("finds decisions by title keyword", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4(), title: "PCI compliance for payment data" }))
    insertDecision(db, makeRecord({ id: uuidv4(), title: "Redis rate limiting strategy" }))
    const results = searchDecisions(db, { query: "rate limiting" })
    expect(results.some((r) => r.title.toLowerCase().includes("rate"))).toBe(true)
  })

  it("returns all decisions when no query is given", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4() }))
    insertDecision(db, makeRecord({ id: uuidv4() }))
    const results = searchDecisions(db, {})
    expect(results.length).toBeGreaterThanOrEqual(2)
  })

  it("filters by tag", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4(), tags: ["pci", "security"] }))
    insertDecision(db, makeRecord({ id: uuidv4(), tags: ["performance"] }))
    const results = searchDecisions(db, { tags: ["pci"] })
    expect(results).toHaveLength(1)
    expect(results[0].tags).toContain("pci")
  })

  it("filters by decision type", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4(), decisionType: "compliance" }))
    insertDecision(db, makeRecord({ id: uuidv4(), decisionType: "performance" }))
    const results = searchDecisions(db, { decisionTypes: ["compliance"] })
    expect(results).toHaveLength(1)
    expect(results[0].decisionType).toBe("compliance")
  })

  it("filters by status", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4(), status: "active" }))
    insertDecision(db, makeRecord({ id: uuidv4(), status: "superseded" }))
    const results = searchDecisions(db, { status: "superseded" })
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe("superseded")
  })

  it("respects limit option", async () => {
    const db = await initDb(oversightDir)
    for (let i = 0; i < 5; i++) {
      insertDecision(db, makeRecord({ id: uuidv4(), title: `Decision ${i}` }))
    }
    const results = searchDecisions(db, { limit: 2 })
    expect(results).toHaveLength(2)
  })

  it("deduplicates results", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4(), title: "PCI security requirement" }))
    const results = searchDecisions(db, {})
    const ids = results.map((r) => r.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  it("combined: query + tag filter", async () => {
    const db = await initDb(oversightDir)
    insertDecision(db, makeRecord({ id: uuidv4(), title: "PCI compliance rule", tags: ["pci"] }))
    insertDecision(db, makeRecord({ id: uuidv4(), title: "PCI reporting rule", tags: ["reporting"] }))
    const results = searchDecisions(db, { query: "PCI", tags: ["pci"] })
    expect(results).toHaveLength(1)
    expect(results[0].tags).toContain("pci")
  })
})
