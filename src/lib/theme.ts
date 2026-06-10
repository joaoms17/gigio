export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'gigio-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'dark' || v === 'light' ? v : 'system'
}

function resolved(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref
}

export function applyThemePref(pref: ThemePref) {
  localStorage.setItem(KEY, pref)
  document.documentElement.dataset.theme = resolved(pref)
}

export function initTheme() {
  document.documentElement.dataset.theme = resolved(getThemePref())
  media.addEventListener('change', () => {
    if (getThemePref() === 'system') {
      document.documentElement.dataset.theme = resolved('system')
    }
  })
}
