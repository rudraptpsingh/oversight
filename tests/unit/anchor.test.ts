import { describe, it, expect } from "vitest"
import { matchesAnchor, formatAnchorsForDisplay } from "../../src/utils/anchor.js"
import type { WhyCodeRecord, CodeAnchor } from "../../src/types/index.js"

function makeRecord(anchors: CodeAnchor[]): WhyCodeRecord {
  return {
    id: "test-id", version: 1, status: "active", anchors,
    title: "Test", summary: "test", context: "", decision: "", rationale: "",
    constraints: [], alternatives: [], consequences: "", tags: [],
    decisionType: "architectural", confidence: "provisional", author: "test",
    timestamp: new Date().toISOString(), agentHints: [], doNotChange: [], reviewTriggers: [],
  }
}

describe("matchesAnchor", () => {
  it("matches exact path", () => {
    const r = makeRecord([{ type: "file", path: "src/auth/validator.ts" }])
    expect(matchesAnchor(r, "src/auth/validator.ts")).toBe(true)
  })

  it("strips leading ./", () => {
    const r = makeRecord([{ type: "file", path: "./src/auth/validator.ts" }])
    expect(matchesAnchor(r, "src/auth/validator.ts")).toBe(true)
  })

  it("matches parent directory", () => {
    const r = makeRecord([{ type: "file", path: "src/auth" }])
    expect(matchesAnchor(r, "src/auth/validator.ts")).toBe(true)
  })

  it("does not match unrelated path", () => {
    const r = makeRecord([{ type: "file", path: "src/auth/validator.ts" }])
    expect(matchesAnchor(r, "src/user/service.ts")).toBe(false)
  })

  it("returns false when no anchors", () => {
    const r = makeRecord([])
    expect(matchesAnchor(r, "src/anything.ts")).toBe(false)
  })
})

describe("formatAnchorsForDisplay", () => {
  it("formats file paths", () => {
    expect(formatAnchorsForDisplay([{ type: "file", path: "src/auth.ts" }])).toBe("src/auth.ts")
  })

  it("includes identifier", () => {
    expect(formatAnchorsForDisplay([{ type: "function", path: "src/auth.ts", identifier: "validateToken" }])).toBe("src/auth.ts (validateToken)")
  })

  it("includes line range", () => {
    expect(formatAnchorsForDisplay([{ type: "line-range", path: "src/auth.ts", lineRange: [10, 20] }])).toBe("src/auth.ts:10-20")
  })

  it("joins multiple anchors", () => {
    expect(formatAnchorsForDisplay([{ type: "file", path: "src/a.ts" }, { type: "file", path: "src/b.ts" }])).toBe("src/a.ts, src/b.ts")
  })
})
