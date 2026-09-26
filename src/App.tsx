import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ConfirmProvider } from './components/ConfirmDialog'
import { ToastProvider } from './components/Toast'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
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

      {/* Páginas com Layout — rota-pai partilhada para o Layout não remontar */}
      <Route element={<AuthGuard><Layout /></AuthGuard>}>
        {/* Calendário — landing após login */}
        <Route path="/" element={<CalendarPage />} />

        {/* Projetos */}
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDashboardPage />} />

        {/* Setlists */}
        <Route path="/setlists" element={<SetlistsPage />} />
        <Route path="/setlist/:id" element={<SetlistPage />} />

        {/* Biblioteca pessoal */}
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/songs/:id" element={<SongPage />} />
        <Route path="/search" element={<SearchPage />} />

        {/* Definições */}
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* Páginas sem Layout (fullscreen) */}
      <Route path="/setlist/:id/concert" element={<AuthGuard><ConcertPage /></AuthGuard>} />
      <Route path="/songs/:id/sync" element={<AuthGuard><SyncEditorPage /></AuthGuard>} />

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
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </ConfirmProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
