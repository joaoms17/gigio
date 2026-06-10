import { useEffect, useState } from 'react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { getThemePref, applyThemePref, type ThemePref } from '../../lib/theme'
import type { ConcertTheme } from '../../types'
import styles from './SettingsPage.module.css'

const BG_SWATCHES = ['#0d0d0d', '#0f172a', '#1a0a2e', '#0a1a0a', '#1a0808']
const ACTIVE_SWATCHES = ['#ffffff', '#FF4D6D', '#7C3AED', '#FBBF24', '#22D3EE', '#4ADE80']
const ACCENT_SWATCHES = ['#FF4D6D', '#7C3AED', '#22D3EE', '#FBBF24', '#4ADE80']

const DEFAULT_THEME: ConcertTheme = {
  bg: '#0d0d0d', active_color: '#ffffff', accent_color: '#FF4D6D', font_size: 26, line_height: 1.6
}

export default function SettingsPage() {
  const { user } = useAuth()
  const [theme, setTheme] = useState<ConcertTheme>(DEFAULT_THEME)
  const [appTheme, setAppTheme] = useState<ThemePref>(getThemePref())
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

        {/* Appearance */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>APARÊNCIA</div>
          <div className={styles.card}>
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.label}>Tema da app</div>
                <div className={styles.hint}>Claro, escuro ou seguir o sistema</div>
              </div>
              <div className={styles.themeToggle}>
                {([['light', '☀️ Claro'], ['dark', '🌙 Escuro'], ['system', '⚙ Sistema']] as [ThemePref, string][]).map(([v, label]) => (
                  <button
                    key={v}
                    className={`${styles.themeOption} ${appTheme === v ? styles.themeOptionActive : ''}`}
                    onClick={() => { setAppTheme(v); applyThemePref(v) }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
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
                <div className={styles.hint}>Tamanho da letra no concerto</div>
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

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.label}>Espaçamento</div>
                <div className={styles.hint}>Espaço entre linhas da letra</div>
              </div>
              <div className={styles.sliderRow}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>↕</span>
                <input
                  type="range" min={10} max={30} step={1} value={Math.round((theme.line_height ?? 1.6) * 10)}
                  onChange={e => pick('line_height', Number(e.target.value) / 10)}
                  className={styles.slider}
                />
                <span className={styles.sliderVal}>{(theme.line_height ?? 1.6).toFixed(1)}</span>
              </div>
            </div>
          </div>

          {/* Live preview */}
          <div className={styles.preview} style={{ background: theme.bg }}>
            {['Meu Deus, que saudade', 'De tudo que a gente foi', 'Let me play among the stars', 'Let me see what spring is like', 'On Jupiter and Mars'].map((line, i) => {
              const isActive = i === 2
              return (
                <div key={i} style={{
                  color: theme.active_color,
                  fontSize: isActive ? theme.font_size : theme.font_size * 0.72,
                  lineHeight: theme.line_height ?? 1.6,
                  opacity: isActive ? 1 : i < 2 ? 0.25 : 0.4,
                  fontWeight: isActive ? 800 : 500,
                  borderLeft: isActive ? `3px solid ${theme.accent_color}` : '3px solid transparent',
                  paddingLeft: 10,
                  transition: 'all 0.15s',
                }}>
                  {line}
                </div>
              )
            })}
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
