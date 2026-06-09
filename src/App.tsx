import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import AuthPage from './pages/auth/AuthPage'
import HomePage from './pages/home/HomePage'
import SetlistPage from './pages/setlist/SetlistPage'
import SearchPage from './pages/search/SearchPage'
import ConcertPage from './pages/concert/ConcertPage'
import BandPage from './pages/band/BandPage'
import SettingsPage from './pages/settings/SettingsPage'
import './index.css'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh', color:'var(--text3)', fontSize:13 }}>A carregar...</div>
  if (!user) return <Navigate to="/auth" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/" element={<AuthGuard><HomePage /></AuthGuard>} />
        <Route path="/setlist/:id" element={<AuthGuard><SetlistPage /></AuthGuard>} />
        <Route path="/setlist/:id/concert" element={<AuthGuard><ConcertPage /></AuthGuard>} />
        <Route path="/search" element={<AuthGuard><SearchPage /></AuthGuard>} />
        <Route path="/band/:id" element={<AuthGuard><BandPage /></AuthGuard>} />
        <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
