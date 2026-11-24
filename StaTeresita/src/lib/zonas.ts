// Zonas (comuna > sector > pasaje / calle) y direcciones de clientes.
// Tablas: comunas, sectores, pasajes, calles, direcciones (ver supabase/migrations/*_zonas.sql).
import { geocodificarDireccion } from '@/lib/geocoding'
import { supabase } from '@/lib/supabase'

export interface Comuna { id: string; nombre: string; activo: boolean }
export interface Sector { id: string; comuna_id: string; nombre: string; activo: boolean }
export interface Pasaje { id: string; sector_id: string; nombre: string; activo: boolean }
export interface Calle { id: string; sector_id: string; nombre: string; activo: boolean }

export interface Catalogo { comunas: Comuna[]; sectores: Sector[]; pasajes: Pasaje[]; calles: Calle[] }
export const catalogoVacio: Catalogo = { comunas: [], sectores: [], pasajes: [], calles: [] }

// Lo que se elige en el formulario de dirección
export interface DireccionForm {
  comuna_id: string | null
  sector_id: string | null
  pasaje_id: string | null // opcional
  calle_id: string | null
  numero: string
  referencia: string
  // Nombres escritos que aún no están en el catálogo (se crean solos al guardar)
  nuevo?: { comuna?: string; sector?: string; calle?: string }
  // Posición exacta del GPS ("Usar mi ubicación"): se guarda tal cual en la dirección
  gps?: { latitud: number; longitud: number } | null
}
export const direccionVacia: DireccionForm = { comuna_id: null, sector_id: null, pasaje_id: null, calle_id: null, numero: '', referencia: '' }

const porNombre = <T extends { nombre: string }>(a: T, b: T) => a.nombre.localeCompare(b.nombre, 'es')

// Lee todo el catálogo (activos e inactivos; los selectores muestran solo los activos).
export const cargarCatalogo = async (): Promise<{ catalogo: Catalogo; error: string | null }> => {
  const [co, se, pa, ca] = await Promise.all([
    supabase.from('comunas').select('id, nombre, activo'),
    supabase.from('sectores').select('id, comuna_id, nombre, activo'),
    supabase.from('pasajes').select('id, sector_id, nombre, activo'),
    supabase.from('calles').select('id, sector_id, nombre, activo'),
  ])
  const error = co.error?.message ?? se.error?.message ?? pa.error?.message ?? ca.error?.message ?? null
  return {
    error,
    catalogo: {
      comunas: ((co.data as Comuna[]) || []).sort(porNombre),
      sectores: ((se.data as Sector[]) || []).sort(porNombre),
      pasajes: ((pa.data as Pasaje[]) || []).sort(porNombre),
      calles: ((ca.data as Calle[]) || []).sort(porNombre),
    },
  }
}

// "Los Aromos 123, Pasaje 2, Sector Rari, Colbún"
export const textoDireccion = (cat: Catalogo, d: DireccionForm) => {
  const nombre = <T extends { id: string; nombre: string }>(lista: T[], id: string | null) => lista.find((x) => x.id === id)?.nombre
  const calle = nombre(cat.calles, d.calle_id) ?? d.nuevo?.calle
  return [
    calle ? [calle, d.numero.trim()].filter(Boolean).join(' ') : null,
    nombre(cat.pasajes, d.pasaje_id),
    nombre(cat.sectores, d.sector_id) ?? d.nuevo?.sector,
    nombre(cat.comunas, d.comuna_id) ?? d.nuevo?.comuna,
  ].filter(Boolean).join(', ')
}

export const validarDireccion = (d: DireccionForm): string | null => {
  if (!d.comuna_id && !d.nuevo?.comuna?.trim()) return 'Elige la comuna'
  if (!d.sector_id && !d.nuevo?.sector?.trim()) return 'Elige el sector'
  if (!d.calle_id && !d.nuevo?.calle?.trim()) return 'Elige el pasaje'
  return null
}

const tieneNuevos = (d: DireccionForm) => !!(d.nuevo?.comuna || d.nuevo?.sector || d.nuevo?.calle)

// Nombres de la dirección (del catálogo o escritos nuevos) para las funciones de Supabase
export const argsDireccion = (cat: Catalogo, d: DireccionForm) => {
  const nombre = <T extends { id: string; nombre: string }>(l: T[], id: string | null) => l.find((x) => x.id === id)?.nombre
  return {
    p_comuna: nombre(cat.comunas, d.comuna_id) ?? d.nuevo?.comuna?.trim() ?? '',
    p_sector: nombre(cat.sectores, d.sector_id) ?? d.nuevo?.sector?.trim() ?? '',
    p_pasaje: nombre(cat.calles, d.calle_id) ?? d.nuevo?.calle?.trim() ?? '',
    p_numero: d.numero.trim() || null,
    p_referencia: d.referencia.trim() || null,
    p_lat: d.gps?.latitud ?? null,
    p_lng: d.gps?.longitud ?? null,
  }
}

// Crea lo que falte (comuna, sector, pasaje) y la dirección con la función asegurar_direccion de Supabase
const asegurarDireccion = async (cat: Catalogo, d: DireccionForm): Promise<string> => {
  const { data, error } = await supabase.rpc('asegurar_direccion', argsDireccion(cat, d))
  if (error) {
    if (error.code === 'PGRST202' || /could not find/i.test(error.message)) {
      throw new Error('Falta correr en Supabase el archivo 20261123140000_asegurar_direccion.sql para crear zonas nuevas desde aquí.')
    }
    throw error
  }
  return data as string
}

// Busca la misma dirección (calle + pasaje + número); si no existe la crea. Devuelve su id.
export const guardarDireccion = async (d: DireccionForm, cat?: Catalogo): Promise<string> => {
  if (cat && (tieneNuevos(d) || d.gps)) return asegurarDireccion(cat, d)
  const numero = d.numero.trim() || null
  let q = supabase.from('direcciones').select('id').eq('calle_id', d.calle_id!)
  q = d.pasaje_id ? q.eq('pasaje_id', d.pasaje_id) : q.is('pasaje_id', null)
  q = numero ? q.eq('numero', numero) : q.is('numero', null)
  const { data: existente, error: e1 } = await q.limit(1).maybeSingle()
  if (e1) throw e1
  if (existente) {
    // Si se escribió una referencia nueva, se actualiza (solo el dueño tiene permiso; si no, se ignora)
    const referencia = d.referencia.trim()
    if (referencia) await supabase.from('direcciones').update({ referencia }).eq('id', existente.id)
    return existente.id as string
  }

  const { data, error } = await supabase.from('direcciones')
    .insert([{ sector_id: d.sector_id, pasaje_id: d.pasaje_id, calle_id: d.calle_id, numero, referencia: d.referencia.trim() || null }])
    .select('id').single()
  if (error) throw error
  return data.id as string
}

// Dirección actual de un cliente para precargar el formulario (null si no tiene o si aún no se corrió el SQL).
export const direccionDeCliente = async (cat: Catalogo, clienteId: string): Promise<DireccionForm | null> => {
  const { data: c } = await supabase.from('clientes').select('direccion_id').eq('id', clienteId).maybeSingle()
  if (!c?.direccion_id) return null
  const { data: d } = await supabase.from('direcciones')
    .select('sector_id, pasaje_id, calle_id, numero, referencia').eq('id', c.direccion_id).maybeSingle()
  if (!d) return null
  return {
    comuna_id: cat.sectores.find((s) => s.id === d.sector_id)?.comuna_id ?? null,
    sector_id: d.sector_id,
    pasaje_id: d.pasaje_id,
    calle_id: d.calle_id,
    numero: d.numero ?? '',
    referencia: d.referencia ?? '',
  }
}

// ---------- Ubicación en el mapa (latitud / longitud de una dirección) ----------
// El cálculo lo hace geocodificarDireccion (lib/geocoding.ts, de kaffee000).
// Las coordenadas se guardan con la función set_ubicacion_direccion de Supabase
// (dueño o vendedor activos; solo cambia latitud y longitud).

export const REGION = 'Maule'

export const guardarUbicacion = async (direccionId: string, latitud: number, longitud: number) => {
  const { error } = await supabase.rpc('set_ubicacion_direccion', { p_direccion_id: direccionId, p_lat: latitud, p_lng: longitud })
  if (error) throw error
}

type FilaDireccion = {
  id: string; numero: string | null; latitud: number | null; longitud: number | null
  sector: { nombre: string; comuna: { nombre: string } | null } | null
  calle: { nombre: string } | null
  pasaje: { nombre: string } | null
}
const SELECT_DIRECCION = 'id, numero, latitud, longitud, sector:sectores ( nombre, comuna:comunas ( nombre ) ), calle:calles ( nombre ), pasaje:pasajes ( nombre )'

// Calcula y guarda la ubicación de una dirección.
// 'ya' = ya tenía coordenadas, 'ok' = se ubicó, 'no' = no se encontró una ubicación confiable.
export const ubicarDireccion = async (direccionId: string, forzar = false): Promise<'ya' | 'ok' | 'no'> => {
  const { data, error } = await supabase.from('direcciones').select(SELECT_DIRECCION).eq('id', direccionId).maybeSingle()
  if (error) throw error
  const d = data as unknown as FilaDireccion | null
  if (!d) return 'no'
  if (!forzar && d.latitud != null && d.longitud != null) return 'ya'
  return (await ubicarFila(d)) ? 'ok' : 'no'
}

const ubicarFila = async (d: FilaDireccion) => {
  const coords = await geocodificarDireccion({
    pais: 'Chile',
    region: REGION,
    ciudad: d.sector?.comuna?.nombre ?? '',
    sector: d.sector?.nombre ?? null,
    calle: d.calle?.nombre ?? '',
    pasaje: d.pasaje?.nombre ?? null,
    numero: d.numero,
  })
  if (!coords) return false
  await guardarUbicacion(d.id, coords.latitud, coords.longitud)
  return true
}

// Ubica todas las direcciones que aún no tienen coordenadas (OpenStreetMap permite 1 consulta por segundo,
// así que puede tardar). Llama a onProgreso después de cada dirección.
export const ubicarPendientes = async (
  onProgreso?: (p: { hechas: number; total: number; ubicadas: number }) => void,
) => {
  const { data, error } = await supabase.from('direcciones').select(SELECT_DIRECCION).or('latitud.is.null,longitud.is.null')
  if (error) throw error
  const lista = ((data as unknown as FilaDireccion[]) || [])
  let ubicadas = 0
  for (let i = 0; i < lista.length; i++) {
    try { if (await ubicarFila(lista[i])) ubicadas++ } catch {}
    onProgreso?.({ hechas: i + 1, total: lista.length, ubicadas })
  }
  return { total: lista.length, ubicadas }
}
