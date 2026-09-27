import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import styles from './ConfirmDialog.module.css'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false))

export function useConfirm() {
  return useContext(ConfirmContext)
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(v: boolean) => void>(() => {})
  const messageId = useId()
  const titleId = useId()

  const confirm = useCallback<ConfirmFn>(o => {
    setOpts(o)
    return new Promise<boolean>(resolve => { resolver.current = resolve })
  }, [])

  function close(result: boolean) {
    setOpts(null)
    resolver.current(result)
  }

  // Escape closes the dialog (same as cancelling)
  useEffect(() => {
    if (!opts) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpts(null)
        resolver.current(false)
      }
    }
    // Fase de captura: stopPropagation no bubble não trava outros listeners
    // do próprio window (ex.: os atalhos do ConcertPage voltavam a disparar)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [opts])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className={styles.overlay} onClick={() => close(false)}>
          <div
            className={`${styles.dialog} ${opts.danger ? styles.dialogDanger : ''}`}
            role={opts.danger ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby={opts.title ? titleId : messageId}
            aria-describedby={opts.title ? messageId : undefined}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.body}>
              <div className={styles.kicker} aria-hidden="true">
                <span className={styles.kickerLed} />
                {opts.danger ? 'Atenção' : 'Confirmar'}
              </div>
              {opts.title && <h2 id={titleId} className={styles.title}>{opts.title}</h2>}
              <div id={messageId} className={styles.message}>{opts.message}</div>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.cancelBtn} onClick={() => close(false)} autoFocus>
                {opts.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                type="button"
                className={opts.danger ? styles.dangerBtn : styles.confirmBtn}
                onClick={() => close(true)}
              >
                {opts.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
