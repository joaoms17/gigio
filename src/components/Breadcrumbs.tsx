import { useNavigate, useOutletContext } from 'react-router-dom'
import type { LayoutOutletContext } from './Layout'
import styles from './Breadcrumbs.module.css'

export interface Crumb {
  label: string
  to?: string
}

/* A raiz das breadcrumbs é sempre a secção acesa no rail / tab bar.
   Se a página abrir com outra secção (ex.: concerto de um projeto chega como
   "Projetos / Casamentos / Jantar" mas vive em Concertos), a raiz passa a ser a
   secção ativa e o resto do caminho mantém-se: "Concertos / Casamentos / Jantar".
   Só troca raízes que sejam secções de navegação; o destino vem sempre da secção
   (corrige raízes com a rota errada, ex.: "Projetos" → "/"). */
function alignRoot(items: Crumb[], ctx: LayoutOutletContext | null | undefined): Crumb[] {
  const section = ctx?.navSection
  if (!section || items.length < 2) return items
  const root = items[0]
  const isSectionRoot = (ctx?.navLabels ?? []).some(l => l.toLowerCase() === root.label.toLowerCase())
  if (!isSectionRoot) return items
  if (root.label === section.label && root.to === section.to) return items
  return [{ label: section.label, to: section.to }, ...items.slice(1)]
}

export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const navigate = useNavigate()
  const crumbs = alignRoot(items, useOutletContext<LayoutOutletContext | null | undefined>())
  return (
    <nav className={styles.crumbs} aria-label="Localização">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        return (
          <span key={i} className={`${styles.crumbWrap} ${last ? styles.crumbWrapLast : ''}`}>
            {c.to && !last ? (
              <button type="button" className={styles.crumbLink} onClick={() => navigate(c.to!)}>
                {c.label}
              </button>
            ) : (
              <span
                className={last ? styles.crumbCurrent : styles.crumbText}
                aria-current={last ? 'page' : undefined}
                title={last ? c.label : undefined}
              >
                {c.label}
              </span>
            )}
            {!last && <span className={styles.sep} aria-hidden="true">/</span>}
          </span>
        )
      })}
    </nav>
  )
}
