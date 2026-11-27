import { supabase } from '@/lib/supabase'

// Furgones con hasta 2 trabajadores (tabla furgon_trabajadores, migración 20261125230000).
// Si la tabla aún no existe, se usa el responsable_id antiguo del furgón (un solo trabajador).

export interface FurgonInfo { id: string; nombre: string; miembros: string[] }

export const cargarFurgones = async (): Promise<FurgonInfo[]> => {
  const { data: us } = await supabase.from('ubicaciones_inventario').select('*').eq('tipo', 'furgon').eq('activo', true).order('nombre')
  const furgones = ((us as any[]) || []).map((u) => ({ id: u.id as string, nombre: u.nombre as string, miembros: [] as string[], responsable: u.responsable_id as string | null }))
  const { data: ft, error } = await supabase.from('furgon_trabajadores').select('ubicacion_id, perfil_id, creado_en').order('creado_en')
  if (!error) {
    ;((ft as any[]) || []).forEach((r) => furgones.find((f) => f.id === r.ubicacion_id)?.miembros.push(r.perfil_id))
  } else {
    furgones.forEach((f) => { if (f.responsable) f.miembros.push(f.responsable) })
  }
  return furgones.map(({ id, nombre, miembros }) => ({ id, nombre, miembros }))
}

export const furgonDeTrabajador = (furgones: FurgonInfo[], usuarioId: string | null | undefined) =>
  usuarioId ? furgones.find((f) => f.miembros.includes(usuarioId)) ?? null : null

// "Gonzalo - Juan" (quien vendió primero) o solo "Gonzalo" si va solo
export const pareja = (nombre: (id: string) => string | undefined, principal: string | null | undefined, acompanante?: string | null) => {
  const a = principal ? nombre(principal) ?? 'Trabajador' : '—'
  const b = acompanante ? nombre(acompanante) : null
  return b ? `${a} - ${b}` : a
}

// Gerente: dejar el furgón con 1 o 2 trabajadores
export const asignarTrabajadoresFurgon = async (furgonId: string, trabajadores: string[]) => {
  const { error } = await supabase.rpc('asignar_trabajadores_furgon', { p_furgon: furgonId, p_trabajadores: trabajadores })
  if (!error) return
  // Sin la migración: solo se puede un trabajador (responsable_id)
  if (error.code === 'PGRST202' || /could not find/i.test(error.message)) {
    if (trabajadores.length > 1) throw new Error('Para asignar 2 trabajadores falta correr en Supabase el archivo 20261125230000_furgon_dos_trabajadores.sql')
    const r = await supabase.from('ubicaciones_inventario').update({ responsable_id: trabajadores[0] ?? null }).eq('id', furgonId)
    if (r.error) throw r.error
    return
  }
  throw error
}

// ---------- Ruta del equipo ----------
// Los que van en el mismo furgón tienen UNA ruta, guardada a nombre del principal (el primero asignado al furgón).
export const principalEn = (furgones: FurgonInfo[], usuarioId: string) => furgonDeTrabajador(furgones, usuarioId)?.miembros[0] ?? usuarioId
export const equipoEn = (furgones: FurgonInfo[], usuarioId: string) => furgonDeTrabajador(furgones, usuarioId)?.miembros ?? [usuarioId]
export const principalDe = async (usuarioId: string) => principalEn(await cargarFurgones(), usuarioId)
// "Gonzalo - Juan" para el equipo de ese trabajador
export const nombreEquipo = (furgones: FurgonInfo[], usuarioId: string, nombre: (id: string) => string | undefined) =>
  equipoEn(furgones, usuarioId).map((id) => nombre(id) ?? 'Trabajador').join(' - ')
