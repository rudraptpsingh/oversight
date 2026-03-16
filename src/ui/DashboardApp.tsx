import { useState } from "react"
import type { Page } from "./types"
import Sidebar from "./components/Sidebar"
import OverviewPage from "./pages/OverviewPage"
import DecisionsPage from "./pages/DecisionsPage"
import DecisionDetailPage from "./pages/DecisionDetailPage"
import ConstraintsPage from "./pages/ConstraintsPage"
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
      </main>
    </div>
  )
}
