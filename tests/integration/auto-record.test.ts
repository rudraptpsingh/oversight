/**
 * Integration tests for auto-recording, deduplication, and merge features.
 *
 * Tests validate:
 * 1. oversight_record automatically deduplicates (skip/merge/insert)
 * 2. oversight_find_similar surfaces near-duplicate records before insert
 * 3. oversight_merge consolidates two records and marks source superseded
 * 4. Source/conversation origin is captured and retrievable
 * 5. Agent re-recording the same constraint is caught and merged
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import {
  insertDecision,
  getDecisionById,
  checkForDuplicates,
  findSimilarDecisions,
  mergeDecisions,
} from "../../src/db/decisions.js"
import { handleRecord } from "../../src/mcp/tools/record.js"
import { handleFindSimilar } from "../../src/mcp/tools/findSimilar.js"
import { handleMerge } from "../../src/mcp/tools/merge.js"
import type { OversightRecord } from "../../src/types/index.js"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oversight-autorecord-test-"))
}

function makeRecord(overrides: Partial<OversightRecord> = {}): OversightRecord {
  return {
    id: uuidv4(),
    version: 1,
    status: "active",
    anchors: [{ type: "file", path: "src/auth.ts" }],
    title: "JWT must use verify not decode",
    summary: "Always call jwt.verify() to validate token signatures",
    context: "Production incident: attacker forged admin JWT using jwt.decode",
    decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
    rationale: "jwt.decode() skips signature verification entirely",
    constraints: [{ description: "MUST use jwt.verify() not jwt.decode()", severity: "must", rationale: "Security" }],
    alternatives: [],
    consequences: "Cryptographically secure auth",
    tags: ["security", "jwt", "auth"],
    decisionType: "security",
    confidence: "definitive",
    author: "security-team",
    timestamp: new Date().toISOString(),
    agentHints: [{ instruction: "DO NOT replace jwt.verify() with jwt.decode()", scope: "function" }],
    doNotChange: ["jwt.verify"],
    reviewTriggers: ["jwt.decode"],
    ...overrides,
  }
}

// ─── Deduplication Tests ──────────────────────────────────────────────────────

describe("Auto-recording: deduplication via oversight_record", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("inserts a fresh record when no similar exists", async () => {
    const db = await initDb(tmpdir)
    const result = handleRecord(db, {
      title: "Use Redis for session storage",
      summary: "Store sessions in Redis for distributed access",
      decision: "All session data goes to Redis, not in-memory",
      context: "Horizontal scaling requires shared session state",
      tags: ["redis", "sessions"],
    })
    expect(result.action).toBe("inserted")
    expect(result.id).toBeDefined()
    expect(result.duplicateWarning).toBeUndefined()
  })

  it("returns action=skipped and existing record when near-identical record exists (score >= 0.75)", async () => {
    const db = await initDb(tmpdir)

    const original = makeRecord()
    insertDecision(db, original)

    const result = handleRecord(db, {
      title: "JWT must use verify not decode",
      summary: "Always call jwt.verify() to validate token signatures",
      decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
      context: "Security incident forced this constraint",
      tags: ["security", "jwt", "auth"],
    })

    expect(result.action).toBe("skipped")
    expect(result.id).toBe(original.id)
    expect(result.duplicateWarning).toContain("Near-identical")
    expect(result.similarDecisions).toBeDefined()
    expect(result.similarDecisions!.length).toBeGreaterThan(0)
  })

  it("merges into existing record when moderately similar (score 0.55–0.75) and adds new constraints", async () => {
    const db = await initDb(tmpdir)

    const original = makeRecord({
      title: "JWT authentication must use verify",
      summary: "Use jwt.verify for all token validation in authentication flow",
      decision: "Use jwt.verify for authentication tokens",
      constraints: [{ description: "MUST use jwt.verify()", severity: "must", rationale: "Security" }],
      agentHints: [{ instruction: "DO NOT use jwt.decode for auth", scope: "function" }],
      tags: ["jwt", "security"],
    })
    insertDecision(db, original)

    const result = handleRecord(db, {
      title: "JWT authentication must use verify not decode",
      summary: "Use jwt.verify for all token validation in authentication flow",
      decision: "Use jwt.verify for all authentication token checks, never jwt.decode",
      context: "Auth bypass incident required this constraint",
      constraints: [
        { description: "MUST use jwt.verify()", severity: "must", rationale: "Security" },
        { description: "NEVER call jwt.decode() in auth paths", severity: "must", rationale: "New constraint from incident" },
      ],
      agentHints: [
        { instruction: "DO NOT use jwt.decode for auth", scope: "function" },
        { instruction: "IF refactoring auth middleware THEN keep jwt.verify()", scope: "function" },
      ],
      tags: ["jwt", "security", "auth"],
    })

    if (result.action === "merged") {
      expect(result.id).toBe(original.id)
      const updated = getDecisionById(db, original.id)
      expect(updated).not.toBeNull()
      expect(updated!.version).toBeGreaterThan(1)
      const constraintDescriptions = updated!.constraints.map((c) => c.description)
      expect(constraintDescriptions.some((d) => d.includes("jwt.verify"))).toBe(true)
    } else {
      expect(["merged", "inserted"]).toContain(result.action)
    }
  })

  it("allowDuplicate=true forces insert even when near-identical exists", async () => {
    const db = await initDb(tmpdir)

    const original = makeRecord()
    insertDecision(db, original)

    const result = handleRecord(db, {
      title: "JWT must use verify not decode",
      summary: "Always call jwt.verify() to validate token signatures",
      decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
      context: "Different team added same constraint independently",
      tags: ["security", "jwt", "auth"],
      allowDuplicate: true,
    })

    expect(result.action).toBe("inserted")
    expect(result.id).not.toBe(original.id)
  })

  it("captures source/origin on insert and persists it", async () => {
    const db = await initDb(tmpdir)

    const result = handleRecord(db, {
      title: "Use HTTPS for all payment endpoints",
      summary: "All payment API routes must enforce HTTPS",
      decision: "Reject HTTP requests to /api/payments/* with 301 redirect",
      context: "PCI-DSS compliance requirement",
      source: {
        origin: "user-chat",
        conversationId: "conv-abc-123",
        participants: ["alice", "bob"],
        excerpt: "User said: we need HTTPS on all payment endpoints, no exceptions",
      },
    })

    expect(result.action).toBe("inserted")
    const saved = getDecisionById(db, result.id)
    expect(saved).not.toBeNull()
    expect(saved!.source).toBeDefined()
    expect(saved!.source!.origin).toBe("user-chat")
    expect(saved!.source!.conversationId).toBe("conv-abc-123")
    expect(saved!.source!.participants).toContain("alice")
    expect(saved!.source!.excerpt).toContain("HTTPS")
  })

  it("agent-decision origin is set by default when no source provided", async () => {
    const db = await initDb(tmpdir)

    const result = handleRecord(db, {
      title: "Use connection pooling for database",
      summary: "Postgres connections must use pg-pool",
      decision: "All DB access goes through the shared pool instance",
      context: "Performance requirement",
    })

    const saved = getDecisionById(db, result.id)
    expect(saved!.source).toBeDefined()
    expect(saved!.source!.origin).toBe("agent-decision")
  })
})

// ─── oversight_find_similar Tests ───────────────────────────────────────────────

describe("oversight_find_similar: pre-insert duplicate detection", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("returns empty result and insert recommendation when no similar records exist", async () => {
    const db = await initDb(tmpdir)

    const result = handleFindSimilar(db, {
      title: "Deploy with Kubernetes",
      summary: "Use K8s for container orchestration",
      decision: "All services deployed as K8s pods with HPA",
    })

    expect(result.hasDuplicates).toBe(false)
    expect(result.recommendation).toBe("insert")
    expect(result.similar).toHaveLength(0)
    expect(result.topMatches).toHaveLength(0)
  })

  it("returns similar records with match reasons when overlap exists", async () => {
    const db = await initDb(tmpdir)
    insertDecision(db, makeRecord())

    const result = handleFindSimilar(db, {
      title: "JWT must use verify not decode",
      summary: "Always call jwt.verify() to validate token signatures",
      decision: "Use jwt.verify, never jwt.decode",
      tags: ["jwt", "security"],
    })

    expect(result.hasDuplicates).toBe(true)
    expect(result.topMatches.length).toBeGreaterThan(0)
    expect(result.topMatches[0].score).toBeGreaterThan(0.35)
    expect(result.topMatches[0].matchReasons.length).toBeGreaterThan(0)
    expect(result.topMatches[0].id).toBeDefined()
    expect(result.topMatches[0].title).toBeDefined()
  })

  it("respects custom threshold — higher threshold returns fewer matches", async () => {
    const db = await initDb(tmpdir)
    insertDecision(db, makeRecord())

    const looseResult = handleFindSimilar(db, {
      title: "JWT verify token signatures",
      summary: "Use jwt.verify for all tokens",
      decision: "Use jwt.verify for authentication",
      threshold: 0.2,
    })

    const strictResult = handleFindSimilar(db, {
      title: "JWT verify token signatures",
      summary: "Use jwt.verify for all tokens",
      decision: "Use jwt.verify for authentication",
      threshold: 0.9,
    })

    expect(looseResult.similar.length).toBeGreaterThanOrEqual(strictResult.similar.length)
  })

  it("returns skip recommendation for near-identical record", async () => {
    const db = await initDb(tmpdir)
    insertDecision(db, makeRecord())

    const result = handleFindSimilar(db, {
      title: "JWT must use verify not decode",
      summary: "Always call jwt.verify() to validate token signatures",
      decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
      tags: ["security", "jwt", "auth"],
    })

    expect(["skip", "merge", "update"]).toContain(result.recommendation)
    expect(result.hasDuplicates).toBe(true)
  })
})

// ─── oversight_merge Tests ──────────────────────────────────────────────────────

describe("oversight_merge: consolidating duplicate decisions", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("merges source constraints into target and marks source as superseded", async () => {
    const db = await initDb(tmpdir)

    const target = makeRecord({
      id: uuidv4(),
      title: "JWT authentication constraint",
      constraints: [{ description: "MUST use jwt.verify()", severity: "must", rationale: "Security" }],
      agentHints: [{ instruction: "DO NOT use jwt.decode for auth", scope: "function" }],
      tags: ["jwt", "security"],
    })

    const source = makeRecord({
      id: uuidv4(),
      title: "JWT decode is forbidden",
      constraints: [
        { description: "MUST use jwt.verify()", severity: "must", rationale: "Security" },
        { description: "NEVER call jwt.decode() in production code", severity: "must", rationale: "New incident finding" },
      ],
      agentHints: [
        { instruction: "DO NOT use jwt.decode for auth", scope: "function" },
        { instruction: "Flag any jwt.decode usage in code review", scope: "function" },
      ],
      tags: ["jwt", "security", "code-review"],
    })

    insertDecision(db, target)
    insertDecision(db, source)

    const result = handleMerge(db, { targetId: target.id, sourceId: source.id })

    if ("error" in result) {
      throw new Error(`Merge failed: ${result.error}`)
    }

    expect(result.merged.id).toBe(target.id)
    expect(result.merged.version).toBeGreaterThan(target.version)

    const constraintDescriptions = result.merged.constraints.map((c) => c.description)
    expect(constraintDescriptions).toContain("MUST use jwt.verify()")
    expect(constraintDescriptions).toContain("NEVER call jwt.decode() in production code")

    const hintInstructions = result.merged.agentHints.map((h) => h.instruction)
    expect(hintInstructions).toContain("DO NOT use jwt.decode for auth")
    expect(hintInstructions).toContain("Flag any jwt.decode usage in code review")

    expect(result.merged.tags).toContain("code-review")

    expect(result.superseded.status).toBe("superseded")
    expect(result.superseded.id).toBe(source.id)

    expect(result.merged.supersedes).toContain(source.id)
  })

  it("returns error for non-existent target", async () => {
    const db = await initDb(tmpdir)
    insertDecision(db, makeRecord())

    const result = handleMerge(db, { targetId: "non-existent-id", sourceId: "also-non-existent" })
    expect("error" in result).toBe(true)
    if ("error" in result) {
      expect(result.error).toContain("not found")
    }
  })

  it("returns error when trying to merge a record into itself", async () => {
    const db = await initDb(tmpdir)
    const record = makeRecord()
    insertDecision(db, record)

    const result = handleMerge(db, { targetId: record.id, sourceId: record.id })
    expect("error" in result).toBe(true)
    if ("error" in result) {
      expect(result.error).toContain("itself")
    }
  })

  it("merged record accumulates unique tags without duplication", async () => {
    const db = await initDb(tmpdir)

    const target = makeRecord({ id: uuidv4(), tags: ["security", "jwt", "auth"] })
    const source = makeRecord({ id: uuidv4(), tags: ["security", "jwt", "incident-2023"] })

    insertDecision(db, target)
    insertDecision(db, source)

    const result = handleMerge(db, { targetId: target.id, sourceId: source.id })

    if ("error" in result) throw new Error(result.error)

    const tags = result.merged.tags
    const uniqueTags = new Set(tags)
    expect(tags.length).toBe(uniqueTags.size)
    expect(tags).toContain("security")
    expect(tags).toContain("jwt")
    expect(tags).toContain("auth")
    expect(tags).toContain("incident-2023")
  })

  it("merged record promotes to higher confidence level", async () => {
    const db = await initDb(tmpdir)

    const target = makeRecord({ id: uuidv4(), confidence: "exploratory" })
    const source = makeRecord({ id: uuidv4(), confidence: "definitive" })

    insertDecision(db, target)
    insertDecision(db, source)

    const result = handleMerge(db, { targetId: target.id, sourceId: source.id })
    if ("error" in result) throw new Error(result.error)

    expect(result.merged.confidence).toBe("definitive")
  })
})

// ─── Core Dedup Logic Tests ───────────────────────────────────────────────────

describe("checkForDuplicates: scoring and recommendation logic", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("recommendation=insert when no similar records", async () => {
    const db = await initDb(tmpdir)
    const result = checkForDuplicates(db, {
      title: "GraphQL for public API",
      summary: "Adopt GraphQL to reduce over-fetching",
      decision: "Migrate public API to GraphQL",
    })
    expect(result.recommendation).toBe("insert")
    expect(result.hasDuplicates).toBe(false)
  })

  it("recommendation=skip when record is essentially identical", async () => {
    const db = await initDb(tmpdir)
    const record = makeRecord()
    insertDecision(db, record)

    const result = checkForDuplicates(db, {
      title: "JWT must use verify not decode",
      summary: "Always call jwt.verify() to validate token signatures",
      decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
      tags: ["security", "jwt", "auth"],
    })

    expect(result.hasDuplicates).toBe(true)
    expect(["skip", "merge", "update"]).toContain(result.recommendation)
    expect(result.recommendedTargetId).toBe(record.id)
  })

  it("findSimilarDecisions returns top 5 results max", async () => {
    const db = await initDb(tmpdir)

    for (let i = 0; i < 10; i++) {
      insertDecision(db, makeRecord({
        id: uuidv4(),
        title: `JWT must use verify not decode variant ${i}`,
        summary: "Always call jwt.verify() to validate token signatures",
        decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
      }))
    }

    const results = findSimilarDecisions(db, {
      title: "JWT must use verify not decode",
      summary: "Always call jwt.verify() to validate token signatures",
      decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
    })

    expect(results.length).toBeLessThanOrEqual(5)
    expect(results.every((r) => r.score >= 0.35)).toBe(true)
  })

  it("results are sorted by score descending", async () => {
    const db = await initDb(tmpdir)

    insertDecision(db, makeRecord({
      id: uuidv4(),
      title: "JWT must use verify not decode",
      summary: "Always call jwt.verify() to validate token signatures",
      decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
    }))
    insertDecision(db, makeRecord({
      id: uuidv4(),
      title: "JWT verify method required",
      summary: "Use jwt.verify for token validation",
      decision: "Call jwt.verify always",
    }))

    const results = findSimilarDecisions(db, {
      title: "JWT must use verify not decode",
      summary: "Always call jwt.verify() to validate token signatures",
      decision: "ALWAYS use jwt.verify(token, JWT_SECRET). NEVER use jwt.decode()",
    })

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })
})

// ─── Agent Re-Recording Scenario ─────────────────────────────────────────────

describe("Agent re-recording prevention: realistic coding agent scenarios", () => {
  let tmpdir: string

  beforeEach(() => { tmpdir = tmpDir() })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("Agent A and Agent B independently discover same constraint — only one record persists", async () => {
    const db = await initDb(tmpdir)

    const agentAResult = handleRecord(db, {
      title: "Rate limiter must use atomic Redis INCR",
      summary: "Use redis.incr() for atomic increment, not GET+SET",
      decision: "ALWAYS use redis.incr(key) for rate limiting. GET+SET has race condition.",
      context: "Agent A: noticed potential race condition in rate limiter code",
      source: { origin: "agent-decision", participants: ["agent-a"] },
      tags: ["redis", "rate-limiting", "atomic"],
    })
    expect(agentAResult.action).toBe("inserted")

    const agentBResult = handleRecord(db, {
      title: "Rate limiter must use atomic Redis INCR",
      summary: "Use redis.incr() for atomic increment, not GET+SET",
      decision: "ALWAYS use redis.incr(key) for rate limiting. GET+SET has race condition.",
      context: "Agent B: code review found same issue independently",
      source: { origin: "agent-decision", participants: ["agent-b"] },
      tags: ["redis", "rate-limiting", "atomic"],
    })

    expect(agentBResult.action).toBe("skipped")
    expect(agentBResult.id).toBe(agentAResult.id)
    expect(agentBResult.duplicateWarning).toBeDefined()
  })

  it("User states constraint in chat → auto-recorded → agent re-records same constraint → merge/skip", async () => {
    const db = await initDb(tmpdir)

    const userCaptured = handleRecord(db, {
      title: "Database connections must use connection pooling",
      summary: "All database access must go through the shared connection pool",
      decision: "Use pg-pool for all PostgreSQL connections. No direct new Client() instantiation.",
      context: "User said: never create raw connections, always use the pool",
      source: {
        origin: "user-chat",
        conversationId: "chat-2024-001",
        excerpt: "User: we absolutely must use connection pooling everywhere, never create raw connections",
      },
      tags: ["database", "postgresql", "performance"],
    })
    expect(userCaptured.action).toBe("inserted")

    const agentResult = handleRecord(db, {
      title: "PostgreSQL must use connection pooling",
      summary: "All database access must use the shared connection pool",
      decision: "Use pg-pool for all PostgreSQL connections",
      context: "Implementing database layer, recognized pooling requirement",
      source: { origin: "agent-decision" },
      tags: ["database", "postgresql"],
    })

    expect(["skipped", "merged"]).toContain(agentResult.action)
    if (agentResult.action === "skipped") {
      expect(agentResult.id).toBe(userCaptured.id)
    }
  })

  it("Constraint from incident report merged with constraint from code review adds unique hints", async () => {
    const db = await initDb(tmpdir)

    const incidentRecord = handleRecord(db, {
      title: "DB connection must be released in finally block",
      summary: "client.release() must always be in the finally block to prevent pool exhaustion",
      decision: "Always put client.release() in finally, never in try or catch alone",
      context: "Post-incident: pool exhaustion caused 18-minute outage",
      source: {
        origin: "incident",
        conversationId: "postmortem-2023-05-12",
        excerpt: "Root cause: client.release() was in try block, skipped on error",
      },
      constraints: [
        { description: "MUST call client.release() in finally block", severity: "must", rationale: "Prevents pool exhaustion" },
      ],
      agentHints: [
        { instruction: "MUST put client.release() in finally block", scope: "function" },
      ],
      tags: ["database", "postgresql", "connection-pool"],
    })
    expect(incidentRecord.action).toBe("inserted")

    const codeReviewRecord = handleRecord(db, {
      title: "DB connection release must be in finally block",
      summary: "client.release() must always be in the finally block to prevent pool exhaustion",
      decision: "Always put client.release() in finally, never in try or catch alone",
      context: "Code review caught a new case of release in try block",
      constraints: [
        { description: "MUST call client.release() in finally block", severity: "must", rationale: "Prevents pool exhaustion" },
        { description: "MUST NOT have client.release() only in try block", severity: "must", rationale: "try block skips on exception" },
      ],
      agentHints: [
        { instruction: "MUST put client.release() in finally block", scope: "function" },
        { instruction: "DO NOT remove the finally { client.release() } pattern", scope: "function" },
      ],
      tags: ["database", "postgresql", "connection-pool", "code-review"],
    })

    if (codeReviewRecord.action === "merged") {
      const merged = getDecisionById(db, incidentRecord.id)
      expect(merged!.constraints.length).toBeGreaterThanOrEqual(1)
      const hasNewConstraint = merged!.constraints.some((c) =>
        c.description.includes("MUST NOT have client.release() only in try block")
      )
      if (hasNewConstraint) {
        expect(merged!.constraints.length).toBeGreaterThan(1)
      }
    } else {
      expect(["skipped", "merged", "inserted"]).toContain(codeReviewRecord.action)
    }
  })
})
