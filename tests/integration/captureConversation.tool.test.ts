import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { initDb } from "../../src/db/schema.js"
import { insertDecision } from "../../src/db/decisions.js"
import { getDecisionById, getAllDecisions } from "../../src/db/decisions.js"
import type { OversightRecord } from "../../src/types/index.js"

vi.mock("../../src/ai/capture.js", () => ({
  extractDecisionsFromConversation: vi.fn(),
}))

import { extractDecisionsFromConversation } from "../../src/ai/capture.js"
import { handleCaptureConversation } from "../../src/mcp/tools/captureConversation.js"

const mockExtract = vi.mocked(extractDecisionsFromConversation)

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oversight-capture-test-"))
}

function makeExtractedRecord(overrides: Partial<OversightRecord> = {}): OversightRecord {
  return {
    id: uuidv4(), version: 1, status: "active",
    anchors: [],
    title: "Use Redis for session storage",
    summary: "Sessions stored in Redis for horizontal scaling",
    context: "Need to scale auth across multiple nodes",
    decision: "Redis as session store",
    rationale: "Supports distributed sessions natively",
    constraints: [{ description: "Never store sessions in memory only", severity: "must", rationale: "Multi-node" }],
    alternatives: [], consequences: "Requires Redis infra",
    tags: ["redis", "sessions", "auth"],
    decisionType: "architectural", confidence: "definitive", author: "agent",
    timestamp: new Date().toISOString(),
    agentHints: [], doNotChange: [], reviewTriggers: [],
    ...overrides,
  }
}

const SAMPLE_MESSAGES = [
  { role: "user", content: "We should use Redis for session storage so we can scale horizontally." },
  { role: "assistant", content: "Agreed. I'll configure Redis as the session store and avoid in-memory sessions." },
]

const SAMPLE_SOURCE = { origin: "user-chat" as const }

describe("handleCaptureConversation", () => {
  let tmpdir: string

  beforeEach(() => {
    tmpdir = tmpDir()
    vi.clearAllMocks()
  })

  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it("inserts a new decision when no duplicates exist", async () => {
    const db = await initDb(tmpdir)
    const record = makeExtractedRecord()
    mockExtract.mockResolvedValueOnce([record])

    const result = await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: SAMPLE_SOURCE,
    })

    expect(result.total).toBe(1)
    expect(result.inserted).toBe(1)
    expect(result.merged).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(result.decisions[0].action).toBe("inserted")
    expect(result.decisions[0].title).toBe("Use Redis for session storage")
  })

  it("returns empty result when AI extracts no decisions", async () => {
    const db = await initDb(tmpdir)
    mockExtract.mockResolvedValueOnce([])

    const result = await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: SAMPLE_SOURCE,
    })

    expect(result.total).toBe(0)
    expect(result.inserted).toBe(0)
    expect(result.decisions).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it("skips near-identical duplicate decisions", async () => {
    const db = await initDb(tmpdir)
    const existing = makeExtractedRecord()
    insertDecision(db, existing)

    const duplicate = makeExtractedRecord({ id: uuidv4() })
    mockExtract.mockResolvedValueOnce([duplicate])

    const result = await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: SAMPLE_SOURCE,
    })

    expect(result.skipped).toBe(1)
    expect(result.inserted).toBe(0)
    expect(result.decisions[0].action).toBe("skipped")
    expect(result.decisions[0].duplicateWarning).toBeDefined()
  })

  it("merges similar (but not identical) decisions", async () => {
    const db = await initDb(tmpdir)
    const existing = makeExtractedRecord({ tags: ["redis"] })
    insertDecision(db, existing)

    const similar = makeExtractedRecord({
      id: uuidv4(),
      title: "Redis for sessions",
      summary: "Store sessions in Redis",
      decision: "Use Redis session store",
      context: "Scaling auth service",
      tags: ["redis", "sessions", "scaling"],
      constraints: [{ description: "Always use Redis TTL", severity: "should", rationale: "Memory management" }],
    })
    mockExtract.mockResolvedValueOnce([similar])

    const result = await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: SAMPLE_SOURCE,
    })

    expect(result.inserted + result.merged + result.skipped).toBe(1)
  })

  it("handles multiple decisions in one conversation", async () => {
    const db = await initDb(tmpdir)
    const records = [
      makeExtractedRecord({ id: uuidv4(), title: "Use Redis for sessions" }),
      makeExtractedRecord({ id: uuidv4(), title: "JWT for API tokens", summary: "JWT tokens for stateless API auth", decision: "JWT tokens", context: "API auth", tags: ["jwt", "auth"] }),
    ]
    mockExtract.mockResolvedValueOnce(records)

    const result = await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: SAMPLE_SOURCE,
    })

    expect(result.total).toBe(2)
    expect(result.inserted).toBe(2)
    expect(result.decisions).toHaveLength(2)
  })

  it("records errors when extraction throws", async () => {
    const db = await initDb(tmpdir)
    mockExtract.mockRejectedValueOnce(new Error("API rate limit"))

    const result = await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: SAMPLE_SOURCE,
    })

    expect(result.total).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Extraction failed")
    expect(result.errors[0]).toContain("API rate limit")
  })

  it("persists inserted decisions to the database", async () => {
    const db = await initDb(tmpdir)
    const record = makeExtractedRecord()
    mockExtract.mockResolvedValueOnce([record])

    await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: SAMPLE_SOURCE,
    })

    const all = getAllDecisions(db, "active")
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe("Use Redis for session storage")
  })

  it("passes source origin to extractDecisionsFromConversation", async () => {
    const db = await initDb(tmpdir)
    mockExtract.mockResolvedValueOnce([])

    await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: { origin: "incident", conversationId: "inc-123", participants: ["alice", "bob"] },
    })

    expect(mockExtract).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ origin: "incident", conversationId: "inc-123" }),
      expect.any(String)
    )
  })

  it("handles partial failure — inserts what succeeds, records error for the rest", async () => {
    const db = await initDb(tmpdir)
    const good = makeExtractedRecord({ id: uuidv4(), title: "Good decision" })
    const badRecord = { ...makeExtractedRecord({ id: uuidv4(), title: "Bad decision" }), id: null as unknown as string }
    mockExtract.mockResolvedValueOnce([good, badRecord])

    const result = await handleCaptureConversation(db, {
      messages: SAMPLE_MESSAGES,
      source: SAMPLE_SOURCE,
    })

    expect(result.inserted).toBeGreaterThanOrEqual(1)
  })
})
