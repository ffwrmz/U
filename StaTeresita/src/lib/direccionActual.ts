// "Usar mi ubicación": toma la posición del GPS y la convierte en comuna / sector / pasaje / número.
// Primero con el teléfono (expo-location); si no trae la calle, con OpenStreetMap (Nominatim).
import { Catalogo, DireccionForm } from '@/lib/zonas'
import * as Location from 'expo-location'

export const normalizar = (t: string | null | undefined) =>
  (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

interface Lugar { comuna: string | null; sector: string | null; calle: string | null; numero: string | null }

const desdeNominatim = async (lat: number, lng: number): Promise<Lugar | null> => {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=es&lat=${lat}&lon=${lng}`,
      { headers: { 'User-Agent': 'SantaTeresitaApp/1.0', Accept: 'application/json' } })
    if (!r.ok) return null
    const a = (await r.json())?.address ?? {}
    return {
      comuna: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null,
      sector: a.suburb ?? a.neighbourhood ?? a.quarter ?? a.hamlet ?? a.city_district ?? null,
      calle: a.road ?? a.pedestrian ?? a.footway ?? null,
      numero: a.house_number ?? null,
    }
  } catch { return null }
}

export interface ResultadoUbicacion { direccion: DireccionForm; precision: number | null }

// Devuelve el formulario rellenado. Lo que no está en el catálogo queda como "nuevo" (se crea al guardar).
export const direccionDesdeMiUbicacion = async (catalogo: Catalogo, actual: DireccionForm): Promise<ResultadoUbicacion> => {
  let { status } = await Location.getForegroundPermissionsAsync()
  if (status !== 'granted') ({ status } = await Location.requestForegroundPermissionsAsync())
  if (status !== 'granted') throw new Error('Activa el permiso de ubicación para usar esta opción.')
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest })
  const { latitude: lat, longitude: lng, accuracy } = pos.coords

  let lugar: Lugar = { comuna: null, sector: null, calle: null, numero: null }
  try {
    const [g] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
    if (g) lugar = { comuna: g.city ?? g.subregion ?? null, sector: g.district ?? null, calle: g.street ?? null, numero: g.streetNumber ?? null }
  } catch { /* se intenta con OpenStreetMap */ }
  if (!lugar.calle || !lugar.comuna || !lugar.sector) {
    const n = await desdeNominatim(lat, lng)
    if (n) lugar = { comuna: lugar.comuna ?? n.comuna, sector: lugar.sector ?? n.sector, calle: lugar.calle ?? n.calle, numero: lugar.numero ?? n.numero }
  }
  if (!lugar.comuna && !lugar.calle) throw new Error('No se pudo saber la dirección de este lugar. Elígela a mano.')

  // Buscar en el catálogo sin distinguir mayúsculas ni tildes
  const igual = (a: string, b: string | null) => !!b && normalizar(a) === normalizar(b)
  const comuna = catalogo.comunas.find((c) => igual(c.nombre, lugar.comuna))
  const sectorNombre = lugar.sector ?? 'Sin sector'
  const sector = comuna ? catalogo.sectores.find((s) => s.comuna_id === comuna.id && igual(s.nombre, sectorNombre)) : undefined
  const calle = sector && lugar.calle ? catalogo.calles.find((c) => c.sector_id === sector.id && igual(c.nombre, lugar.calle)) : undefined

  return {
    precision: accuracy ?? null,
    direccion: {
      ...actual,
      comuna_id: comuna?.id ?? null,
      sector_id: sector?.id ?? null,
      pasaje_id: null,
      calle_id: calle?.id ?? null,
      numero: lugar.numero ?? actual.numero,
      nuevo: {
        comuna: comuna ? undefined : lugar.comuna ?? undefined,
        sector: sector ? undefined : sectorNombre,
        calle: calle ? undefined : lugar.calle ?? undefined,
      },
      gps: { latitud: lat, longitud: lng },
    },
  }
}
