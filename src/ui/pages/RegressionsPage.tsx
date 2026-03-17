import { useEffect, useState } from "react"
import type { Page } from "../types"
import { fetchRegressions, resolveRegression } from "../api"
import type { RegressionRow } from "../api"
import styles from "./RegressionsPage.module.css"

interface Props {
  onNavigate: (p: Page) => void
}

export default function RegressionsPage({ onNavigate }: Props) {
  const [rows, setRows] = useState<RegressionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetchRegressions()
      .then((data) => {
        setRows(data)
        setError(null)
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  async function handleResolve(id: number) {
    setResolving((prev) => new Set(prev).add(id))
    try {
      await resolveRegression(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (e: unknown) {
      alert(`Failed to resolve: ${String(e)}`)
    } finally {
      setResolving((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className={styles.centerState}>
        <div className={styles.spinner} />
        <p>Loading regressions...</p>
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
        <h1 className={styles.title}>Regressions</h1>
        <p className={styles.subtitle}>Unresolved test failures linked to decisions</p>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <p>No unresolved regressions.</p>
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colTest}>Test</span>
            <span className={styles.colCommit}>Commit</span>
            <span className={styles.colDecision}>Decision</span>
            <span className={styles.colDate}>Date</span>
            <span className={styles.colAction} />
          </div>
          {rows.map((row) => (
            <div key={row.id} className={styles.tableRow}>
              <span className={styles.colTest}>
                <span className={styles.testName}>{row.testName}</span>
              </span>
              <span className={styles.colCommit}>
                <code className={styles.sha}>{row.commitSha.slice(0, 8)}</code>
              </span>
              <span className={styles.colDecision}>
                {row.decisionId ? (
                  <button
                    className={styles.decisionLink}
                    onClick={() => onNavigate({ name: "decision-detail", id: row.decisionId! })}
                  >
                    {row.decisionId.slice(0, 12)}...
                  </button>
                ) : (
                  <span className={styles.noDecision}>—</span>
                )}
              </span>
              <span className={styles.colDate}>
                {formatDate(row.createdAt)}
              </span>
              <span className={styles.colAction}>
                <button
                  className={styles.resolveButton}
                  onClick={() => handleResolve(row.id)}
                  disabled={resolving.has(row.id)}
                >
                  {resolving.has(row.id) ? "Resolving..." : "Resolve"}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return String(ts)
  }
}
