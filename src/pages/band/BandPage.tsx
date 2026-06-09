import { useEffect, useState } from 'react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './BandPage.module.css'

interface Band {
  id: string
  name: string
  owner_id: string
  invite_code: string
  created_at: string
}

interface Member {
  user_id: string
  role: string
  profiles: { display_name: string | null }
}

export default function BandPage() {
  const { user } = useAuth()
  const [bands, setBands] = useState<Band[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [activeBand, setActiveBand] = useState<Band | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'create' | 'join'>('create')

  useEffect(() => {
    if (!user) return
    loadBands()
  }, [user])

  async function loadBands() {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('band_members')
      .select('band_id, bands(*)')
      .eq('user_id', user.id)
    const list = (data ?? []).map((r: any) => r.bands).filter(Boolean)
    setBands(list)
    setLoading(false)
  }

  async function openBand(band: Band) {
    setActiveBand(band)
    const { data } = await supabase
      .from('band_members')
      .select('user_id, role, profiles(display_name)')
      .eq('band_id', band.id)
    setMembers((data ?? []) as unknown as Member[])
  }

  async function createBand() {
    if (!user || !newName.trim()) return
    setCreating(true)
    const { data, error } = await supabase
      .from('bands')
      .insert({ name: newName.trim(), owner_id: user.id })
      .select()
      .single()
    setCreating(false)
    if (error) { alert('Erro ao criar banda: ' + error.message); return }
    setNewName('')
    await loadBands()
    if (data) openBand(data)
  }

  async function joinBand() {
    if (!user || !joinCode.trim()) return
    setJoining(true)
    const { data: band, error: bandErr } = await supabase
      .from('bands')
      .select('*')
      .eq('invite_code', joinCode.trim().toLowerCase())
      .single()
    if (bandErr || !band) {
      alert('Código inválido ou banda não encontrada.')
      setJoining(false)
      return
    }
    const { error: memberErr } = await supabase
      .from('band_members')
      .insert({ band_id: band.id, user_id: user.id, role: 'member' })
    setJoining(false)
    if (memberErr && !memberErr.message.includes('duplicate')) {
      alert('Erro ao entrar: ' + memberErr.message)
      return
    }
    setJoinCode('')
    await loadBands()
    openBand(band)
  }

  async function leaveOrDelete(band: Band) {
    if (!user) return
    if (band.owner_id === user.id) {
      if (!confirm(`Eliminar a banda "${band.name}"? Todos os membros serão removidos.`)) return
      await supabase.from('bands').delete().eq('id', band.id)
    } else {
      if (!confirm(`Sair da banda "${band.name}"?`)) return
      await supabase.from('band_members').delete().eq('band_id', band.id).eq('user_id', user.id)
    }
    setActiveBand(null)
    await loadBands()
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (activeBand) {
    const isOwner = activeBand.owner_id === user?.id
    return (
      <Layout>
        <div className={styles.page}>
          <button className={styles.back} onClick={() => { setActiveBand(null); setMembers([]) }}>← Bandas</button>
          <div className={styles.bandHeader}>
            <div className={styles.bandAvatar}>{activeBand.name[0].toUpperCase()}</div>
            <div>
              <h1 className={styles.bandName}>{activeBand.name}</h1>
              <p className={styles.bandRole}>{isOwner ? 'Dono' : 'Membro'}</p>
            </div>
          </div>

          {isOwner && (
            <div className={styles.inviteBox}>
              <div className={styles.inviteLabel}>Código de convite</div>
              <div className={styles.inviteRow}>
                <code className={styles.inviteCode}>{activeBand.invite_code}</code>
                <button className={styles.copyBtn} onClick={() => copyCode(activeBand.invite_code)}>
                  {copied ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
              <p className={styles.inviteHint}>Partilha este código com os membros da tua banda.</p>
            </div>
          )}

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Membros ({members.length})</h2>
            <div className={styles.memberList}>
              {members.map(m => (
                <div key={m.user_id} className={styles.memberRow}>
                  <div className={styles.memberAvatar}>{(m.profiles?.display_name ?? '?')[0].toUpperCase()}</div>
                  <div>
                    <div className={styles.memberName}>{m.profiles?.display_name ?? 'Utilizador'}</div>
                    <div className={styles.memberRole}>{m.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button className={styles.dangerBtn} onClick={() => leaveOrDelete(activeBand)}>
            {isOwner ? '🗑 Eliminar banda' : '↩ Sair da banda'}
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Bandas</h1>
        </div>

        <div className={styles.tabs}>
          <button className={tab === 'create' ? styles.tabActive : styles.tabBtn} onClick={() => setTab('create')}>Criar banda</button>
          <button className={tab === 'join' ? styles.tabActive : styles.tabBtn} onClick={() => setTab('join')}>Entrar com código</button>
        </div>

        {tab === 'create' ? (
          <div className={styles.formBox}>
            <input
              className={styles.input}
              placeholder="Nome da banda"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createBand()}
            />
            <button className={styles.createBtn} onClick={createBand} disabled={creating || !newName.trim()}>
              {creating ? 'A criar...' : 'Criar'}
            </button>
          </div>
        ) : (
          <div className={styles.formBox}>
            <input
              className={styles.input}
              placeholder="Código de convite"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinBand()}
            />
            <button className={styles.createBtn} onClick={joinBand} disabled={joining || !joinCode.trim()}>
              {joining ? 'A entrar...' : 'Entrar'}
            </button>
          </div>
        )}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>As tuas bandas</h2>
          {loading ? (
            <p className={styles.empty}>A carregar...</p>
          ) : bands.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🎸</div>
              <p>Ainda não tens bandas.</p>
              <p className={styles.emptySub}>Cria uma ou entra com um código.</p>
            </div>
          ) : (
            <div className={styles.bandList}>
              {bands.map(b => (
                <div key={b.id} className={styles.bandCard} onClick={() => openBand(b)}>
                  <div className={styles.bandCardAvatar}>{b.name[0].toUpperCase()}</div>
                  <div>
                    <div className={styles.bandCardName}>{b.name}</div>
                    <div className={styles.bandCardRole}>{b.owner_id === user?.id ? 'Dono' : 'Membro'}</div>
                  </div>
                  <span className={styles.chevron}>›</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
