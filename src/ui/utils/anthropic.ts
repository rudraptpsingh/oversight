const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
const MODEL = "claude-sonnet-4-20250514"

export interface RunAgentResult {
  output: string
  latencyMs: number
}

export async function runAgent(opts: {
  systemPrompt: string
  userPrompt: string
}): Promise<RunAgentResult> {
  const start = performance.now()

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.userPrompt }],
    }),
  })

  const latencyMs = Math.round(performance.now() - start)

  if (!res.ok) {
    let detail = ""
    try {
      const errBody = (await res.json()) as { error?: { message?: string } }
      detail = errBody?.error?.message ?? ""
    } catch {
      /* ignore */
    }
    throw new Error(`Anthropic API ${res.status}: ${detail}`)
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>
  }

  const textBlock = data.content.find((b) => b.type === "text")
  if (!textBlock) {
    throw new Error("No text block in Anthropic response")
  }

  return { output: textBlock.text, latencyMs }
}
