import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './BandPage.module.css'

interface Band {
  id: string
  name: string
  owner_id: string
  invite_code: string
  invite_expires_at: string
  created_at: string
}

interface Member {
  user_id: string
  role: string
  instrument: string | null
  profiles: { display_name: string | null }
}

interface BandSetlist {
  id: string
  name: string
  date: string | null
  is_shared: boolean
  setlist_songs: { count: number }[]
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

function daysLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86400000))
}

export default function BandPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { id: bandIdParam } = useParams<{ id: string }>()
  const [bands, setBands] = useState<Band[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [tab, setTab] = useState<'create' | 'join'>('create')

  const [activeBand, setActiveBand] = useState<Band | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [setlists, setSetlists] = useState<BandSetlist[]>([])
  const [copied, setCopied] = useState(false)
  const [editingInstrument, setEditingInstrument] = useState(false)
  const [instrumentInput, setInstrumentInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [renameInput, setRenameInput] = useState('')

  useEffect(() => { if (user) loadBands() }, [user])

  // Abrir banda específica quando vem por /band/:id (links da sidebar)
  useEffect(() => {
    if (!bandIdParam) { setActiveBand(null); return }
    if (activeBand?.id === bandIdParam) return
    const b = bands.find(x => x.id === bandIdParam)
    if (b) openBand(b)
  }, [bandIdParam, bands])

  async function loadBands() {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('band_members')
      .select('bands(*)')
      .eq('user_id', user.id)
    setBands((data ?? []).map((r: any) => r.bands).filter(Boolean))
    setLoading(false)
  }

  async function openBand(band: Band) {
    setActiveBand(band)
    setRenameInput(band.name)
    const [m, s] = await Promise.all([
      supabase.from('band_members').select('user_id, role, instrument, profiles(display_name)').eq('band_id', band.id),
      supabase.from('setlists').select('id, name, date, is_shared, setlist_songs(count)').eq('band_id', band.id).order('date', { ascending: true }),
    ])
    setMembers((m.data ?? []) as unknown as Member[])
    setSetlists((s.data ?? []) as unknown as BandSetlist[])
  }

  async function createBand() {
    if (!user || !newName.trim()) return
    setCreating(true)
    const { data, error } = await supabase.from('bands').insert({ name: newName.trim(), owner_id: user.id }).select().single()
    setCreating(false)
    if (error) { alert('Erro ao criar projeto: ' + error.message); return }
    setNewName('')
    await loadBands()
    if (data) openBand(data)
  }

  async function joinBand() {
    if (!user || !joinCode.trim()) return
    setJoining(true)
    const code = joinCode.trim().toUpperCase()
    const { data: band, error } = await supabase.from('bands').select('*').eq('invite_code', code).single()
    if (error || !band) { alert('Código inválido ou projeto não encontrado.'); setJoining(false); return }
    if (band.invite_expires_at && new Date(band.invite_expires_at).getTime() < Date.now()) {
      alert('Este código de convite expirou. Pede um novo ao dono do projeto.'); setJoining(false); return
    }
    const { error: memErr } = await supabase.from('band_members').insert({ band_id: band.id, user_id: user.id, role: 'member' })
    setJoining(false)
    if (memErr && !memErr.message.includes('duplicate')) { alert('Erro ao entrar: ' + memErr.message); return }
    setJoinCode('')
    await loadBands()
    openBand(band)
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function renewCode() {
    if (!activeBand || !user || activeBand.owner_id !== user.id) return
    const newCode = genCode(activeBand.name)
    const expires = new Date(Date.now() + 7 * 86400000).toISOString()
    const { error } = await supabase.from('bands').update({ invite_code: newCode, invite_expires_at: expires }).eq('id', activeBand.id)
    if (error) { alert('Erro ao renovar: ' + error.message); return }
    setActiveBand({ ...activeBand, invite_code: newCode, invite_expires_at: expires })
  }

  function genCode(name: string) {
    let letters = name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase()
    while (letters.length < 4) letters += 'X'
    return `${letters}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`
  }

  async function saveInstrument() {
    if (!activeBand || !user) return
    await supabase.from('band_members').update({ instrument: instrumentInput.trim() || null }).eq('band_id', activeBand.id).eq('user_id', user.id)
    setMembers(prev => prev.map(m => m.user_id === user.id ? { ...m, instrument: instrumentInput.trim() || null } : m))
    setEditingInstrument(false)
  }

  async function createBandSetlist() {
    if (!activeBand || !user) return
    const { data } = await supabase.from('setlists').insert({ name: 'Nova Setlist', owner_id: user.id, band_id: activeBand.id, is_shared: true }).select().single()
    if (data) navigate(`/setlist/${data.id}`)
  }

  async function saveRename() {
    if (!activeBand || !renameInput.trim()) return
    await supabase.from('bands').update({ name: renameInput.trim() }).eq('id', activeBand.id)
    setActiveBand({ ...activeBand, name: renameInput.trim() })
    setShowSettings(false)
    loadBands()
  }

  async function leaveOrDelete() {
    if (!activeBand || !user) return
    const isOwner = activeBand.owner_id === user.id
    if (isOwner) {
      if (!confirm(`Eliminar o projeto "${activeBand.name}"? Todos os membros serão removidos.`)) return
      await supabase.from('bands').delete().eq('id', activeBand.id)
    } else {
      if (!confirm(`Sair do projeto "${activeBand.name}"?`)) return
      await supabase.from('band_members').delete().eq('band_id', activeBand.id).eq('user_id', user.id)
    }
    setActiveBand(null); setShowSettings(false); loadBands()
  }

  // ---------- BAND DETAIL ----------
  if (activeBand) {
    const isOwner = activeBand.owner_id === user?.id
    return (
      <Layout>
        <div className={styles.detailPage}>
          <div className={styles.detailHeader}>
            <button className={styles.back} onClick={() => { setActiveBand(null); setMembers([]); setSetlists([]); navigate('/bands') }}>← Projetos</button>
            <div className={styles.detailTitleRow}>
              <div>
                <h1 className={styles.bandName}>{activeBand.name}</h1>
                <p className={styles.bandMeta}>{members.length} membros · {setlists.length} setlist{setlists.length !== 1 ? 's' : ''}</p>
              </div>
              <button className={styles.settingsBtn} onClick={() => setShowSettings(true)}>⚙ Definições</button>
            </div>
          </div>

          <div className={styles.columns}>
            {/* MEMBROS */}
            <div className={styles.col}>
              <div className={styles.colTitle}>MEMBROS</div>
              <div className={styles.memberList}>
                {members.map(m => {
                  const name = m.profiles?.display_name ?? 'Utilizador'
                  const isSelf = m.user_id === user?.id
                  const subtitle = isSelf && !m.instrument ? 'tu' : (m.instrument || (isSelf ? 'tu' : '—'))
                  return (
                    <div key={m.user_id} className={styles.memberRow}>
                      <div className={styles.avatar} style={{ background: colorFor(m.user_id) }}>{initials(name)}</div>
                      <div className={styles.memberInfo}>
                        <div className={styles.memberName}>{name}</div>
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
                            onClick={() => { if (isSelf) { setInstrumentInput(m.instrument ?? ''); setEditingInstrument(true) } }}
                          >
                            {subtitle}{isSelf && <span className={styles.editPen}> ✎</span>}
                          </div>
                        )}
                      </div>
                      <span className={`${styles.roleBadge} ${m.role === 'owner' ? styles.owner : ''}`}>{m.role === 'owner' ? 'owner' : 'membro'}</span>
                    </div>
                  )
                })}
                <button className={styles.inviteRow} onClick={() => copyCode(activeBand.invite_code)}>
                  <div className={styles.invitePlus}>+</div>
                  <span>Convidar membro</span>
                </button>
              </div>

              <div className={styles.inviteBox}>
                <div className={styles.inviteLabel}>Código de convite</div>
                <div className={styles.inviteCode} onClick={() => copyCode(activeBand.invite_code)} title="Clica para copiar">
                  {activeBand.invite_code}
                </div>
                <div className={styles.inviteFooter}>
                  {copied ? <span className={styles.copiedMsg}>✓ Copiado!</span> : (
                    <>
                      Expira em {daysLeft(activeBand.invite_expires_at)} dias
                      {isOwner && <> · <button className={styles.renewBtn} onClick={renewCode}>renovar</button></>}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* SETLISTS DA BANDA */}
            <div className={styles.col}>
              <div className={styles.colTitle}>SETLISTS DA BANDA</div>
              <div className={styles.setlistGrid}>
                {setlists.map((s, i) => (
                  <div key={s.id} className={`${styles.setlistCard} ${styles[`sc${i % 3}`]}`} onClick={() => navigate(`/setlist/${s.id}`)}>
                    <div className={styles.setlistName}>{s.name}</div>
                    {s.date && (
                      <div className={styles.setlistDate}>
                        {new Date(s.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    )}
                    <div className={styles.setlistTags}>
                      <span className={styles.tag}>{s.setlist_songs?.[0]?.count ?? 0} músicas</span>
                      {s.is_shared && <span className={styles.tagShared}>partilhada</span>}
                    </div>
                  </div>
                ))}
                <button className={styles.newSetlistCard} onClick={createBandSetlist}>
                  <span className={styles.plusBig}>+</span>
                  <span>Nova setlist</span>
                </button>
              </div>
              {setlists.length === 0 && <p className={styles.hint}>Cria a primeira setlist deste projeto. Fica partilhada com todos os membros.</p>}
            </div>
          </div>
        </div>

        {showSettings && (
          <div className={styles.overlay} onClick={() => setShowSettings(false)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <span className={styles.modalTitle}>Definições do projeto</span>
                <button className={styles.closeBtn} onClick={() => setShowSettings(false)}>✕</button>
              </div>
              {isOwner ? (
                <>
                  <label className={styles.modalLabel}>Nome do projeto</label>
                  <div className={styles.modalRow}>
                    <input className={styles.modalInput} value={renameInput} onChange={e => setRenameInput(e.target.value)} />
                    <button className={styles.saveBtn} onClick={saveRename}>Guardar</button>
                  </div>
                </>
              ) : (
                <p className={styles.modalNote}>Só o dono do projeto pode alterar as definições.</p>
              )}
              <button className={styles.dangerBtn} onClick={leaveOrDelete}>
                {isOwner ? '🗑 Eliminar projeto' : '↩ Sair do projeto'}
              </button>
            </div>
          </div>
        )}
      </Layout>
    )
  }

  // ---------- BAND LIST ----------
  return (
    <Layout>
      <div className={styles.page}>
        <h1 className={styles.title}>Projetos</h1>

        <div className={styles.tabs}>
          <button className={tab === 'create' ? styles.tabActive : styles.tabBtn} onClick={() => setTab('create')}>Criar projeto</button>
          <button className={tab === 'join' ? styles.tabActive : styles.tabBtn} onClick={() => setTab('join')}>Entrar com código</button>
        </div>

        {tab === 'create' ? (
          <div className={styles.formBox}>
            <input className={styles.input} placeholder="Nome do projeto" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createBand()} />
            <button className={styles.createBtn} onClick={createBand} disabled={creating || !newName.trim()}>{creating ? 'A criar...' : 'Criar'}</button>
          </div>
        ) : (
          <div className={styles.formBox}>
            <input className={styles.input} placeholder="Código (ex: JZBR-4829)" value={joinCode} onChange={e => setJoinCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && joinBand()} />
            <button className={styles.createBtn} onClick={joinBand} disabled={joining || !joinCode.trim()}>{joining ? 'A entrar...' : 'Entrar'}</button>
          </div>
        )}

        <div className={styles.colTitle}>OS TEUS PROJETOS</div>
        {loading ? (
          <p className={styles.hint}>A carregar...</p>
        ) : bands.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎸</div>
            <p>Ainda não tens projetos.</p>
            <p className={styles.emptySub}>Cria um ou entra com um código.</p>
          </div>
        ) : (
          <div className={styles.bandList}>
            {bands.map(b => (
              <div key={b.id} className={styles.bandCard} onClick={() => openBand(b)}>
                <div className={styles.avatar} style={{ background: colorFor(b.id) }}>{initials(b.name)}</div>
                <div className={styles.memberInfo}>
                  <div className={styles.memberName}>{b.name}</div>
                  <div className={styles.memberSub}>{b.owner_id === user?.id ? 'Dono' : 'Membro'}</div>
                </div>
                <span className={styles.chevron}>›</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
