import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useConfirm } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { getThemePref, applyThemePref, type ThemePref } from '../../lib/theme'
import type { ConcertTheme } from '../../types'
import styles from './SettingsPage.module.css'
import { DEFAULT_CONCERT_THEME, normalizeConcertTheme } from '../../lib/concertTheme'

/* Paletas do modo palco (v2): pretos de palco + tintas de sinal */
const BG_SWATCHES = ['#0B0B0C', '#000000', '#17171A', '#0E1520', '#1A110B']
const ACTIVE_SWATCHES = ['#F2F1EC', '#FF6A26', '#FFC24B', '#3DDC97', '#4CC9F0']
const ACCENT_SWATCHES = ['#FF6A26', '#FFC24B', '#3DDC97', '#4CC9F0', '#F2F1EC']

const SWATCH_NAMES: Record<string, string> = {
  '#0b0b0c': 'Preto de palco',
  '#000000': 'Preto puro',
  '#17171a': 'Grafite',
  '#0e1520': 'Azul noite',
  '#1a110b': 'Castanho escuro',
  '#f2f1ec': 'Branco',
  '#ff6a26': 'Laranja',
  '#ffc24b': 'Âmbar',
  '#3ddc97': 'Verde',
  '#4cc9f0': 'Ciano',
}

const DEFAULT_THEME: ConcertTheme = DEFAULT_CONCERT_THEME

function sameColor(a: string | undefined, b: string) {
  return (a ?? '').trim().toLowerCase() === b.toLowerCase()
}

function swatchName(c: string) {
  return SWATCH_NAMES[c.toLowerCase()] ?? c
}

/** Hex → rgba (sem color-mix: iPadOS antigo) */
function withAlpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m) return hex
  let h = m[1]
  if (h.length === 3) h = h.split('').map(ch => ch + ch).join('')
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** Iniciais — mesmo critério do Layout (avatar neutro, mono) */
function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

/* ── Ícones v2: traço 1.8, cantos secos, currentColor ── */

const ICON = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
}

function IconSun() {
  return (
    <svg {...ICON} width="16" height="16">
      <rect x="8" y="8" width="8" height="8" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg {...ICON} width="16" height="16">
      <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7Z" />
    </svg>
  )
}

function IconMonitor() {
  return (
    <svg {...ICON} width="16" height="16">
      <rect x="2.5" y="4" width="19" height="13" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function IconCheck({ size = 16 }: { size?: number }) {
  return (
    <svg {...ICON} width={size} height={size} strokeWidth={2.4}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconBook() {
  return (
    <svg {...ICON} width="18" height="18">
      <path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4Z" />
      <path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6Z" />
    </svg>
  )
}

function IconExternal() {
  return (
    <svg {...ICON} width="14" height="14">
      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg {...ICON} width="18" height="18">
      <path d="M9 21H4V3h5M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}

/* Espaçamento: três linhas juntas (menos) → três linhas afastadas (mais),
   o par gráfico do "A → A" do tamanho */
function IconLinesTight() {
  return (
    <svg {...ICON} width="16" height="16">
      <path d="M5 9h14M5 12h14M5 15h14" />
    </svg>
  )
}

function IconLinesLoose() {
  return (
    <svg {...ICON} width="20" height="20">
      <path d="M4 5h16M4 12h16M4 19h16" />
    </svg>
  )
}

/* Alinhamento da letra: linhas encostadas à esquerda / centradas */
function IconAlignLeft() {
  return (
    <svg {...ICON} width="16" height="16">
      <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />
    </svg>
  )
}

function IconAlignCenter() {
  return (
    <svg {...ICON} width="16" height="16">
      <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />
    </svg>
  )
}

type LyricAlign = NonNullable<ConcertTheme['align']>

const ALIGN_OPTIONS: [LyricAlign, string, ReactNode][] = [
  ['left', 'Esquerda', <IconAlignLeft key="i" />],
  ['center', 'Centro', <IconAlignCenter key="i" />],
]

/* ── Mini-ecrã de palco: espelha o modo concerto (ConcertPage) ── */

function StagePreview({ theme }: { theme: ConcertTheme }) {
  const ink = theme.active_color
  const accent = theme.accent_color
  const alignClass = theme.align === 'center' ? styles.stageCenter : styles.stageLeft
  const vars = {
    background: theme.bg,
    color: ink,
    '--pv-size': `${theme.font_size}px`,
    '--pv-lh': String(theme.line_height ?? 1.6),
  } as CSSProperties

  return (
    <div className={styles.stage} style={vars} role="img" aria-label="Pré-visualização do ecrã de palco">
      <div className={styles.stageBar} style={{ borderColor: withAlpha(ink, 0.14) }} aria-hidden="true">
        <span className={styles.stageCounter}>
          <span style={{ color: accent }}>07</span>
          <span style={{ color: withAlpha(ink, 0.56) }}> / 22</span>
        </span>
        <span className={styles.stageLive} style={{ color: withAlpha(ink, 0.72) }}>
          <span className={styles.stageLed} style={{ background: accent }} />
          Ao vivo
        </span>
      </div>

      <div className={`${styles.stageLyrics} ${alignClass}`} aria-hidden="true">
        <div className={`${styles.stageLine} ${styles.stagePast}`}>Acordo cedo com o rio a passar</div>
        <div className={styles.stageSection} style={{ color: accent }}>Refrão</div>
        <div
          className={`${styles.stageLine} ${styles.stageActive}`}
          style={{ background: withAlpha(accent, 0.14), boxShadow: `inset 3px 0 0 ${accent}` }}
        >
          Leva-me contigo, leva-me daqui
        </div>
        <div className={styles.stageLine}>Leva-me contigo até ao fim da linha</div>
      </div>
    </div>
  )
}

/* ── Linha de swatches: 32px visível, 44px de alvo ── */

function SwatchRow({ colors, value, label, onPick, outlined }: {
  colors: string[]
  value: string
  label: string
  onPick: (c: string) => void
  /** Pretos de palco: contorno mais forte para se distinguirem no tema escuro */
  outlined?: boolean
}) {
  return (
    <div className={`${styles.swatches} ${outlined ? styles.swatchesOutlined : ''}`} role="group" aria-label={label}>
      {colors.map(c => {
        const sel = sameColor(value, c)
        return (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className={`${styles.swatch} ${sel ? styles.swatchSel : ''}`}
            aria-label={`${label}: ${swatchName(c)}`}
            aria-pressed={sel}
            title={swatchName(c)}
          >
            <span className={styles.swatchChip} style={{ background: c }} />
          </button>
        )
      })}
    </div>
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
        if (data?.concert_theme) setTheme(normalizeConcertTheme(data.concert_theme as Partial<ConcertTheme>))
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
      title: 'Terminar sessão',
      message: 'Terminar a sessão neste dispositivo? Vais precisar de ligação à internet para voltar a entrar.',
      confirmLabel: 'Terminar sessão',
      danger: true,
    })) return
    await supabase.auth.signOut()
    window.location.href = '/auth'
  }

  const avatarText = initials(displayName || user?.email?.split('@')[0] || '')

  const themeOptions: [ThemePref, string, ReactNode][] = [
    ['light', 'Claro', <IconSun key="i" />],
    ['dark', 'Escuro', <IconMoon key="i" />],
    ['system', 'Sistema', <IconMonitor key="i" />],
  ]

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>Definições</h1>
        <p className={styles.meta}>Conta · Aparência · Palco</p>
      </header>

      <div className={styles.grid}>
        {/* ── Perfil ── */}
        <section className={`${styles.section} ${styles.areaProfile}`} aria-labelledby="set-profile">
          <div className={styles.sectionHead}>
            <h2 id="set-profile" className={styles.sectionLabel}>Perfil</h2>
          </div>
          <div className={styles.panel}>
            <div className={styles.profile}>
              <div className={styles.avatar} aria-hidden="true">{avatarText}</div>
              <div className={styles.profileMain}>
                <label className={styles.fieldLabel} htmlFor="settings-display-name">Nome</label>
                <div className={styles.fieldRow}>
                  <input
                    id="settings-display-name"
                    className={styles.input}
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveName()}
                    placeholder="O teu nome"
                    autoComplete="name"
                  />
                  <button
                    type="button"
                    className={`${styles.btnSecondary} ${styles.saveBtn}`}
                    data-state={nameSaved ? 'saved' : undefined}
                    onClick={saveName}
                    disabled={savingName || !displayName.trim()}
                  >
                    {savingName
                      ? 'A guardar…'
                      : nameSaved
                        ? <><IconCheck size={15} /> Guardado</>
                        : 'Guardar'}
                  </button>
                </div>
                <div className={styles.email} title={user?.email ?? undefined}>{user?.email}</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Aparência ── */}
        <section className={`${styles.section} ${styles.areaLook}`} aria-labelledby="set-look">
          <div className={styles.sectionHead}>
            <h2 id="set-look" className={styles.sectionLabel}>Aparência</h2>
          </div>
          <div className={styles.panel}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Tema da app</div>
                <div className={styles.rowHint}>Claro, escuro ou seguir o sistema</div>
              </div>
              <div className={styles.segmented} role="group" aria-label="Tema da app">
                {themeOptions.map(([v, label, icon]) => (
                  <button
                    key={v}
                    type="button"
                    className={`${styles.segOption} ${appTheme === v ? styles.segOptionActive : ''}`}
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

        {/* ── Tema de concerto ── */}
        <section className={`${styles.section} ${styles.areaStage}`} aria-labelledby="set-stage">
          <div className={styles.sectionHead}>
            <h2 id="set-stage" className={styles.sectionLabel}>Tema de concerto</h2>
            <div className={styles.saveState} role="status" data-state={themeSaveState}>
              {themeSaveState === 'saving'
                ? 'A guardar…'
                : themeSaveState === 'saved'
                  ? <><IconCheck size={13} /> Guardado</>
                  : 'Gravação automática'}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.stageWrap}>
              <StagePreview theme={theme} />
            </div>

            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Fundo</div>
                <div className={styles.rowHint}>Cor do ecrã durante o concerto</div>
              </div>
              <SwatchRow colors={BG_SWATCHES} value={theme.bg} label="Cor de fundo" onPick={c => pick('bg', c)} outlined />
            </div>

            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Letra</div>
                <div className={styles.rowHint}>Cor do texto da letra e da linha ativa</div>
              </div>
              <SwatchRow colors={ACTIVE_SWATCHES} value={theme.active_color} label="Cor da letra" onPick={c => pick('active_color', c)} />
            </div>

            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Acento</div>
                <div className={styles.rowHint}>Linha ativa, secções e contador</div>
              </div>
              <SwatchRow colors={ACCENT_SWATCHES} value={theme.accent_color} label="Cor de acento" onPick={c => pick('accent_color', c)} />
            </div>

            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Tamanho do texto</div>
                <div className={styles.rowHint}>Tamanho da letra no palco</div>
              </div>
              <div className={styles.sliderRow}>
                <span className={styles.glyphSm} aria-hidden="true">A</span>
                <input
                  type="range" min={16} max={48} value={theme.font_size}
                  onChange={e => pick('font_size', Number(e.target.value))}
                  className={styles.slider}
                  aria-label="Tamanho do texto"
                  aria-valuetext={`${theme.font_size} píxeis`}
                />
                <span className={styles.glyphLg} aria-hidden="true">A</span>
                <span className={styles.sliderVal}>{theme.font_size}px</span>
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Espaçamento</div>
                <div className={styles.rowHint}>Espaço entre linhas da letra</div>
              </div>
              <div className={styles.sliderRow}>
                <span className={styles.sliderIcon} aria-hidden="true"><IconLinesTight /></span>
                <input
                  type="range" min={10} max={30} step={1} value={Math.round((theme.line_height ?? 1.6) * 10)}
                  onChange={e => pick('line_height', Number(e.target.value) / 10)}
                  className={styles.slider}
                  aria-label="Espaçamento entre linhas"
                />
                <span className={styles.sliderIcon} aria-hidden="true"><IconLinesLoose /></span>
                <span className={styles.sliderVal}>{(theme.line_height ?? 1.6).toFixed(1)}</span>
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Alinhamento da letra</div>
                <div className={styles.rowHint}>À esquerda, a letra aparece como foi escrita</div>
              </div>
              <div className={styles.segmented} role="group" aria-label="Alinhamento da letra">
                {ALIGN_OPTIONS.map(([v, label, icon]) => {
                  const on = (theme.align ?? 'left') === v
                  return (
                    <button
                      key={v}
                      type="button"
                      className={`${styles.segOption} ${on ? styles.segOptionActive : ''}`}
                      aria-pressed={on}
                      onClick={() => { if (!on) pick('align', v) }}
                    >
                      {icon}
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── Ajuda ── */}
        <section className={`${styles.section} ${styles.areaHelp}`} aria-labelledby="set-help">
          <div className={styles.sectionHead}>
            <h2 id="set-help" className={styles.sectionLabel}>Ajuda</h2>
          </div>
          <div className={styles.panel}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Guia da aplicação</div>
                <div className={styles.rowHint}>Tutorial em PDF — projetos, repertório, concertos e modo palco</div>
              </div>
              <a
                href="/guia.html"
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.btnSecondary} ${styles.rowAction}`}
              >
                <IconBook />
                Abrir guia
                <span className={styles.extIcon}><IconExternal /></span>
              </a>
            </div>
          </div>
        </section>

        {/* ── Sessão (destrutivo, no fim) ── */}
        <section className={`${styles.section} ${styles.areaSession}`} aria-labelledby="set-session">
          <div className={styles.sectionHead}>
            <h2 id="set-session" className={styles.sectionLabel}>Sessão</h2>
          </div>
          <div className={styles.panel}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Sair deste dispositivo</div>
                <div className={styles.rowHint}>Para voltar a entrar precisas de internet</div>
              </div>
              <button type="button" className={`${styles.btnDanger} ${styles.rowAction}`} onClick={signOut}>
                <IconLogout />
                Terminar sessão
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
