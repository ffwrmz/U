// Modo sin conexión:
//  * Caché de lecturas: cada consulta a Supabase que responde bien se guarda en el teléfono y, sin señal,
//    se responde con lo último guardado (por eso las pantallas que se abrieron con señal se ven igual).
//  * Cola de acciones: ventas, pagos, Estaba/No estaba, orden de la ruta, clientes nuevos, solicitudes…
//    se guardan en orden y se suben de a una, en el mismo orden, cuando vuelve la señal.
//  * Efectos locales: mientras una acción espera, las lecturas se muestran como si ya se hubiera hecho
//    (saldo descontado, parada marcada, stock rebajado, cliente nuevo en la lista).
import AsyncStorage from '@react-native-async-storage/async-storage'

export type EstadoAccion = 'pendiente' | 'fallida'
export interface Accion {
  id: string // uuid generado en el teléfono (sirve para no aplicarla dos veces)
  tipo: string // ej. "rpc/registrar_pago", "PATCH ruta_paradas"
  descripcion: string
  url: string
  metodo: string
  headers: Record<string, string>
  cuerpo: string | null
  creado_en: string
  intentos: number
  estado: EstadoAccion
  error?: string
  usuario?: string | null // quién la hizo: solo se sube con la sesión de esa persona
}

const CLAVE_COLA = 'offline:cola'
const PREFIJO_CACHE = 'offline:c:'
const CLAVE_INDICE = 'offline:indice'
const MAX_ENTRADA = 400_000 // bytes por respuesta guardada
const MAX_TOTAL = 3_500_000 // AsyncStorage en Android tiene ~6 MB en total

export const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

// ---------------- Cola ----------------
let cola: Accion[] = []
let colaCargada: Promise<void> | null = null
const oyentesCola = new Set<() => void>()

export const cargarCola = () => {
  if (!colaCargada) {
    colaCargada = AsyncStorage.getItem(CLAVE_COLA)
      .then((t) => { cola = t ? JSON.parse(t) : [] })
      .catch(() => { cola = [] })
  }
  return colaCargada
}
const guardarCola = async () => {
  try { await AsyncStorage.setItem(CLAVE_COLA, JSON.stringify(cola)) } catch {}
  oyentesCola.forEach((f) => f())
}
export const verCola = () => cola.slice()
export const escucharCola = (f: () => void) => { oyentesCola.add(f); return () => { oyentesCola.delete(f) } }

export const agregarAccion = async (a: Accion) => { await cargarCola(); cola.push(a); await guardarCola() }
export const quitarAccion = async (id: string) => { cola = cola.filter((a) => a.id !== id); await guardarCola() }
export const actualizarAccion = async (id: string, cambios: Partial<Accion>) => {
  cola = cola.map((a) => (a.id === id ? { ...a, ...cambios } : a)); await guardarCola()
}
export const reintentarFallidas = async () => {
  cola = cola.map((a) => (a.estado === 'fallida' ? { ...a, estado: 'pendiente', error: undefined } : a)); await guardarCola()
}

// ---------------- Caché de lecturas ----------------
interface EntradaCache { status: number; headers: Record<string, string>; cuerpo: string; t: number }
let indice: Record<string, { t: number; n: number }> | null = null
const leerIndice = async () => {
  if (!indice) { try { indice = JSON.parse((await AsyncStorage.getItem(CLAVE_INDICE)) || '{}') } catch { indice = {} } }
  return indice!
}
const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + s.length.toString(36)
}

export const guardarEnCache = async (clave: string, e: Omit<EntradaCache, 't'>) => {
  if (e.cuerpo.length > MAX_ENTRADA) return
  try {
    const idx = await leerIndice()
    const k = PREFIJO_CACHE + hash(clave)
    idx[k] = { t: Date.now(), n: e.cuerpo.length }
    // Si se pasa del total, se borran las más antiguas
    let total = Object.values(idx).reduce((s, x) => s + x.n, 0)
    const viejas = Object.entries(idx).sort((a, b) => a[1].t - b[1].t)
    const borrar: string[] = []
    while (total > MAX_TOTAL && viejas.length) { const [kk, v] = viejas.shift()!; if (kk === k) continue; total -= v.n; borrar.push(kk); delete idx[kk] }
    if (borrar.length) await AsyncStorage.multiRemove(borrar)
    await AsyncStorage.multiSet([[k, JSON.stringify({ ...e, t: Date.now() })], [CLAVE_INDICE, JSON.stringify(idx)]])
  } catch {}
}
export const leerDeCache = async (clave: string): Promise<EntradaCache | null> => {
  try { const t = await AsyncStorage.getItem(PREFIJO_CACHE + hash(clave)); return t ? JSON.parse(t) : null } catch { return null }
}

// ---------------- Efectos locales de las acciones pendientes ----------------
// Filtros "col=eq.valor" de la URL (para saber a qué filas corresponde una lista)
const filtrosEq = (url: string) => {
  const out: Record<string, string> = {}
  try {
    new URL(url).searchParams.forEach((v, k) => { if (v.startsWith('eq.')) out[k] = decodeURIComponent(v.slice(3)) })
  } catch {}
  return out
}
const tablaDe = (url: string) => { try { return new URL(url).pathname.split('/rest/v1/')[1] ?? '' } catch { return '' } }

const recorrer = (x: any, f: (o: any) => void) => {
  if (Array.isArray(x)) x.forEach((y) => recorrer(y, f))
  else if (x && typeof x === 'object') { f(x); Object.values(x).forEach((y) => recorrer(y, f)) }
}

export const usuarioDeToken = (headers: Record<string, string>) => {
  try {
    const jwt = (headers.Authorization || headers.authorization || '').replace(/^Bearer /, '')
    let p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    while (p.length % 4) p += '='
    return JSON.parse(globalThis.atob ? globalThis.atob(p) : '').sub as string
  } catch { return null }
}

const aplicarUna = (a: Accion, url: string, json: any) => {
  const tablaLectura = tablaDe(url)
  const eq = filtrosEq(url)
  const cuerpo = a.cuerpo ? JSON.parse(a.cuerpo) : null
  const tabla = tablaDe(a.url)

  if (a.metodo === 'PATCH') {
    const id = filtrosEq(a.url).id
    if (id && cuerpo && typeof cuerpo === 'object') recorrer(json, (o) => { if (o.id === id) Object.assign(o, cuerpo) })
    return
  }
  if (a.metodo === 'DELETE') {
    const id = filtrosEq(a.url).id
    if (id && Array.isArray(json) && tablaLectura === tabla) return json.filter((o) => o?.id !== id)
    return
  }
  if (a.metodo !== 'POST' || !cuerpo) return

  // Insert en una tabla: la fila nueva aparece en las listas de esa tabla que calzan con sus filtros
  if (!tabla.startsWith('rpc/')) {
    if (tablaLectura !== tabla || !Array.isArray(json)) return
    const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo]
    filas.filter((f) => Object.entries(eq).every(([k, v]) => String(f[k]) === v) && !json.some((o) => o?.id === f.id))
      .forEach((f) => json.push({ ...f }))
    return
  }

  const fn = tabla.slice(4)
  const yo = usuarioDeToken(a.headers)
  if (fn === 'registrar_pago') {
    let resto = Number(cuerpo.p_monto) || 0
    const candidatas: any[] = []
    recorrer(json, (o) => {
      if (!('saldo_pendiente' in o) || o.estado_pago === 'anulada' || Number(o.saldo_pendiente) <= 0) return
      const delCliente = cuerpo.p_cliente_id && (o.cliente_id === cuerpo.p_cliente_id || (tablaLectura === 'ventas_pedidos' && eq.cliente_id === cuerpo.p_cliente_id))
      if ((cuerpo.p_venta_id && o.id === cuerpo.p_venta_id) || (!cuerpo.p_venta_id && delCliente)) candidatas.push(o)
    })
    candidatas.sort((x, y) => String(x.fecha_venta ?? '').localeCompare(String(y.fecha_venta ?? '')))
    for (const v of candidatas) {
      if (resto <= 0) break
      const parte = Math.min(resto, Number(v.saldo_pendiente))
      v.saldo_pendiente = Number(v.saldo_pendiente) - parte
      if (v.saldo_pendiente <= 0) v.estado_pago = 'pagada'
      if (Array.isArray(v.pagos)) v.pagos.push({ id: `${a.id}-${v.id}`, monto_abonado: parte, metodo_pago: cuerpo.p_metodo, fecha_pago: a.creado_en, creado_en: a.creado_en, cobrador_id: yo })
      resto -= parte
    }
    return
  }
  if (fn === 'registrar_venta') {
    // Stock del furgón rebajado
    for (const it of cuerpo.p_items || []) {
      recorrer(json, (o) => {
        if (o.ubicacion_id === cuerpo.p_ubicacion && o.producto_id === it.producto_id && 'cantidad' in o && !('venta_pedido_id' in o)) o.cantidad = Number(o.cantidad) - Number(it.cantidad)
      })
    }
    // La compra aparece en la deuda del cliente
    const total = Number(cuerpo._total) || 0
    const saldo = cuerpo.p_contado ? 0 : Math.max(total - (Number(cuerpo.p_pie) || 0), 0)
    if (tablaLectura === 'ventas_pedidos' && Array.isArray(json) && (!eq.cliente_id || eq.cliente_id === cuerpo.p_cliente)
        && !json.some((o) => o?.id === a.id)) {
      if (saldo > 0 || !url.includes('saldo_pendiente=gt.')) {
        json.unshift({ id: a.id, cliente_id: cuerpo.p_cliente, monto_total: total, saldo_pendiente: saldo, estado_pago: saldo > 0 ? 'pendiente' : 'pagada',
          descripcion: cuerpo._descripcion ?? 'Venta (por subir)', fecha_venta: a.creado_en, pagos: [] })
      }
    }
    return
  }
  if (fn === 'reordenar_mi_ruta') {
    const orden: string[] = cuerpo.p_orden || []
    recorrer(json, (o) => { const i = orden.indexOf(o.id); if (i >= 0 && 'orden' in o) o.orden = i + 1 })
    if (Array.isArray(json) && tablaLectura === 'ruta_paradas') json.sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0))
    return
  }
  if (fn === 'iniciar_mi_ruta') {
    if (tablaLectura !== 'jornada_vendedores' || !Array.isArray(json)) return
    const fila = json.find((o) => o.jornada_id === cuerpo.p_jornada && o.vendedor_id === yo)
    if (fila) fila.estado = 'en_curso'
    else json.push({ jornada_id: cuerpo.p_jornada, vendedor_id: yo, estado: 'en_curso', iniciada_en: a.creado_en })
    return
  }
  if (fn === 'registrar_cliente') {
    if (tablaLectura !== 'clientes' || !Array.isArray(json) || json.some((o) => o?.id === cuerpo.p_id)) return
    json.push({ id: cuerpo.p_id, nombre: cuerpo.p_nombre, rut: cuerpo.p_rut, telefono: cuerpo.p_telefono, direccion: cuerpo.p_texto_direccion, direccion_id: null })
    json.sort((x, y) => String(x.nombre ?? '').localeCompare(String(y.nombre ?? ''), 'es'))
  }
}

// Aplica a una lectura todas las acciones que aún no se suben (en orden)
export const aplicarPendientes = (url: string, cuerpo: string): string => {
  const pendientes = cola.filter((a) => a.estado === 'pendiente')
  if (!pendientes.length || !cuerpo) return cuerpo
  try {
    let json = JSON.parse(cuerpo)
    for (const a of pendientes) {
      try { const r = aplicarUna(a, url, json); if (r !== undefined) json = r } catch {}
    }
    return JSON.stringify(json)
  } catch { return cuerpo }
}

// Texto corto para la lista de pendientes
export const describir = (metodo: string, url: string, cuerpo: any): string => {
  const t = tablaDe(url)
  if (t === 'rpc/registrar_pago') return `Pago de $${Math.round(Number(cuerpo?.p_monto) || 0).toLocaleString('es-CL')}`
  if (t === 'rpc/registrar_venta') return cuerpo?._descripcion ? `Venta: ${cuerpo._descripcion}` : 'Venta'
  if (t === 'rpc/registrar_cliente') return `Cliente nuevo: ${cuerpo?.p_nombre ?? ''}`
  if (t === 'rpc/reordenar_mi_ruta') return 'Orden de la ruta'
  if (t === 'rpc/iniciar_mi_ruta') return 'Comenzar ruta'
  if (t === 'rpc/set_ubicacion_direccion') return 'Ubicación de una casa'
  if (t === 'ruta_paradas' && metodo === 'PATCH') return cuerpo?.estado === 'visitado' ? 'Visita: Estaba' : cuerpo?.estado === 'no_estaba' ? 'Visita: No estaba' : 'Visita: pendiente'
  if (t === 'solicitudes_correccion') return 'Solicitud de corrección'
  if (t === 'solicitudes_descuento') return 'Solicitud de descuento'
  if (t === 'notificaciones') return 'Notificación leída'
  return `${metodo === 'POST' ? 'Guardar' : metodo === 'PATCH' ? 'Cambiar' : 'Borrar'} en ${t}`
}
