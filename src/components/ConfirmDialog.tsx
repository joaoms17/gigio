import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opts])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className={styles.overlay} onClick={() => close(false)}>
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-label={opts.title ?? opts.message}
            onClick={e => e.stopPropagation()}
          >
            {opts.title && <div className={styles.title}>{opts.title}</div>}
            <div className={styles.message}>{opts.message}</div>
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => close(false)} autoFocus>
                {opts.cancelLabel ?? 'Cancelar'}
              </button>
              <button
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
