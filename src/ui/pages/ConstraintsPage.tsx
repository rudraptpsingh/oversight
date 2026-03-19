import { useEffect, useState } from "react"
import type { Page } from "../types"
import { fetchDecisions } from "../api"
import type { OversightRecord, Constraint } from "../types"
import { constraintBadge } from "../components/Badge"
import styles from "./ConstraintsPage.module.css"

interface Props {
  onNavigate: (p: Page) => void
}

interface ConstraintWithDecision {
  constraint: Constraint
  decision: OversightRecord
}

export default function ConstraintsPage({ onNavigate }: Props) {
  const [decisions, setDecisions] = useState<OversightRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function doFetch() {
      fetchDecisions({ limit: 200 })
        .then((data) => {
          setDecisions(data)
          setError(null)
        })
        .catch((e: unknown) => setError(String(e)))
        .finally(() => setLoading(false))
    }
    doFetch()
    const timer = setInterval(doFetch, 30_000)
    return () => clearInterval(timer)
  }, [])

  const constraintsWithDecisions: ConstraintWithDecision[] = decisions.flatMap((d) =>
    d.constraints.map((c) => ({ constraint: c, decision: d }))
  )

  if (loading) {
    return (
      <div className={styles.centerState}>
        <div className={styles.spinner} />
        <p>Loading constraints...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.centerState}>
        <p className={styles.errorText}>Failed to load: {error}</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Constraints</h1>
        <p className={styles.subtitle}>
          All architectural constraints across decisions. Agents check these before making changes.
        </p>
      </div>

      {constraintsWithDecisions.length === 0 ? (
        <div className={styles.empty}>
          <p>No constraints recorded yet.</p>
          <p>Add constraints when capturing decisions with <code>oversight capture</code>.</p>
        </div>
      ) : (
        <div className={styles.constraintList}>
          {constraintsWithDecisions.map(({ constraint, decision }, i) => (
            <div key={`${decision.id}-${i}`} className={styles.constraintCard}>
              <div className={styles.constraintHeader}>
                {constraintBadge(constraint.severity)}
                <button
                  className={styles.decisionLink}
                  onClick={() => onNavigate({ name: "decision-detail", id: decision.id })}
                >
                  {decision.title}
                </button>
              </div>
              <p className={styles.constraintDesc}>{constraint.description}</p>
              {constraint.rationale && (
                <p className={styles.constraintRationale}>{constraint.rationale}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
