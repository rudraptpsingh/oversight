import { useEffect, useState } from "react"
import type { Page } from "../types"
import { fetchSessionReport } from "../api"
import styles from "./ConfidencePage.module.css"

interface Props {
  onNavigate: (p: Page) => void
}

interface UnreliableConstraint {
  id?: number
  description: string
  consistency_score: number
  decision_id?: string
  decision_title?: string
}

interface ConfidenceDelta {
  decision_id?: string
  decision_title?: string
  description: string
  old_score: number
  new_score: number
}

interface SessionReport {
  found?: boolean
  summary?: {
    avg_confidence?: number
    total_constraints?: number
  }
  unreliable_constraints?: UnreliableConstraint[]
  confidence_deltas?: ConfidenceDelta[]
}

export default function ConfidencePage({ onNavigate }: Props) {
  const [report, setReport] = useState<SessionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function doFetch() {
      fetchSessionReport()
        .then((data) => {
          setReport(data as SessionReport)
          setError(null)
        })
        .catch((e: unknown) => setError(String(e)))
        .finally(() => setLoading(false))
    }
    doFetch()
    const timer = setInterval(doFetch, 30_000)
    return () => clearInterval(timer)
  }, [])

  if (loading) {
    return (
      <div className={styles.centerState}>
        <div className={styles.spinner} />
        <p>Loading confidence data...</p>
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

  if (!report || report.found === false) {
    return (
      <div className={styles.centerState}>
        <p className={styles.emptyText}>No session report found. Run <code>oversight scan</code> to generate one.</p>
      </div>
    )
  }

  const avgConfidence = report.summary?.avg_confidence ?? 0
  const totalConstraints = report.summary?.total_constraints ?? 0
  const unreliable = report.unreliable_constraints ?? []
  const deltas = report.confidence_deltas ?? []
  const confidencePct = Math.round(avgConfidence * 100)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Constraint Confidence</h1>
        <p className={styles.subtitle}>Reliability scores for tracked architectural constraints</p>
      </div>

      <div className={styles.summaryBar}>
        <div className={styles.stat}>
          <div className={styles.statValue} style={{ color: confidenceColor(avgConfidence) }}>
            {confidencePct}%
          </div>
          <div className={styles.statLabel}>Avg Confidence</div>
        </div>
        <div className={styles.gaugeTrack}>
          <div
            className={styles.gaugeFill}
            style={{ width: `${confidencePct}%`, background: confidenceColor(avgConfidence) }}
          />
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{totalConstraints}</div>
          <div className={styles.statLabel}>Total Constraints</div>
        </div>
      </div>

      {unreliable.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Unreliable Constraints</h2>
          <p className={styles.sectionSubtitle}>Constraints with consistency score below 50%</p>
          <div className={styles.list}>
            {unreliable.map((c, i) => (
              <div key={c.id ?? i} className={styles.unreliableCard}>
                <div className={styles.unreliableHeader}>
                  <span className={styles.redBadge}>LOW</span>
                  <span className={styles.scoreText}>{Math.round((c.consistency_score ?? 0) * 100)}% consistent</span>
                  {c.decision_id && (
                    <button
                      className={styles.decisionLink}
                      onClick={() => onNavigate({ name: "decision-detail", id: c.decision_id! })}
                    >
                      {c.decision_title ?? c.decision_id}
                    </button>
                  )}
                </div>
                <p className={styles.constraintDesc}>{c.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {deltas.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Recent Confidence Changes</h2>
          <div className={styles.deltaList}>
            {deltas.map((d, i) => {
              const diff = d.new_score - d.old_score
              const up = diff > 0
              return (
                <div key={i} className={styles.deltaRow}>
                  <span className={up ? styles.arrowUp : styles.arrowDown}>
                    {up ? "▲" : "▼"}
                  </span>
                  <span className={styles.deltaDesc}>{d.description}</span>
                  <span className={styles.deltaScore}>
                    {Math.round(d.old_score * 100)}% → {Math.round(d.new_score * 100)}%
                  </span>
                  {d.decision_id && (
                    <button
                      className={styles.decisionLink}
                      onClick={() => onNavigate({ name: "decision-detail", id: d.decision_id! })}
                    >
                      {d.decision_title ?? d.decision_id}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {unreliable.length === 0 && deltas.length === 0 && (
        <div className={styles.empty}>
          <p>All constraints are reliable. No confidence issues detected.</p>
        </div>
      )}
    </div>
  )
}

function confidenceColor(score: number): string {
  if (score >= 0.7) return "var(--green)"
  if (score >= 0.4) return "var(--yellow)"
  return "var(--red)"
}
