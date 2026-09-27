/* Ícones SVG inline (traço 2, cantos redondos) — sem emojis. */
import type { ReactNode } from 'react'

function Svg({ size = 20, strokeWidth = 2, className, children }: {
  size?: number; strokeWidth?: number; className?: string; children: ReactNode
}) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

type P = { size?: number; className?: string }

export const IconClose = ({ size = 20 }: P) => <Svg size={size}><path d="M6 6l12 12M18 6L6 18" /></Svg>
export const IconPdf = ({ size = 22 }: P) => (
  <Svg size={size} strokeWidth={1.75}>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5M8.5 13h7M8.5 17h4.5" />
  </Svg>
)
export const IconCamera = ({ size = 22 }: P) => (
  <Svg size={size} strokeWidth={1.75}>
    <path d="M4 8a1 1 0 0 1 1-1h2.5l1.5-2h6l1.5 2H19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
)
export const IconImage = ({ size = 20 }: P) => (
  <Svg size={size} strokeWidth={1.75}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <circle cx="9" cy="9.5" r="1.5" />
    <path d="M20 15.5l-4.5-4.5L6 20" />
  </Svg>
)
export const IconText = ({ size = 22 }: P) => (
  <Svg size={size} strokeWidth={1.75}><path d="M5 6h14M5 10h14M5 14h9M5 18h6" /></Svg>
)
export const IconUp = ({ size = 20 }: P) => <Svg size={size}><path d="M6 14l6-6 6 6" /></Svg>
export const IconDown = ({ size = 20 }: P) => <Svg size={size}><path d="M6 10l6 6 6-6" /></Svg>
export const IconTrash = ({ size = 20 }: P) => (
  <Svg size={size}><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></Svg>
)
export const IconCheck = ({ size = 18 }: P) => <Svg size={size} strokeWidth={2.5}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
export const IconPlus = ({ size = 18 }: P) => <Svg size={size}><path d="M12 5v14M5 12h14" /></Svg>
export const IconSearch = ({ size = 18 }: P) => <Svg size={size}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>
export const IconSwap = ({ size = 18 }: P) => <Svg size={size}><path d="M7 7h11l-3-3M17 17H6l3 3" /></Svg>
export const IconRetry = ({ size = 18 }: P) => <Svg size={size}><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5" /></Svg>
export const IconAlert = ({ size = 18 }: P) => <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></Svg>
export const IconChevronRight = ({ size = 18, className }: P) => <Svg size={size} className={className}><path d="M9 6l6 6-6 6" /></Svg>
export const IconArrowLeft = ({ size = 18 }: P) => <Svg size={size}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
export const IconEmpty = ({ size = 18 }: P) => <Svg size={size}><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 8h6" /></Svg>
export const IconPaste = ({ size = 18 }: P) => (
  <Svg size={size} strokeWidth={1.9}>
    <rect x="6" y="4" width="12" height="17" rx="1.5" />
    <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
  </Svg>
)
