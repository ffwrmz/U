// ¿Hay internet? (NetInfo). Sin el módulo nativo (web) se usa navigator.onLine.
import NetInfo from '@react-native-community/netinfo'

let enLinea = true
const oyentes = new Set<(v: boolean) => void>()

const fijar = (v: boolean) => {
  if (v === enLinea) return
  enLinea = v
  oyentes.forEach((f) => f(v))
}

try {
  NetInfo.addEventListener((s) => fijar(!!s.isConnected && s.isInternetReachable !== false))
  NetInfo.fetch().then((s) => fijar(!!s.isConnected && s.isInternetReachable !== false)).catch(() => {})
} catch {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => fijar(true))
    window.addEventListener('offline', () => fijar(false))
  }
}

export const hayConexion = () => enLinea

// Un error de red real (sin señal) cuenta como "sin conexión" aunque NetInfo diga lo contrario
export const marcarSinConexion = () => fijar(false)
export const marcarConConexion = () => fijar(true)

// Vuelve a preguntarle al teléfono si hay internet (después de un error de red puntual)
export const revisarConexion = async () => {
  try { const s = await NetInfo.fetch(); fijar(!!s.isConnected && s.isInternetReachable !== false) } catch {}
  return enLinea
}

export const alCambiarConexion = (f: (v: boolean) => void) => {
  oyentes.add(f)
  return () => { oyentes.delete(f) }
}
