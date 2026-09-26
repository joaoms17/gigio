import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import styles from './Toast.module.css'

type ToastType = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  type?: ToastType
}

type ToastFn = (message: string, opts?: { type?: ToastType }) => void

const ToastContext = createContext<ToastFn>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback<ToastFn>((message, opts) => {
    const id = nextId.current++
    setToasts(prev => [...prev, { id, message, type: opts?.type }])
    // Erros ficam mais tempo no ecrã
    const ttl = opts?.type === 'error' ? 6000 : 4000
    timers.current.set(id, setTimeout(() => dismiss(id), ttl))
  }, [dismiss])

  // Clear pending timers if the provider ever unmounts
  useEffect(() => {
    const map = timers.current
    return () => { map.forEach(t => clearTimeout(t)); map.clear() }
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.length > 0 && (
        <div className={styles.stack}>
          {toasts.map(t => (
            <div
              key={t.id}
              className={`${styles.toast} ${t.type === 'error' ? styles.error : ''} ${t.type === 'success' ? styles.success : ''}`}
              role="status"
              onClick={() => dismiss(t.id)}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}
