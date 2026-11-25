import { supabase } from '@/lib/supabase'

// Ajustes del negocio y permisos por trabajador (migración 20261125020000_ajustes_permisos.sql).
// Si la migración aún no se corrió, todo funciona como antes: 10% de descuento y todo permitido.

export const DESCUENTO_POR_DEFECTO = 10

export interface Permisos {
  puede_vender: boolean
  puede_cobrar: boolean
  puede_crear_clientes: boolean
  descuento_max: number | null // null = usa el general
}
export const permisosDe = (p: any): Permisos => ({
  puede_vender: p?.puede_vender !== false,
  puede_cobrar: p?.puede_cobrar !== false,
  puede_crear_clientes: p?.puede_crear_clientes !== false,
  descuento_max: p?.descuento_max == null ? null : Number(p.descuento_max),
})

export const leerDescuentoGeneral = async (): Promise<number> => {
  const { data, error } = await supabase.from('ajustes').select('descuento_max_casero').maybeSingle()
  return error || !data ? DESCUENTO_POR_DEFECTO : Number((data as any).descuento_max_casero)
}

export const guardarDescuentoGeneral = async (valor: number) => {
  const { error } = await supabase.from('ajustes').update({ descuento_max_casero: valor, actualizado_en: new Date().toISOString() }).eq('id', true)
  if (error) throw error
}

export const guardarPermisos = async (usuarioId: string, cambios: Partial<Permisos>) => {
  const { error } = await supabase.from('perfiles').update(cambios).eq('id', usuarioId)
  if (error) throw error
}

// Descuento máximo sin aprobación para quien está usando la app
export const miLimiteDescuento = async (): Promise<number> => {
  const { data, error } = await supabase.rpc('limite_descuento')
  return error || data == null ? DESCUENTO_POR_DEFECTO : Number(data)
}

export interface Companero { id: string; nombre: string; rol: string; telefono: string | null }

// Trabajadores activos (nombre y teléfono) para escribirse por WhatsApp
export const listarEquipo = async (): Promise<Companero[]> => {
  const r = await supabase.rpc('listar_equipo')
  if (!r.error) return (r.data as Companero[]) || []
  const { data } = await supabase.from('perfiles').select('id, nombre, rol, telefono, activo').in('rol', ['dueno', 'vendedor']).order('nombre')
  return ((data as any[]) || []).filter((p) => p.activo !== false)
}
