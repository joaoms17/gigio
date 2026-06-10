import { useEffect, useState } from 'react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { ConcertTheme } from '../../types'
import styles from './SettingsPage.module.css'

const BG_SWATCHES = ['#0d0d0d', '#0f172a', '#1a0a2e', '#0a1a0a', '#1a0808']
const ACTIVE_SWATCHES = ['#ffffff', '#FF4D6D', '#7C3AED', '#FBBF24', '#22D3EE', '#4ADE80']
const ACCENT_SWATCHES = ['#FF4D6D', '#7C3AED', '#22D3EE', '#FBBF24', '#4ADE80']

const DEFAULT_THEME: ConcertTheme = {
  bg: '#0d0d0d', active_color: '#ffffff', accent_color: '#FF4D6D', font_size: 26
}

export default function SettingsPage() {
  const { user } = useAuth()
  const [theme, setTheme] = useState<ConcertTheme>(DEFAULT_THEME)
  const [themeSaved, setThemeSaved] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [savingName, setSavingName] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('concert_theme, display_name').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.concert_theme) setTheme(data.concert_theme as ConcertTheme)
        if (data?.display_name) setDisplayName(data.display_name)
      })
  }, [user])

  function pick(key: keyof ConcertTheme, value: string | number) {
    setTheme(prev => ({ ...prev, [key]: value }))
    setThemeSaved(false)
  }

  async function saveTheme() {
    if (!user) return
    await supabase.from('profiles').update({ concert_theme: theme }).eq('id', user.id)
    setThemeSaved(true)
    setTimeout(() => setThemeSaved(false), 2000)
  }

  async function saveName() {
    if (!user || !displayName.trim()) return
    setSavingName(true)
    await supabase.from('profiles').update({ display_name: displayName.trim() }).eq('id', user.id)
    setSavingName(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/auth'
  }

  return (
    <Layout>
      <div className={styles.page}>
        <h1 className={styles.title}>Definições</h1>

        {/* Account */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>CONTA</div>
          <div className={styles.card}>
            <div className={styles.accountRow}>
              <div className={styles.accountAvatar}>
                {displayName ? displayName[0].toUpperCase() : user?.email?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className={styles.accountInfo}>
                <div className={styles.accountEmail}>{user?.email}</div>
              </div>
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Nome de utilizador</label>
              <div className={styles.fieldInputRow}>
                <input
                  className={styles.fieldInput}
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveName()}
                  placeholder="O teu nome"
                />
                <button
                  className={`${styles.saveSmall} ${nameSaved ? styles.saveSmallDone : ''}`}
                  onClick={saveName}
                  disabled={savingName || !displayName.trim()}
                >
                  {savingName ? '...' : nameSaved ? '✓' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
          <button className={styles.signOutBtn} onClick={signOut}>Sair da conta</button>
        </section>

        {/* Concert theme */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>MODO CONCERTO</div>
          <div className={styles.card}>
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.label}>Fundo</div>
                <div className={styles.hint}>Cor do ecrã durante o concerto</div>
              </div>
              <div className={styles.swatches}>
                {BG_SWATCHES.map(c => (
                  <button
                    key={c} onClick={() => pick('bg', c)}
                    className={`${styles.swatch} ${theme.bg === c ? styles.swatchSel : ''}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.label}>Linha ativa</div>
                <div className={styles.hint}>Cor do texto em destaque</div>
              </div>
              <div className={styles.swatches}>
                {ACTIVE_SWATCHES.map(c => (
                  <button
                    key={c} onClick={() => pick('active_color', c)}
                    className={`${styles.swatch} ${theme.active_color === c ? styles.swatchSel : ''}`}
                    style={{ background: c, border: c === '#ffffff' ? '1.5px solid var(--border)' : undefined }}
                  />
                ))}
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.label}>Cor de acento</div>
                <div className={styles.hint}>Barra de progresso e destaques</div>
              </div>
              <div className={styles.swatches}>
                {ACCENT_SWATCHES.map(c => (
                  <button
                    key={c} onClick={() => pick('accent_color', c)}
                    className={`${styles.swatch} ${theme.accent_color === c ? styles.swatchSel : ''}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.label}>Tamanho do texto</div>
                <div className={styles.hint}>Linha ativa no concerto</div>
              </div>
              <div className={styles.sliderRow}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>A</span>
                <input
                  type="range" min={16} max={48} value={theme.font_size}
                  onChange={e => pick('font_size', Number(e.target.value))}
                  className={styles.slider}
                />
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text3)' }}>A</span>
                <span className={styles.sliderVal}>{theme.font_size}px</span>
              </div>
            </div>
          </div>

          {/* Live preview */}
          <div className={styles.preview} style={{ background: theme.bg }}>
            <div className={styles.previewPast} style={{ color: theme.active_color, opacity: 0.3, fontSize: theme.font_size * 0.72 }}>
              Let me play among the stars
            </div>
            <div className={styles.previewActive} style={{ color: theme.active_color, fontSize: theme.font_size }}>
              Let me see what spring is like
            </div>
            <div className={styles.previewFuture} style={{ color: theme.active_color, opacity: 0.4, fontSize: theme.font_size * 0.72 }}>
              On Jupiter and Mars
            </div>
            <div className={styles.previewBar} style={{ background: theme.accent_color }} />
          </div>

          <button
            className={styles.saveBtn}
            style={{ background: themeSaved ? '#10b981' : undefined }}
            onClick={saveTheme}
          >
            {themeSaved ? '✓ Guardado' : 'Guardar preferências do concerto'}
          </button>
        </section>
      </div>
    </Layout>
  )
}
