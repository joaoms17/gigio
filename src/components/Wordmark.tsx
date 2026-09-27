import styles from './Wordmark.module.css'

/** Wordmark "gigio" — os pontos dos "i" são LEDs quadrados no acento. */
export default function Wordmark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={`${styles.wm} ${className ?? ''}`} style={{ fontSize: size }} role="img" aria-label="gigio">
      <span aria-hidden="true">
        g<span className={styles.i}>ı</span>g<span className={styles.i}>ı</span>o
      </span>
    </span>
  )
}

/** Símbolo compacto "gi" em tile — o mesmo desenho do ícone da app. */
export function BrandMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={`${styles.mark} ${className ?? ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.62), borderRadius: Math.round(size * 0.22) }}
      role="img"
      aria-label="gigio"
    >
      <span aria-hidden="true" className={styles.markInner}>
        g<span className={styles.i}>ı</span>
      </span>
    </span>
  )
}
