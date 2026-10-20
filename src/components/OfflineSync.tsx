import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from './Toast'
import { isLikelyOffline, subscribeNet } from '../lib/offline/net'
import { keepOnlyUser, loadConcert } from '../lib/offline/store'
import { flushPendingOrders, prefetchUpcoming } from '../lib/offline/sync'

/**
 * Trabalho de fundo dos concertos offline (montado uma vez, também por
 * cima do modo concerto, que não tem Layout). Com sessão e rede: envia as
 * ordens mudadas sem rede e guarda os próximos concertos — ao arrancar,
 * quando a rede volta e quando a app volta ao primeiro plano (o prefetch
 * tem o seu próprio limite: no máximo de 10 em 10 min).
 */
export default function OfflineSync() {
  const { user } = useAuth()
  const toast = useToast()
  const userId = user?.id

  useEffect(() => {
    if (!userId) return
    let alive = true
    let busy = false
    // Outro utilizador neste aparelho (sessão que expirou sem "Terminar sessão"): as cópias dele saem
    keepOnlyUser(userId).catch(() => {})

    async function run() {
      if (busy || isLikelyOffline()) return
      busy = true
      try {
        for (const { setlistId, result } of await flushPendingOrders(userId!)) {
          if (!alive || (result !== 'sent' && result !== 'failed')) continue
          const name = (await loadConcert(userId!, setlistId))?.setlist.name
          const what = name ? ` de "${name}"` : ''
          if (result === 'sent') toast(`Nova ordem${what} enviada`, { type: 'success' })
          else toast(`Não foi possível guardar a nova ordem${what}`, { type: 'error' })
        }
        if (alive) await prefetchUpcoming(userId!)
      } catch { /* fica para a próxima */ } finally {
        busy = false
      }
    }

    // Sem atrasar o primeiro desenho
    const first = setTimeout(run, 1500)
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    // Rede de volta (evento 'online', ou passou a janela de falha)
    const unsub = subscribeNet(() => { if (!isLikelyOffline()) run() })
    return () => {
      alive = false
      clearTimeout(first)
      document.removeEventListener('visibilitychange', onVisible)
      unsub()
    }
  }, [userId, toast])

  return null
}
