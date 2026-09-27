/* "PARA: [■ Projeto ▾]" — onde o concerto vai ser criado (projeto ou Pessoal).
   <select> nativo: no iPad abre o seletor do sistema, com alvo grande.
   Se os projetos não carregarem, NÃO assume "Pessoal": fica em erro com "Tentar de novo". */
import { useId } from 'react'
import type { ProjectOption } from './data'
import { IconAlert, IconChevronDown } from './icons'
import styles from './NewConcertPage.module.css'

export default function ProjectSelect({ projects, value, onChange, disabled, error, onRetry, selectId }: {
  /** null = a carregar (ou falhou, com `error`) */
  projects: ProjectOption[] | null
  /** null = Pessoal */
  value: string | null
  onChange: (projectId: string | null) => void
  disabled?: boolean
  /** Os projetos não carregaram */
  error?: string | null
  onRetry?: () => void
  /** id do <select> (para o "Mudar" do cartão Importar o focar) */
  selectId?: string
}) {
  const autoId = useId()
  const id = selectId ?? autoId
  const options = projects?.filter(p => p.canCreate) ?? []
  const current = value ? options.find(p => p.id === value) : undefined
  const color = current?.color ?? null

  return (
    <div className={styles.para}>
      {projects === null && error
        ? <span className={styles.paraLabel}>Para</span>
        : <label htmlFor={id} className={styles.paraLabel}>Para</label>}
      {projects === null && error ? (
        <div className={styles.paraError} role="alert">
          <IconAlert size={16} />
          <span>Não foi possível carregar os projetos</span>
          {onRetry && (
            <button type="button" className={styles.secondaryBtn} onClick={onRetry}>Tentar de novo</button>
          )}
        </div>
      ) : projects === null ? (
        <div className={`skeleton ${styles.paraSkel}`} aria-hidden="true" />
      ) : (
        <div className={`${styles.paraSelect} ${disabled ? styles.paraDisabled : ''}`}>
          <span
            className={`${styles.led} ${color ? '' : styles.ledHollow}`}
            style={color ? { background: color } : undefined}
            aria-hidden="true"
          />
          <select
            id={id}
            value={current ? current.id : ''}
            onChange={e => onChange(e.target.value || null)}
            disabled={disabled}
          >
            {options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="">Pessoal</option>
          </select>
          <span className={styles.paraChevron} aria-hidden="true"><IconChevronDown /></span>
        </div>
      )}
    </div>
  )
}
