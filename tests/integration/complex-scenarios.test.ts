import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import {
  insertDecision,
  getDecisionById,
  getDecisionsByPath,
  getAllDecisions,
  updateDecision,
  deleteDecision,
} from "../../src/db/decisions.js"
import { searchDecisions } from "../../src/db/search.js"
import { handleGetByPath } from "../../src/mcp/tools/getByPath.js"
import { handleGetBySymbol } from "../../src/mcp/tools/getBySymbol.js"
import { handleSearch } from "../../src/mcp/tools/search.js"
import { handleRecord } from "../../src/mcp/tools/record.js"
import { handleCheckChange } from "../../src/mcp/tools/checkChange.js"
import type { WhyCodeRecord, Constraint } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "whycode-complex-test-"))
}

function makeRecord(overrides: Partial<WhyCodeRecord> = {}): WhyCodeRecord {
  return {
    id: uuidv4(),
    version: 1,
    status: "active",
    anchors: [{ type: "file", path: "src/auth.ts" }],
    title: "Auth token decision",
    summary: "Use JWT for stateless auth",
    context: "Need stateless authentication across services",
    decision: "JWT tokens with RS256 signing",
    rationale: "Industry standard, supports distributed verification",
    constraints: [],
    alternatives: [],
    consequences: "Enables horizontal scaling",
    tags: ["auth", "security"],
    decisionType: "security",
    confidence: "definitive",
    author: "alice",
    timestamp: new Date().toISOString(),
    agentHints: [],
    doNotChange: [],
    reviewTriggers: [],
    ...overrides,
  }
}

describe("Complex Scenario: Full lifecycle of a decision", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("records a decision via MCP, finds it by path, updates it, and verifies versioning", () => {
    const db = initDb(tmpdir)

    const { id, record } = handleRecord(db, {
      title: "Rate limiting strategy",
      summary: "Sliding window at the gateway",
      decision: "Use sliding window algorithm at API gateway",
      context: "DDoS protection and fair usage enforcement needed",
      rationale: "Sliding window is more accurate than fixed window",
      anchors: [{ type: "file", path: "src/gateway/ratelimit.ts" }],
      constraints: [
        { description: "Limit must be configurable per tenant", severity: "must", rationale: "Multi-tenancy" },
      ],
      tags: ["performance", "gateway"],
      decisionType: "algorithmic",
      confidence: "definitive",
    })

    expect(id).toBeDefined()
    expect(record.version).toBe(1)
    expect(record.status).toBe("active")

    const found = handleGetByPath(db, { path: "src/gateway/ratelimit.ts" })
    expect(found).toHaveLength(1)
    expect(found[0].title).toBe("Rate limiting strategy")

    const updated = updateDecision(db, id, {
      title: "Rate limiting strategy v2",
      confidence: "definitive",
    })
    expect(updated).not.toBeNull()
    expect(updated!.version).toBe(2)
    expect(updated!.title).toBe("Rate limiting strategy v2")

    const refetched = getDecisionById(db, id)
    expect(refetched!.version).toBe(2)
    expect(refetched!.title).toBe("Rate limiting strategy v2")
  })
})

describe("Complex Scenario: Multi-file architectural refactor risk assessment", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("aggregates must constraints from multiple files and reports HIGH risk", () => {
    const db = initDb(tmpdir)

    insertDecision(db, makeRecord({
      title: "Auth module constraints",
      anchors: [{ type: "file", path: "src/auth/index.ts" }],
      constraints: [
        { description: "Never store plaintext passwords", severity: "must", rationale: "Security compliance" },
        { description: "Always validate token expiry", severity: "must", rationale: "Session security" },
      ],
    }))

    insertDecision(db, makeRecord({
      title: "Database access layer",
      anchors: [{ type: "file", path: "src/db/client.ts" }],
      constraints: [
        { description: "Use parameterized queries only", severity: "must", rationale: "Prevent SQL injection" },
        { description: "Prefer connection pooling", severity: "should", rationale: "Performance" },
      ],
    }))

    insertDecision(db, makeRecord({
      title: "User service rules",
      anchors: [{ type: "file", path: "src/services/user.ts" }],
      constraints: [
        { description: "Log all PII access for audit", severity: "should", rationale: "Compliance" },
      ],
    }))

    const result = handleCheckChange(db, {
      changeDescription: "Refactor authentication and user data access across auth, db and user modules",
      affectedPaths: ["src/auth/index.ts", "src/db/client.ts", "src/services/user.ts"],
    })

    expect(result.riskLevel).toBe("high")
    expect(result.mustConstraints).toHaveLength(3)
    expect(result.relevantDecisions).toHaveLength(3)

    const mustDescriptions = result.mustConstraints.map((c) => c.description)
    expect(mustDescriptions).toContain("Never store plaintext passwords")
    expect(mustDescriptions).toContain("Always validate token expiry")
    expect(mustDescriptions).toContain("Use parameterized queries only")

    expect(result.warnings.some((w) => w.includes("[MUST]"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("[SHOULD]"))).toBe(true)
  })

  it("deduplicates a decision anchored to a directory when multiple child files are affected", () => {
    const db = initDb(tmpdir)

    insertDecision(db, makeRecord({
      title: "Auth module global policy",
      anchors: [{ type: "file", path: "src/auth" }],
      constraints: [
        { description: "All auth functions must be unit tested", severity: "must", rationale: "Coverage" },
      ],
    }))

    const result = handleCheckChange(db, {
      changeDescription: "Refactor all files in auth module",
      affectedPaths: ["src/auth/validator.ts", "src/auth/tokens.ts", "src/auth/middleware.ts"],
    })

    expect(result.relevantDecisions).toHaveLength(1)
    expect(result.riskLevel).toBe("high")
  })
})

describe("Complex Scenario: Decision supersession chain", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("supersedes an old decision and only returns the active one by default", () => {
    const db = initDb(tmpdir)

    const oldId = uuidv4()
    const newId = uuidv4()

    insertDecision(db, makeRecord({
      id: oldId,
      title: "Old caching strategy",
      summary: "In-memory LRU cache",
      anchors: [{ type: "file", path: "src/cache/store.ts" }],
      status: "superseded",
      supersededBy: newId,
    }))

    insertDecision(db, makeRecord({
      id: newId,
      title: "New caching strategy",
      summary: "Redis distributed cache",
      anchors: [{ type: "file", path: "src/cache/store.ts" }],
      status: "active",
      supersedes: [oldId],
    }))

    const defaultResults = handleGetByPath(db, { path: "src/cache/store.ts" })
    expect(defaultResults).toHaveLength(1)
    expect(defaultResults[0].title).toBe("New caching strategy")

    const allResults = handleGetByPath(db, { path: "src/cache/store.ts", includeSuperseded: true })
    expect(allResults).toHaveLength(2)

    const activeRecord = allResults.find((r) => r.status === "active")!
    expect(activeRecord.supersedes).toContain(oldId)

    const oldRecord = allResults.find((r) => r.status === "superseded")!
    expect(oldRecord.supersededBy).toBe(newId)
  })
})

describe("Complex Scenario: Full-text search with filters and ranking", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("searches across multiple fields and applies tag filters correctly", () => {
    const db = initDb(tmpdir)

    insertDecision(db, makeRecord({
      title: "JWT authentication",
      summary: "Stateless auth via JWT",
      tags: ["auth", "security"],
      decisionType: "security",
    }))

    insertDecision(db, makeRecord({
      title: "OAuth2 for third-party",
      summary: "Delegate auth to external providers",
      tags: ["auth", "oauth"],
      decisionType: "security",
    }))

    insertDecision(db, makeRecord({
      title: "PostgreSQL connection pooling",
      summary: "Use pg-pool for database connections",
      tags: ["database", "performance"],
      decisionType: "performance",
    }))

    insertDecision(db, makeRecord({
      title: "Redis session storage",
      summary: "Store sessions in Redis for scalability",
      tags: ["performance", "session"],
      decisionType: "performance",
    }))

    const authResults = handleSearch(db, { query: "auth" })
    expect(authResults.length).toBeGreaterThanOrEqual(2)

    const tagFiltered = searchDecisions(db, { tags: ["auth"] })
    expect(tagFiltered).toHaveLength(2)
    expect(tagFiltered.every((r) => r.tags.includes("auth"))).toBe(true)

    const typeFiltered = searchDecisions(db, { decisionTypes: ["performance"] })
    expect(typeFiltered).toHaveLength(2)
    expect(typeFiltered.every((r) => r.decisionType === "performance")).toBe(true)

    const limited = handleSearch(db, { query: "auth", limit: 1 })
    expect(limited).toHaveLength(1)
  })

  it("searches rationale and context fields, not just title", () => {
    const db = initDb(tmpdir)

    insertDecision(db, makeRecord({
      title: "Unrelated title",
      context: "The system needs horizontal scalability for peak traffic",
      rationale: "Kubernetes allows auto-scaling pods dynamically",
      tags: ["infra"],
    }))

    const results = handleSearch(db, { query: "kubernetes" })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe("Unrelated title")
  })
})

describe("Complex Scenario: Symbol-based discovery for multi-anchor decisions", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("finds a decision anchored to multiple functions and retrieves it by each symbol", () => {
    const db = initDb(tmpdir)

    const record = makeRecord({
      title: "Password hashing policy",
      anchors: [
        { type: "function", path: "src/auth/hash.ts", identifier: "hashPassword" },
        { type: "function", path: "src/auth/hash.ts", identifier: "verifyPassword" },
        { type: "function", path: "src/auth/hash.ts", identifier: "generateSalt" },
      ],
      constraints: [
        { description: "Use bcrypt with cost factor >= 12", severity: "must", rationale: "Security" },
      ],
    })

    insertDecision(db, record)

    const byHash = handleGetBySymbol(db, { symbol: "hashPassword" })
    expect(byHash).toHaveLength(1)

    const byVerify = handleGetBySymbol(db, { symbol: "verifyPassword" })
    expect(byVerify).toHaveLength(1)
    expect(byVerify[0].id).toBe(record.id)

    const byPartial = handleGetBySymbol(db, { symbol: "password" })
    expect(byPartial).toHaveLength(1)

    const byPathAndSymbol = handleGetBySymbol(db, { symbol: "generateSalt", path: "src/auth/hash.ts" })
    expect(byPathAndSymbol).toHaveLength(1)

    const wrongPath = handleGetBySymbol(db, { symbol: "hashPassword", path: "src/other/file.ts" })
    expect(wrongPath).toHaveLength(0)
  })
})

describe("Complex Scenario: Agent workflow - record then check", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("agent records a decision with doNotChange patterns, then checkChange surfaces them as warnings", () => {
    const db = initDb(tmpdir)

    handleRecord(db, {
      title: "Payment processing core",
      summary: "PCI-DSS compliant payment flow",
      decision: "Use Stripe SDK, never handle raw card numbers",
      context: "PCI-DSS compliance requirement for card processing",
      rationale: "Offload compliance scope to Stripe",
      anchors: [{ type: "file", path: "src/payments/processor.ts" }],
      constraints: [
        { description: "Never log card numbers or CVV", severity: "must", rationale: "PCI-DSS Level 1" },
        { description: "Always use HTTPS for payment endpoints", severity: "must", rationale: "Data in transit" },
      ],
      doNotChange: ["cardNumber", "cvv", "rawCard"],
      tags: ["payments", "security", "compliance"],
      decisionType: "compliance",
      confidence: "definitive",
    })

    const result = handleCheckChange(db, {
      changeDescription: "Optimise payment processor by caching card details",
      affectedPaths: ["src/payments/processor.ts"],
    })

    expect(result.riskLevel).toBe("high")
    expect(result.mustConstraints).toHaveLength(2)

    const doNotChangeWarning = result.warnings.find((w) => w.includes("doNotChange") || w.includes("cardNumber") || w.includes("Do-not-change"))
    expect(doNotChangeWarning).toBeDefined()

    expect(result.warnings.some((w) => w.includes("Never log card numbers"))).toBe(true)
  })

  it("agent records multiple decisions sequentially and getAllDecisions returns them all", () => {
    const db = initDb(tmpdir)

    const r1 = handleRecord(db, {
      title: "Frontend bundling",
      summary: "Vite for dev and production builds",
      decision: "Use Vite",
      context: "Need fast HMR and optimised bundles",
      decisionType: "architectural",
    })

    const r2 = handleRecord(db, {
      title: "State management",
      summary: "Zustand for global state",
      decision: "Use Zustand",
      context: "Redux too verbose for this project size",
      decisionType: "architectural",
    })

    const r3 = handleRecord(db, {
      title: "API communication",
      summary: "TanStack Query for server state",
      decision: "Use TanStack Query",
      context: "Need caching, deduplication, background sync",
      decisionType: "architectural",
    })

    const all = getAllDecisions(db)
    expect(all).toHaveLength(3)

    const ids = all.map((r) => r.id)
    expect(ids).toContain(r1.id)
    expect(ids).toContain(r2.id)
    expect(ids).toContain(r3.id)
  })
})

describe("Complex Scenario: Status lifecycle and stale decision management", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("transitions a decision through proposed → active → needs-review → deprecated", () => {
    const db = initDb(tmpdir)

    const { id } = handleRecord(db, {
      title: "GraphQL adoption",
      summary: "Evaluate GraphQL for the public API",
      decision: "Pilot GraphQL on the reporting endpoint",
      context: "REST endpoints becoming unwieldy with complex nested queries",
      confidence: "exploratory",
    })

    let record = getDecisionById(db, id)!
    expect(record.status).toBe("active")
    expect(record.confidence).toBe("exploratory")

    updateDecision(db, id, { status: "needs-review" })
    record = getDecisionById(db, id)!
    expect(record.status).toBe("needs-review")
    expect(record.version).toBe(2)

    updateDecision(db, id, { status: "deprecated", confidence: "provisional" })
    record = getDecisionById(db, id)!
    expect(record.status).toBe("deprecated")
    expect(record.version).toBe(3)

    const active = getAllDecisions(db, "active")
    expect(active.find((r) => r.id === id)).toBeUndefined()

    const deprecated = getAllDecisions(db, "deprecated")
    expect(deprecated.find((r) => r.id === id)).toBeDefined()
  })

  it("deleting a decision removes it from path lookups and search", () => {
    const db = initDb(tmpdir)

    const { id } = handleRecord(db, {
      title: "Temporary workaround",
      summary: "Manual retry on flaky third-party API",
      decision: "Add exponential backoff",
      context: "Vendor API unreliable until Q2",
      anchors: [{ type: "file", path: "src/integrations/vendor.ts" }],
      decisionType: "workaround",
    })

    let found = handleGetByPath(db, { path: "src/integrations/vendor.ts" })
    expect(found).toHaveLength(1)

    let searched = handleSearch(db, { query: "exponential backoff" })
    expect(searched).toHaveLength(1)

    const deleted = deleteDecision(db, id)
    expect(deleted).toBe(true)

    found = handleGetByPath(db, { path: "src/integrations/vendor.ts" })
    expect(found).toHaveLength(0)

    searched = handleSearch(db, { query: "exponential backoff" })
    expect(searched).toHaveLength(0)
  })
})

describe("Complex Scenario: Constraint priority escalation", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("escalates from low to medium risk when a should constraint is added via update", () => {
    const db = initDb(tmpdir)

    const { id } = handleRecord(db, {
      title: "Logging strategy",
      summary: "Structured JSON logs",
      decision: "Use pino logger with JSON format",
      context: "Logs consumed by ELK stack",
      anchors: [{ type: "file", path: "src/utils/logger.ts" }],
    })

    let result = handleCheckChange(db, {
      changeDescription: "Switch to console.log",
      affectedPaths: ["src/utils/logger.ts"],
    })
    expect(result.riskLevel).toBe("low")

    updateDecision(db, id, {
      constraints: [
        { description: "Use structured JSON format for all log entries", severity: "should", rationale: "ELK compatibility" },
      ],
    })

    result = handleCheckChange(db, {
      changeDescription: "Switch to console.log",
      affectedPaths: ["src/utils/logger.ts"],
    })
    expect(result.riskLevel).toBe("medium")

    updateDecision(db, id, {
      constraints: [
        { description: "Use structured JSON format for all log entries", severity: "should", rationale: "ELK compatibility" },
        { description: "Never log PII in production", severity: "must", rationale: "GDPR" },
      ],
    })

    result = handleCheckChange(db, {
      changeDescription: "Switch to console.log",
      affectedPaths: ["src/utils/logger.ts"],
    })
    expect(result.riskLevel).toBe("high")
    expect(result.mustConstraints).toHaveLength(1)
    expect(result.warnings.some((w) => w.includes("GDPR") || w.includes("PII"))).toBe(true)
  })
})

describe("Complex Scenario: Cross-cutting concerns with agent hints", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("stores and retrieves agent hints with function-scoped decisions", () => {
    const db = initDb(tmpdir)

    const { id } = handleRecord(db, {
      title: "Token refresh logic",
      summary: "Silent refresh using refresh token rotation",
      decision: "Implement silent refresh via interceptor",
      context: "Short-lived access tokens require seamless refresh",
      anchors: [
        { type: "function", path: "src/api/interceptor.ts", identifier: "refreshAccessToken" },
      ],
      agentHints: [
        { instruction: "Do not add retry loops inside refreshAccessToken, use the outer request queue", scope: "function" },
        { instruction: "Always invalidate refresh token after single use", scope: "function" },
      ],
      constraints: [
        { description: "Refresh tokens are single-use", severity: "must", rationale: "Security - prevent token reuse" },
      ],
      tags: ["auth", "security", "api"],
    })

    const bySymbol = handleGetBySymbol(db, { symbol: "refreshAccessToken" })
    expect(bySymbol).toHaveLength(1)

    const record = bySymbol[0]
    expect(record.agentHints).toHaveLength(2)
    expect(record.agentHints[0].scope).toBe("function")
    expect(record.agentHints.some((h) => h.instruction.includes("request queue"))).toBe(true)
    expect(record.agentHints.some((h) => h.instruction.includes("single use"))).toBe(true)

    const checkResult = handleCheckChange(db, {
      changeDescription: "Add retry logic to token refresh",
      affectedPaths: ["src/api/interceptor.ts"],
    })
    expect(checkResult.riskLevel).toBe("high")
    expect(checkResult.mustConstraints[0].description).toBe("Refresh tokens are single-use")
  })
})
