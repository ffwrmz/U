import { supabase } from '@/lib/supabase'

// Notificaciones dentro de la app (tabla notificaciones, migración 20261123120000).
// Las crea la base con triggers: clientes asignados al casero, correcciones y descuentos pedidos al gerente.

export interface Notificacion {
  id: string
  tipo: string
  titulo: string
  cuerpo: string | null
  datos: { ruta?: string; [k: string]: any }
  leida: boolean
  creado_en: string
}

// Si la tabla aún no existe (migración sin correr) no se muestra error: simplemente no hay notificaciones
export const faltaTabla = (e: { code?: string; message?: string } | null) =>
  !!e && (['PGRST205', 'PGRST202', '42P01', '42883'].includes(e.code ?? '') || /could not find|does not exist/i.test(e.message ?? ''))

export const listarNotificaciones = async (): Promise<Notificacion[]> => {
  const { data, error } = await supabase.from('notificaciones')
    .select('id, tipo, titulo, cuerpo, datos, leida, creado_en').order('creado_en', { ascending: false }).limit(100)
  if (error) { console.warn('notificaciones:', error.message); return [] }
  return (data as Notificacion[]) || []
}

export const contarNoLeidas = async (): Promise<number> => {
  const { count, error } = await supabase.from('notificaciones').select('id', { count: 'exact', head: true }).eq('leida', false)
  return error ? 0 : count ?? 0
}

export const marcarLeida = async (id: string) => {
  await supabase.from('notificaciones').update({ leida: true }).eq('id', id)
}

export const marcarTodasLeidas = async () => {
  await supabase.from('notificaciones').update({ leida: true }).eq('leida', false)
}

// Escucha en tiempo real las notificaciones de un usuario (nuevas o actualizadas). Devuelve cómo dejar de escuchar.
export const escucharNotificaciones = (usuarioId: string, alCambiar: (n: Notificacion | null) => void) => {
  const canal = supabase.channel(`notif-${usuarioId}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notificaciones', filter: `usuario_id=eq.${usuarioId}` },
      (p: any) => alCambiar((p.new && p.new.id ? p.new : null) as Notificacion | null))
    .subscribe()
  return () => { supabase.removeChannel(canal) }
}

// ¿La cuenta del usuario sigue activa? Si la función aún no existe, se revisa el perfil directamente.
export const cuentaActiva = async (usuarioId: string): Promise<boolean | null> => {
  const r = await supabase.rpc('mi_cuenta_activa')
  if (!r.error) return r.data === true
  if (!faltaTabla(r.error)) return null // error de red: no sacar a nadie por eso
  const { data, error } = await supabase.from('perfiles').select('activo, rol').eq('id', usuarioId).maybeSingle()
  if (error) return null
  return !!data && (data as any).activo !== false && !!(data as any).rol
}
