import styles from "./Badge.module.css"

type Variant = "blue" | "green" | "yellow" | "red" | "orange" | "purple" | "gray" | "teal"

interface Props {
  label: string
  variant?: Variant
  size?: "sm" | "md"
}

export function Badge({ label, variant = "gray", size = "md" }: Props) {
  return (
    <span className={`${styles.badge} ${styles[variant]} ${styles[size]}`}>
      {label}
    </span>
  )
}

export function decisionTypeBadge(type: string) {
  const map: Record<string, Variant> = {
    architectural: "blue",
    algorithmic: "teal",
    security: "red",
    performance: "orange",
    compatibility: "purple",
    compliance: "yellow",
    "business-logic": "green",
    workaround: "gray",
    deferred: "gray",
  }
  return <Badge label={type} variant={map[type] ?? "gray"} />
}

export function statusBadge(status: string) {
  const map: Record<string, Variant> = {
    active: "green",
    superseded: "yellow",
    deprecated: "gray",
    proposed: "blue",
    "needs-review": "orange",
  }
  return <Badge label={status} variant={map[status] ?? "gray"} />
}

export function confidenceBadge(confidence: string) {
  const map: Record<string, Variant> = {
    definitive: "green",
    provisional: "yellow",
    exploratory: "gray",
  }
  return <Badge label={confidence} variant={map[confidence] ?? "gray"} size="sm" />
}

export function constraintBadge(severity: string) {
  const map: Record<string, Variant> = {
    must: "red",
    should: "yellow",
    avoid: "orange",
  }
  return <Badge label={severity.toUpperCase()} variant={map[severity] ?? "gray"} size="sm" />
}
