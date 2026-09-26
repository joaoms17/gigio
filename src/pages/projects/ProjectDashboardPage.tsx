import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { exportSongsPdf } from '../../lib/pdfExport'
import { uploadProjectImage } from '../../lib/uploadImage'
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
  has_sync: boolean
  is_user_edited: boolean
  source_provider: string | null
  updated_at: string | null
}

const PALETTE = ['#7C3AED', '#FF4D6D', '#2563EB', '#059669', '#D97706', '#DB2777', '#0891B2', '#9333EA']
function colorFor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

/* ── Ícones SVG inline ── */

function IconX({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

function IconPlus({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconArrowLeft({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="20" y1="12" x2="4" y2="12" />
      <path d="m10 6-6 6 6 6" />
    </svg>
  )
}

function IconCamera({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function IconSearch({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  )
}

function IconMusic({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function IconCalendar({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function IconDownload({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function IconFileText({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
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
  const [settingsColor, setSettingsColor] = useState(PROJECT_COLORS[0])
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
    setSettingsColor(proj.color ?? PROJECT_COLORS[0])
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
        .select('id, title, artist, tags, performance_key, bpm, has_sync, is_user_edited, source_provider, updated_at')
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

  // Segmented control: mede a posição da tab ativa para o deslize do "thumb"
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const [tabThumb, setTabThumb] = useState<{ left: number; width: number } | null>(null)
  useEffect(() => {
    const measure = () => {
      const el = tabsRef.current?.querySelector<HTMLElement>('[data-active]')
      if (el) setTabThumb({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    let cancelled = false
    document.fonts?.ready.then(() => { if (!cancelled) measure() }).catch(() => {})
    return () => { cancelled = true; window.removeEventListener('resize', measure) }
  }, [activeTab, loading])

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
      accent: project.color ?? PROJECT_COLORS[0],
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
        <div className={styles.heroSkeleton}>
          <div className="skeleton" style={{ width: 84, height: 84, borderRadius: 20, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="skeleton" style={{ height: 30, width: '55%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 14, width: '35%' }} />
          </div>
        </div>
        <div className="skeleton" style={{ height: 52, borderRadius: 999, marginBottom: 26 }} />
        <div className="skeleton" style={{ height: 110, borderRadius: 18, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 110, borderRadius: 18 }} />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className={styles.errorState}>
        <p>{error ?? 'Projeto não encontrado.'}</p>
        <button className={styles.backLink} onClick={() => navigate('/')}>
          <IconArrowLeft /> Voltar
        </button>
      </div>
    )
  }

  const projectColor = project.color ?? PROJECT_COLORS[0]

  return (
    <>
      <div className={styles.page}>
        {isOffline && (
          <div className={styles.offlineBanner}>
            Sem ligação — a mostrar dados em cache
          </div>
        )}
        {/* Header — mini-herói do projeto */}
        <div className={styles.header}>
          <Breadcrumbs items={[
            { label: 'Projetos', to: '/' },
            { label: project.name },
          ]} />
          <div className={styles.hero} style={{ '--project-tint': `${projectColor}24` } as React.CSSProperties}>
            <label
              className={`${styles.projectAvatar} ${canManage ? styles.avatarEditable : ''}`}
              style={{ background: projectColor }}
              title={canManage ? 'Alterar imagem do projeto' : undefined}
            >
              {project.image_url
                ? <img src={project.image_url} alt={project.name} className={styles.avatarImg} />
                : initials(project.name)
              }
              {canManage && (
                <>
                  <span className={styles.avatarEditIcon}><IconCamera /></span>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
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
              <h1 className={styles.projectName}>{project.name}</h1>
              <div className={styles.projectMeta}>
                <span className={styles.typeBadge}>{PROJECT_TYPE_LABELS[project.type as ProjectType] ?? project.type}</span>
                <span className={styles.metaDot} aria-hidden="true">·</span>
                <span className={styles.metaText}>{members.length} membro{members.length !== 1 ? 's' : ''}</span>
                <span className={styles.metaDot} aria-hidden="true">·</span>
                <span className={styles.metaText}>{setlists.length} concerto{setlists.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs — segmented control pill */}
        <div className={styles.tabsWrap}>
          <div
            className={styles.tabs}
            ref={tabsRef}
            role="tablist"
            aria-label="Secções do projeto"
            style={{ '--tab-ring': `${projectColor}59` } as React.CSSProperties}
          >
            <span
              className={styles.tabThumb}
              aria-hidden="true"
              style={tabThumb
                ? { width: tabThumb.width, transform: `translateX(${tabThumb.left}px)`, opacity: 1 }
                : undefined}
            />
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                data-active={activeTab === id || undefined}
                className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
                onClick={() => setTab(id)}
                style={activeTab === id ? { color: projectColor } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.content}>
          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <div className={styles.overviewGrid}>
              {/* Stats */}
              <div className={styles.statsRow}>
                <div className={styles.statCard}>
                  <div className={styles.statNum}>{members.length}</div>
                  <div className={styles.statLabel}>Membros</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statNum}>{songs.length}</div>
                  <div className={styles.statLabel}>Músicas</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statNum}>{setlists.length}</div>
                  <div className={styles.statLabel}>Concertos</div>
                </div>
              </div>

              {/* Recent setlists */}
              {setlists.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>CONCERTOS RECENTES</div>
                    <button className={styles.seeAll} onClick={() => setTab('setlists')}>ver todos</button>
                  </div>
                  <div className={styles.recentList}>
                    {setlists.slice(0, 3).map(s => (
                      <div
                        key={s.id}
                        className={styles.recentItem}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/setlist/${s.id}`)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/setlist/${s.id}`) }
                        }}
                      >
                        <div className={styles.recentInfo}>
                          <div className={styles.recentName}>{s.name}</div>
                          <div className={styles.recentSub}>
                            {s.date ? new Date(s.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                            {s.venue ? `${s.date ? ' · ' : ''}${s.venue}` : ''}
                          </div>
                        </div>
                        <span className={styles.recentCount}>{s.setlist_songs?.[0]?.count ?? 0} músicas</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Members preview */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>MEMBROS</div>
                  <button className={styles.seeAll} onClick={() => setTab('members')}>ver todos</button>
                </div>
                <div className={styles.memberPreview}>
                  {members.slice(0, 5).map(m => {
                    const name = m.profiles?.display_name ?? 'Utilizador'
                    return (
                      <div key={m.user_id} className={styles.memberChip}>
                        <div className={styles.memberAvatar} style={{ background: colorFor(m.user_id) }}>
                          {initials(name)}
                        </div>
                        <span className={styles.memberChipName}>{name.split(' ')[0]}</span>
                      </div>
                    )
                  })}
                  {members.length > 5 && (
                    <div className={styles.memberChip}>
                      <div className={styles.memberAvatarMore}>+{members.length - 5}</div>
                    </div>
                  )}
                </div>
              </div>

              {project.description && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>SOBRE O PROJETO</div>
                  <p className={styles.description}>{project.description}</p>
                </div>
              )}
            </div>
          )}

          {/* ── REPERTÓRIO ── */}
          {activeTab === 'repertoire' && (
            <div>
              <div className={styles.tabHeader}>
                <div>
                  <h2 className={styles.tabTitle}>Repertório</h2>
                  <p className={styles.tabSub}>{songs.length} música{songs.length !== 1 ? 's' : ''} no projeto</p>
                </div>
                <div className={styles.tabActions}>
                  {songs.length > 0 && (
                    <>
                      <button className={styles.exportBtn} onClick={() => exportRepertoirePdf(false)} disabled={exporting}>
                        <IconDownload /> Exportar lista
                      </button>
                      <button className={styles.exportBtn} onClick={() => exportRepertoirePdf(true)} disabled={exporting}>
                        <IconFileText /> {exporting ? 'A preparar…' : 'Exportar repertório'}
                      </button>
                    </>
                  )}
                  {canEdit && (
                    <button className={styles.addBtn} style={{ background: projectColor }} onClick={() => navigate(`/search?project=${project.id}`)}>
                      <IconPlus /> Pesquisar letra
                    </button>
                  )}
                </div>
              </div>

              {songs.length === 0 ? (
                <div className={styles.emptyTab}>
                  <div className={styles.emptyTabIcon}><IconMusic /></div>
                  <h3 className={styles.emptyTabTitle}>Este projeto ainda não tem músicas</h3>
                  <p className={styles.emptyTabSub}>Adiciona a primeira música ao repertório.</p>
                  {canEdit && (
                    <button
                      className={styles.emptyTabBtn}
                      style={{ background: projectColor }}
                      onClick={() => navigate(`/search?project=${project.id}`)}
                    >
                      Pesquisar letra
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className={styles.songSearchWrap}>
                    <span className={styles.songSearchIcon}><IconSearch /></span>
                    <input
                      className={styles.songSearchInput}
                      placeholder="Filtrar por título ou artista..."
                      value={songSearch}
                      onChange={e => setSongSearch(e.target.value)}
                    />
                  </div>
                  <div className={styles.songList}>
                    {songs
                      .filter(s => !songSearch || `${s.title} ${s.artist}`.toLowerCase().includes(songSearch.toLowerCase()))
                      .map(s => (
                        <div
                          key={s.id}
                          className={styles.songRow}
                          role="button"
                          tabIndex={0}
                          onClick={() => navigate(`/songs/${s.id}?project=${project.id}`)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/songs/${s.id}?project=${project.id}`) }
                          }}
                        >
                          <div className={styles.songInfo}>
                            <div className={styles.songTitle}>{s.title}</div>
                            <div className={styles.songArtist}>{s.artist}</div>
                          </div>
                          <div className={styles.songMeta}>
                            {songPlayCounts[s.id] > 0 && (
                              <span className={styles.playCountBadge} title="Vezes em setlists">
                                {songPlayCounts[s.id]}×
                              </span>
                            )}
                            {s.performance_key && <span className={styles.keyBadge}>{s.performance_key}</span>}
                            {s.bpm && <span className={styles.bpmBadge}>{s.bpm} bpm</span>}
                            {s.has_sync && <span className={styles.syncBadge2}>sync</span>}
                            {s.is_user_edited && <span className={styles.editedBadge}>editada</span>}
                            {(s.tags ?? []).slice(0, 2).map(tag => (
                              <span key={tag} className={styles.tagBadge}>{tag}</span>
                            ))}
                          </div>
                          {canEdit && (
                            <button
                              className={styles.songDeleteBtn}
                              onClick={e => { e.stopPropagation(); deleteSong(s.id, s.title) }}
                              disabled={deletingSong === s.id}
                              title="Remover do repertório"
                            >
                              {deletingSong === s.id ? '…' : <IconX />}
                            </button>
                          )}
                        </div>
                      ))
                    }
                    {songs.filter(s => !songSearch || `${s.title} ${s.artist}`.toLowerCase().includes(songSearch.toLowerCase())).length === 0 && (
                      <p className={styles.noSongsFilter}>Nenhuma música corresponde a "{songSearch}"</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── SETLISTS ── */}
          {activeTab === 'setlists' && (
            <div>
              <div className={styles.tabHeader}>
                <div>
                  <h2 className={styles.tabTitle}>Concertos</h2>
                  <p className={styles.tabSub}>{setlists.length} concerto{setlists.length !== 1 ? 's' : ''}</p>
                </div>
                {canEdit && (
                  <button className={styles.addBtn} style={{ background: projectColor }} onClick={createSetlist}>
                    <IconPlus /> Novo concerto
                  </button>
                )}
              </div>

              {setlists.length === 0 ? (
                <div className={styles.emptyTab}>
                  <div className={styles.emptyTabIcon}><IconCalendar /></div>
                  <h3 className={styles.emptyTabTitle}>Ainda não existem concertos neste projeto</h3>
                  <p className={styles.emptyTabSub}>Cria o primeiro concerto para ensaio ou apresentação.</p>
                  {canEdit && (
                    <button
                      className={styles.emptyTabBtn}
                      style={{ background: projectColor }}
                      onClick={createSetlist}
                    >
                      Criar concerto
                    </button>
                  )}
                </div>
              ) : (
                <div className={styles.setlistGrid}>
                  {setlists.map(s => (
                    <div
                      key={s.id}
                      className={styles.setlistCard}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/setlist/${s.id}`)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/setlist/${s.id}`) }
                      }}
                    >
                      <div className={styles.setlistAccent} style={{ background: projectColor }} />
                      <div className={styles.setlistBody}>
                        <div className={styles.setlistName}>{s.name}</div>
                        <div className={styles.setlistMeta}>
                          {s.date ? new Date(s.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                          {s.venue ? `${s.date ? ' · ' : ''}${s.venue}` : ''}
                        </div>
                        <div className={styles.setlistTags}>
                          <span className={styles.setlistCount}>{s.setlist_songs?.[0]?.count ?? 0} músicas</span>
                          {s.is_shared && <span className={styles.sharedBadge}>partilhada</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {canEdit && (
                    <button className={styles.newSetlistCard} onClick={createSetlist}>
                      <IconPlus size={20} />
                      <span>Novo concerto</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── MEMBROS ── */}
          {activeTab === 'members' && (
            <div>
              <div className={styles.tabHeader}>
                <div>
                  <h2 className={styles.tabTitle}>Membros</h2>
                  <p className={styles.tabSub}>{members.length} membro{members.length !== 1 ? 's' : ''} ativos</p>
                </div>
              </div>

              <div className={styles.memberList}>
                {members.map(m => {
                  const name = m.profiles?.display_name ?? 'Utilizador'
                  const isSelf = m.user_id === user?.id
                  const canRemove = canManage && !isSelf && m.role !== 'owner'
                  const canChangeRole = canManage && !isSelf && m.role !== 'owner'

                  return (
                    <div key={m.user_id} className={styles.memberRow}>
                      <div className={styles.memberAvatar2} style={{ background: colorFor(m.user_id) }}>
                        {initials(name)}
                      </div>
                      <div className={styles.memberInfo}>
                        <div className={styles.memberName}>
                          {name}
                          {isSelf && <span className={styles.youBadge}>tu</span>}
                        </div>
                        {isSelf && editingInstrument ? (
                          <input
                            className={styles.instrumentInput}
                            value={instrumentInput}
                            onChange={e => setInstrumentInput(e.target.value)}
                            onBlur={saveInstrument}
                            onKeyDown={e => e.key === 'Enter' && saveInstrument()}
                            placeholder="o teu instrumento"
                            autoFocus
                          />
                        ) : (
                          <div
                            className={`${styles.memberSub} ${isSelf ? styles.editable : ''}`}
                            onClick={() => {
                              if (isSelf) { setInstrumentInput(m.instrument ?? ''); setEditingInstrument(true) }
                            }}
                          >
                            {m.instrument ?? (isSelf ? 'Clica para adicionar instrumento' : '—')}
                          </div>
                        )}
                      </div>
                      <div className={styles.memberActions}>
                        {canChangeRole ? (
                          <select
                            className={styles.roleSelect}
                            value={m.role}
                            onChange={e => changeRole(m.user_id, e.target.value as ProjectRole)}
                          >
                            <option value="admin">{ROLE_LABELS.admin}</option>
                            <option value="editor">{ROLE_LABELS.editor}</option>
                            <option value="viewer">{ROLE_LABELS.viewer}</option>
                          </select>
                        ) : (
                          <span className={styles.roleBadge} data-role={m.role}>
                            {ROLE_LABELS[m.role] ?? m.role}
                          </span>
                        )}
                        {canRemove && (
                          <button
                            className={styles.removeBtn}
                            onClick={() => removeMember(m.user_id, name)}
                            title={`Remover ${name}`}
                            aria-label={`Remover ${name}`}
                          >
                            <IconX size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pending invites */}
              {canManage && invites.length > 0 && (
                <div className={styles.inviteSection}>
                  <div className={styles.sectionTitle}>CONVITES PENDENTES</div>
                  {invites.map(inv => (
                    <div key={inv.id} className={styles.inviteRow}>
                      <div className={styles.inviteEmail}>{inv.email}</div>
                      <span className={styles.inviteRoleBadge}>{ROLE_LABELS[inv.role] ?? inv.role}</span>
                      <button className={styles.revokeBtn} onClick={() => revokeInvite(inv.id)}>Revogar</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Invite form */}
              {canManage && (
                <div className={styles.inviteForm}>
                  <div className={styles.sectionTitle}>CONVIDAR MEMBRO</div>
                  <div className={styles.inviteInputRow}>
                    <input
                      className={styles.inviteEmailInput}
                      type="email"
                      placeholder="email do membro"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendInvite()}
                    />
                    <select
                      className={styles.inviteRoleSelect}
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as typeof inviteRole)}
                    >
                      <option value="admin">{ROLE_LABELS.admin}</option>
                      <option value="editor">{ROLE_LABELS.editor}</option>
                      <option value="viewer">{ROLE_LABELS.viewer}</option>
                    </select>
                    <button
                      className={styles.inviteBtn}
                      style={{ background: projectColor }}
                      onClick={sendInvite}
                      disabled={inviting || !inviteEmail.trim()}
                    >
                      {inviting ? '...' : 'Convidar'}
                    </button>
                  </div>
                  <p className={styles.inviteHint}>
                    O membro receberá um convite por email para entrar no projeto.
                  </p>

                  <div className={styles.codeBox}>
                    <div className={styles.codeLabel}>Código de convite rápido</div>
                    <div className={styles.codeRow}>
                      <code className={styles.inviteCode}>{project.invite_code}</code>
                      <button className={styles.copyCodeBtn} onClick={copyInviteCode}>
                        {inviteCopied === 'code' ? <><IconCheck /> Copiado</> : 'Copiar código'}
                      </button>
                      <button className={styles.copyCodeBtn} onClick={copyJoinLink}>
                        {inviteCopied === 'link' ? <><IconCheck /> Link copiado</> : 'Copiar link'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── DEFINIÇÕES ── */}
          {activeTab === 'settings' && (
            <div className={styles.settingsPage}>
              <h2 className={styles.tabTitle}>Definições do projeto</h2>

              <div className={styles.settingsCard}>
              {canManage ? (
                <>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Nome do projeto</label>
                    <input
                      className={styles.fieldInput}
                      value={settingsName}
                      onChange={e => setSettingsName(e.target.value)}
                      placeholder="Nome do projeto"
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Tipo</label>
                    <select
                      className={styles.fieldSelect}
                      value={settingsType}
                      onChange={e => setSettingsType(e.target.value as ProjectType)}
                    >
                      {Object.entries(PROJECT_TYPE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Descrição</label>
                    <textarea
                      className={styles.fieldTextarea}
                      value={settingsDesc}
                      onChange={e => setSettingsDesc(e.target.value)}
                      placeholder="Descrição do projeto..."
                      rows={3}
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Cor do projeto</label>
                    <div className={styles.colorGrid}>
                      {PROJECT_COLORS.map(c => (
                        <button
                          key={c}
                          className={`${styles.colorSwatch} ${settingsColor === c ? styles.colorActive : ''}`}
                          style={{ background: c }}
                          onClick={() => setSettingsColor(c)}
                        />
                      ))}
                    </div>
                  </div>

                  {project.image_url && (
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Enquadramento da imagem</label>
                      <div className={styles.imagePosPreview}>
                        <img
                          src={project.image_url}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${settingsImagePos}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={settingsImagePos}
                        onChange={e => setSettingsImagePos(Number(e.target.value))}
                        className={styles.imagePosSlider}
                      />
                      <div className={styles.imagePosHint}>Arrasta para escolher que parte da imagem aparece no cartão</div>
                    </div>
                  )}

                  <button
                    className={styles.saveBtn}
                    style={{ background: settingsColor }}
                    onClick={saveSettings}
                    disabled={savingSettings || !settingsName.trim()}
                  >
                    {savingSettings ? 'A guardar...' : settingsSaved ? <><IconCheck /> Guardado</> : 'Guardar alterações'}
                  </button>
                </>
              ) : (
                <p className={styles.noPermNote}>Só o owner ou admin podem alterar as definições do projeto.</p>
              )}
              </div>

              <div className={styles.dangerZone}>
                <div className={styles.dangerTitle}>ZONA DE PERIGO</div>
                {isOwner ? (
                  <button className={styles.dangerBtn} onClick={deleteProject}>
                    Eliminar projeto permanentemente
                  </button>
                ) : (
                  <button className={styles.dangerBtn} onClick={leaveProject}>
                    Sair do projeto
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {showCreateSetlist && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateSetlist(false)}>
          <div className={styles.createModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Novo concerto</div>
              <button className={styles.modalClose} onClick={() => setShowCreateSetlist(false)} aria-label="Fechar">
                <IconX />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Nome *</label>
                <input
                  className={styles.modalInput}
                  placeholder="Nome do concerto..."
                  value={newSetlistName}
                  onChange={e => setNewSetlistName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && newSetlistVenue === '' && doCreateSetlist()}
                  autoFocus
                />
              </div>
              <div className={styles.modalField} style={{ position: 'relative' }}>
                <label className={styles.modalLabel}>Local (opcional)</label>
                <input
                  className={styles.modalInput}
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
              <button className={styles.modalCancel} onClick={() => setShowCreateSetlist(false)}>Cancelar</button>
              <button
                className={styles.modalConfirm}
                style={{ background: projectColor }}
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
