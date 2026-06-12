import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Layout from '../../components/Layout'
import Breadcrumbs from '../../components/Breadcrumbs'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../lib/supabase'
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

const SETLIST_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  preparing: 'A preparar',
  final: 'Final',
  archived: 'Arquivada',
}

export default function ProjectDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirmDialog = useConfirm()
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
    if (error) { alert('Erro ao guardar: ' + error.message); return }
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
      if (error.code === '23505') alert('Já existe um convite pendente para este email.')
      else alert('Erro ao enviar convite: ' + error.message)
      return
    }
    setInviteEmail('')
    await load()
  }

  async function revokeInvite(inviteId: string) {
    await supabase.from('project_invites').update({ status: 'revoked' }).eq('id', inviteId)
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
    await supabase.from('band_members').delete().eq('band_id', project.id).eq('user_id', userId)
    setMembers(prev => prev.filter(m => m.user_id !== userId))
  }

  async function changeRole(userId: string, role: ProjectRole) {
    if (!project) return
    await supabase.from('band_members').update({ role }).eq('band_id', project.id).eq('user_id', userId)
    setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role } : m))
  }

  async function saveInstrument() {
    if (!project || !user) return
    await supabase.from('band_members').update({ instrument: instrumentInput.trim() || null }).eq('band_id', project.id).eq('user_id', user.id)
    setMembers(prev => prev.map(m => m.user_id === user.id ? { ...m, instrument: instrumentInput.trim() || undefined } : m))
    setEditingInstrument(false)
  }

  async function deleteSong(songId: string, title: string) {
    if (!await confirmDialog({ title: 'Remover música', message: `Remover "${title}" do repertório?`, confirmLabel: 'Remover', danger: true })) return
    setDeletingSong(songId)
    await supabase.from('songs').delete().eq('id', songId)
    setSongs(prev => prev.filter(s => s.id !== songId))
    setDeletingSong(null)
  }

  function createSetlist() {
    setNewSetlistName('')
    setNewSetlistVenue('')
    setShowCreateSetlist(true)
  }

  async function doCreateSetlist() {
    if (!project || !user || !newSetlistName.trim()) return
    setCreatingSetlist(true)
    const { data } = await supabase
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
    setShowCreateSetlist(false)
    if (data) navigate(`/setlist/${data.id}?add=1`)
  }

  if (loading) {
    return (
      <Layout>
        <div className={styles.loading}>A carregar projeto...</div>
      </Layout>
    )
  }

  if (error || !project) {
    return (
      <Layout>
        <div className={styles.errorState}>
          <p>{error ?? 'Projeto não encontrado.'}</p>
          <button className={styles.backLink} onClick={() => navigate('/')}>← Voltar</button>
        </div>
      </Layout>
    )
  }

  const projectColor = project.color ?? PROJECT_COLORS[0]

  return (
    <Layout>
      <div className={styles.page}>
        {isOffline && (
          <div className={styles.offlineBanner}>
            Sem ligação — a mostrar dados em cache
          </div>
        )}
        {/* Header */}
        <div className={styles.header}>
          <Breadcrumbs items={[
            { label: 'Projetos', to: '/' },
            { label: project.name },
          ]} />
          <div className={styles.projectHead}>
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
                  <span className={styles.avatarEditIcon}>📷</span>
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
                        alert('Erro ao carregar imagem: ' + (err?.message ?? err))
                      } finally {
                        setUploadingImage(false)
                        e.target.value = ''
                      }
                    }}
                  />
                </>
              )}
            </label>
            <div>
              <h1 className={styles.projectName}>{project.name}</h1>
              <div className={styles.projectMeta}>
                <span className={styles.typeBadge}>{PROJECT_TYPE_LABELS[project.type as ProjectType] ?? project.type}</span>
                <span className={styles.metaDot}>·</span>
                <span className={styles.metaText}>{members.length} membro{members.length !== 1 ? 's' : ''}</span>
                <span className={styles.metaDot}>·</span>
                <span className={styles.metaText}>{setlists.length} setlist{setlists.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className={styles.tabs} style={{ '--tab-color': projectColor } as React.CSSProperties}>
          {([
            ['setlists', 'Setlists'],
            ['repertoire', 'Repertório'],
            ['members', 'Membros'],
            ['settings', 'Definições'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
              onClick={() => setTab(id)}
              style={activeTab === id ? { color: projectColor, borderBottomColor: projectColor } : undefined}
            >
              {label}
            </button>
          ))}
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
                  <div className={styles.statLabel}>Setlists</div>
                </div>
              </div>

              {/* Recent setlists */}
              {setlists.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>SETLISTS RECENTES</div>
                    <button className={styles.seeAll} onClick={() => setTab('setlists')}>ver todas</button>
                  </div>
                  <div className={styles.recentList}>
                    {setlists.slice(0, 3).map(s => (
                      <div key={s.id} className={styles.recentItem} onClick={() => navigate(`/setlist/${s.id}`)}>
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
                {canEdit && (
                  <div className={styles.tabActions}>
                    <button className={styles.addBtn} onClick={() => navigate(`/search?project=${project.id}`)}>
                      + Pesquisar letra
                    </button>
                  </div>
                )}
              </div>

              {songs.length === 0 ? (
                <div className={styles.emptyTab}>
                  <div className={styles.emptyTabIcon}>🎵</div>
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
                  <input
                    className={styles.songSearchInput}
                    placeholder="Filtrar por título ou artista..."
                    value={songSearch}
                    onChange={e => setSongSearch(e.target.value)}
                  />
                  <div className={styles.songList}>
                    {songs
                      .filter(s => !songSearch || `${s.title} ${s.artist}`.toLowerCase().includes(songSearch.toLowerCase()))
                      .map(s => (
                        <div
                          key={s.id}
                          className={styles.songRow}
                          onClick={() => navigate(`/songs/${s.id}?project=${project.id}`)}
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
                              {deletingSong === s.id ? '...' : '✕'}
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
                  <h2 className={styles.tabTitle}>Setlists</h2>
                  <p className={styles.tabSub}>{setlists.length} setlist{setlists.length !== 1 ? 's' : ''}</p>
                </div>
                {canEdit && (
                  <button className={styles.addBtn} style={{ background: projectColor }} onClick={createSetlist}>
                    + Nova setlist
                  </button>
                )}
              </div>

              {setlists.length === 0 ? (
                <div className={styles.emptyTab}>
                  <div className={styles.emptyTabIcon}>📋</div>
                  <h3 className={styles.emptyTabTitle}>Ainda não existem setlists neste projeto</h3>
                  <p className={styles.emptyTabSub}>Cria a primeira setlist para ensaio ou concerto.</p>
                  {canEdit && (
                    <button
                      className={styles.emptyTabBtn}
                      style={{ background: projectColor }}
                      onClick={createSetlist}
                    >
                      Criar setlist
                    </button>
                  )}
                </div>
              ) : (
                <div className={styles.setlistGrid}>
                  {setlists.map(s => (
                    <div key={s.id} className={styles.setlistCard} onClick={() => navigate(`/setlist/${s.id}`)}>
                      <div className={styles.setlistAccent} style={{ background: projectColor }} />
                      <div className={styles.setlistBody}>
                        <div className={styles.setlistName}>{s.name}</div>
                        <div className={styles.setlistMeta}>
                          {s.date ? new Date(s.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                          {s.venue ? `${s.date ? ' · ' : ''}${s.venue}` : ''}
                        </div>
                        <div className={styles.setlistTags}>
                          <span className={styles.setlistCount}>{s.setlist_songs?.[0]?.count ?? 0} músicas</span>
                          {s.status && s.status !== 'draft' && (
                            <span className={styles.statusBadge} data-status={s.status}>
                              {SETLIST_STATUS_LABELS[s.status] ?? s.status}
                            </span>
                          )}
                          {s.is_shared && <span className={styles.sharedBadge}>partilhada</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {canEdit && (
                    <button className={styles.newSetlistCard} onClick={createSetlist}>
                      <span>+</span>
                      <span>Nova setlist</span>
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
                          >
                            ✕
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
                        {inviteCopied === 'code' ? '✓' : 'Copiar código'}
                      </button>
                      <button className={styles.copyCodeBtn} onClick={copyJoinLink}>
                        {inviteCopied === 'link' ? '✓ Link copiado' : 'Copiar link'}
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
                    {savingSettings ? 'A guardar...' : settingsSaved ? '✓ Guardado' : 'Guardar alterações'}
                  </button>
                </>
              ) : (
                <p className={styles.noPermNote}>Só o owner ou admin podem alterar as definições do projeto.</p>
              )}

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
              <div className={styles.modalTitle}>Nova setlist</div>
              <button className={styles.modalClose} onClick={() => setShowCreateSetlist(false)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Nome *</label>
                <input
                  className={styles.modalInput}
                  placeholder="Nome da setlist..."
                  value={newSetlistName}
                  onChange={e => setNewSetlistName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && newSetlistVenue === '' && doCreateSetlist()}
                  autoFocus
                />
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Local (opcional)</label>
                <input
                  className={styles.modalInput}
                  placeholder="Ex: Hard Club, Sala Principal..."
                  value={newSetlistVenue}
                  onChange={e => setNewSetlistVenue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doCreateSetlist()}
                />
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
                {creatingSetlist ? 'A criar...' : 'Criar setlist'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
