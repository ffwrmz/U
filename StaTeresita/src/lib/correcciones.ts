import { clp, telefonoLocal } from '@/lib/format'
import { faltaTabla } from '@/lib/notificaciones'
import { supabase } from '@/lib/supabase'

// Solicitudes de corrección: el casero pide corregir un dato y el gerente la aprueba o rechaza
// (tabla solicitudes_correccion y función resolver_correccion, migración 20261122020000).

export type TipoCorreccion = 'pago' | 'venta_item' | 'cliente'
export type EstadoCorreccion = 'pendiente' | 'aprobada' | 'rechazada'

export interface Correccion {
  id: string
  tipo: TipoCorreccion
  pago_id: string | null
  venta_id: string | null
  venta_item_id: string | null
  cliente_id: string | null
  datos_anteriores: Record<string, any>
  datos_nuevos: Record<string, any>
  motivo: string
  estado: EstadoCorreccion
  solicitado_por: string
  solicitado_en: string
  revisado_en: string | null
  comentario_gerente: string | null
  clientes?: { nombre: string } | null
}

const CAMPOS = 'id, tipo, pago_id, venta_id, venta_item_id, cliente_id, datos_anteriores, datos_nuevos, motivo, estado, solicitado_por, solicitado_en, revisado_en, comentario_gerente'

// Nombre de cada cliente (aparte, para no depender de la relación en la consulta)
const conClientes = async (l: Correccion[]): Promise<Correccion[]> => {
  const ids = Array.from(new Set(l.map((c) => c.cliente_id).filter(Boolean))) as string[]
  if (!ids.length) return l
  const { data } = await supabase.from('clientes').select('id, nombre').in('id', ids)
  const m = Object.fromEntries(((data as any[]) || []).map((c) => [c.id, c.nombre]))
  return l.map((c) => ({ ...c, clientes: c.cliente_id && m[c.cliente_id] ? { nombre: m[c.cliente_id] } : null }))
}

export const crearCorreccion = async (s: {
  tipo: TipoCorreccion
  pago_id?: string | null
  venta_id?: string | null
  venta_item_id?: string | null
  cliente_id: string
  datos_anteriores: Record<string, any>
  datos_nuevos: Record<string, any>
  motivo: string
}) => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No hay sesión activa')
  const { error } = await supabase.from('solicitudes_correccion').insert({ ...s, solicitado_por: user.id })
  if (error) throw error
}

// Solicitudes de un cliente (el casero solo ve las suyas por RLS; el gerente ve todas)
export const correccionesDeCliente = async (clienteId: string): Promise<Correccion[]> => {
  const { data, error } = await supabase.from('solicitudes_correccion').select(CAMPOS)
    .eq('cliente_id', clienteId).order('solicitado_en', { ascending: false }).limit(20)
  if (error) return [] // si la tabla aún no existe
  return conClientes((data as any[]) as Correccion[])
}

export const listarCorrecciones = async (estado: 'pendiente' | 'resueltas'): Promise<Correccion[]> => {
  let q = supabase.from('solicitudes_correccion').select(CAMPOS)
  q = estado === 'pendiente' ? q.eq('estado', 'pendiente').order('solicitado_en', { ascending: true })
    : q.neq('estado', 'pendiente').order('revisado_en', { ascending: false }).limit(50)
  const { data, error } = await q
  if (error) {
    if (faltaTabla(error)) { console.warn('solicitudes_correccion:', error.message); return [] }
    throw error
  }
  return conClientes((data as any[]) as Correccion[])
}

export const contarPendientes = async (): Promise<number> => {
  const { count, error } = await supabase.from('solicitudes_correccion').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')
  return error ? 0 : count ?? 0
}

export const resolverCorreccion = async (id: string, aprobar: boolean, comentario?: string) => {
  const { error } = await supabase.rpc('resolver_correccion', { p_id: id, p_aprobar: aprobar, p_comentario: comentario?.trim() || null })
  if (error) throw error
}

// Avisa cuando cambia cualquier solicitud (tiempo real). Devuelve la función para dejar de escuchar.
export const escucharCorrecciones = (alCambiar: () => void) => {
  const canal = supabase.channel(`correcciones-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_correccion' }, () => alCambiar())
    .subscribe()
  return () => { supabase.removeChannel(canal) }
}

export const TITULO_TIPO: Record<TipoCorreccion, string> = {
  pago: 'Monto de un pago',
  venta_item: 'Producto vendido',
  cliente: 'Datos del cliente',
}

// "Antes → después" en texto, para la tarjeta de la solicitud
export const cambiosDe = (c: Pick<Correccion, 'tipo' | 'datos_anteriores' | 'datos_nuevos'>): { campo: string; antes: string; despues: string }[] => {
  const a = c.datos_anteriores ?? {}
  const n = c.datos_nuevos ?? {}
  if (c.tipo === 'pago') {
    return [{ campo: 'Monto', antes: clp(Number(a.monto_abonado ?? 0)), despues: Number(n.monto_abonado) === 0 ? 'Sin pago (se borra)' : clp(Number(n.monto_abonado ?? 0)) }]
  }
  if (c.tipo === 'venta_item') {
    const filas = []
    if ('producto_id' in n && n.producto_id !== a.producto_id) filas.push({ campo: 'Producto', antes: a.producto_nombre ?? '—', despues: n.producto_nombre ?? '—' })
    if ('cantidad' in n) filas.push({ campo: 'Cantidad', antes: String(a.cantidad ?? '—'), despues: Number(n.cantidad) === 0 ? '0 (se quita)' : String(n.cantidad) })
    if ('precio_final' in n) filas.push({ campo: 'Precio unitario', antes: clp(Number(a.precio_final ?? 0)), despues: clp(Number(n.precio_final)) })
    return filas
  }
  const filas = []
  if ('telefono' in n) filas.push({ campo: 'Teléfono', antes: a.telefono ? `+56 ${telefonoLocal(a.telefono)}` : '—', despues: n.telefono ? `+56 ${telefonoLocal(n.telefono)}` : '—' })
  if ('referencia' in n) filas.push({ campo: 'Indicaciones', antes: a.referencia || '—', despues: n.referencia || '—' })
  return filas
}

export const ESTADO_TEXTO: Record<EstadoCorreccion, string> = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' }
