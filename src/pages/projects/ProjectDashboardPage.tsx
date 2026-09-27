import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { exportSongsPdf } from '../../lib/pdfExport'
import { uploadProjectImage } from '../../lib/uploadImage'
import { STATUS_LABELS } from '../../lib/setlistStatus'
import { useAuth } from '../../hooks/useAuth'
import {
  type Project,
  type ProjectMember,
  type ProjectInvite,
  type ProjectType,
  type ProjectRole,
  PROJECT_TYPE_LABELS,
  PROJECT_COLORS,
  ROLE_LABELS,
} from '../../types'
import { cacheProjectDashboard, getCachedProjectDashboard } from '../../lib/concertCache'
import styles from './ProjectDashboardPage.module.css'
import { mapLegacyProjectColor } from '../../lib/projectColor'

type Tab = 'overview' | 'repertoire' | 'setlists' | 'members' | 'settings'

interface SetlistCard {
  id: string
  name: string
  date: string | null
  venue: string | null
  status: string | null
  is_shared: boolean
  setlist_songs: { count: number }[]
}

interface SongCard {
  id: string
  title: string
  artist: string
  tags: string[] | null
  performance_key: string | null
  bpm: number | null
  duration_sec?: number | null
  has_sync: boolean
  is_user_edited: boolean
  source_provider: string | null
  updated_at: string | null
}

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** Posições, contagens e minutos sempre com 2 dígitos: 01, 02… (assinatura v2) */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}


function mapColor(c: string): string {
  return mapLegacyProjectColor(c)
}

/** Amostras do seletor de cor (paleta v2, sem duplicados) */
const SWATCHES: string[] = Array.from(new Set(PROJECT_COLORS.map(mapColor)))

/** Cor do projeto pronta a mostrar (LED do quadrado de identidade, modal, PDF) */
function projectColorOf(c: string | null | undefined): string {
  return c ? mapColor(c) : SWATCHES[0]
}

/** "2026-09-28" → Date local (sem desvio de fuso) */
function parseDay(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** Dia do mês com 2 dígitos, como na agenda (Concertos, Palco, Calendário): "04", "28" */
function dayNumber(dateStr: string): string {
  return pad2(parseDay(dateStr).getDate())
}

/** "set" — e "set 25" quando o ano não é o corrente. Maiúsculas via CSS. */
function monthShort(dateStr: string): string {
  const date = parseDay(dateStr)
  const label = date.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '').trim()
  return date.getFullYear() === new Date().getFullYear()
    ? label
    : `${label} ${String(date.getFullYear()).slice(2)}`
}

function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '—'
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`
}

/* ── Ícones SVG inline (stroke, currentColor) ── */

const ICON = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function IconX({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

function IconPlus({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconArrowLeft({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <line x1="20" y1="12" x2="4" y2="12" />
      <path d="m10 6-6 6 6 6" />
    </svg>
  )
}

function IconArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="m14 6 6 6-6 6" />
    </svg>
  )
}

/** ▶ igual ao da agenda (Concertos) — atalho para o modo concerto */
function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

function IconChevronDown({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function IconCamera({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function IconSearch({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  )
}

function IconMusic({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} strokeWidth={1.75}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function IconCalendar({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON} strokeWidth={1.75}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function IconDownload({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function IconFileText({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

function IconTrash({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

function IconCopy({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function IconLink({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function IconPencil({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

const TABS: [Tab, string][] = [
  ['overview', 'Resumo'],
  ['setlists', 'Concertos'],
  ['repertoire', 'Repertório'],
  ['members', 'Membros'],
  ['settings', 'Definições'],
]

export default function ProjectDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
  const toast = useToast()
  const { id: projectId } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as Tab) ?? 'setlists'

  const [project, setProject] = useState<Project | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [myRole, setMyRole] = useState<ProjectRole>('viewer')
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [setlists, setSetlists] = useState<SetlistCard[]>([])
  const [songs, setSongs] = useState<SongCard[]>([])
  const [invites, setInvites] = useState<ProjectInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [songSearch, setSongSearch] = useState('')
  const [deletingSong, setDeletingSong] = useState<string | null>(null)
  const [songPlayCounts, setSongPlayCounts] = useState<Record<string, number>>({})
  const [exporting, setExporting] = useState(false)

  // Settings form
  const [settingsName, setSettingsName] = useState('')
  const [settingsDesc, setSettingsDesc] = useState('')
  const [settingsType, setSettingsType] = useState<ProjectType>('band')
  const [settingsColor, setSettingsColor] = useState(SWATCHES[0])
  const [settingsImagePos, setSettingsImagePos] = useState(50)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor')
  const [inviting, setInviting] = useState(false)
  const [inviteCopied, setInviteCopied] = useState<string | null>(null)

  // Edit instrument
  const [editingInstrument, setEditingInstrument] = useState(false)
  const [instrumentInput, setInstrumentInput] = useState('')

  // New setlist modal
  const [showCreateSetlist, setShowCreateSetlist] = useState(false)
  const [newSetlistName, setNewSetlistName] = useState('')
  const [newSetlistVenue, setNewSetlistVenue] = useState('')
  const [creatingSetlist, setCreatingSetlist] = useState(false)

  // Nominatim venue autocomplete
  const [venueSuggestions, setVenueSuggestions] = useState<{ name: string; detail: string }[]>([])
  const [showVenueDrop, setShowVenueDrop] = useState(false)
  const venueDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setTab = (tab: Tab) => setSearchParams({ tab })

  const canEdit = myRole === 'owner' || myRole === 'admin' || myRole === 'editor'
  const canManage = myRole === 'owner' || myRole === 'admin'
  const isOwner = myRole === 'owner'

  const load = useCallback(async (silent = false) => {
    if (!user || !projectId) return
    if (!silent) setLoading(true)
    setError(null)

    const { data: membership, error: membershipError } = await supabase
      .from('band_members')
      .select('role, bands(*)')
      .eq('band_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership || membershipError) {
      const cached = getCachedProjectDashboard<{
        project: Project; role: ProjectRole
        setlists: SetlistCard[]; songs: SongCard[]
      }>(projectId)
      if (cached) {
        setProject(cached.project)
        setMyRole(cached.role)
        setSetlists(cached.setlists)
        setSongs(cached.songs)
        setIsOffline(true)
        setLoading(false)
      } else {
        setError('Não tens acesso a este projeto ou ele não existe.')
        setLoading(false)
      }
      return
    }

    setIsOffline(false)
    const proj = membership.bands as unknown as Project
    setProject(proj)
    setMyRole(membership.role as ProjectRole)
    setSettingsName(proj.name)
    setSettingsDesc(proj.description ?? '')
    setSettingsType((proj.type as ProjectType) ?? 'band')
    setSettingsColor(projectColorOf(proj.color))
    setSettingsImagePos((proj as any).image_position ?? 50)

    const [membersRes, setlistsRes, songsRes, invitesRes] = await Promise.all([
      supabase
        .from('band_members')
        .select('band_id, user_id, role, status, instrument, profiles(display_name, avatar_url)')
        .eq('band_id', projectId),
      supabase
        .from('setlists')
        .select('id, name, date, venue, status, is_shared, setlist_songs(count)')
        .eq('band_id', projectId)
        .order('date', { ascending: true }),
      supabase
        .from('songs')
        .select('id, title, artist, tags, performance_key, bpm, duration_sec, has_sync, is_user_edited, source_provider, updated_at')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })
        .limit(200),
      canManage
        ? supabase
            .from('project_invites')
            .select('*')
            .eq('project_id', projectId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])

    const fetchedSetlists = (setlistsRes.data ?? []) as unknown as SetlistCard[]
    const fetchedSongs    = (songsRes.data ?? []) as unknown as SongCard[]
    setMembers((membersRes.data ?? []) as unknown as ProjectMember[])
    setSetlists(fetchedSetlists)
    setSongs(fetchedSongs)
    // Count setlist appearances per song
    if (setlistsRes.data && setlistsRes.data.length > 0) {
      const setlistIds = setlistsRes.data.map((s: any) => s.id)
      supabase
        .from('setlist_songs')
        .select('song_id')
        .in('setlist_id', setlistIds)
        .then(({ data }) => {
          if (data) {
            const counts: Record<string, number> = {}
            data.forEach((r: any) => { counts[r.song_id] = (counts[r.song_id] ?? 0) + 1 })
            setSongPlayCounts(counts)
          }
        })
    }
    setInvites((invitesRes.data ?? []) as unknown as ProjectInvite[])
    cacheProjectDashboard(projectId, {
      project: proj,
      role: membership.role as ProjectRole,
      setlists: fetchedSetlists,
      songs: fetchedSongs,
    })
    setLoading(false)
  }, [user, projectId, canManage])

  useEffect(() => { load() }, [load])

  // Silent refresh when switching tabs so counts/lists stay current
  const firstTabRender = useRef(true)
  useEffect(() => {
    if (firstTabRender.current) { firstTabRender.current = false; return }
    load(true)
  }, [activeTab])

  // Segmented: no telemóvel o trilho faz scroll — manter a tab ativa à vista
  const tabsWrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const wrap = tabsWrapRef.current
    const el = wrap?.querySelector<HTMLElement>('[data-active]')
    if (!wrap || !el || wrap.scrollWidth <= wrap.clientWidth) return
    const left = el.offsetLeft - (wrap.clientWidth - el.offsetWidth) / 2
    wrap.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [activeTab, loading])

  // Fade nas pontas do trilho quando há separadores escondidos (indica que faz scroll)
  useEffect(() => {
    const wrap = tabsWrapRef.current
    if (!wrap) return
    const update = () => {
      const max = wrap.scrollWidth - wrap.clientWidth
      const l = wrap.scrollLeft > 2
      const r = wrap.scrollLeft < max - 2
      wrap.dataset.fade = l && r ? 'both' : l ? 'left' : r ? 'right' : 'none'
    }
    update()
    wrap.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      wrap.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [loading, error, project?.id])

  async function saveSettings() {
    if (!project || !settingsName.trim()) return
    setSavingSettings(true)
    const base = {
      name: settingsName.trim(),
      description: settingsDesc.trim() || null,
      type: settingsType,
      color: settingsColor,
    }
    // image_position needs a DB column — retry without it if missing
    let { error } = await supabase
      .from('bands')
      .update({ ...base, image_position: settingsImagePos })
      .eq('id', project.id)
    if (error) {
      ;({ error } = await supabase.from('bands').update(base).eq('id', project.id))
    }
    setSavingSettings(false)
    if (error) { toast('Erro ao guardar: ' + error.message, { type: 'error' }); return }
    setProject(p => p ? { ...p, ...base, description: base.description ?? undefined, image_position: settingsImagePos } as any : p)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2000)
  }

  async function leaveProject() {
    if (!project || !user) return
    if (!await confirmDialog({ title: 'Sair do projeto', message: `Sair do projeto "${project.name}"?`, confirmLabel: 'Sair', danger: true })) return
    await supabase.from('band_members').delete().eq('band_id', project.id).eq('user_id', user.id)
    navigate('/')
  }

  async function deleteProject() {
    if (!project || !user) return
    if (!await confirmDialog({ title: 'Eliminar projeto', message: `Eliminar o projeto "${project.name}"? Esta ação é irreversível.`, confirmLabel: 'Eliminar', danger: true })) return
    await supabase.from('bands').delete().eq('id', project.id)
    navigate('/')
  }

  async function sendInvite() {
    if (!user || !project || !inviteEmail.trim()) return
    setInviting(true)
    const { error } = await supabase
      .from('project_invites')
      .insert({
        project_id: project.id,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        invited_by: user.id,
      })
    setInviting(false)
    if (error) {
      if (error.code === '23505') toast('Já existe um convite pendente para este email.', { type: 'error' })
      else toast('Erro ao enviar convite: ' + error.message, { type: 'error' })
      return
    }
    setInviteEmail('')
    await load()
  }

  async function revokeInvite(inviteId: string) {
    const { error } = await supabase.from('project_invites').update({ status: 'revoked' }).eq('id', inviteId)
    if (error) { toast('Erro ao revogar convite: ' + error.message, { type: 'error' }); return }
    setInvites(prev => prev.filter(i => i.id !== inviteId))
  }

  async function copyInviteCode() {
    if (!project) return
    await navigator.clipboard.writeText(project.invite_code)
    setInviteCopied('code')
    setTimeout(() => setInviteCopied(null), 1500)
  }

  async function copyJoinLink() {
    if (!project) return
    const url = `${window.location.origin}/join?code=${project.invite_code}`
    await navigator.clipboard.writeText(url)
    setInviteCopied('link')
    setTimeout(() => setInviteCopied(null), 1500)
  }

  async function removeMember(userId: string, displayName: string) {
    if (!project) return
    if (!await confirmDialog({ title: 'Remover membro', message: `Remover ${displayName} do projeto?`, confirmLabel: 'Remover', danger: true })) return
    const { error } = await supabase.from('band_members').delete().eq('band_id', project.id).eq('user_id', userId)
    if (error) { toast('Erro ao remover membro: ' + error.message, { type: 'error' }); return }
    setMembers(prev => prev.filter(m => m.user_id !== userId))
  }

  async function changeRole(userId: string, role: ProjectRole) {
    if (!project) return
    const { error } = await supabase.from('band_members').update({ role }).eq('band_id', project.id).eq('user_id', userId)
    if (error) { toast('Erro ao alterar o papel: ' + error.message, { type: 'error' }); return }
    setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role } : m))
  }

  async function saveInstrument() {
    if (!project || !user) return
    const { error } = await supabase.from('band_members').update({ instrument: instrumentInput.trim() || null }).eq('band_id', project.id).eq('user_id', user.id)
    if (error) { toast('Erro ao guardar o instrumento: ' + error.message, { type: 'error' }); setEditingInstrument(false); return }
    setMembers(prev => prev.map(m => m.user_id === user.id ? { ...m, instrument: instrumentInput.trim() || undefined } : m))
    setEditingInstrument(false)
  }

  async function deleteSong(songId: string, title: string) {
    if (!await confirmDialog({ title: 'Remover música', message: `Remover "${title}" do repertório?`, confirmLabel: 'Remover', danger: true })) return
    setDeletingSong(songId)
    const { error } = await supabase.from('songs').delete().eq('id', songId)
    setDeletingSong(null)
    if (error) { toast('Erro ao remover a música: ' + error.message, { type: 'error' }); return }
    setSongs(prev => prev.filter(s => s.id !== songId))
  }

  /** Exporta o repertório do projeto (filtrado como na vista) em PDF */
  async function exportRepertoirePdf(withLyrics: boolean) {
    if (!project || exporting) return
    const visible = songs.filter(s => !songSearch || `${s.title} ${s.artist}`.toLowerCase().includes(songSearch.toLowerCase()))
    if (visible.length === 0) return
    let items: { title: string; lyrics?: string | null }[] = visible.map(s => ({ title: s.title }))
    if (withLyrics) {
      setExporting(true)
      const { data, error } = await supabase
        .from('songs')
        .select('id, lyrics, edited_lyrics')
        .in('id', visible.map(s => s.id))
      setExporting(false)
      if (error) { toast('Erro ao carregar as letras: ' + error.message, { type: 'error' }); return }
      const byId = new Map((data ?? []).map((r: any) => [r.id as string, (r.edited_lyrics ?? r.lyrics) as string | null]))
      items = visible.map(s => ({ title: s.title, lyrics: byId.get(s.id) ?? null }))
    }
    const ok = exportSongsPdf(items, {
      title: project.name,
      accent: projectColorOf(project.color),
      logoUrl: project.image_url ?? null,
      logoInitial: project.name,
      withLyrics,
    })
    if (!ok) toast('Permite pop-ups para exportar o PDF.', { type: 'error' })
  }

  function onVenueInput(val: string) {
    setNewSetlistVenue(val)
    if (venueDebounceRef.current) clearTimeout(venueDebounceRef.current)
    if (val.trim().length < 3) { setVenueSuggestions([]); setShowVenueDrop(false); return }
    venueDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&accept-language=pt`,
          { headers: { 'Accept-Language': 'pt' } }
        )
        const data: { display_name: string }[] = await res.json()
        const suggestions = data.map(r => {
          const parts = r.display_name.split(',')
          return { name: parts[0].trim(), detail: parts.slice(1, 3).map(s => s.trim()).join(', ') }
        })
        setVenueSuggestions(suggestions)
        setShowVenueDrop(suggestions.length > 0)
      } catch { setVenueSuggestions([]); setShowVenueDrop(false) }
    }, 400)
  }

  function createSetlist() {
    setNewSetlistName('')
    setNewSetlistVenue('')
    setVenueSuggestions([])
    setShowVenueDrop(false)
    setShowCreateSetlist(true)
  }

  async function doCreateSetlist() {
    if (!project || !user || !newSetlistName.trim()) return
    setCreatingSetlist(true)
    const { data, error } = await supabase
      .from('setlists')
      .insert({
        name: newSetlistName.trim(),
        venue: newSetlistVenue.trim() || null,
        owner_id: user.id,
        band_id: project.id,
        is_shared: true,
        status: 'draft',
      })
      .select()
      .single()
    setCreatingSetlist(false)
    if (error) { toast('Erro ao criar concerto: ' + error.message, { type: 'error' }); return }
    setShowCreateSetlist(false)
    if (data) navigate(`/setlist/${data.id}?add=1`)
  }

  if (loading) {
    return (
      <div className={styles.page} aria-busy="true">
        <div className="skeleton" style={{ height: 12, width: 160 }} />
        <div className={styles.heroSkeleton}>
          <div className={`skeleton ${styles.tileSkeleton}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="skeleton" style={{ height: 11, width: '22%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 34, width: '55%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 12, width: '38%' }} />
          </div>
        </div>
        <div className="skeleton" style={{ height: 50, borderRadius: 8 }} />
        <div className={styles.panel}>
          {[0, 1, 2].map(i => (
            <div key={i} className={styles.rowSkeleton}>
              <div className="skeleton" style={{ width: 40, height: 40, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="skeleton" style={{ height: 15, width: '50%', marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 11, width: '30%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyPanel}>
          <p className={styles.emptySub}>{error ?? 'Projeto não encontrado.'}</p>
          <button className={styles.secondaryBtn} onClick={() => navigate('/')}>
            <IconArrowLeft /> Voltar
          </button>
        </div>
      </div>
    )
  }

  const projectColor = projectColorOf(project.color)
  const typeLabel = PROJECT_TYPE_LABELS[project.type as ProjectType] ?? project.type
  const imagePos = (project as any).image_position ?? 50

  const visibleSongs = songs.filter(
    s => !songSearch || `${s.title} ${s.artist}`.toLowerCase().includes(songSearch.toLowerCase())
  )

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  /* Contagem do cabeçalho de secção, à direita da régua: "CONCERTOS ──────── 03" */
  const headCount = (n: number) => (
    <span className={styles.headCount}>{pad2(n)}</span>
  )

  // Resumo: os próximos (e sem data); se não houver, os passados mais recentes
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const upcomingGigs = setlists.filter(s => !s.date || parseDay(s.date) >= todayStart)
  const pastGigs = setlists.filter(s => !!s.date && parseDay(s.date) < todayStart).reverse()
  const overviewGigs = (upcomingGigs.length > 0 ? upcomingGigs : pastGigs).slice(0, 3)

  /* Avatar circular de membro: foto do perfil ou iniciais em tinta */
  const memberAvatar = (m: ProjectMember, name: string, small = false) => (
    <div className={`${styles.memberAvatar} ${small ? styles.memberAvatarSm : ''}`} aria-hidden="true">
      {m.profiles?.avatar_url
        ? <img src={m.profiles.avatar_url} alt="" className={styles.avatarImg} />
        : initials(name)
      }
    </div>
  )

  /* Linha de concerto — a mesma da agenda (Concertos / Palco / Calendário): bloco de data
     "04 / OUT", nome + meta mono (local · músicas), chips de estado e partilha, ▶ fantasma
     para o modo concerto. Sem LED: todos os concertos aqui são deste projeto. */
  const renderSetlistRow = (s: SetlistCard) => {
    const count = s.setlist_songs?.[0]?.count ?? 0
    const statusLabel = s.status ? (STATUS_LABELS[s.status] ?? s.status) : undefined
    const hasChips = !!statusLabel || s.is_shared
    const meta = [s.venue, `${count} mús`].filter(Boolean).join(' · ')
    const open = () => navigate(`/setlist/${s.id}`)
    const day = s.date ? parseDay(s.date) : null
    const isPast = !!day && day < todayStart
    const isToday = !!day && day.getTime() === todayStart.getTime()
    return (
      <div
        key={s.id}
        className={[
          styles.gigRow,
          !hasChips && styles.gigRowNoChip,
          isPast && styles.gigRowPast,
          isToday && styles.gigRowToday,
        ].filter(Boolean).join(' ')}
        role="button"
        tabIndex={0}
        aria-label={`Abrir ${s.name}`}
        onClick={open}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
        }}
      >
        <div className={styles.dateBlock}>
          {s.date ? (
            <>
              <span className={`${styles.dateDay} ${isToday ? styles.dateToday : ''}`}>{dayNumber(s.date)}</span>
              <span className={`${styles.dateMonth} ${isToday ? styles.dateToday : ''}`}>
                {isToday ? 'Hoje' : monthShort(s.date)}
              </span>
            </>
          ) : (
            <>
              <span className={`${styles.dateDay} ${styles.dateDayEmpty}`} aria-hidden="true">--</span>
              <span className={styles.dateMonth}>s/d</span>
            </>
          )}
        </div>
        <div className={styles.gigInfo}>
          <div className={styles.gigName}>{s.name}</div>
          <div className={styles.gigSub}>{meta}</div>
        </div>
        {hasChips && (
          <div className={styles.gigChips}>
            {statusLabel && (
              <span className={styles.statusChip} data-status={s.status ?? undefined}>{statusLabel}</span>
            )}
            {s.is_shared && <span className={styles.statusChip}>partilhada</span>}
          </div>
        )}
        <button
          type="button"
          className={styles.playBtn}
          aria-label={`Iniciar concerto ${s.name}`}
          title="Iniciar concerto"
          onClick={e => { e.stopPropagation(); navigate(`/setlist/${s.id}/concert`) }}
        >
          <IconPlay />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className={styles.page}>
        {isOffline && (
          <div className={styles.offlineBanner} role="status">
            <span className={styles.offlineLed} aria-hidden="true" />
            Sem ligação — a mostrar dados em cache
          </div>
        )}

        {/* Header — o mesmo padrão das outras páginas de entidade (Setlist, Música):
            breadcrumb, micro-rótulo, entityTitle e linha mono diretamente sobre o fundo */}
        <header className={styles.header}>
          <Breadcrumbs items={[
            { label: 'Projetos', to: '/' },
            { label: project.name },
          ]} />
          <div className={styles.hero}>
            {/* Quadrado de identidade neutro (inicial em tinta ou a imagem) + LED da cor do projeto */}
            <label
              className={`${styles.projectAvatar} ${canManage ? styles.avatarEditable : ''}`}
              title={canManage ? 'Alterar imagem do projeto' : undefined}
            >
              <span className={styles.tileFace}>
                {project.image_url
                  ? (
                    <img
                      src={project.image_url}
                      alt={project.name}
                      className={styles.avatarImg}
                      style={{ objectPosition: `50% ${imagePos}%` }}
                    />
                  )
                  : <span aria-hidden="true">{initials(project.name)}</span>
                }
                {canManage && (
                  <span className={styles.avatarEditOverlay} aria-hidden="true">
                    {uploadingImage ? <span className={styles.avatarUploading}>A carregar…</span> : <IconCamera />}
                  </span>
                )}
              </span>
              <span className={styles.tileLed} style={{ background: projectColor }} aria-hidden="true" />
              {canManage && (
                <>
                  {/* Selo da câmara encostado por FORA do canto — nunca tapa a inicial */}
                  <span className={styles.avatarEditBadge} aria-hidden="true"><IconCamera size={13} /></span>
                  <input
                    type="file"
                    accept="image/*"
                    className={styles.visuallyHidden}
                    aria-label="Alterar imagem do projeto"
                    disabled={uploadingImage}
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file || !projectId) return
                      setUploadingImage(true)
                      try {
                        const url = await uploadProjectImage(projectId, file)
                        await supabase.from('bands').update({ image_url: url }).eq('id', projectId)
                        setProject(p => p ? { ...p, image_url: url } : p)
                      } catch (err: any) {
                        toast('Erro ao carregar imagem: ' + (err?.message ?? err), { type: 'error' })
                      } finally {
                        setUploadingImage(false)
                        e.target.value = ''
                      }
                    }}
                  />
                </>
              )}
            </label>
            <div className={styles.heroInfo}>
              {/* Micro-rótulo: tipo · o teu papel */}
              <div className={styles.heroKicker}>
                <span className={styles.heroKickerText}>{typeLabel}</span>
                <span className={styles.chip}>{ROLE_LABELS[myRole] ?? myRole}</span>
              </div>
              <h1 className={styles.projectName}>{project.name}</h1>
              {/* Linha de metadados mono — cada item inteiro; no telemóvel ocupa a largura toda */}
              <div className={styles.heroMeta}>
                <div className={styles.heroMetaList}>
                  <span className={styles.metaItem}>{plural(members.length, 'membro', 'membros')}</span>
                  <span className={styles.metaItem}>{plural(songs.length, 'música', 'músicas')}</span>
                  <span className={styles.metaItem}>{plural(setlists.length, 'concerto', 'concertos')}</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Tabs — segmented mono */}
        <div className={styles.tabsWrap} ref={tabsWrapRef}>
          <div className={styles.tabs} role="tablist" aria-label="Secções do projeto">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                data-active={activeTab === id || undefined}
                className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.content}>
          {/* ── RESUMO ── */}
          {activeTab === 'overview' && (
            <div className={styles.overview}>
              {/* Leituras — contadores mono */}
              <div className={styles.stats}>
                {([
                  ['members', 'Membros', members.length],
                  ['repertoire', 'Músicas', songs.length],
                  ['setlists', 'Concertos', setlists.length],
                ] as [Tab, string, number][]).map(([tab, label, n]) => (
                  <button key={tab} className={styles.stat} onClick={() => setTab(tab)}>
                    <span className={styles.label}>{label}</span>
                    <span className={styles.statNum}>{pad2(n)}</span>
                  </button>
                ))}
              </div>

              <div className={styles.overviewCols}>
                {/* Concertos recentes */}
                <section className={styles.section} aria-labelledby="ov-gigs">
                  <div className={styles.sectionHead}>
                    <h2 id="ov-gigs" className={styles.label}>
                      {upcomingGigs.length > 0 ? 'A seguir' : setlists.length > 0 ? 'Concertos recentes' : 'Concertos'}
                    </h2>
                    <span className={styles.rule} aria-hidden="true" />
                    {setlists.length > 0 && headCount(upcomingGigs.length > 0 ? upcomingGigs.length : setlists.length)}
                    {setlists.length > 0 && (
                      <button className={styles.seeAll} onClick={() => setTab('setlists')}>
                        Ver todos <IconArrowRight />
                      </button>
                    )}
                  </div>
                  <div className={styles.panel}>
                    {setlists.length > 0 ? (
                      overviewGigs.map(renderSetlistRow)
                    ) : (
                      <div className={styles.panelEmpty}>
                        <p>Ainda não existem concertos neste projeto.</p>
                        {canEdit && (
                          <button className={styles.secondaryBtn} onClick={createSetlist}>
                            <IconPlus size={16} /> Novo concerto
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                <div className={styles.sideCol}>
                  {/* Membros */}
                  <section className={styles.section} aria-labelledby="ov-members">
                    <div className={styles.sectionHead}>
                      <h2 id="ov-members" className={styles.label}>Membros</h2>
                      <span className={styles.rule} aria-hidden="true" />
                      {headCount(members.length)}
                      <button className={styles.seeAll} onClick={() => setTab('members')}>
                        Ver todos <IconArrowRight />
                      </button>
                    </div>
                    <div className={styles.panel}>
                      {members.slice(0, 5).map(m => {
                        const name = m.profiles?.display_name ?? 'Utilizador'
                        return (
                          <div key={m.user_id} className={styles.miniMemberRow}>
                            {memberAvatar(m, name, true)}
                            <span className={styles.miniMemberName}>{name}</span>
                            <span className={styles.chip}>{ROLE_LABELS[m.role] ?? m.role}</span>
                          </div>
                        )
                      })}
                      {members.length > 5 && (
                        <button className={styles.addRow} onClick={() => setTab('members')}>
                          <span className={styles.addRowIcon} aria-hidden="true">+{members.length - 5}</span>
                          <span>Mais {members.length - 5} membro{members.length - 5 !== 1 ? 's' : ''}</span>
                        </button>
                      )}
                      {members.length === 0 && (
                        <div className={styles.panelEmpty}><p>Sem membros para mostrar.</p></div>
                      )}
                    </div>
                  </section>

                  {project.description && (
                    <section className={styles.section} aria-labelledby="ov-about">
                      <div className={styles.sectionHead}>
                        <h2 id="ov-about" className={styles.label}>Sobre o projeto</h2>
                        <span className={styles.rule} aria-hidden="true" />
                      </div>
                      <div className={`${styles.panel} ${styles.panelPad}`}>
                        <p className={styles.description}>{project.description}</p>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── REPERTÓRIO ── */}
          {activeTab === 'repertoire' && (
            <div className={styles.tabPane}>
              <div className={styles.sectionHead}>
                <h2 className={styles.label}>Repertório</h2>
                <span className={styles.rule} aria-hidden="true" />
                {headCount(songs.length)}
                {canEdit && songs.length > 0 && (
                  <button
                    className={`${styles.primaryBtn} ${styles.headPrimary}`}
                    onClick={() => navigate(`/search?project=${project.id}`)}
                  >
                    <IconPlus /> Adicionar música
                  </button>
                )}
              </div>

              {songs.length === 0 ? (
                <div className={styles.emptyPanel}>
                  <span className={styles.emptyIcon}><IconMusic /></span>
                  <h3 className={styles.emptyTitle}>Este projeto ainda não tem músicas</h3>
                  <p className={styles.emptySub}>Pesquisa a letra da primeira música para a juntar ao repertório.</p>
                  {canEdit && (
                    <button
                      className={styles.primaryBtn}
                      onClick={() => navigate(`/search?project=${project.id}`)}
                    >
                      <IconSearch size={18} /> Pesquisar letra
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className={styles.toolbar}>
                    <div className={styles.searchWrap}>
                      <span className={styles.searchIcon}><IconSearch /></span>
                      <input
                        className={`${styles.searchInput} ${songSearch ? styles.searchInputCount : ''}`}
                        placeholder="Filtrar por título ou artista..."
                        value={songSearch}
                        onChange={e => setSongSearch(e.target.value)}
                        aria-label="Filtrar repertório"
                      />
                      {songSearch && (
                        <span className={styles.searchCount} aria-live="polite">
                          {pad2(visibleSongs.length)} / {pad2(songs.length)}
                        </span>
                      )}
                    </div>
                    <div className={styles.toolbarActions}>
                      <button className={styles.secondaryBtn} onClick={() => exportRepertoirePdf(false)} disabled={exporting}>
                        <IconDownload /> Exportar lista
                      </button>
                      <button className={styles.secondaryBtn} onClick={() => exportRepertoirePdf(true)} disabled={exporting}>
                        <IconFileText /> {exporting ? 'A preparar…' : 'Exportar com letras'}
                      </button>
                    </div>
                  </div>

                  <div className={styles.panel}>
                    {visibleSongs.map((s, i) => {
                      const plays = songPlayCounts[s.id] ?? 0
                      const open = () => navigate(`/songs/${s.id}?project=${project.id}`)
                      return (
                        <div
                          key={s.id}
                          className={`${styles.songRow} ${canEdit ? styles.songRowEditable : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Abrir ${s.title} — ${s.artist}`}
                          onClick={open}
                          onKeyDown={e => {
                            if (e.target !== e.currentTarget) return
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
                          }}
                        >
                          <span className={styles.songNum}>{pad2(i + 1)}</span>
                          <div className={styles.songInfo}>
                            <div className={styles.songTitle}>{s.title}</div>
                            <div className={styles.songArtist}>{s.artist}</div>
                          </div>
                          <div className={styles.songMeta}>
                            {plays > 0 && (
                              <span className={styles.metaMono} title="Vezes em setlists">{plays}×</span>
                            )}
                            {s.performance_key && <span className={styles.keyChip}>{s.performance_key}</span>}
                            {s.bpm ? <span className={styles.metaMono}>{s.bpm} bpm</span> : null}
                            {s.has_sync && <span className={`${styles.chip} ${styles.chipSuccess}`}>sync</span>}
                            {s.is_user_edited && <span className={`${styles.chip} ${styles.chipWarn}`}>editada</span>}
                            {(s.tags ?? []).slice(0, 2).map(tag => (
                              <span key={tag} className={`${styles.chip} ${styles.chipNeutral}`}>{tag}</span>
                            ))}
                          </div>
                          <span className={styles.songDur}>{formatDuration(s.duration_sec)}</span>
                          {canEdit && (
                            <button
                              className={styles.songDeleteBtn}
                              onClick={e => { e.stopPropagation(); deleteSong(s.id, s.title) }}
                              disabled={deletingSong === s.id}
                              title="Remover do repertório"
                              aria-label={`Remover ${s.title} do repertório`}
                            >
                              {deletingSong === s.id ? <span aria-hidden="true">…</span> : <IconTrash />}
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {visibleSongs.length === 0 && (
                      <div className={styles.panelEmpty}>
                        <p>Nenhuma música corresponde a "{songSearch}"</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── CONCERTOS ── */}
          {activeTab === 'setlists' && (
            <div className={styles.tabPane}>
              <div className={styles.sectionHead}>
                <h2 className={styles.label}>Concertos</h2>
                <span className={styles.rule} aria-hidden="true" />
                {headCount(setlists.length)}
                {canEdit && setlists.length > 0 && (
                  <button className={`${styles.primaryBtn} ${styles.headPrimary}`} onClick={createSetlist}>
                    <IconPlus /> Novo concerto
                  </button>
                )}
              </div>

              {setlists.length === 0 ? (
                <div className={styles.emptyPanel}>
                  <span className={styles.emptyIcon}><IconCalendar /></span>
                  <h3 className={styles.emptyTitle}>Ainda não existem concertos neste projeto</h3>
                  <p className={styles.emptySub}>Cria o primeiro concerto para ensaio ou apresentação.</p>
                  {canEdit && (
                    <button className={styles.primaryBtn} onClick={createSetlist}>
                      <IconPlus /> Criar concerto
                    </button>
                  )}
                </div>
              ) : (
                <div className={styles.panel}>
                  {setlists.map(renderSetlistRow)}
                </div>
              )}
            </div>
          )}

          {/* ── MEMBROS ── */}
          {activeTab === 'members' && (
            <div className={styles.tabPane}>
              <div className={styles.sectionHead}>
                <h2 className={styles.label}>Membros</h2>
                <span className={styles.rule} aria-hidden="true" />
                {headCount(members.length)}
              </div>

              <div className={styles.panel}>
                {members.map(m => {
                  const name = m.profiles?.display_name ?? 'Utilizador'
                  const isSelf = m.user_id === user?.id
                  const canRemove = canManage && !isSelf && m.role !== 'owner'
                  const canChangeRole = canManage && !isSelf && m.role !== 'owner'

                  return (
                    <div key={m.user_id} className={styles.memberRow}>
                      {memberAvatar(m, name)}
                      <div className={styles.memberInfo}>
                        <div className={styles.memberName}>
                          <span className={styles.memberNameText}>{name}</span>
                          {isSelf && <span className={`${styles.chip} ${styles.chipNeutral}`}>tu</span>}
                        </div>
                        {isSelf && editingInstrument ? (
                          <input
                            className={styles.instrumentInput}
                            value={instrumentInput}
                            onChange={e => setInstrumentInput(e.target.value)}
                            onBlur={saveInstrument}
                            onKeyDown={e => e.key === 'Enter' && saveInstrument()}
                            placeholder="o teu instrumento"
                            aria-label="O teu instrumento"
                            autoFocus
                          />
                        ) : isSelf ? (
                          <button
                            className={styles.instrumentBtn}
                            onClick={() => { setInstrumentInput(m.instrument ?? ''); setEditingInstrument(true) }}
                            aria-label={m.instrument ? `Instrumento: ${m.instrument} — editar` : 'Adicionar instrumento'}
                          >
                            <span className={m.instrument ? undefined : styles.instrumentPlaceholder}>
                              {m.instrument ?? 'Adicionar instrumento'}
                            </span>
                            <IconPencil />
                          </button>
                        ) : (
                          <div className={styles.memberSub}>{m.instrument ?? '—'}</div>
                        )}
                      </div>
                      <div className={styles.memberActions}>
                        {canChangeRole ? (
                          <div className={styles.selectWrap}>
                            <select
                              className={`${styles.select} ${styles.roleSelect}`}
                              value={m.role}
                              onChange={e => changeRole(m.user_id, e.target.value as ProjectRole)}
                              aria-label={`Papel de ${name}`}
                            >
                              <option value="admin">{ROLE_LABELS.admin}</option>
                              <option value="editor">{ROLE_LABELS.editor}</option>
                              <option value="viewer">{ROLE_LABELS.viewer}</option>
                            </select>
                            <span className={styles.selectIcon}><IconChevronDown /></span>
                          </div>
                        ) : (
                          <span className={styles.chip}>{ROLE_LABELS[m.role] ?? m.role}</span>
                        )}
                        {canRemove && (
                          <button
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            onClick={() => removeMember(m.user_id, name)}
                            title={`Remover ${name}`}
                            aria-label={`Remover ${name}`}
                          >
                            <IconX size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Convites pendentes */}
              {canManage && invites.length > 0 && (
                <section className={styles.section} aria-labelledby="pending-invites">
                  <div className={styles.sectionHead}>
                    <h3 id="pending-invites" className={styles.label}>Convites pendentes</h3>
                    <span className={styles.rule} aria-hidden="true" />
                    {headCount(invites.length)}
                  </div>
                  <div className={styles.panel}>
                    {invites.map(inv => (
                      <div key={inv.id} className={styles.inviteRow}>
                        <div className={styles.inviteEmail}>{inv.email}</div>
                        <span className={`${styles.chip} ${styles.chipNeutral}`}>{ROLE_LABELS[inv.role] ?? inv.role}</span>
                        <button className={styles.ghostDangerBtn} onClick={() => revokeInvite(inv.id)}>Revogar</button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Convidar */}
              {canManage && (
                <section className={styles.section} aria-labelledby="invite-member">
                  <div className={styles.sectionHead}>
                    <h3 id="invite-member" className={styles.label}>Convidar membro</h3>
                    <span className={styles.rule} aria-hidden="true" />
                  </div>
                  <div className={`${styles.panel} ${styles.panelPad}`}>
                    <div className={styles.inviteInputRow}>
                      <input
                        className={`${styles.input} ${styles.inviteEmailInput}`}
                        type="email"
                        placeholder="email do membro"
                        value={inviteEmail}
                        onChange={e => setInviteEmail(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendInvite()}
                        aria-label="Email do membro"
                      />
                      <div className={`${styles.selectWrap} ${styles.inviteRoleWrap}`}>
                        <select
                          className={styles.select}
                          value={inviteRole}
                          onChange={e => setInviteRole(e.target.value as typeof inviteRole)}
                          aria-label="Papel do convidado"
                        >
                          <option value="admin">{ROLE_LABELS.admin}</option>
                          <option value="editor">{ROLE_LABELS.editor}</option>
                          <option value="viewer">{ROLE_LABELS.viewer}</option>
                        </select>
                        <span className={styles.selectIcon}><IconChevronDown /></span>
                      </div>
                      <button
                        className={`${styles.primaryBtn} ${styles.inviteBtn}`}
                        onClick={sendInvite}
                        disabled={inviting || !inviteEmail.trim()}
                      >
                        {inviting ? 'A convidar…' : 'Convidar'}
                      </button>
                    </div>
                    <p className={styles.hint}>
                      O membro receberá um convite por email para entrar no projeto.
                    </p>

                    <div className={styles.codeBox}>
                      <span className={styles.label}>Código de convite rápido</span>
                      <div className={styles.codeRow}>
                        <code className={styles.inviteCode}>{project.invite_code}</code>
                        <div className={styles.codeActions} aria-live="polite">
                          <button
                            className={`${styles.secondaryBtn} ${inviteCopied === 'code' ? styles.copied : ''}`}
                            onClick={copyInviteCode}
                          >
                            {inviteCopied === 'code' ? <><IconCheck /> Copiado</> : <><IconCopy /> Copiar código</>}
                          </button>
                          <button
                            className={`${styles.secondaryBtn} ${inviteCopied === 'link' ? styles.copied : ''}`}
                            onClick={copyJoinLink}
                          >
                            {inviteCopied === 'link' ? <><IconCheck /> Link copiado</> : <><IconLink /> Copiar link</>}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ── DEFINIÇÕES ── */}
          {activeTab === 'settings' && (
            <div className={`${styles.tabPane} ${styles.settingsPane}`}>
              <div className={styles.sectionHead}>
                <h2 className={styles.label}>Definições do projeto</h2>
                <span className={styles.rule} aria-hidden="true" />
              </div>

              <div className={`${styles.panel} ${styles.panelPad}`}>
                {canManage ? (
                  <>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="settings-name">Nome do projeto</label>
                      <input
                        id="settings-name"
                        className={styles.input}
                        value={settingsName}
                        onChange={e => setSettingsName(e.target.value)}
                        placeholder="Nome do projeto"
                      />
                    </div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="settings-type">Tipo</label>
                      <div className={styles.selectWrap}>
                        <select
                          id="settings-type"
                          className={styles.select}
                          value={settingsType}
                          onChange={e => setSettingsType(e.target.value as ProjectType)}
                        >
                          {Object.entries(PROJECT_TYPE_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                        <span className={styles.selectIcon}><IconChevronDown /></span>
                      </div>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="settings-desc">Descrição</label>
                      <textarea
                        id="settings-desc"
                        className={styles.textarea}
                        value={settingsDesc}
                        onChange={e => setSettingsDesc(e.target.value)}
                        placeholder="Descrição do projeto..."
                        rows={3}
                      />
                    </div>

                    <div className={styles.field}>
                      <span className={styles.fieldLabel} id="settings-color">Cor do projeto</span>
                      <div className={styles.colorGrid} role="group" aria-labelledby="settings-color">
                        {SWATCHES.map(c => (
                          <button
                            key={c}
                            type="button"
                            className={`${styles.colorSwatch} ${settingsColor === c ? styles.colorActive : ''}`}
                            style={{ background: c }}
                            onClick={() => setSettingsColor(c)}
                            aria-label={`Cor ${c}`}
                            aria-pressed={settingsColor === c}
                            title={c}
                          />
                        ))}
                      </div>
                    </div>

                    {project.image_url && (
                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor="settings-imgpos">Enquadramento da imagem</label>
                        <div className={styles.imagePosPreview}>
                          <img
                            src={project.image_url}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${settingsImagePos}%` }}
                          />
                        </div>
                        <input
                          id="settings-imgpos"
                          type="range"
                          min={0}
                          max={100}
                          value={settingsImagePos}
                          onChange={e => setSettingsImagePos(Number(e.target.value))}
                          className={styles.imagePosSlider}
                        />
                        <div className={styles.hint}>Arrasta para escolher que parte da imagem aparece no cartão</div>
                      </div>
                    )}

                    <div className={styles.settingsFooter}>
                      <button
                        className={styles.primaryBtn}
                        onClick={saveSettings}
                        disabled={savingSettings || !settingsName.trim()}
                      >
                        {savingSettings ? 'A guardar...' : settingsSaved ? <><IconCheck /> Guardado</> : 'Guardar alterações'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className={styles.noPermNote}>Só o owner ou admin podem alterar as definições do projeto.</p>
                )}
              </div>

              <section className={styles.dangerZone} aria-labelledby="danger-zone">
                <h3 id="danger-zone" className={styles.dangerLabel}>Zona de perigo</h3>
                <div className={styles.dangerBody}>
                  <div className={styles.dangerText}>
                    <div className={styles.dangerTitle}>{isOwner ? 'Eliminar projeto' : 'Sair do projeto'}</div>
                    <p className={styles.dangerSub}>
                      {isOwner
                        ? 'Elimina o projeto para todos os membros. Esta ação é irreversível.'
                        : 'Deixas de ter acesso ao repertório e aos concertos deste projeto.'}
                    </p>
                  </div>
                  {isOwner ? (
                    <button className={styles.dangerBtn} onClick={deleteProject}>
                      <IconTrash size={16} /> Eliminar projeto permanentemente
                    </button>
                  ) : (
                    <button className={styles.dangerBtn} onClick={leaveProject}>
                      Sair do projeto
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {showCreateSetlist && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateSetlist(false)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-gig-title"
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalHeadText}>
                <span className={styles.modalKicker}>
                  <span className={styles.led} style={{ background: projectColor }} aria-hidden="true" />
                  {project.name}
                </span>
                <h2 id="new-gig-title" className={styles.modalTitle}>Novo concerto</h2>
              </div>
              <button className={styles.iconBtn} onClick={() => setShowCreateSetlist(false)} aria-label="Fechar">
                <IconX />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-gig-name">Nome *</label>
                <input
                  id="new-gig-name"
                  className={styles.input}
                  placeholder="Nome do concerto..."
                  value={newSetlistName}
                  onChange={e => setNewSetlistName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && newSetlistVenue === '' && doCreateSetlist()}
                  autoFocus
                />
              </div>
              <div className={styles.field} style={{ position: 'relative' }}>
                <label className={styles.fieldLabel} htmlFor="new-gig-venue">Local (opcional)</label>
                <input
                  id="new-gig-venue"
                  className={styles.input}
                  placeholder="Ex: Hard Club, Porto..."
                  value={newSetlistVenue}
                  onChange={e => onVenueInput(e.target.value)}
                  onFocus={() => venueSuggestions.length > 0 && setShowVenueDrop(true)}
                  onBlur={() => setTimeout(() => setShowVenueDrop(false), 200)}
                  onKeyDown={e => e.key === 'Enter' && doCreateSetlist()}
                  autoComplete="off"
                />
                {showVenueDrop && venueSuggestions.length > 0 && (
                  <div className={styles.venueDrop}>
                    {venueSuggestions.map((s, i) => (
                      <div
                        key={i}
                        className={styles.venueDropItem}
                        onMouseDown={() => { setNewSetlistVenue(s.name); setShowVenueDrop(false) }}
                      >
                        <div className={styles.venueDropName}>{s.name}</div>
                        {s.detail && <div className={styles.venueDropDetail}>{s.detail}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.secondaryBtn} onClick={() => setShowCreateSetlist(false)}>Cancelar</button>
              <button
                className={styles.primaryBtn}
                onClick={doCreateSetlist}
                disabled={creatingSetlist || !newSetlistName.trim()}
              >
                {creatingSetlist ? 'A criar...' : 'Criar concerto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
