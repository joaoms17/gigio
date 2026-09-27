/* Ícones SVG inline do assistente "Novo concerto" (traço, currentColor) — sem emojis. */
import type { ReactNode } from 'react'

function Svg({ size = 20, strokeWidth = 2, children }: { size?: number; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

type P = { size?: number }

export const IconBack = ({ size = 18 }: P) => <Svg size={size}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
export const IconChevronRight = ({ size = 18 }: P) => <Svg size={size}><path d="M9 6l6 6-6 6" /></Svg>
export const IconChevronDown = ({ size = 18 }: P) => <Svg size={size}><path d="M6 9l6 6 6-6" /></Svg>
export const IconUp = ({ size = 20 }: P) => <Svg size={size}><path d="M6 14l6-6 6 6" /></Svg>
export const IconDown = ({ size = 20 }: P) => <Svg size={size}><path d="M6 10l6 6 6-6" /></Svg>
export const IconClose = ({ size = 18 }: P) => <Svg size={size}><path d="M6 6l12 12M18 6L6 18" /></Svg>
export const IconSearch = ({ size = 18 }: P) => <Svg size={size}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>
export const IconCheck = ({ size = 16 }: P) => <Svg size={size} strokeWidth={2.5}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
export const IconAlert = ({ size = 18 }: P) => <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></Svg>

/** Importar: folha com seta a entrar */
export const IconImport = ({ size = 22 }: P) => (
  <Svg size={size} strokeWidth={1.75}>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5M12 11v6M9 14l3 3 3-3" />
  </Svg>
)

/** Copiar concerto: duas folhas */
export const IconCopy = ({ size = 22 }: P) => (
  <Svg size={size} strokeWidth={1.75}>
    <rect x="8" y="8" width="12" height="13" rx="1.5" />
    <path d="M16 8V4.5A1.5 1.5 0 0 0 14.5 3h-9A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17H8" />
    <path d="M11 12.5h6M11 16h4" />
  </Svg>
)

/** Repertório: notas */
export const IconLibrary = ({ size = 22 }: P) => (
  <Svg size={size} strokeWidth={1.75}>
    <circle cx="7" cy="18" r="3" />
    <path d="M10 18V5l9-2v12" />
    <circle cx="16" cy="15" r="3" />
  </Svg>
)

/** Começar vazio: folha em branco com + */
export const IconBlank = ({ size = 20 }: P) => (
  <Svg size={size} strokeWidth={1.75}>
    <rect x="5" y="3" width="14" height="18" rx="1.5" />
    <path d="M12 9v6M9 12h6" />
  </Svg>
)
