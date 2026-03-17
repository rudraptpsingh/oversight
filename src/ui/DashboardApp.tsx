import { useState } from "react"
import type { Page } from "./types"
import Sidebar from "./components/Sidebar"
import OverviewPage from "./pages/OverviewPage"
import DecisionsPage from "./pages/DecisionsPage"
import DecisionDetailPage from "./pages/DecisionDetailPage"
import ConstraintsPage from "./pages/ConstraintsPage"
import BacklogPage from "./pages/BacklogPage"
import ConfidencePage from "./pages/ConfidencePage"
import CoveragePage from "./pages/CoveragePage"
import RegressionsPage from "./pages/RegressionsPage"
import styles from "./DashboardApp.module.css"

export default function DashboardApp() {
  const [page, setPage] = useState<Page>({ name: "overview" })

  return (
    <div className={styles.root}>
      <Sidebar
        currentPage={page.name === "decision-detail" ? "decision-detail" : page.name}
        onNavigate={setPage}
      />
      <main className={styles.main}>
        {page.name === "overview" && <OverviewPage onNavigate={setPage} />}
        {page.name === "decisions" && <DecisionsPage onNavigate={setPage} />}
        {page.name === "decision-detail" && page.id && (
          <DecisionDetailPage id={page.id} onNavigate={setPage} />
        )}
        {page.name === "constraints" && <ConstraintsPage onNavigate={setPage} />}
        {page.name === "backlog" && <BacklogPage onNavigate={setPage} />}
        {page.name === "confidence" && <ConfidencePage onNavigate={setPage} />}
        {page.name === "coverage" && <CoveragePage onNavigate={setPage} />}
        {page.name === "regressions" && <RegressionsPage onNavigate={setPage} />}
      </main>
    </div>
  )
}
