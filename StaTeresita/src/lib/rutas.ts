// Rutas guardadas en Supabase: una jornada por día (tabla jornadas) y sus paradas (tabla ruta_paradas).
// Ver supabase/migrations/20261109161000_rutas_jornadas.sql
import { supabase } from '@/lib/supabase'

export type EstadoJornada = 'preparacion' | 'en_curso' | 'finalizada'
export type EstadoParada = 'pendiente' | 'visitado' | 'no_estaba'

export interface Jornada { id: string; fecha: string; estado: EstadoJornada; iniciada_en: string | null; finalizada_en: string | null }

// Dirección estructurada de un cliente (clientes.direccion_id → direcciones → sector/comuna, calle, pasaje)
export interface Dir {
  numero: string | null
  referencia: string | null
  sector: { nombre: string; comuna: { nombre: string } | null } | null
  calle: { nombre: string } | null
  pasaje: { nombre: string } | null
}
export interface ClienteRuta { id: string; nombre: string; direccion: string | null; dir: Dir | null }

export interface Parada {
  id: string
  vendedor_id: string
  cliente_id: string
  orden: number
  estado: EstadoParada
  visitado_en: string | null
  nota: string | null
  cliente: ClienteRuta | null
}

// Columnas de un cliente con su dirección por zonas (para usar dentro de un select)
export const SELECT_CLIENTE =
  'id, nombre, direccion, dir:direcciones ( numero, referencia, sector:sectores ( nombre, comuna:comunas ( nombre ) ), calle:calles ( nombre ), pasaje:pasajes ( nombre ) )'

const SELECT_PARADA = `id, vendedor_id, cliente_id, orden, estado, visitado_en, nota, cliente:clientes ( ${SELECT_CLIENTE} )`
const SELECT_JORNADA = 'id, fecha, estado, iniciada_en, finalizada_en'

// Fecha de hoy en Chile (YYYY-MM-DD)
export const hoyChile = () => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}

export const textoEstadoJornada = (estado?: EstadoJornada | null) =>
  estado === 'en_curso' ? 'En curso' : estado === 'finalizada' ? 'Finalizada' : 'En preparación'

// Jornada de hoy. Si no existe y `crear` es true (solo el dueño tiene permiso), la crea.
export const obtenerOCrearJornadaHoy = async (crear: boolean): Promise<Jornada | null> => {
  const fecha = hoyChile()
  const { data, error } = await supabase.from('jornadas').select(SELECT_JORNADA).eq('fecha', fecha).maybeSingle()
  if (error) throw error
  if (data || !crear) return (data as Jornada) ?? null
  const { data: nueva, error: e2 } = await supabase.from('jornadas').insert([{ fecha }]).select(SELECT_JORNADA).single()
  if (e2) {
    // Otra persona la creó al mismo tiempo: se vuelve a leer
    if (e2.code === '23505') {
      const { data: otra } = await supabase.from('jornadas').select(SELECT_JORNADA).eq('fecha', fecha).maybeSingle()
      return (otra as Jornada) ?? null
    }
    throw e2
  }
  return nueva as Jornada
}

export const cambiarEstadoJornada = async (jornadaId: string, estado: EstadoJornada): Promise<Jornada> => {
  const cambios: Record<string, unknown> = { estado }
  if (estado === 'en_curso') cambios.iniciada_en = new Date().toISOString()
  if (estado === 'finalizada') cambios.finalizada_en = new Date().toISOString()
  const { data, error } = await supabase.from('jornadas').update(cambios).eq('id', jornadaId).select(SELECT_JORNADA).single()
  if (error) throw error
  return data as Jornada
}

// Paradas de una jornada (todas, o solo las de un vendedor), ordenadas
export const listarParadas = async (jornadaId: string, vendedorId?: string): Promise<Parada[]> => {
  let q = supabase.from('ruta_paradas').select(SELECT_PARADA).eq('jornada_id', jornadaId)
  if (vendedorId) q = q.eq('vendedor_id', vendedorId)
  const { data, error } = await q.order('orden', { ascending: true })
  if (error) throw error
  return ((data as any[]) || []) as Parada[]
}

// Agrega clientes al final de la ruta del vendedor. Si un cliente ya está en la jornada, se ignora.
export const asignarParadas = async (jornadaId: string, vendedorId: string, clienteIds: string[]) => {
  if (clienteIds.length === 0) return
  const { data: ultima } = await supabase.from('ruta_paradas').select('orden')
    .eq('jornada_id', jornadaId).eq('vendedor_id', vendedorId)
    .order('orden', { ascending: false }).limit(1).maybeSingle()
  const base = ultima?.orden ?? 0
  const filas = clienteIds.map((cliente_id, i) => ({ jornada_id: jornadaId, vendedor_id: vendedorId, cliente_id, orden: base + i + 1 }))
  const { error } = await supabase.from('ruta_paradas').upsert(filas, { onConflict: 'jornada_id,cliente_id', ignoreDuplicates: true })
  if (error) throw error
}

// Intercambia la parada con la anterior (-1) o la siguiente (+1) dentro de la lista del vendedor
export const moverParada = async (lista: Parada[], paradaId: string, delta: -1 | 1) => {
  const i = lista.findIndex((p) => p.id === paradaId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= lista.length) return
  // Se usan las posiciones (1, 2, 3...) para que el orden quede siempre limpio
  const [a, b] = [lista[i], lista[j]]
  const r1 = await supabase.from('ruta_paradas').update({ orden: j + 1 }).eq('id', a.id)
  if (r1.error) throw r1.error
  const r2 = await supabase.from('ruta_paradas').update({ orden: i + 1 }).eq('id', b.id)
  if (r2.error) throw r2.error
}

export const quitarParada = async (paradaId: string) => {
  const { error } = await supabase.from('ruta_paradas').delete().eq('id', paradaId)
  if (error) throw error
}

export const marcarParada = async (paradaId: string, estado: EstadoParada) => {
  const { error } = await supabase.from('ruta_paradas')
    .update({ estado, visitado_en: estado === 'pendiente' ? null : new Date().toISOString() })
    .eq('id', paradaId)
  if (error) throw error
}
