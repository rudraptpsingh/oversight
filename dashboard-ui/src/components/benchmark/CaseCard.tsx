import { useState } from "react"
import type { BenchmarkCase, CaseResult } from "../../types/benchmark"
import styles from "./CaseCard.module.css"

interface Props {
  benchmarkCase: BenchmarkCase
  result: CaseResult
  isRunning: boolean
  onRunCase: (id: string) => void
}

export default function CaseCard({ benchmarkCase: bc, result, isRunning, onRunCase }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const status = result.status

  return (
    <div className={styles.card}>
      <CaseHeader
        bc={bc}
        status={status}
        isRunning={isRunning}
        onRun={() => onRunCase(bc.id)}
      />

      {status === "idle" && (
        <div className={styles.idleBody}>
          <div className={styles.originalCode}>
            <div className={styles.codeLabel}>Original Code</div>
            <pre className={styles.codeBlock}>{bc.code}</pre>
          </div>
        </div>
      )}

      {status === "running" && <LoadingState />}

      {(status === "done" || status === "error") && (
        <ResultSection
          bc={bc}
          result={result}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
        />
      )}
    </div>
  )
}

function CaseHeader({
  bc,
  status,
  isRunning,
  onRun,
}: {
  bc: BenchmarkCase
  status: CaseResult["status"]
  isRunning: boolean
  onRun: () => void
}) {
  return (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        <span className={styles.domainBadge}>{bc.domain}</span>
        <h2 className={styles.title}>{bc.title}</h2>
      </div>
      <div className={styles.headerRight}>
        {status === "running" ? (
          <div className={styles.runningChip}>
            <span className={styles.chipSpinner} />
            Running…
          </div>
        ) : status === "done" ? (
          <div className={styles.doneChip}>Done</div>
        ) : status === "error" ? (
          <div className={styles.errorChip}>Error</div>
        ) : (
          <button
            className={styles.runCaseBtn}
            onClick={onRun}
            disabled={isRunning}
          >
            Run This Case
          </button>
        )}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className={styles.loadingState}>
      <div className={styles.loadingCols}>
        <div className={styles.loadingCol}>
          <div className={styles.loadingAgentLabel} data-agent="a" />
          <div className={styles.skeleton} style={{ height: 180 }} />
          <div className={styles.skeleton} style={{ height: 36 }} />
        </div>
        <div className={styles.loadingCol}>
          <div className={styles.loadingAgentLabel} data-agent="b" />
          <div className={styles.skeleton} style={{ height: 180 }} />
          <div className={styles.skeleton} style={{ height: 36 }} />
        </div>
      </div>
    </div>
  )
}

function ResultSection({
  bc,
  result,
  drawerOpen,
  onToggleDrawer,
}: {
  bc: BenchmarkCase
  result: CaseResult
  drawerOpen: boolean
  onToggleDrawer: () => void
}) {
  if (result.status === "error") {
    return (
      <div className={styles.errorBox}>
        <span className={styles.errorLabel}>API Error</span>
        <span className={styles.errorText}>{result.error}</span>
      </div>
    )
  }

  const { agentA, agentB } = result

  return (
    <div className={styles.resultSection}>
      <div className={styles.originalCode}>
        <div className={styles.codeLabel}>Original Code</div>
        <pre className={styles.codeBlock}>{bc.code}</pre>
      </div>

      <div className={styles.resultCols}>
        {agentA && (
          <AgentOutput
            label="Agent A — No Context"
            agent="a"
            output={agentA.output}
            violated={agentA.violated}
            violationDescription={bc.violationDescription}
          />
        )}
        {agentB && (
          <AgentOutput
            label="Agent B — With ADRs"
            agent="b"
            output={agentB.output}
            violated={agentB.violated}
            violationDescription={bc.violationDescription}
          />
        )}
      </div>

      <button className={styles.drawerToggle} onClick={onToggleDrawer}>
        <span>{drawerOpen ? "Hide" : "Show"} Architectural Decision Record</span>
        <span className={styles.drawerChevron} data-open={drawerOpen}>▼</span>
      </button>

      {drawerOpen && (
        <div className={styles.drawer}>
          <pre className={styles.decisionText}>{bc.decision}</pre>
        </div>
      )}
    </div>
  )
}

function AgentOutput({
  label,
  agent,
  output,
  violated,
  violationDescription,
}: {
  label: string
  agent: "a" | "b"
  output: string
  violated: boolean
  violationDescription: string
}) {
  return (
    <div className={styles.agentCol}>
      <div className={styles.agentColLabel} data-agent={agent}>
        {label}
      </div>
      <pre className={styles.agentCode}>{output}</pre>
      {violated ? (
        <div className={styles.violationBanner}>
          <span className={styles.bannerIcon}>⚠</span>
          <span>
            <strong>CONSTRAINT VIOLATED:</strong> {violationDescription}
          </span>
        </div>
      ) : (
        <div className={styles.safeBanner}>
          <span className={styles.bannerIcon}>✓</span>
          <span>Constraint respected</span>
        </div>
      )}
    </div>
  )
}
