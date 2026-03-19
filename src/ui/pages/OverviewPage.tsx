import { useEffect, useState } from "react"
import type { Page } from "../types"
import { fetchMetrics, fetchDecisions } from "../api"
import type { OversightMetrics, OversightRecord, DecisionType } from "../types"
import StatCard from "../components/StatCard"
import { decisionTypeBadge, statusBadge } from "../components/Badge"
import styles from "./OverviewPage.module.css"

interface Props {
  onNavigate: (p: Page) => void
}

export default function OverviewPage({ onNavigate }: Props) {
  const [metrics, setMetrics] = useState<OversightMetrics | null>(null)
  const [recent, setRecent] = useState<OversightRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    function doFetch() {
      Promise.all([fetchMetrics(), fetchDecisions({ limit: 5 })])
        .then(([m, decisions]) => {
          setMetrics(m)
          const sorted = [...decisions].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          )
          setRecent(sorted.slice(0, 5))
          setLoading(false)
          setError(null)
          setLastUpdated(new Date())
        })
        .catch((e: Error) => {
          setError(e.message)
          setLoading(false)
        })
    }
    doFetch()
    const timer = setInterval(doFetch, 30_000)
    return () => clearInterval(timer)
  }, [])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!metrics) return null

  const typeEntries = Object.entries(metrics.decisions.byType) as [DecisionType, number][]
  const maxTypeCount = Math.max(...typeEntries.map(([, v]) => v), 1)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Overview</h1>
        <p className={styles.subtitle}>
          Decision coverage and agent safety metrics for this repository
          {lastUpdated && (
            <span style={{ opacity: 0.5, marginLeft: "0.75rem", fontSize: "0.75rem" }}>
              · updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </p>
      </div>

      <div className={styles.statsGrid}>
        <StatCard
          label="Total Decisions"
          value={metrics.decisions.total}
          sub={`${metrics.decisions.active} active`}
          accent="blue"
        />
        <StatCard
          label="Files Protected"
          value={metrics.decisions.uniqueFilesProtected}
          sub={`${metrics.coverage.decisionsPerProtectedFile.toFixed(1)} decisions/file`}
          accent="green"
        />
        <StatCard
          label="MUST Constraints"
          value={metrics.decisions.mustConstraintTotal}
          sub={`${metrics.decisions.shouldConstraintTotal} SHOULD constraints`}
          accent="red"
        />
        <StatCard
          label="Agent Checks"
          value={metrics.checkChange.totalChecks}
          sub={`${metrics.checkChange.highRiskBlocked} high-risk flagged`}
          accent="orange"
        />
      </div>

      <div className={styles.row}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Decisions by Type</h2>
          <div className={styles.barChart}>
            {typeEntries.length === 0 ? (
              <p className={styles.empty}>No decisions recorded yet</p>
            ) : (
              typeEntries
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <div key={type} className={styles.barRow}>
                    <div className={styles.barLabel}>
                      {decisionTypeBadge(type)}
                    </div>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{ width: `${(count / maxTypeCount) * 100}%` }}
                      />
                    </div>
                    <div className={styles.barCount}>{count}</div>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Health Summary</h2>
          <div className={styles.healthGrid}>
            <HealthItem
              label="With Constraints"
              value={metrics.decisions.withConstraints}
              total={metrics.decisions.total}
              good
            />
            <HealthItem
              label="With Agent Hints"
              value={metrics.decisions.withAgentHints}
              total={metrics.decisions.total}
              good
            />
            <HealthItem
              label="Needs Review"
              value={metrics.decisions.needsReview}
              total={metrics.decisions.total}
              good={false}
            />
            <HealthItem
              label="Deprecated"
              value={metrics.decisions.deprecated}
              total={metrics.decisions.total}
              good={false}
            />
            <HealthItem
              label="Alternatives Documented"
              value={metrics.decisions.alternativesDocumented}
              total={metrics.decisions.total}
              good
            />
            <HealthItem
              label="High-Risk Checks"
              value={metrics.checkChange.highRiskBlocked}
              total={metrics.checkChange.totalChecks}
              good={false}
            />
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Recent Decisions</h2>
          <button
            className={styles.viewAll}
            onClick={() => onNavigate({ name: "decisions" })}
          >
            View all
          </button>
        </div>
        {recent.length === 0 ? (
          <p className={styles.empty}>No decisions recorded yet. Run <code>oversight capture</code> to add your first.</p>
        ) : (
          <div className={styles.recentList}>
            {recent.map((d) => {
              const mustCount = d.constraints.filter((c) => c.severity === "must").length
              const shouldCount = d.constraints.filter((c) => c.severity === "should").length
              return (
                <button
                  key={d.id}
                  className={styles.recentItem}
                  onClick={() => onNavigate({ name: "decision-detail", id: d.id })}
                >
                  <div className={styles.recentLeft}>
                    <div className={styles.recentTitle}>{d.title}</div>
                    <div className={styles.recentMeta}>
                      {d.author}
                      <span className={styles.dot}>&middot;</span>
                      {formatDate(d.timestamp)}
                      {(mustCount > 0 || shouldCount > 0) && (
                        <>
                          <span className={styles.dot}>&middot;</span>
                          {mustCount > 0 && <span className={styles.mustChip}>{mustCount} MUST</span>}
                          {shouldCount > 0 && <span className={styles.shouldChip}>{shouldCount} SHOULD</span>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className={styles.recentBadges}>
                    {decisionTypeBadge(d.decisionType)}
                    {statusBadge(d.status)}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function HealthItem({
  label,
  value,
  total,
  good,
}: {
  label: string
  value: number
  total: number
  good: boolean
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  const color = good
    ? pct > 60 ? "var(--green)" : pct > 30 ? "var(--yellow)" : "var(--red)"
    : pct > 30 ? "var(--red)" : pct > 10 ? "var(--yellow)" : "var(--green)"

  return (
    <div className={styles.healthItem}>
      <div className={styles.healthValue} style={{ color }}>{value}</div>
      <div className={styles.healthLabel}>{label}</div>
    </div>
  )
}

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return ts
  }
}

function LoadingState() {
  return (
    <div className={styles.centerState}>
      <div className={styles.spinner} />
      <p>Loading metrics...</p>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className={styles.centerState}>
      <p className={styles.errorText}>Failed to load: {message}</p>
      <p className={styles.errorHint}>Make sure you ran <code>oversight init</code> in this directory.</p>
    </div>
  )
}
