import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource-variable/archivo/standard.css'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme'
import { setNetProbe } from './lib/offline/net'
import { probeSupabase } from './lib/offline/sync'

initTheme()
// Wi-Fi sem internet: o modo offline dura até o Supabase voltar a responder
setNetProbe(probeSupabase)

/** Modo concerto aberto: uma versão nova da app nunca recarrega o palco (o relógio e a posição perdiam-se) */
const onStage = () => /^\/setlist\/[^/]+\/concert\/?$/.test(window.location.pathname)

// Versão nova da app (service worker): recarrega — mas, em palco, só depois de sair dele
registerSW({
  onRegisteredSW(_swUrl: string, r: ServiceWorkerRegistration | undefined) {
    if (!r) return
    setInterval(() => {
      // Sem rede não há o que procurar (e o pedido falhado era um erro por apanhar)
      if (!navigator.onLine) return
      r.update().catch(() => {})
    }, 60_000)
  },
  onNeedReload() {
    if (!onStage()) { window.location.reload(); return }
    const wait = setInterval(() => {
      if (onStage()) return
      clearInterval(wait)
      window.location.reload()
    }, 1000)
  },
  onOfflineReady() {},
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
