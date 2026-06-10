import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Force reload when a new SW version is available
registerSW({ onRegisteredSW(_swUrl: string, r: ServiceWorkerRegistration | undefined) {
  r && setInterval(() => r.update(), 60_000)
}, onOfflineReady() {} })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
