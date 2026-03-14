import Anthropic from "@anthropic-ai/sdk"
import type { WhyCodeRecord, StalenessResult } from "../types/index.js"

const client = new Anthropic()

export async function checkStaleness(
  record: WhyCodeRecord,
  fileContents: Map<string, string>
): Promise<StalenessResult> {
  const filesSection = Array.from(fileContents.entries())
    .map(([p, content]) => `--- ${p} ---\n${content.slice(0, 2000)}`)
    .join("\n\n")

  const prompt = `You are reviewing whether a code decision record is still valid.

Decision Record:
Title: ${record.title}
Summary: ${record.summary}
Decision: ${record.decision}
Rationale: ${record.rationale}
Timestamp: ${record.timestamp}
Confidence: ${record.confidence}

Current file contents:
${filesSection || "(no file contents provided)"}

Return ONLY valid JSON:
{
  "likelyStale": boolean,
  "reason": "explanation",
  "suggestedAction": "what to do"
}`

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  })

  const block = response.content[0]
  if (block.type !== "text") throw new Error("Unexpected response type from AI")

  const jsonMatch = block.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("AI returned no JSON for staleness check")

  return JSON.parse(jsonMatch[0]) as StalenessResult
}
