/* navigator.onLine com os eventos 'online'/'offline' (true quando não se sabe). */
import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

const read = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, read, () => true)
}
