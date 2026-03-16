import styles from "./StatCard.module.css"

interface Props {
  label: string
  value: number | string
  sub?: string
  accent?: "blue" | "green" | "red" | "yellow" | "orange"
}

export default function StatCard({ label, value, sub, accent = "blue" }: Props) {
  return (
    <div className={styles.card}>
      <div className={`${styles.value} ${styles[accent]}`}>{value}</div>
      <div className={styles.label}>{label}</div>
      {sub && <div className={styles.sub}>{sub}</div>}
    </div>
  )
}
