import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

// Todo lo que el casero le pidió al gerente: correcciones, descuentos e inventario, con su estado.
export interface MiSolicitud {
  id: string
  tipo: 'Corrección' | 'Descuento' | 'Inventario'
  detalle: string
  estado: string // pendiente | aprobada | rechazada | usada
  comentario: string | null
  creado_en: string
  resuelto_en: string | null
}

const CLAVE_VISTO = 'mis-solicitudes-visto'

export const listarMisSolicitudes = async (): Promise<MiSolicitud[]> => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const [co, de, inv] = await Promise.all([
    supabase.from('solicitudes_correccion').select('id, tipo, motivo, estado, comentario_gerente, solicitado_en, revisado_en, clientes ( nombre )').eq('solicitado_por', user.id).order('solicitado_en', { ascending: false }).limit(30),
    supabase.from('solicitudes_descuento').select('*, clientes ( nombre ), productos ( nombre )').eq('solicitante_id', user.id).order('creado_en', { ascending: false }).limit(30),
    supabase.from('solicitudes_inventario').select('*, productos ( nombre )').eq('solicitante_id', user.id).order('creado_en', { ascending: false }).limit(30),
  ])
  const l: MiSolicitud[] = []
  ;((co.data as any[]) || []).forEach((x) => l.push({
    id: 'c' + x.id, tipo: 'Corrección',
    detalle: `${x.tipo === 'pago' ? 'Pago' : x.tipo === 'venta_item' ? 'Producto vendido' : 'Datos'} de ${x.clientes?.nombre ?? 'un cliente'}`,
    estado: x.estado, comentario: x.comentario_gerente, creado_en: x.solicitado_en, resuelto_en: x.revisado_en,
  }))
  ;((de.data as any[]) || []).forEach((x) => l.push({
    id: 'd' + x.id, tipo: 'Descuento',
    detalle: `${x.tipo === 'porcentaje' ? `${x.valor}%` : `$${Number(x.valor).toLocaleString('es-CL')}`} ${x.productos?.nombre ? `en ${x.productos.nombre}` : 'sobre el total'}${x.clientes?.nombre ? ` · ${x.clientes.nombre}` : ''}`,
    estado: x.estado, comentario: null, creado_en: x.creado_en, resuelto_en: x.resuelto_en ?? null,
  }))
  ;((inv.data as any[]) || []).forEach((x) => l.push({
    id: 'i' + x.id, tipo: 'Inventario',
    detalle: `${x.tipo === 'agregar' ? 'Agregar' : x.tipo === 'devolver' ? 'Devolver' : 'Dejar en'} ${x.cantidad} · ${x.productos?.nombre ?? 'Producto'}`,
    estado: x.estado, comentario: x.comentario_gerente, creado_en: x.creado_en, resuelto_en: x.resuelta_en,
  }))
  return l.sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)))
}

// Cuántas se resolvieron desde la última vez que abrió "Mis solicitudes"
export const contarResueltasNoVistas = async (): Promise<number> => {
  try {
    const visto = (await AsyncStorage.getItem(CLAVE_VISTO)) ?? ''
    const l = await listarMisSolicitudes()
    return l.filter((s) => s.estado !== 'pendiente' && s.resuelto_en && s.resuelto_en > visto).length
  } catch { return 0 }
}

export const marcarMisSolicitudesVistas = () => AsyncStorage.setItem(CLAVE_VISTO, new Date().toISOString()).catch(() => {})
