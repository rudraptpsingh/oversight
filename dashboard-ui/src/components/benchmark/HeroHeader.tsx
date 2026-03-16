import type { CaseStates } from "../../types/benchmark"
import styles from "./HeroHeader.module.css"

interface Props {
  caseStates: CaseStates
  isRunning: boolean
  onRunAll: () => void
  onReset: () => void
}

export default function HeroHeader({ caseStates, isRunning, onRunAll, onReset }: Props) {
  const results = Object.values(caseStates)
  const doneCount = results.filter((r) => r.status === "done" || r.status === "error").length
  const totalCount = results.length
  const hasAnyResult = doneCount > 0

  return (
    <header className={styles.hero}>
      <div className={styles.eyebrow}>Automated AI Agent Evaluation</div>
      <h1 className={styles.title}>Oversight Benchmark</h1>
      <p className={styles.subtitle}>
        Two identical agents. One gets architectural decision records. Same model, same temperature.
        <br />
        Automated checkers determine if agents respect production constraints.
      </p>

      <div className={styles.agentLabels}>
        <div className={styles.agentPill} data-agent="a">
          <span className={styles.agentDot} />
          <span>Agent A — No Context</span>
        </div>
        <div className={styles.vsLabel}>vs</div>
        <div className={styles.agentPill} data-agent="b">
          <span className={styles.agentDot} />
          <span>Agent B — With ADRs</span>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.runBtn}
          onClick={hasAnyResult ? onReset : onRunAll}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <span className={styles.spinner} />
              Running {doneCount}/{totalCount}…
            </>
          ) : hasAnyResult ? (
            "Reset & Run Again"
          ) : (
            "Run All 5 Cases"
          )}
        </button>
      </div>
    </header>
  )
}
