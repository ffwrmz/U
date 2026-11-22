// Listas fijas del Calendario (Lunes a Viernes, quincenas, día 20, ...): grupos de clientes con su casero
// que cuentan como preasignados los días que calzan con su regla. Ver supabase/migrations/20261122005000_listas_fijas.sql
import { ClienteRuta, SELECT_CLIENTE } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'

export interface ListaFija {
  id: string
  nombre: string
  dias_semana: number[] | null // 1 = lunes ... 7 = domingo
  dias_mes: number[] | null // 1..31
  ultimo_dia_mes: boolean
  color: string | null
  orden: number
  activo: boolean
  sistema: boolean // Lunes a Viernes: no se eliminan
}
export interface ItemLista { lista_id: string; cliente_id: string; vendedor_id: string; orden: number; cliente: ClienteRuta | null }

const SELECT_LISTA = 'id, nombre, dias_semana, dias_mes, ultimo_dia_mes, color, orden, activo, sistema'

export const COLORES_LISTA = ['#262C60', '#E8590C', '#1E7A46', '#9A6200', '#7B3FA0', '#0E7490', '#B91C1C']

export const listarListas = async (): Promise<ListaFija[]> => {
  const { data, error } = await supabase.from('listas_fijas').select(SELECT_LISTA).eq('activo', true).order('orden').order('nombre')
  if (error) throw error
  return (data as ListaFija[]) || []
}

export const itemsDeListas = async (): Promise<ItemLista[]> => {
  const { data, error } = await supabase.from('listas_fijas_clientes')
    .select(`lista_id, cliente_id, vendedor_id, orden, cliente:clientes ( ${SELECT_CLIENTE} )`).order('orden')
  if (error) throw error
  return ((data as any[]) || []) as ItemLista[]
}

export const omitidasEntre = async (desde: string, hasta: string) => {
  const { data, error } = await supabase.from('listas_fijas_omitidas').select('fecha, lista_id, cliente_id').gte('fecha', desde).lte('fecha', hasta)
  if (error) throw error
  return (data as { fecha: string; lista_id: string; cliente_id: string }[]) || []
}

// ¿La regla de la lista calza con la fecha YYYY-MM-DD?
export const listaCalza = (l: ListaFija, fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number)
  const js = new Date(y, m - 1, d).getDay() // 0 = domingo
  const diaSemana = js === 0 ? 7 : js
  const ultimo = new Date(y, m, 0).getDate()
  if (l.dias_semana?.includes(diaSemana)) return true
  if (l.dias_mes?.includes(d)) return true // un día que el mes no tiene (ej. 30 en febrero) no aplica
  if (l.ultimo_dia_mes && d === ultimo) return true
  return false
}

// "Todos los lunes", "Días 15 y último del mes", "Día 20 de cada mes"
export const textoRegla = (l: Pick<ListaFija, 'dias_semana' | 'dias_mes' | 'ultimo_dia_mes'>) => {
  const nombres = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos']
  const partes: string[] = []
  if (l.dias_semana?.length) partes.push(`Todos los ${l.dias_semana.map((d) => nombres[d]).join(', ')}`)
  const dias = [...(l.dias_mes ?? []).map(String), ...(l.ultimo_dia_mes ? ['último'] : [])]
  if (dias.length === 1) partes.push(dias[0] === 'último' ? 'Último día de cada mes' : `Día ${dias[0]} de cada mes`)
  else if (dias.length > 1) partes.push(`Días ${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1]} del mes`)
  return partes.join(' · ') || 'Sin regla'
}

export const crearLista = async (l: { nombre: string; dias_semana: number[] | null; dias_mes: number[] | null; ultimo_dia_mes: boolean; color: string }) => {
  const { error } = await supabase.from('listas_fijas').insert([{ ...l, orden: 100 }])
  if (error) throw error
}
export const editarLista = async (id: string, cambios: Partial<Pick<ListaFija, 'nombre' | 'dias_semana' | 'dias_mes' | 'ultimo_dia_mes' | 'color'>>) => {
  const { error } = await supabase.from('listas_fijas').update(cambios).eq('id', id)
  if (error) throw error
}
export const eliminarLista = async (id: string) => {
  const { error } = await supabase.from('listas_fijas').delete().eq('id', id)
  if (error) throw error
}

export const agregarALista = async (listaId: string, vendedorId: string, clienteIds: string[]) => {
  if (clienteIds.length === 0) return
  const { data: ultima } = await supabase.from('listas_fijas_clientes').select('orden')
    .eq('lista_id', listaId).order('orden', { ascending: false }).limit(1).maybeSingle()
  const base = ultima?.orden ?? 0
  // Si el cliente ya estaba en la lista con otro casero, pasa a este
  const filas = clienteIds.map((cliente_id, i) => ({ lista_id: listaId, cliente_id, vendedor_id: vendedorId, orden: base + i + 1 }))
  const { error } = await supabase.from('listas_fijas_clientes').upsert(filas, { onConflict: 'lista_id,cliente_id' })
  if (error) throw error
}
export const quitarDeLista = async (listaId: string, clienteId: string) => {
  const { error } = await supabase.from('listas_fijas_clientes').delete().eq('lista_id', listaId).eq('cliente_id', clienteId)
  if (error) throw error
}

// Sacar a un cliente de una lista solo ese día
export const omitirDia = async (fecha: string, listaId: string, clienteId: string) => {
  const { error } = await supabase.from('listas_fijas_omitidas').upsert([{ fecha, lista_id: listaId, cliente_id: clienteId }], { onConflict: 'fecha,lista_id,cliente_id', ignoreDuplicates: true })
  if (error) throw error
}
