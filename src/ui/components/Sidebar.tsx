import type { Page } from "../types"
import styles from "./Sidebar.module.css"

interface Props {
  currentPage: string
  onNavigate: (p: Page) => void
}

export default function Sidebar({ currentPage, onNavigate }: Props) {
  return (
    <nav className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke="#2f81f7" strokeWidth="1.5"/>
            <path d="M7 10h6M10 7v6" stroke="#2f81f7" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <span className={styles.logoText}>Oversight</span>
      </div>

      <div className={styles.nav}>
        <NavItem
          label="Overview"
          icon={<GridIcon />}
          active={currentPage === "overview"}
          onClick={() => onNavigate({ name: "overview" })}
        />
        <NavItem
          label="Decisions"
          icon={<ListIcon />}
          active={currentPage === "decisions" || currentPage === "decision-detail"}
          onClick={() => onNavigate({ name: "decisions" })}
        />
        <NavItem
          label="Constraints"
          icon={<ShieldIcon />}
          active={currentPage === "constraints"}
          onClick={() => onNavigate({ name: "constraints" })}
        />
      </div>

      <div className={styles.footer}>
        <a
          href="https://github.com/rudraptpsingh/oversight"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
        >
          <GithubIcon />
          GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/oversight"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
        >
          <NpmIcon />
          npm
        </a>
      </div>
    </nav>
  )
}

function NavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`${styles.navItem} ${active ? styles.active : ""}`}
      onClick={onClick}
    >
      <span className={styles.navIcon}>{icon}</span>
      {label}
    </button>
  )
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM9 2.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zM10.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zM2.5 10a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM9 10.5A1.5 1.5 0 0 1 10.5 9h3A1.5 1.5 0 0 1 15 10.5v3A1.5 1.5 0 0 1 13.5 15h-3A1.5 1.5 0 0 1 9 13.5v-3zM10.5 10a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z"/>
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/>
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M8 1.5a.5.5 0 0 0-.5.5v.518a4.5 4.5 0 0 1-3.26 4.327l-.77.18.77.18a4.5 4.5 0 0 1 3.26 4.327v5.518a.5.5 0 0 0 .5.5c.938 0 2.4-1.1 3.432-2.7.56-.88 1.068-1.9 1.068-2.8V6.845a4.5 4.5 0 0 1 3.26-4.327l.77-.18-.77-.18a4.5 4.5 0 0 1-3.26-4.327V2a.5.5 0 0 0-.5-.5zm0 1.018v4.327a5.5 5.5 0 0 0 3.985 4.982.5.5 0 0 1 .015.036v2.146c0 .56-.392 1.324-1.068 2.4C9.64 14.3 8.438 15 8 15c-.438 0-1.64-.7-2.932-2.1-.676-1.076-1.068-1.84-1.068-2.4V7.168a.5.5 0 0 1 .015-.036A5.5 5.5 0 0 0 8 2.518z"/>
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  )
}

function NpmIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 0v16h16V0zm14.5 14.5h-13V1.5h13z"/>
      <path d="M3 3.5h10v7H8V6H6v4.5H3z"/>
    </svg>
  )
}
