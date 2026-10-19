import { useEffect, useState } from 'react'
import { isLikelyOffline, subscribeNet } from '../lib/offline/net'

/**
 * true = há rede (o browser diz que sim e nenhum pedido falhou por falta
 * dela há pouco). Num Wi-Fi sem internet passa a false no 1.º pedido falhado.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => !isLikelyOffline())
  useEffect(() => {
    const update = () => setOnline(!isLikelyOffline())
    update()
    return subscribeNet(update)
  }, [])
  return online
}
