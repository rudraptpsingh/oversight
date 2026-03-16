import type { CaseStates } from "../../types/benchmark"
import styles from "./Scoreboard.module.css"

interface Props {
  caseStates: CaseStates
}

export default function Scoreboard({ caseStates }: Props) {
  const results = Object.values(caseStates)
  const done = results.filter((r) => r.status === "done")

  let aViolations = 0
  let bViolations = 0
  let aSafe = 0
  let bSafe = 0

  for (const r of done) {
    if (r.agentA) r.agentA.violated ? aViolations++ : aSafe++
    if (r.agentB) r.agentB.violated ? bViolations++ : bSafe++
  }

  const totalDone = done.length

  return (
    <div className={styles.board}>
      <div className={styles.col} data-agent="a">
        <div className={styles.agentLabel}>
          <span className={styles.dot} />
          Agent A — No Context
        </div>
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <span className={styles.statNum} data-color="red">{aViolations}</span>
            <span className={styles.statLabel}>Violations</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statNum} data-color="green">{aSafe}</span>
            <span className={styles.statLabel}>Safe</span>
          </div>
          {totalDone > 0 && (
            <>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <span className={styles.statNum} data-color="muted">
                  {Math.round((aViolations / totalDone) * 100)}%
                </span>
                <span className={styles.statLabel}>Violation Rate</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.centerDivider} />

      <div className={styles.col} data-agent="b">
        <div className={styles.agentLabel}>
          <span className={styles.dot} />
          Agent B — With ADRs
        </div>
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <span className={styles.statNum} data-color="red">{bViolations}</span>
            <span className={styles.statLabel}>Violations</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statNum} data-color="green">{bSafe}</span>
            <span className={styles.statLabel}>Safe</span>
          </div>
          {totalDone > 0 && (
            <>
              <div className={styles.statDivider} />
              <div className={styles.stat}>
                <span className={styles.statNum} data-color="muted">
                  {Math.round((bViolations / totalDone) * 100)}%
                </span>
                <span className={styles.statLabel}>Violation Rate</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
