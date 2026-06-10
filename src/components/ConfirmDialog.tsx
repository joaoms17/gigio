import { createContext, useCallback, useContext, useRef, useState } from 'react'
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

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className={styles.overlay} onClick={() => close(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
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
