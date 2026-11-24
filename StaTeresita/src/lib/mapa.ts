import AsyncStorage from '@react-native-async-storage/async-storage'
// Arma los puntos del mapa (UbicacionMapa) a partir de clientes o de las paradas de una ruta.
import type { UbicacionMapa } from '@/components/mapaClientes.types'
import { ClienteRuta, lineaDireccion, lineaZona } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
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
export interface Punto { latitud: number; longitud: number; precision?: number | null }

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

// Ubicación actual del teléfono. Pide permiso la primera vez; devuelve null si no se da o falla.
export const obtenerMiUbicacion = async (): Promise<Punto | null> => {
  try {
    let { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') ({ status } = await Location.requestForegroundPermissionsAsync())
    if (status !== 'granted') return null
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    return { latitud: pos.coords.latitude, longitud: pos.coords.longitude, precision: pos.coords.accuracy }
  } catch {
    return null
  }
}

// Sigue la ubicación mientras la pantalla está abierta (cada ~30 s o al moverse 50 m).
// Devuelve una función para dejar de seguirla. Asume que el permiso ya se dio.
export const seguirMiUbicacion = async (cb: (p: Punto) => void): Promise<() => void> => {
  try {
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 30000, distanceInterval: 50 },
      (pos) => cb({ latitud: pos.coords.latitude, longitud: pos.coords.longitude, precision: pos.coords.accuracy }),
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

// ---------- Camino por calles (OSRM, servidor público de OpenStreetMap) ----------
// Servidor de demostración gratuito y sin clave: sirve para probar, con límite de uso y sin garantías.
// Si no responde, la app sigue mostrando la línea recta.
// PENDIENTE para producción: el servidor público de OSRM es de demostración. Con un servidor propio o pagado,
// poner su dirección en EXPO_PUBLIC_OSRM_URL (variable de EAS o .env).
const OSRM = process.env.EXPO_PUBLIC_OSRM_URL || 'https://router.project-osrm.org'

export interface RutaCalles {
  trazado: Punto[] // forma del camino para dibujar en el mapa
  distancia: number // metros en total
  duracion: number // segundos en total
  tramos: { distancia: number; duracion: number }[] // de cada punto al siguiente
}

// Consulta a OSRM con tiempo máximo de 8 s y como mucho 1 consulta por segundo
let ultimaOSRM = 0
// Las respuestas se guardan en el teléfono: sin señal se usa la misma consulta guardada o, si cambió solo el
// punto de partida, la última con las mismas paradas. Si no hay nada, la app muestra la línea recta.
const CLAVE_OSRM = 'osrm:indice'
const paradasDe = (url: string) => { const m = url.match(/\/driving\/([^?]+)/); return m ? m[1].split(';').slice(1).join(';') : url }
const guardarOSRM = async (url: string, json: any) => {
  try {
    const idx: string[] = JSON.parse((await AsyncStorage.getItem(CLAVE_OSRM)) || '[]').filter((u: string) => u !== url)
    idx.unshift(url)
    const sobran = idx.splice(20)
    await AsyncStorage.multiSet([['osrm:' + url, JSON.stringify(json)], [CLAVE_OSRM, JSON.stringify(idx)]])
    if (sobran.length) await AsyncStorage.multiRemove(sobran.map((u) => 'osrm:' + u))
  } catch {}
}
const leerOSRM = async (url: string) => {
  try {
    const exacta = await AsyncStorage.getItem('osrm:' + url)
    if (exacta) return JSON.parse(exacta)
    const tipo = url.split('/driving/')[0]
    const idx: string[] = JSON.parse((await AsyncStorage.getItem(CLAVE_OSRM)) || '[]')
    const parecida = idx.find((u) => u.split('/driving/')[0] === tipo && paradasDe(u) === paradasDe(url))
    return parecida ? JSON.parse((await AsyncStorage.getItem('osrm:' + parecida)) || 'null') : null
  } catch { return null }
}
const consultarOSRM = async (url: string) => {
  try {
    const json = await consultarOSRMRed(url)
    guardarOSRM(url, json)
    return json
  } catch (e) {
    const guardada = await leerOSRM(url)
    if (guardada) return guardada
    throw e
  }
}
const consultarOSRMRed = async (url: string) => {
  const espera = ultimaOSRM + 1000 - Date.now()
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
  ultimaOSRM = Date.now()
  const control = new AbortController()
  const t = setTimeout(() => control.abort(), 8000)
  try {
    const res = await fetch(url, { signal: control.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`OSRM respondió ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

const coordsOSRM = (puntos: Punto[]) => puntos.map((p) => `${p.longitud.toFixed(6)},${p.latitud.toFixed(6)}`).join(';')
const cacheRutas = new Map<string, RutaCalles | null>()
const cacheOrden = new Map<string, number[] | null>()

// Camino en auto pasando por los puntos en el orden dado. Con muchas paradas se pide por bloques
// de 25 puntos encadenados (cada bloque empieza donde terminó el anterior).
export const rutaPorCalles = async (puntos: Punto[]): Promise<RutaCalles | null> => {
  if (puntos.length < 2) return null
  if (puntos.length > 25) {
    const partes: RutaCalles[] = []
    for (let i = 0; i < puntos.length - 1; i += 24) {
      const r = await rutaPorCalles(puntos.slice(i, i + 25))
      if (!r) return null
      partes.push(r)
    }
    return {
      trazado: partes.flatMap((r) => r.trazado),
      distancia: partes.reduce((n, r) => n + r.distancia, 0),
      duracion: partes.reduce((n, r) => n + r.duracion, 0),
      tramos: partes.flatMap((r) => r.tramos),
    }
  }
  const clave = coordsOSRM(puntos)
  if (cacheRutas.has(clave)) return cacheRutas.get(clave) ?? null
  try {
    const data = await consultarOSRM(`${OSRM}/route/v1/driving/${clave}?overview=full&geometries=geojson&steps=false`)
    const r = data?.routes?.[0]
    if (data?.code !== 'Ok' || !r) { cacheRutas.set(clave, null); return null }
    const ruta: RutaCalles = {
      trazado: (r.geometry?.coordinates ?? []).map(([lng, lat]: [number, number]) => ({ latitud: lat, longitud: lng })),
      distancia: r.distance,
      duracion: r.duration,
      tramos: (r.legs ?? []).map((l: any) => ({ distancia: l.distance, duracion: l.duration })),
    }
    cacheRutas.set(clave, ruta)
    return ruta
  } catch {
    return null // sin internet o el servidor no responde: no se guarda en caché para reintentar
  }
}

// Mejor orden en auto para visitar `puntos` partiendo desde `inicio` (sin volver al inicio).
// Devuelve los índices de `puntos` en el orden sugerido, o null si el servicio no responde.
export const ordenPorCalles = async (inicio: Punto, puntos: Punto[]): Promise<number[] | null> => {
  if (puntos.length < 2 || puntos.length > 90) return null // el servidor público no acepta viajes tan largos
  // La ubicación se redondea (~100 m) para no consultar de nuevo con cada pequeño movimiento
  const ini = { latitud: Math.round(inicio.latitud * 1000) / 1000, longitud: Math.round(inicio.longitud * 1000) / 1000 }
  const clave = coordsOSRM([ini, ...puntos])
  if (cacheOrden.has(clave)) return cacheOrden.get(clave) ?? null
  try {
    const data = await consultarOSRM(`${OSRM}/trip/v1/driving/${clave}?source=first&roundtrip=false&destination=any&overview=false`)
    if (data?.code !== 'Ok' || !Array.isArray(data.waypoints)) { cacheOrden.set(clave, null); return null }
    // waypoints[i].waypoint_index = posición del punto i dentro del viaje (el 0 es mi ubicación)
    const orden = data.waypoints
      .map((w: any, i: number) => ({ i: i - 1, pos: w.waypoint_index as number }))
      .filter((x: { i: number }) => x.i >= 0)
      .sort((a: { pos: number }, b: { pos: number }) => a.pos - b.pos)
      .map((x: { i: number }) => x.i)
    cacheOrden.set(clave, orden)
    return orden
  } catch {
    return null
  }
}

// "12 min" / "1 h 05 min"
export const textoDuracion = (s: number) => {
  const min = Math.max(1, Math.round(s / 60))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

// ---------- Posiciones del casero (seguimiento del gerente) ----------
// Tabla posiciones_vendedor (ver supabase/migrations/20261115163000_posiciones_vendedor.sql)
export interface Posicion { latitud: number; longitud: number; registrada_en: string }

// Guarda mi posición en la jornada (lecturas con precisión peor que 100 m se ignoran). Si falla, no avisa.
export const registrarPosicion = async (jornadaId: string, vendedorId: string, p: Punto) => {
  if (p.precision != null && p.precision > 100) return
  try {
    await supabase.from('posiciones_vendedor').insert([{
      jornada_id: jornadaId, vendedor_id: vendedorId, latitud: p.latitud, longitud: p.longitud, precision_m: p.precision ?? null,
    }])
  } catch {}
}

export const listarPosiciones = async (jornadaId: string, vendedorId: string): Promise<Posicion[]> => {
  const { data, error } = await supabase.from('posiciones_vendedor').select('latitud, longitud, registrada_en')
    .eq('jornada_id', jornadaId).eq('vendedor_id', vendedorId).order('registrada_en', { ascending: true }).limit(2000)
  if (error) return []
  return (data as Posicion[]) || []
}

// Km recorridos según las posiciones (suma en línea recta; se descartan saltos de más de 1,5 km entre lecturas)
export const metrosRecorridos = (ps: Punto[]) => {
  let total = 0
  for (let i = 1; i < ps.length; i++) {
    const d = distanciaMetros(ps[i - 1], ps[i])
    if (d <= 1500) total += d
  }
  return total
}

// "hace 2 min" / "hace 1 h"
export const haceCuanto = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  return `hace ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
}
