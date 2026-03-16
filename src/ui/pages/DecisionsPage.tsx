import { useEffect, useState, useCallback } from "react"
import type { Page } from "../types"
import { fetchDecisions, searchDecisions } from "../api"
import type { OversightRecord, DecisionStatus, DecisionType } from "../types"
import { decisionTypeBadge, statusBadge, Badge } from "../components/Badge"
import styles from "./DecisionsPage.module.css"

interface Props {
  onNavigate: (p: Page) => void
}

const ALL_STATUSES: DecisionStatus[] = ["active", "proposed", "needs-review", "superseded", "deprecated"]
const ALL_TYPES: DecisionType[] = [
  "architectural", "algorithmic", "security", "performance",
  "compatibility", "compliance", "business-logic", "workaround", "deferred",
]

export default function DecisionsPage({ onNavigate }: Props) {
  const [decisions, setDecisions] = useState<OversightRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | "">("")
  const [typeFilter, setTypeFilter] = useState<DecisionType | "">("")
  const [searchPending, setSearchPending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let data: OversightRecord[]
      if (search.trim()) {
        data = await searchDecisions(search.trim(), 100)
      } else {
        data = await fetchDecisions({
          status: statusFilter || undefined,
          types: typeFilter ? [typeFilter] : undefined,
          limit: 200,
        })
      }
      if (typeFilter && search.trim()) {
        data = data.filter((d) => d.decisionType === typeFilter)
      }
      if (statusFilter && search.trim()) {
        data = data.filter((d) => d.status === statusFilter)
      }
      const sorted = [...data].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      setDecisions(sorted)
      setError(null)
    } catch (e: unknown) {
      setError(String(e))
    } finally {
      setLoading(false)
      setSearchPending(false)
    }
  }, [search, statusFilter, typeFilter])

  useEffect(() => {
    const timer = setTimeout(() => load(), search ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Decisions</h1>
        <p className={styles.subtitle}>{decisions.length} records</p>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            placeholder="Search decisions..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setSearchPending(true)
            }}
          />
          {searchPending && <div className={styles.searchSpinner} />}
        </div>
        <select
          className={styles.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DecisionStatus | "")}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className={styles.select}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as DecisionType | "")}
        >
          <option value="">All types</option>
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loadingRow}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : decisions.length === 0 ? (
        <div className={styles.empty}>
          <p>No decisions found.</p>
          {!search && !statusFilter && !typeFilter && (
            <p>Run <code>oversight capture</code> to record your first decision.</p>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {decisions.map((d) => (
            <DecisionRow
              key={d.id}
              decision={d}
              onClick={() => onNavigate({ name: "decision-detail", id: d.id })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DecisionRow({
  decision: d,
  onClick,
}: {
  decision: OversightRecord
  onClick: () => void
}) {
  const mustCount = d.constraints.filter((c) => c.severity === "must").length
  const shouldCount = d.constraints.filter((c) => c.severity === "should").length

  return (
    <button className={styles.row} onClick={onClick}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitle}>{d.title}</div>
        <div className={styles.rowSummary}>{d.summary}</div>
        <div className={styles.rowMeta}>
          <span>{d.author}</span>
          <span className={styles.dot}>&middot;</span>
          <span>{formatDate(d.timestamp)}</span>
          {d.anchors.length > 0 && (
            <>
              <span className={styles.dot}>&middot;</span>
              <span>{d.anchors.length} anchor{d.anchors.length !== 1 ? "s" : ""}</span>
            </>
          )}
          {(mustCount > 0 || shouldCount > 0) && (
            <>
              <span className={styles.dot}>&middot;</span>
              {mustCount > 0 && (
                <span className={styles.mustChip}>{mustCount} MUST</span>
              )}
              {shouldCount > 0 && (
                <span className={styles.shouldChip}>{shouldCount} SHOULD</span>
              )}
            </>
          )}
        </div>
      </div>
      <div className={styles.rowBadges}>
        {d.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} label={tag} variant="gray" size="sm" />
        ))}
        {decisionTypeBadge(d.decisionType)}
        {statusBadge(d.status)}
        <ChevronIcon />
      </div>
    </button>
  )
}

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  } catch {
    return ts
  }
}

function SearchIcon() {
  return (
    <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
      <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
    </svg>
  )
}
