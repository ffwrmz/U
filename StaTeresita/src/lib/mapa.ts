// Arma los puntos del mapa (UbicacionMapa) a partir de clientes o de las paradas de una ruta.
import type { UbicacionMapa } from '@/components/mapaClientes.types'
import { ClienteRuta, lineaDireccion, lineaZona } from '@/lib/rutas'
import * as Location from 'expo-location'
import { Linking, Platform } from 'react-native'

const tieneCoordenadas = (c: ClienteRuta | null | undefined): c is ClienteRuta & { dir: NonNullable<ClienteRuta['dir']> } =>
  !!c?.dir && c.dir.latitud != null && c.dir.longitud != null &&
  Number.isFinite(Number(c.dir.latitud)) && Number.isFinite(Number(c.dir.longitud))

const textoCompleto = (c: ClienteRuta) => [lineaDireccion(c), lineaZona(c)].filter(Boolean).join(', ')

// Un punto por casa; si varios clientes viven en la misma dirección van juntos en el mismo marcador.
export const ubicacionesDeClientes = (clientes: ClienteRuta[], deudas: Record<string, number> = {}): UbicacionMapa[] => {
  const porDireccion: Record<string, UbicacionMapa> = {}
  clientes.filter(tieneCoordenadas).forEach((c) => {
    const key = c.dir.id ?? `${c.dir.latitud},${c.dir.longitud}`
    const u = (porDireccion[key] ??= {
      id: key, latitud: Number(c.dir.latitud), longitud: Number(c.dir.longitud), direccion: textoCompleto(c), clientes: [],
    })
    u.clientes.push({ id: c.id, nombre: c.nombre, deuda: deudas[c.id] || 0 })
  })
  return Object.values(porDireccion)
}

// Paradas de una ruta en orden, con su número de parada como etiqueta del marcador.
// Si dos paradas seguidas están en la misma casa se juntan ("3-4").
export const ubicacionesDeParadas = (
  paradas: { cliente: ClienteRuta | null; estado?: string }[],
  colores?: Partial<Record<string, string>>,
): UbicacionMapa[] => {
  const lista: UbicacionMapa[] = []
  paradas.forEach((p, i) => {
    const c = p.cliente
    if (!tieneCoordenadas(c)) return
    const key = c.dir.id ?? `${c.dir.latitud},${c.dir.longitud}`
    const anterior = lista[lista.length - 1]
    if (anterior && anterior.id === key) {
      anterior.clientes.push({ id: c.id, nombre: c.nombre, deuda: 0 })
      anterior.etiqueta = `${anterior.etiqueta?.split('-')[0]}-${i + 1}`
      return
    }
    lista.push({
      id: lista.some((x) => x.id === key) ? `${key}-${i}` : key,
      latitud: Number(c.dir.latitud), longitud: Number(c.dir.longitud), direccion: textoCompleto(c),
      clientes: [{ id: c.id, nombre: c.nombre, deuda: 0 }],
      etiqueta: String(i + 1),
      color: (p.estado && colores?.[p.estado]) || undefined,
    })
  })
  return lista
}

// Abre Google Maps (o Apple Maps / Waze según el teléfono) con indicaciones para llegar a la casa.
// Si la dirección no tiene coordenadas, busca por el texto de la dirección.
export const abrirComoLlegar = async (c: ClienteRuta) => {
  const destino = tieneCoordenadas(c)
    ? `${Number(c.dir.latitud)},${Number(c.dir.longitud)}`
    : encodeURIComponent([textoCompleto(c), 'Chile'].filter(Boolean).join(', '))
  const web = `https://www.google.com/maps/dir/?api=1&destination=${destino}`
  const nativo = Platform.OS === 'ios' ? `maps://?daddr=${destino}` : `google.navigation:q=${destino}`
  try {
    if (Platform.OS !== 'web' && (await Linking.canOpenURL(nativo))) { await Linking.openURL(nativo); return }
  } catch {}
  await Linking.openURL(web)
}

// ---------- Mi ubicación y distancias ----------
export interface Punto { latitud: number; longitud: number }

// Distancia en metros entre dos puntos (fórmula de Haversine)
export const distanciaMetros = (a: Punto, b: Punto) => {
  const R = 6371000
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.latitud - a.latitud)
  const dLng = rad(b.longitud - a.longitud)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// "350 m" / "1,2 km"
export const textoDistancia = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`

// Coordenadas de la casa de un cliente (o null si no tiene)
export const puntoDe = (c: ClienteRuta | null | undefined): Punto | null =>
  tieneCoordenadas(c) ? { latitud: Number(c.dir.latitud), longitud: Number(c.dir.longitud) } : null

// Ubicación simulada (solo para pruebas, desde "Depuración del día"): si está puesta, se usa en vez del GPS.
let ubicacionSimulada: Punto | null = null
export const simularUbicacion = (p: Punto | null) => { ubicacionSimulada = p }
export const hayUbicacionSimulada = () => ubicacionSimulada != null

// Ubicación actual del teléfono. Pide permiso la primera vez; devuelve null si no se da o falla.
export const obtenerMiUbicacion = async (): Promise<Punto | null> => {
  if (ubicacionSimulada) return ubicacionSimulada
  try {
    let { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') ({ status } = await Location.requestForegroundPermissionsAsync())
    if (status !== 'granted') return null
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    return { latitud: pos.coords.latitude, longitud: pos.coords.longitude }
  } catch {
    return null
  }
}

// Sigue la ubicación mientras la pantalla está abierta (cada ~30 s o al moverse 50 m).
// Devuelve una función para dejar de seguirla. Asume que el permiso ya se dio.
export const seguirMiUbicacion = async (cb: (p: Punto) => void): Promise<() => void> => {
  if (ubicacionSimulada) return () => {} // con ubicación simulada no se sigue el GPS
  try {
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 30000, distanceInterval: 50 },
      (pos) => cb({ latitud: pos.coords.latitude, longitud: pos.coords.longitude }),
    )
    return () => sub.remove()
  } catch {
    return () => {}
  }
}

// ---------- Ruta sugerida desde mi ubicación ----------
// Ordena las paradas para recorrerlas partiendo desde `inicio`: primero "vecino más cercano"
// (siempre a la más cercana que falte) y después se mejora con 2-opt (invierte tramos si acorta el total).
// Distancias en línea recta. Devuelve el orden (índices de `puntos`), cada tramo y el total en metros.
export const rutaSugerida = (inicio: Punto, puntos: Punto[]) => {
  const n = puntos.length
  if (n === 0) return { orden: [] as number[], tramos: [] as number[], total: 0 }

  // 1) Vecino más cercano
  const orden: number[] = []
  const usado = new Array(n).fill(false)
  let actual = inicio
  for (let k = 0; k < n; k++) {
    let mejor = -1
    let mejorD = Infinity
    for (let i = 0; i < n; i++) {
      if (usado[i]) continue
      const d = distanciaMetros(actual, puntos[i])
      if (d < mejorD) { mejorD = d; mejor = i }
    }
    usado[mejor] = true
    orden.push(mejor)
    actual = puntos[mejor]
  }

  // 2) 2-opt para un camino abierto que parte en `inicio` (pocas pasadas: las rutas son chicas)
  const p = (k: number) => (k < 0 ? inicio : puntos[orden[k]])
  const d = (a: number, b: number) => distanciaMetros(p(a), p(b))
  let mejoro = true
  for (let pasada = 0; mejoro && pasada < 20; pasada++) {
    mejoro = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        // Tramo i..j invertido: cambian las aristas (i-1, i) y (j, j+1)
        const antes = d(i - 1, i) + (j + 1 < n ? d(j, j + 1) : 0)
        const despues = d(i - 1, j) + (j + 1 < n ? d(i, j + 1) : 0)
        if (despues + 1e-6 < antes) {
          orden.splice(i, j - i + 1, ...orden.slice(i, j + 1).reverse())
          mejoro = true
        }
      }
    }
  }

  const tramos = orden.map((_, k) => d(k - 1, k))
  return { orden, tramos, total: tramos.reduce((s, x) => s + x, 0) }
}
