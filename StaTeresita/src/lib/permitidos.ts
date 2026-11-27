import { esGerente } from '@/lib/roles'
import { obtenerOCrearJornadaHoy } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'

// Clientes a los que el casero puede venderle o cobrarle hoy: los de su ruta de hoy (asignados por el gerente)
// y los que él mismo registró hoy. Para el gerente devuelve null (sin restricción).
// Es la misma regla que aplica Supabase en registrar_venta / registrar_pago; funciona también sin señal
// (las lecturas quedan guardadas en el teléfono).
export const clientesPermitidosHoy = async (): Promise<Set<string> | null> => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Set()
  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).maybeSingle()
  if (esGerente(perfil?.rol)) return null
  const ids = new Set<string>()
  try {
    const j = await obtenerOCrearJornadaHoy(false)
    if (j) {
      const { data } = await supabase.from('ruta_paradas').select('*').eq('jornada_id', j.id).eq('vendedor_id', user.id)
      ;((data as any[]) || []).filter((p) => !p.fuera_de_ruta).forEach((p) => ids.add(p.cliente_id))
    }
  } catch {}
  try {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const { data, error } = await supabase.from('clientes').select('id').eq('creado_por', user.id).gte('creado_en', hoy.toISOString())
    if (!error) ((data as any[]) || []).forEach((c) => ids.add(c.id))
  } catch {}
  return ids
}
