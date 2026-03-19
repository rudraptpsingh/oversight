import { useEffect, useState } from "react"
import type { Page } from "../types"
import { fetchBacklog, resolveBacklogItem } from "../api"
import type { BacklogItem } from "../api"
import styles from "./BacklogPage.module.css"

interface Props {
  onNavigate: (p: Page) => void
}

const PRIORITY_ORDER: BacklogItem['priority'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

const PRIORITY_LABELS: Record<BacklogItem['priority'], string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
}

export default function BacklogPage({ onNavigate }: Props) {
  const [items, setItems] = useState<BacklogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<Set<string>>(new Set())

  useEffect(() => {
    function doFetch() {
      fetchBacklog()
        .then((data) => {
          setItems(data)
          setError(null)
        })
        .catch((e: unknown) => setError(String(e)))
        .finally(() => setLoading(false))
    }
    doFetch()
    const timer = setInterval(doFetch, 30_000)
    return () => clearInterval(timer)
  }, [])

  async function handleResolve(id: string) {
    setResolving((prev) => new Set(prev).add(id))
    try {
      await resolveBacklogItem(id)
      setItems((prev) => prev.filter((item) => item.id !== id))
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
        <p>Loading backlog...</p>
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
        <h1 className={styles.title}>Decision Backlog</h1>
        <p className={styles.subtitle}>
          {items.length === 0
            ? "Decision debt: 0. Your codebase is fully documented."
            : `${items.length} item${items.length !== 1 ? 's' : ''} requiring attention`}
        </p>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <p>Decision debt: 0. Your codebase is fully documented.</p>
        </div>
      ) : (
        <div className={styles.swimlanes}>
          {PRIORITY_ORDER.map((priority) => {
            const group = items.filter((item) => item.priority === priority)
            if (group.length === 0) return null
            return (
              <div key={priority} className={styles.swimlane}>
                <div className={`${styles.swimlaneHeader} ${styles[`priority${priority}`]}`}>
                  <span className={styles.priorityBadge}>{PRIORITY_LABELS[priority]}</span>
                  <span className={styles.priorityCount}>{group.length}</span>
                </div>
                <div className={styles.cardList}>
                  {group.map((item) => (
                    <div key={item.id} className={styles.card}>
                      <div className={styles.cardHeader}>
                        <span className={`${styles.priorityTag} ${styles[`tag${priority}`]}`}>
                          {PRIORITY_LABELS[priority]}
                        </span>
                        <span className={styles.typeTag}>{item.type}</span>
                      </div>
                      <p className={styles.cardTitle}>{item.title}</p>
                      <p className={styles.cardEvidence}>{item.evidence}</p>
                      <div className={styles.cardActions}>
                        {item.decisionId && (
                          <button
                            className={styles.viewLink}
                            onClick={() => onNavigate({ name: "decision-detail", id: item.decisionId! })}
                          >
                            View Decision
                          </button>
                        )}
                        <button
                          className={styles.resolveButton}
                          onClick={() => handleResolve(item.id)}
                          disabled={resolving.has(item.id)}
                        >
                          {resolving.has(item.id) ? "Resolving..." : "Mark Resolved"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
