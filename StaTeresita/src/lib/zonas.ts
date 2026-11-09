// Zonas (comuna > sector > pasaje / calle) y direcciones de clientes.
// Tablas: comunas, sectores, pasajes, calles, direcciones (ver supabase/migrations/*_zonas.sql).
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
  const calle = nombre(cat.calles, d.calle_id)
  return [
    calle ? [calle, d.numero.trim()].filter(Boolean).join(' ') : null,
    nombre(cat.pasajes, d.pasaje_id),
    nombre(cat.sectores, d.sector_id),
    nombre(cat.comunas, d.comuna_id),
  ].filter(Boolean).join(', ')
}

export const validarDireccion = (d: DireccionForm): string | null => {
  if (!d.comuna_id) return 'Elige la comuna'
  if (!d.sector_id) return 'Elige el sector'
  if (!d.calle_id) return 'Elige la calle'
  return null
}

// Busca la misma dirección (calle + pasaje + número); si no existe la crea. Devuelve su id.
export const guardarDireccion = async (d: DireccionForm): Promise<string> => {
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
