import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import HomePage from './pages/home/HomePage'
import SetlistPage from './pages/setlist/SetlistPage'
import SearchPage from './pages/search/SearchPage'
import ConcertPage from './pages/concert/ConcertPage'
import BandPage from './pages/band/BandPage'
import SettingsPage from './pages/settings/SettingsPage'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/setlist/:id" element={<SetlistPage />} />
        <Route path="/setlist/:id/concert" element={<ConcertPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/band/:id" element={<BandPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
