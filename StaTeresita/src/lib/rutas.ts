// Rutas guardadas en Supabase: una jornada por día (tabla jornadas) y sus paradas (tabla ruta_paradas).
// Ver supabase/migrations/20261109161000_rutas_jornadas.sql
import { supabase } from '@/lib/supabase'

export type EstadoJornada = 'preparacion' | 'en_curso' | 'finalizada'
export type EstadoParada = 'pendiente' | 'visitado' | 'no_estaba'

export interface Jornada {
  id: string; fecha: string; estado: EstadoJornada; iniciada_en: string | null; finalizada_en: string | null
  cargada_desde_base?: boolean
}

// Dirección estructurada de un cliente (clientes.direccion_id → direcciones → sector/comuna, calle, pasaje)
export interface Dir {
  numero: string | null
  referencia: string | null
  sector: { nombre: string; comuna: { nombre: string } | null } | null
  calle: { nombre: string } | null
  pasaje: { nombre: string } | null
}
export interface ClienteRuta { id: string; nombre: string; telefono?: string | null; direccion: string | null; dir: Dir | null }

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
  'id, nombre, telefono, direccion, dir:direcciones ( numero, referencia, sector:sectores ( nombre, comuna:comunas ( nombre ) ), calle:calles ( nombre ), pasaje:pasajes ( nombre ) )'

const SELECT_PARADA = `id, vendedor_id, cliente_id, orden, estado, visitado_en, nota, cliente:clientes ( ${SELECT_CLIENTE} )`
const SELECT_JORNADA = '*'

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

// Jornada de hoy con la función preparar_jornada_hoy de Supabase: si no existe y quien llama es el dueño,
// la crea y le carga las rutas base del día. Para un casero devuelve null si aún no existe.
// `crear` solo se usa si esa función todavía no está en Supabase (modo antiguo).
export const obtenerOCrearJornadaHoy = async (crear: boolean): Promise<Jornada | null> => {
  const { data: rpc, error: eRpc } = await supabase.rpc('preparar_jornada_hoy')
  if (!eRpc) {
    const fila = Array.isArray(rpc) ? rpc[0] : rpc
    return fila && fila.id ? (fila as Jornada) : null
  }
  if (eRpc.code !== 'PGRST202' && eRpc.code !== '42883') throw eRpc // 'función no existe' → modo antiguo
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

// ---------- Rutas de la semana (ruta base por día de la semana y casero) ----------
// Tablas rutas_base y rutas_base_paradas; RPC preparar_jornada_hoy y cargar_rutas_base.
// Ver supabase/migrations/20261111152500_rutas_semanales.sql. dia_semana: 1 = lunes ... 7 = domingo.

export const DIAS = [
  { n: 1, corto: 'Lun', largo: 'lunes' },
  { n: 2, corto: 'Mar', largo: 'martes' },
  { n: 3, corto: 'Mié', largo: 'miércoles' },
  { n: 4, corto: 'Jue', largo: 'jueves' },
  { n: 5, corto: 'Vie', largo: 'viernes' },
  { n: 6, corto: 'Sáb', largo: 'sábado' },
  { n: 7, corto: 'Dom', largo: 'domingo' },
] as const

// Día de la semana (1-7) de una fecha YYYY-MM-DD
export const diaSemana = (fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = domingo
  return js === 0 ? 7 : js
}
export const nombreDia = (n: number) => DIAS.find((d) => d.n === n)?.largo ?? ''

export interface ParadaBase { id: string; ruta_base_id: string; cliente_id: string; orden: number; cliente: ClienteRuta | null }
export interface RutaBase { id: string; dia_semana: number; vendedor_id: string; nombre: string | null; activo: boolean; paradas: ParadaBase[] }

const SELECT_RUTA_BASE = `id, dia_semana, vendedor_id, nombre, activo, paradas:rutas_base_paradas ( id, ruta_base_id, cliente_id, orden, cliente:clientes ( ${SELECT_CLIENTE} ) )`

// Rutas base (de un día o de toda la semana), con sus paradas ordenadas
export const listarRutasBase = async (dia?: number): Promise<RutaBase[]> => {
  let q = supabase.from('rutas_base').select(SELECT_RUTA_BASE)
  if (dia) q = q.eq('dia_semana', dia)
  const { data, error } = await q
  if (error) throw error
  return ((data as any[]) || []).map((r) => ({ ...r, paradas: [...(r.paradas || [])].sort((a: ParadaBase, b: ParadaBase) => a.orden - b.orden) })) as RutaBase[]
}

// Id de la ruta base de un casero para un día; la crea si no existe
export const obtenerOCrearRutaBase = async (dia: number, vendedorId: string): Promise<string> => {
  const buscar = () => supabase.from('rutas_base').select('id').eq('dia_semana', dia).eq('vendedor_id', vendedorId).maybeSingle()
  const { data, error } = await buscar()
  if (error) throw error
  if (data) return data.id as string
  const { data: nueva, error: e2 } = await supabase.from('rutas_base').insert([{ dia_semana: dia, vendedor_id: vendedorId }]).select('id').single()
  if (e2) {
    if (e2.code === '23505') { const { data: otra } = await buscar(); if (otra) return otra.id as string }
    throw e2
  }
  return nueva.id as string
}

// Agrega clientes al final de la ruta base (sin duplicar)
export const agregarParadasBase = async (rutaBaseId: string, clienteIds: string[]) => {
  if (clienteIds.length === 0) return
  const { data: ultima } = await supabase.from('rutas_base_paradas').select('orden')
    .eq('ruta_base_id', rutaBaseId).order('orden', { ascending: false }).limit(1).maybeSingle()
  const base = ultima?.orden ?? 0
  const filas = clienteIds.map((cliente_id, i) => ({ ruta_base_id: rutaBaseId, cliente_id, orden: base + i + 1 }))
  const { error } = await supabase.from('rutas_base_paradas').upsert(filas, { onConflict: 'ruta_base_id,cliente_id', ignoreDuplicates: true })
  if (error) throw error
}

export const moverParadaBase = async (lista: ParadaBase[], id: string, delta: -1 | 1) => {
  const i = lista.findIndex((p) => p.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= lista.length) return
  const r1 = await supabase.from('rutas_base_paradas').update({ orden: j + 1 }).eq('id', lista[i].id)
  if (r1.error) throw r1.error
  const r2 = await supabase.from('rutas_base_paradas').update({ orden: i + 1 }).eq('id', lista[j].id)
  if (r2.error) throw r2.error
}

export const quitarParadaBase = async (id: string) => {
  const { error } = await supabase.from('rutas_base_paradas').delete().eq('id', id)
  if (error) throw error
}

// Copia la ruta de un casero a otro día (reemplaza la de ese día). No copia clientes que ese día
// ya estén con otro casero. Devuelve cuántos copió y cuántos omitió.
export const copiarRutaBase = async (origen: RutaBase, diaDestino: number) => {
  const destinoId = await obtenerOCrearRutaBase(diaDestino, origen.vendedor_id)
  const delDia = await listarRutasBase(diaDestino)
  const ocupados = new Set(delDia.filter((r) => r.vendedor_id !== origen.vendedor_id).flatMap((r) => r.paradas.map((p) => p.cliente_id)))
  const { error: e1 } = await supabase.from('rutas_base_paradas').delete().eq('ruta_base_id', destinoId)
  if (e1) throw e1
  const copiar = origen.paradas.filter((p) => !ocupados.has(p.cliente_id))
  if (copiar.length > 0) {
    const { error: e2 } = await supabase.from('rutas_base_paradas')
      .insert(copiar.map((p, i) => ({ ruta_base_id: destinoId, cliente_id: p.cliente_id, orden: i + 1 })))
    if (e2) throw e2
  }
  return { copiados: copiar.length, omitidos: origen.paradas.length - copiar.length }
}

// Carga en la jornada las rutas base de su día. reemplazar = borra las paradas de hoy y las vuelve a cargar.
export const cargarRutasBase = async (jornadaId: string, reemplazar: boolean): Promise<number> => {
  const { data, error } = await supabase.rpc('cargar_rutas_base', { p_jornada_id: jornadaId, p_reemplazar: reemplazar })
  if (error) throw error
  return Number(data ?? 0)
}

// ---------- Textos de dirección ----------
export const comunaDe = (c: ClienteRuta) => c.dir?.sector?.comuna?.nombre ?? ''
export const sectorDe = (c: ClienteRuta) => c.dir?.sector?.nombre ?? ''
// "Yerbas Buenas 123 (Pasaje Los Olivos)"; si no tiene dirección por zonas, el texto antiguo
export const lineaDireccion = (c: ClienteRuta) => {
  if (!c.dir) return c.direccion ?? ''
  const calle = [c.dir.calle?.nombre, c.dir.numero].filter(Boolean).join(' ')
  return c.dir.pasaje ? `${calle} (${c.dir.pasaje.nombre})` : calle
}
// "Sector · Comuna"
export const lineaZona = (c: ClienteRuta) => [sectorDe(c), comunaDe(c)].filter(Boolean).join(' · ')
