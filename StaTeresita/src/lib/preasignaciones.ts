// Calendario de preasignaciones: clientes dejados para un casero en una fecha (hoy o días siguientes).
// Tabla preasignaciones (ver supabase/migrations/20261122003500_preasignaciones.sql).
import { ClienteRuta, SELECT_CLIENTE } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'

export interface Preasignacion {
  id: string
  fecha: string // YYYY-MM-DD
  vendedor_id: string
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

// Próximas preasignaciones de un cliente (desde hoy)
export const preasignacionesDeCliente = async (clienteId: string, desde: string): Promise<Preasignacion[]> => {
  const { data, error } = await supabase.from('preasignaciones').select('id, fecha, vendedor_id, cliente_id, orden, nota')
    .eq('cliente_id', clienteId).gte('fecha', desde).order('fecha')
  if (error) throw error
  return ((data as any[]) || []).map((x) => ({ ...x, cliente: null })) as Preasignacion[]
}

// Agrega clientes al final de lo preasignado a ese casero ese día (si un cliente ya está ese día, se ignora)
export const preasignar = async (fecha: string, vendedorId: string, clienteIds: string[]) => {
  if (clienteIds.length === 0) return
  const { data: ultima } = await supabase.from('preasignaciones').select('orden')
    .eq('fecha', fecha).eq('vendedor_id', vendedorId).order('orden', { ascending: false }).limit(1).maybeSingle()
  const base = ultima?.orden ?? 0
  const filas = clienteIds.map((cliente_id, i) => ({ fecha, vendedor_id: vendedorId, cliente_id, orden: base + i + 1 }))
  const { error } = await supabase.from('preasignaciones').upsert(filas, { onConflict: 'fecha,cliente_id', ignoreDuplicates: true })
  if (error) throw error
}

// Programa (o cambia de casero) la visita de un cliente para una fecha
export const programarVisita = async (clienteId: string, fecha: string, vendedorId: string) => {
  const { data: existente } = await supabase.from('preasignaciones').select('id').eq('fecha', fecha).eq('cliente_id', clienteId).maybeSingle()
  if (existente) {
    const { error } = await supabase.from('preasignaciones').update({ vendedor_id: vendedorId }).eq('id', existente.id)
    if (error) throw error
  } else {
    await preasignar(fecha, vendedorId, [clienteId])
  }
}

export const quitarPreasignacion = async (id: string) => {
  const { error } = await supabase.from('preasignaciones').delete().eq('id', id)
  if (error) throw error
}
