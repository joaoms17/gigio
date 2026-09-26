import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
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

/* Cor do utilizador — mesma paleta/hashing do Layout para consistência */
const PALETTE = ['#7C3AED', '#FF4D6D', '#2563EB', '#059669', '#D97706', '#DB2777', '#0891B2', '#9333EA']
function colorFor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/* ── Ícones SVG inline ── */

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  )
}

function IconMonitor() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function IconCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconBook() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

function IconLineHeight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v18M8.5 6.5 12 3l3.5 3.5M8.5 17.5 12 21l3.5-3.5" />
    </svg>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const confirmDialog = useConfirm()
  const toast = useToast()
  const [theme, setTheme] = useState<ConcertTheme>(DEFAULT_THEME)
  const [appTheme, setAppTheme] = useState<ThemePref>(getThemePref())
  const [themeSaveState, setThemeSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const themeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTheme = useRef<ConcertTheme | null>(null)
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

  /** Grava imediatamente ao escolher (debounce curto para os sliders) */
  function pick(key: keyof ConcertTheme, value: string | number) {
    const next = { ...theme, [key]: value }
    setTheme(next)
    setThemeSaveState('saving')
    pendingTheme.current = next
    if (themeSaveTimer.current) clearTimeout(themeSaveTimer.current)
    themeSaveTimer.current = setTimeout(() => persistTheme(next), 500)
  }

  async function persistTheme(next: ConcertTheme) {
    if (!user) return
    pendingTheme.current = null
    const { error } = await supabase.from('profiles').update({ concert_theme: next }).eq('id', user.id)
    if (error) {
      setThemeSaveState('idle')
      toast('Erro ao guardar as preferências: ' + error.message, { type: 'error' })
      return
    }
    setThemeSaveState('saved')
    setTimeout(() => setThemeSaveState(s => (s === 'saved' ? 'idle' : s)), 2000)
  }

  // Se a página desmontar antes do debounce disparar, grava o que ficou pendente
  useEffect(() => {
    return () => {
      if (themeSaveTimer.current) clearTimeout(themeSaveTimer.current)
      if (pendingTheme.current && user) {
        supabase.from('profiles').update({ concert_theme: pendingTheme.current }).eq('id', user.id)
          .then(() => { pendingTheme.current = null })
      }
    }
  }, [user])

  async function saveName() {
    if (!user || !displayName.trim()) return
    setSavingName(true)
    const { error } = await supabase.from('profiles').update({ display_name: displayName.trim() }).eq('id', user.id)
    setSavingName(false)
    if (error) { toast('Erro ao guardar o nome: ' + error.message, { type: 'error' }); return }
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  async function signOut() {
    if (!await confirmDialog({
      title: 'Sair da conta',
      message: 'Terminar a sessão neste dispositivo? Vais precisar de ligação à internet para voltar a entrar.',
      confirmLabel: 'Sair',
      danger: true,
    })) return
    await supabase.auth.signOut()
    window.location.href = '/auth'
  }

  const userColor = colorFor(user?.id ?? '')

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Definições</h1>

      {/* Perfil */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Perfil</div>
        <div className={styles.card}>
          <div className={styles.profileRow}>
            <div className={styles.avatar} style={{ background: userColor }} aria-hidden="true">
              {displayName ? displayName[0].toUpperCase() : user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className={styles.profileInfo}>
              <label className={styles.fieldLabel} htmlFor="settings-display-name">Nome de utilizador</label>
              <div className={styles.fieldInputRow}>
                <input
                  id="settings-display-name"
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
                  {savingName ? '…' : nameSaved ? <IconCheck /> : 'Guardar'}
                </button>
              </div>
              <div className={styles.accountEmail}>{user?.email}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Aparência */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Aparência</div>
        <div className={styles.card}>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.label}>Tema da app</div>
              <div className={styles.hint}>Claro, escuro ou seguir o sistema</div>
            </div>
            <div className={styles.themeToggle} role="group" aria-label="Tema da app">
              {([['light', 'Claro', <IconSun key="i" />], ['dark', 'Escuro', <IconMoon key="i" />], ['system', 'Sistema', <IconMonitor key="i" />]] as [ThemePref, string, React.ReactNode][]).map(([v, label, icon]) => (
                <button
                  key={v}
                  className={`${styles.themeOption} ${appTheme === v ? styles.themeOptionActive : ''}`}
                  aria-pressed={appTheme === v}
                  onClick={() => { setAppTheme(v); applyThemePref(v) }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Modo concerto */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Modo concerto</div>
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
                  aria-label={`Cor de fundo ${c}`}
                  aria-pressed={theme.bg === c}
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
                  style={{ background: c }}
                  aria-label={`Cor da linha ativa ${c}`}
                  aria-pressed={theme.active_color === c}
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
                  aria-label={`Cor de acento ${c}`}
                  aria-pressed={theme.accent_color === c}
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
              <span className={styles.sliderGlyphSm} aria-hidden="true">A</span>
              <input
                type="range" min={16} max={48} value={theme.font_size}
                onChange={e => pick('font_size', Number(e.target.value))}
                className={styles.slider}
                aria-label="Tamanho do texto"
              />
              <span className={styles.sliderGlyphLg} aria-hidden="true">A</span>
              <span className={styles.sliderVal}>{theme.font_size}px</span>
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.label}>Espaçamento</div>
              <div className={styles.hint}>Espaço entre linhas da letra</div>
            </div>
            <div className={styles.sliderRow}>
              <span className={styles.sliderIcon}><IconLineHeight /></span>
              <input
                type="range" min={10} max={30} step={1} value={Math.round((theme.line_height ?? 1.6) * 10)}
                onChange={e => pick('line_height', Number(e.target.value) / 10)}
                className={styles.slider}
                aria-label="Espaçamento entre linhas"
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

        <div className={styles.autoSaveHint} role="status" data-state={themeSaveState}>
          {themeSaveState === 'saving'
            ? 'A guardar…'
            : themeSaveState === 'saved'
              ? <><IconCheck size={13} /> Preferências guardadas</>
              : 'As alterações são guardadas automaticamente'}
        </div>
      </section>

      {/* Ajuda */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Ajuda</div>
        <div className={styles.card}>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.label}>Guia da aplicação</div>
              <div className={styles.hint}>Tutorial completo em PDF — projetos, biblioteca, concertos, modo concerto</div>
            </div>
            <a
              href="/guia.html"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.guideBtn}
            >
              <IconBook />
              Abrir guia
            </a>
          </div>
        </div>
      </section>

      {/* Sessão */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Sessão</div>
        <button className={styles.signOutBtn} onClick={signOut}>
          <IconLogout />
          Sair da conta
        </button>
      </section>
    </div>
  )
}
