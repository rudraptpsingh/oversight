import { useEffect, useState } from "react"
import type { Page } from "../types"
import { fetchCoverage } from "../api"
import type { CoverageData } from "../api"
import styles from "./CoveragePage.module.css"

interface Props {
  onNavigate: (p: Page) => void
}

export default function CoveragePage({ onNavigate }: Props) {
  const [coverage, setCoverage] = useState<CoverageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCoverage()
      .then((data) => {
        setCoverage(data)
        setError(null)
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className={styles.centerState}>
        <div className={styles.spinner} />
        <p>Loading coverage...</p>
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

  if (!coverage) return null

  const scorePct = Math.round((coverage.coverage_score ?? 0) * 100)
  const scoreColor = scorePct > 70 ? "var(--green)" : scorePct > 30 ? "var(--yellow)" : "var(--red)"
  const gaps = coverage.coverage_gaps ?? []

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Coverage</h1>
        <p className={styles.subtitle}>Decision coverage across your codebase</p>
      </div>

      <div className={styles.scoreCard}>
        <div className={styles.scoreLarge} style={{ color: scoreColor }}>
          {scorePct}%
        </div>
        <div className={styles.scoreLabel}>Coverage Score</div>
        <div className={styles.gaugeTrack}>
          <div
            className={styles.gaugeFill}
            style={{ width: `${scorePct}%`, background: scoreColor }}
          />
        </div>
        <div className={styles.scoreMeta}>
          <span>{coverage.total_decisions} decisions recorded</span>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Coverage Gaps</h2>
        {gaps.length === 0 ? (
          <div className={styles.empty}>
            <p>No coverage gaps detected.</p>
          </div>
        ) : (
          <div className={styles.gapsTable}>
            <div className={styles.tableHeader}>
              <span className={styles.colFile}>File</span>
              <span className={styles.colReason}>Reason</span>
              <span className={styles.colAction} />
            </div>
            {gaps.map((gap, i) => (
              <div key={i} className={styles.tableRow}>
                <span className={styles.colFile}>
                  <code className={styles.filePath}>{gap.file}</code>
                </span>
                <span className={styles.colReason}>{gap.reason}</span>
                <span className={styles.colAction}>
                  <button
                    className={styles.captureButton}
                    onClick={() => onNavigate({ name: "decisions" })}
                  >
                    Capture
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
