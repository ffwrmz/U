// Calendario de preasignaciones: clientes dejados para un casero en una fecha (hoy o días siguientes).
// Tabla preasignaciones (ver supabase/migrations/20261122003500_preasignaciones.sql).
import { itemsDeListas, ListaFija, listaCalza, listarListas, omitidasEntre } from '@/lib/listasFijas'
import { ClienteRuta, SELECT_CLIENTE } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'

export interface Preasignacion {
  id: string
  fecha: string // YYYY-MM-DD
  vendedor_id: string | null // las nuevas se guardan sin casero (se elige al asignar la ruta del día)
  cliente_id: string
  orden: number
  nota: string | null
  cliente: ClienteRuta | null
}

const SELECT_PRE = `id, fecha, vendedor_id, cliente_id, orden, nota, cliente:clientes ( ${SELECT_CLIENTE} )`

// Fecha local YYYY-MM-DD (sin pasar por UTC)
export const fechaISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// "lunes 24 de noviembre"
export const fechaLarga = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
}

export const listarPreasignaciones = async (desde: string, hasta: string): Promise<Preasignacion[]> => {
  const { data, error } = await supabase.from('preasignaciones').select(SELECT_PRE)
    .gte('fecha', desde).lte('fecha', hasta).order('fecha').order('orden')
  if (error) throw error
  return ((data as any[]) || []) as Preasignacion[]
}

// Agrega clientes al final de lo preasignado ese día (si un cliente ya está ese día, se ignora).
// Sin casero por defecto: el casero se elige en Asignar clientes.
export const preasignar = async (fecha: string, vendedorId: string | null, clienteIds: string[]) => {
  if (clienteIds.length === 0) return
  const { data: ultima } = await supabase.from('preasignaciones').select('orden')
    .eq('fecha', fecha).order('orden', { ascending: false }).limit(1).maybeSingle()
  const base = ultima?.orden ?? 0
  const filas = clienteIds.map((cliente_id, i) => ({ fecha, vendedor_id: vendedorId, cliente_id, orden: base + i + 1 }))
  const { error } = await supabase.from('preasignaciones').upsert(filas, { onConflict: 'fecha,cliente_id', ignoreDuplicates: true })
  if (error) throw error
}

// Programa la visita de un cliente para una fecha (sin casero). Si ya estaba ese día, no hace nada.
export const programarVisita = async (clienteId: string, fecha: string) => {
  await preasignar(fecha, null, [clienteId])
}

export const quitarPreasignacion = async (id: string) => {
  const { error } = await supabase.from('preasignaciones').delete().eq('id', id)
  if (error) throw error
}

// ---------- Preasignados por fecha (explícitos + listas fijas) ----------

export interface PreDia {
  fecha: string
  cliente_id: string
  vendedor_id: string | null // null: cliente de una lista fija sin casero
  orden: number
  cliente: ClienteRuta | null
  origen: 'manual' | 'lista'
  id?: string // preasignación explícita
  lista?: Pick<ListaFija, 'id' | 'nombre' | 'color'>
}

const fechasEntre = (desde: string, hasta: string) => {
  const r: string[] = []
  const [y, m, d] = desde.split('-').map(Number)
  for (let f = new Date(y, m - 1, d); fechaISO(f) <= hasta; f.setDate(f.getDate() + 1)) r.push(fechaISO(f))
  return r
}

// Resuelve los preasignados de cada día del rango: primero las preasignaciones explícitas; después los
// clientes de las listas fijas cuya regla calza con el día (menos los omitidos ese día). Si un cliente está
// en dos listas el mismo día, gana la de menor orden. Si las tablas de listas no existen, solo las explícitas.
export const resolverPreasignados = async (desde: string, hasta: string): Promise<PreDia[]> => {
  const manual = await listarPreasignaciones(desde, hasta)
  let listas: ListaFija[] = []
  let items: Awaited<ReturnType<typeof itemsDeListas>> = []
  let omitidas: Awaited<ReturnType<typeof omitidasEntre>> = []
  try { [listas, items, omitidas] = await Promise.all([listarListas(), itemsDeListas(), omitidasEntre(desde, hasta)]) } catch {}
  const r: PreDia[] = manual.map((p) => ({ ...p, origen: 'manual' as const }))
  for (const fecha of fechasEntre(desde, hasta)) {
    const ocupados = new Set(manual.filter((p) => p.fecha === fecha).map((p) => p.cliente_id))
    for (const l of listas.filter((x) => listaCalza(x, fecha))) {
      for (const it of items.filter((x) => x.lista_id === l.id)) {
        if (ocupados.has(it.cliente_id)) continue
        if (omitidas.some((o) => o.fecha === fecha && o.lista_id === l.id && o.cliente_id === it.cliente_id)) continue
        ocupados.add(it.cliente_id)
        r.push({ fecha, cliente_id: it.cliente_id, vendedor_id: it.vendedor_id, orden: 1000 + it.orden, cliente: it.cliente, origen: 'lista', lista: { id: l.id, nombre: l.nombre, color: l.color } })
      }
    }
  }
  return r
}
