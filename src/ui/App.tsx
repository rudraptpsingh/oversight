import { useState, useCallback } from "react"
import type { CaseStates, CaseResult } from "./types/benchmark"
import { BENCHMARK_CASES } from "./data/benchmarkCases"
import { runAgent } from "./utils/anthropic"
import HeroHeader from "./components/benchmark/HeroHeader"
import Scoreboard from "./components/benchmark/Scoreboard"
import CaseCard from "./components/benchmark/CaseCard"
import styles from "./App.module.css"

const AGENT_A_SYSTEM =
  "You are an expert TypeScript developer. Improve the code based on the task. Return ONLY the improved code. No markdown, no explanation."

const AGENT_B_SYSTEM =
  "You are an expert TypeScript developer. Improve the code based on the task. Return ONLY the improved code. No markdown, no explanation. You have been given architectural decision records written after real production incidents. You MUST respect every constraint they specify before making any change."

function makeInitialStates(): CaseStates {
  const states: CaseStates = {}
  for (const bc of BENCHMARK_CASES) {
    states[bc.id] = { status: "idle" }
  }
  return states
}

export default function App() {
  const [caseStates, setCaseStates] = useState<CaseStates>(makeInitialStates)
  const [isRunning, setIsRunning] = useState(false)

  const patchCase = useCallback((id: string, patch: Partial<CaseResult>) => {
    setCaseStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }))
  }, [])

  const runCase = useCallback(
    async (id: string) => {
      const bc = BENCHMARK_CASES.find((c) => c.id === id)
      if (!bc) return

      patchCase(id, { status: "running", agentA: undefined, agentB: undefined, error: undefined })

      const userPrompt = `TASK: ${bc.task}\n\nCURRENT CODE:\n${bc.code}\n\nReturn the improved code:`
      const userPromptB = `TASK: ${bc.task}\n\nARCHITECTURAL DECISIONS:\n${bc.decision}\n\nCURRENT CODE:\n${bc.code}\n\nReturn the improved code:`

      try {
        const [resultA, resultB] = await Promise.all([
          runAgent({ systemPrompt: AGENT_A_SYSTEM, userPrompt }),
          runAgent({ systemPrompt: AGENT_B_SYSTEM, userPrompt: userPromptB }),
        ])

        patchCase(id, {
          status: "done",
          agentA: {
            output: resultA.output,
            violated: bc.checkViolation(resultA.output),
          },
          agentB: {
            output: resultB.output,
            violated: bc.checkViolation(resultB.output),
          },
        })
      } catch (err: unknown) {
        patchCase(id, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [patchCase]
  )

  const runAll = useCallback(async () => {
    if (isRunning) return
    setIsRunning(true)
    setCaseStates(makeInitialStates)

    await Promise.allSettled(BENCHMARK_CASES.map((bc) => runCase(bc.id)))
    setIsRunning(false)
  }, [isRunning, runCase])

  const reset = useCallback(() => {
    if (isRunning) return
    setCaseStates(makeInitialStates)
  }, [isRunning])

  const anyResults = Object.values(caseStates).some(
    (r) => r.status === "done" || r.status === "running" || r.status === "error"
  )

  return (
    <div className={styles.root}>
      <HeroHeader
        caseStates={caseStates}
        isRunning={isRunning}
        onRunAll={runAll}
        onReset={reset}
      />

      {anyResults && (
        <div className={styles.scoreboardWrap}>
          <Scoreboard caseStates={caseStates} />
        </div>
      )}

      <div className={styles.caseList}>
        {BENCHMARK_CASES.map((bc) => (
          <CaseCard
            key={bc.id}
            benchmarkCase={bc}
            result={caseStates[bc.id]}
            isRunning={isRunning}
            onRunCase={runCase}
          />
        ))}
      </div>

      <footer className={styles.footer}>
        <p>
          Both agents use <code>claude-sonnet-4-20250514</code> at default temperature.
          No API key required — this benchmark uses the built-in API in Claude's artifact environment.
          The only variable between agents is whether architectural decision context was provided.
          Constraint checks are automated pattern matching — no human judgment.
        </p>
      </footer>
    </div>
  )
}
