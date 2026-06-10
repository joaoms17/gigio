import { useNavigate } from 'react-router-dom'
import styles from './Breadcrumbs.module.css'

export interface Crumb {
  label: string
  to?: string
}

export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const navigate = useNavigate()
  return (
    <nav className={styles.crumbs}>
      {items.map((c, i) => {
        const last = i === items.length - 1
        return (
          <span key={i} className={styles.crumbWrap}>
            {c.to && !last ? (
              <button className={styles.crumbLink} onClick={() => navigate(c.to!)}>
                {c.label}
              </button>
            ) : (
              <span className={last ? styles.crumbCurrent : styles.crumbText}>{c.label}</span>
            )}
            {!last && <span className={styles.sep}>›</span>}
          </span>
        )
      })}
    </nav>
  )
}
