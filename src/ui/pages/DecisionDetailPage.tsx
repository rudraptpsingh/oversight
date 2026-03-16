import { useEffect, useState } from "react"
import type { Page } from "../App"
import { fetchDecision, updateDecisionStatus, deleteDecision } from "../api"
import type { OversightRecord, DecisionStatus, Constraint } from "../types"
import { decisionTypeBadge, statusBadge, confidenceBadge, constraintBadge } from "../components/Badge"
import styles from "./DecisionDetailPage.module.css"

interface Props {
  id: string
  onNavigate: (p: Page) => void
}

const STATUSES: DecisionStatus[] = ["active", "proposed", "needs-review", "superseded", "deprecated"]

export default function DecisionDetailPage({ id, onNavigate }: Props) {
  const [decision, setDecision] = useState<OversightRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetchDecision(id)
      .then((d) => {
        setDecision(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [id])

  async function handleStatusChange(newStatus: DecisionStatus) {
    if (!decision) return
    setUpdating(true)
    try {
      const updated = await updateDecisionStatus(id, newStatus)
      setDecision(updated)
    } catch (e: unknown) {
      alert("Failed to update: " + String(e))
    } finally {
      setUpdating(false)
    }
  }

  async function handleDelete() {
    setUpdating(true)
    try {
      await deleteDecision(id)
      onNavigate({ name: "decisions" })
    } catch (e: unknown) {
      alert("Failed to delete: " + String(e))
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.centerState}>
        <div className={styles.spinner} />
      </div>
    )
  }

  if (error || !decision) {
    return (
      <div className={styles.centerState}>
        <p className={styles.errorText}>{error ?? "Decision not found"}</p>
        <button className={styles.backBtn} onClick={() => onNavigate({ name: "decisions" })}>
          Back to decisions
        </button>
      </div>
    )
  }

  const d = decision
  const mustConstraints = d.constraints.filter((c) => c.severity === "must")
  const shouldConstraints = d.constraints.filter((c) => c.severity === "should")
  const avoidConstraints = d.constraints.filter((c) => c.severity === "avoid")

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <button className={styles.breadcrumbBtn} onClick={() => onNavigate({ name: "decisions" })}>
          Decisions
        </button>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{d.title}</span>
      </div>

      <div className={styles.topRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{d.title}</h1>
          <p className={styles.summary}>{d.summary}</p>
          <div className={styles.badges}>
            {decisionTypeBadge(d.decisionType)}
            {statusBadge(d.status)}
            {confidenceBadge(d.confidence)}
            {d.tags.map((tag) => (
              <span key={tag} className={styles.tag}>{tag}</span>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <select
            className={styles.statusSelect}
            value={d.status}
            onChange={(e) => handleStatusChange(e.target.value as DecisionStatus)}
            disabled={updating}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {!showDeleteConfirm ? (
            <button
              className={styles.deleteBtn}
              onClick={() => setShowDeleteConfirm(true)}
              disabled={updating}
            >
              Delete
            </button>
          ) : (
            <div className={styles.confirmRow}>
              <span className={styles.confirmText}>Sure?</span>
              <button className={styles.confirmYes} onClick={handleDelete} disabled={updating}>
                Yes
              </button>
              <button className={styles.confirmNo} onClick={() => setShowDeleteConfirm(false)}>
                No
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={styles.meta}>
        <MetaItem label="Author" value={d.author} />
        <MetaItem label="Recorded" value={formatDate(d.timestamp)} />
        <MetaItem label="Version" value={`v${d.version}`} />
        {d.linkedPR && <MetaItem label="PR" value={d.linkedPR} />}
        {d.linkedIssue && <MetaItem label="Issue" value={d.linkedIssue} />}
      </div>

      <div className={styles.grid}>
        <Section title="Context">
          <p className={styles.prose}>{d.context}</p>
        </Section>

        <Section title="Decision">
          <p className={styles.prose}>{d.decision}</p>
        </Section>

        {d.rationale && (
          <Section title="Rationale">
            <p className={styles.prose}>{d.rationale}</p>
          </Section>
        )}

        {d.consequences && (
          <Section title="Consequences">
            <p className={styles.prose}>{d.consequences}</p>
          </Section>
        )}
      </div>

      {d.constraints.length > 0 && (
        <Section title="Constraints">
          <div className={styles.constraintList}>
            {[...mustConstraints, ...shouldConstraints, ...avoidConstraints].map((c, i) => (
              <ConstraintCard key={i} constraint={c} />
            ))}
          </div>
        </Section>
      )}

      {d.agentHints.length > 0 && (
        <Section title="Agent Hints">
          <div className={styles.hintList}>
            {d.agentHints.map((hint, i) => (
              <div key={i} className={styles.hintItem}>
                <span className={styles.hintScope}>{hint.scope}</span>
                <p className={styles.hintText}>{hint.instruction}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.doNotChange.length > 0 && (
        <Section title="Do Not Change Patterns">
          <div className={styles.codeList}>
            {d.doNotChange.map((pattern, i) => (
              <code key={i} className={styles.codeChip}>{pattern}</code>
            ))}
          </div>
        </Section>
      )}

      {d.alternatives.length > 0 && (
        <Section title="Alternatives Considered">
          <div className={styles.altList}>
            {d.alternatives.map((alt, i) => (
              <div key={i} className={styles.altItem}>
                <div className={styles.altTitle}>{alt.description}</div>
                <div className={styles.altReason}>Rejected: {alt.rejectionReason}</div>
                {alt.tradeoffs && <div className={styles.altTradeoffs}>Tradeoffs: {alt.tradeoffs}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.anchors.length > 0 && (
        <Section title="Code Anchors">
          <div className={styles.anchorList}>
            {d.anchors.map((anchor, i) => (
              <div key={i} className={styles.anchorItem}>
                <code className={styles.anchorPath}>{anchor.path}</code>
                {anchor.identifier && (
                  <span className={styles.anchorId}>{anchor.identifier}</span>
                )}
                <span className={styles.anchorType}>{anchor.type}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.reviewTriggers.length > 0 && (
        <Section title="Review Triggers">
          <div className={styles.codeList}>
            {d.reviewTriggers.map((trigger, i) => (
              <code key={i} className={styles.codeChip}>{trigger}</code>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </div>
  )
}

function ConstraintCard({ constraint: c }: { constraint: Constraint }) {
  return (
    <div className={`${styles.constraintCard} ${styles[`constraint_${c.severity}`]}`}>
      <div className={styles.constraintHeader}>
        {constraintBadge(c.severity)}
        <p className={styles.constraintDesc}>{c.description}</p>
      </div>
      {c.rationale && (
        <p className={styles.constraintRationale}>{c.rationale}</p>
      )}
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaItem}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  )
}

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    })
  } catch {
    return ts
  }
}
