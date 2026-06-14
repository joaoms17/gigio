import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ConfirmProvider } from './components/ConfirmDialog'
import { useAuth } from './hooks/useAuth'
import AuthPage from './pages/auth/AuthPage'
import CalendarPage from './pages/calendar/CalendarPage'
import ProjectsPage from './pages/projects/ProjectsPage'
import ProjectDashboardPage from './pages/projects/ProjectDashboardPage'
import SetlistPage from './pages/setlist/SetlistPage'
import SongPage from './pages/song/SongPage'
import SearchPage from './pages/search/SearchPage'
import InvitePage from './pages/invite/InvitePage'
import ConcertPage from './pages/concert/ConcertPage'
import LibraryPage from './pages/library/LibraryPage'
import SetlistsPage from './pages/setlists/SetlistsPage'
import SettingsPage from './pages/settings/SettingsPage'
import SyncEditorPage from './pages/sync/SyncEditorPage'
import './index.css'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', color: 'var(--text3)', fontSize: 13 }}>A carregar...</div>
  if (!user) return <Navigate to="/auth" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />

      {/* Calendário — landing após login */}
      <Route path="/" element={<AuthGuard><CalendarPage /></AuthGuard>} />

      {/* Projetos */}
      <Route path="/projects" element={<AuthGuard><ProjectsPage /></AuthGuard>} />
      <Route path="/projects/:id" element={<AuthGuard><ProjectDashboardPage /></AuthGuard>} />

      {/* Setlists */}
      <Route path="/setlists" element={<AuthGuard><SetlistsPage /></AuthGuard>} />
      <Route path="/setlist/:id" element={<AuthGuard><SetlistPage /></AuthGuard>} />
      <Route path="/setlist/:id/concert" element={<AuthGuard><ConcertPage /></AuthGuard>} />

      {/* Biblioteca pessoal */}
      <Route path="/library" element={<AuthGuard><LibraryPage /></AuthGuard>} />
      <Route path="/songs/:id" element={<AuthGuard><SongPage /></AuthGuard>} />
      <Route path="/songs/:id/sync" element={<AuthGuard><SyncEditorPage /></AuthGuard>} />
      <Route path="/search" element={<AuthGuard><SearchPage /></AuthGuard>} />

      {/* Definições */}
      <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />

      {/* Convites */}
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/join" element={<InvitePage />} />

      {/* Compatibilidade com rotas antigas */}
      <Route path="/band/:id" element={<AuthGuard><BandRedirect /></AuthGuard>} />
      <Route path="/bands" element={<Navigate to="/projects" replace />} />
      <Route path="/home" element={<Navigate to="/" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function BandRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/projects/${id}`} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ConfirmProvider>
          <AppRoutes />
        </ConfirmProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
