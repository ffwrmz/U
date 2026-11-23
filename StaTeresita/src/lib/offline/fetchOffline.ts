// fetch que usa el cliente de Supabase: guarda lecturas, responde sin señal con lo guardado
// y pone en la cola (en orden) las acciones que no se pueden enviar. Ver cola.ts.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Accion, agregarAccion, aplicarPendientes, actualizarAccion, cargarCola, describir, guardarEnCache, leerDeCache, quitarAccion, usuarioDeToken, uuid, verCola } from './cola'
import { hayConexion, marcarConConexion, marcarSinConexion } from './red'

// Funciones de Supabase que se pueden guardar para después (las demás necesitan señal)
const RPC_EN_COLA = new Set(['registrar_pago', 'registrar_venta', 'registrar_cliente', 'reordenar_mi_ruta', 'iniciar_mi_ruta', 'set_ubicacion_direccion'])
// Se envían una sola vez aunque la respuesta se pierda (ejecutar_accion_offline guarda el id de la acción)
const RPC_IDEMPOTENTES = new Set(['registrar_pago', 'registrar_venta', 'registrar_cliente'])
// Sin señal se descartan (no tiene sentido subirlas tarde)
const TABLAS_DESCARTABLES = new Set(['posiciones_vendedor'])

const fetchReal: typeof fetch = (...args) => globalThis.fetch(...args)

const aObjeto = (h: HeadersInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!h) return out
  if (typeof (h as any).forEach === 'function' && !(Array.isArray(h))) (h as Headers).forEach((v, k) => { out[k] = v })
  else if (Array.isArray(h)) h.forEach(([k, v]) => { out[k] = v })
  else Object.assign(out, h)
  return out
}
const encabezado = (h: Record<string, string>, k: string) => h[k] ?? h[k.toLowerCase()] ?? Object.entries(h).find(([x]) => x.toLowerCase() === k.toLowerCase())?.[1]

const esErrorDeRed = (e: any) => e?.name === 'AbortError' || e instanceof TypeError || /network|fetch|internet|timed out/i.test(String(e?.message ?? e))

const respuesta = (cuerpo: string, status: number, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : cuerpo, { status, headers: { 'Content-Type': 'application/json', ...headers } })

// ---------- Sesión actual (para reenviar con el token vigente) ----------
let claveSesion: string | null = null
export const configurarClaveSesion = (supabaseUrl: string) => {
  try { claveSesion = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` } catch {}
}
const tokenActual = async () => {
  try { const t = claveSesion && (await AsyncStorage.getItem(claveSesion)); return t ? (JSON.parse(t).access_token as string) : null } catch { return null }
}

// ---------- Enviar una acción ----------
type Resultado = { tipo: 'ok'; res: Response } | { tipo: 'red' } | { tipo: 'espera' } | { tipo: 'error'; res: Response; mensaje: string }

const enviar = async (a: Accion): Promise<Resultado> => {
  const token = await tokenActual()
  const headers = { ...a.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  // Si ahora hay otra persona con la sesión abierta, se espera a que vuelva quien la hizo
  if (a.usuario && usuarioDeToken(headers) !== a.usuario) return { tipo: 'espera' }
  const tabla = a.url.split('/rest/v1/')[1]?.split('?')[0] ?? ''
  const fn = tabla.startsWith('rpc/') ? tabla.slice(4) : null
  let url = a.url
  let cuerpo = a.cuerpo
  if (fn && cuerpo) {
    // Los campos que empiezan con "_" son solo para la app (ej. el total estimado de una venta)
    const args = Object.fromEntries(Object.entries(JSON.parse(cuerpo)).filter(([k]) => !k.startsWith('_')))
    cuerpo = JSON.stringify(args)
    if (RPC_IDEMPOTENTES.has(fn)) {
      url = a.url.replace(`/rpc/${fn}`, '/rpc/ejecutar_accion_offline')
      cuerpo = JSON.stringify({ p_id: a.id, p_tipo: fn, p_args: args })
    }
  }
  let res: Response
  try {
    res = await fetchReal(url, { method: a.metodo, headers, body: cuerpo ?? undefined })
  } catch (e) {
    if (esErrorDeRed(e)) return { tipo: 'red' }
    throw e
  }
  marcarConConexion()
  const texto = await res.text()
  const copia = respuesta(texto, res.status, { 'Content-Type': res.headers.get('content-type') ?? 'application/json', ...(res.headers.get('content-range') ? { 'Content-Range': res.headers.get('content-range')! } : {}) })
  if (res.ok) return { tipo: 'ok', res: copia }
  let mensaje = texto
  try { const j = JSON.parse(texto); mensaje = j.message ?? texto
    // Aún no se corrió el SQL de modo sin conexión: se envía la función original
    if (url !== a.url && (j.code === 'PGRST202' || /ejecutar_accion_offline/.test(j.message ?? ''))) {
      return enviar({ ...a, url: a.url, cuerpo: a.cuerpo && JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(a.cuerpo)).filter(([k]) => !k.startsWith('_')))), headers: a.headers, tipo: a.tipo + '#directo' })
    }
    // Ya estaba guardada (se reintentó una inserción que sí había llegado)
    if (j.code === '23505' && !fn && a.metodo === 'POST') return { tipo: 'ok', res: respuesta('[]', 201) }
  } catch {}
  // Sesión vencida o servidor caído: se reintenta más tarde, no es culpa de la acción
  if (res.status === 401 || res.status >= 502) return { tipo: 'espera' }
  return { tipo: 'error', res: copia, mensaje }
}

// ---------- Sincronizar (de a una, en orden) ----------
let sincronizando: Promise<void> | null = null
const resultados = new Map<string, Resultado>()
const oyentesSync = new Set<(s: boolean) => void>()
export const escucharSincronizando = (f: (s: boolean) => void) => { oyentesSync.add(f); return () => { oyentesSync.delete(f) } }
export const estaSincronizando = () => !!sincronizando

export const sincronizar = (): Promise<void> => {
  if (sincronizando) return sincronizando
  sincronizando = (async () => {
    oyentesSync.forEach((f) => f(true))
    try {
      await cargarCola()
      for (const a of verCola()) {
        if (a.estado !== 'pendiente') continue
        let r: Resultado
        try { r = await enviar(a) } catch (e: any) { r = { tipo: 'error', res: respuesta('{}', 500), mensaje: e?.message ?? String(e) } }
        resultados.set(a.id, r)
        if (r.tipo === 'red') { marcarSinConexion(); break }
        if (r.tipo === 'espera') break
        if (r.tipo === 'ok') await quitarAccion(a.id)
        else await actualizarAccion(a.id, { estado: 'fallida', error: r.mensaje, intentos: a.intentos + 1 })
      }
    } finally {
      sincronizando = null
      oyentesSync.forEach((f) => f(false))
    }
  })()
  return sincronizando
}

// ---------- El fetch ----------
export const crearFetchOffline = (supabaseUrl: string): typeof fetch => async (input, init) => {
  const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
  const metodo = (init?.method ?? (input as Request).method ?? 'GET').toUpperCase()
  if (!url.startsWith(supabaseUrl)) return fetchReal(input as any, init)
  const esRest = url.includes('/rest/v1/')
  const esAuthUsuario = url.includes('/auth/v1/user') && metodo === 'GET'
  if (!esRest && !esAuthUsuario) return fetchReal(input as any, init)
  await cargarCola()
  const headers = aObjeto(init?.headers)

  // ---- Lecturas ----
  if (metodo === 'GET' || metodo === 'HEAD') {
    const clave = [metodo, url, encabezado(headers, 'Accept'), encabezado(headers, 'Prefer'), encabezado(headers, 'Range')].join('|')
    const desdeCache = async () => {
      const c = await leerDeCache(clave)
      if (!c) return null
      return respuesta(aplicarPendientes(url, c.cuerpo), c.status, c.headers)
    }
    if (!hayConexion()) {
      const c = await desdeCache()
      if (c) return c
      // Sin nada guardado: se intenta igual (NetInfo a veces se equivoca)
    }
    try {
      const control = new AbortController()
      const t = setTimeout(() => control.abort(), 12000)
      init?.signal?.addEventListener?.('abort', () => control.abort())
      const res = await fetchReal(url, { ...init, signal: control.signal }).finally(() => clearTimeout(t))
      marcarConConexion()
      if (!res.ok) return res
      const texto = await res.text()
      const h: Record<string, string> = { 'Content-Type': res.headers.get('content-type') ?? 'application/json' }
      const cr = res.headers.get('content-range'); if (cr) h['Content-Range'] = cr
      guardarEnCache(clave, { status: res.status, headers: h, cuerpo: texto })
      return respuesta(esRest ? aplicarPendientes(url, texto) : texto, res.status, h)
    } catch (e) {
      if (!esErrorDeRed(e)) throw e
      marcarSinConexion()
      const c = await desdeCache()
      if (c) return c
      throw e
    }
  }

  // ---- Escrituras ----
  const tabla = url.split('/rest/v1/')[1]?.split('?')[0] ?? ''
  const fn = tabla.startsWith('rpc/') ? tabla.slice(4) : null
  // Funciones que solo sirven con señal (ej. resolver una corrección): se envían directo
  if (fn && !RPC_EN_COLA.has(fn)) return fetchReal(input as any, init)
  let cuerpoTexto = typeof init?.body === 'string' ? init.body : null
  if (TABLAS_DESCARTABLES.has(tabla) && (!hayConexion() || verCola().some((a) => a.estado === 'pendiente'))) return respuesta('', 201)

  // Las filas nuevas llevan su id desde el teléfono (para que reintentar no duplique)
  let cuerpo: any = null
  try { cuerpo = cuerpoTexto ? JSON.parse(cuerpoTexto) : null } catch {}
  if (!fn && metodo === 'POST' && cuerpo) {
    const conId = (f: any) => (f && typeof f === 'object' && !f.id ? { ...f, id: uuid() } : f)
    cuerpo = Array.isArray(cuerpo) ? cuerpo.map(conId) : conId(cuerpo)
    cuerpoTexto = JSON.stringify(cuerpo)
  }
  const usuario = usuarioDeToken(headers)
  const sinAuth = { ...headers }
  delete sinAuth.Authorization; delete sinAuth.authorization
  const accion: Accion = {
    id: uuid(), tipo: fn ? `rpc/${fn}` : `${metodo} ${tabla}`, descripcion: describir(metodo, url, cuerpo),
    url, metodo, headers: sinAuth, cuerpo: cuerpoTexto, creado_en: new Date().toISOString(), intentos: 0, estado: 'pendiente', usuario,
  }
  await agregarAccion(accion)

  // Con señal y nada esperando antes: se envía ahora y se devuelve la respuesta real
  if (hayConexion()) {
    // Si ya había una sincronización andando (que no incluía esta acción), se corre otra vez
    await sincronizar()
    if (!resultados.has(accion.id) && hayConexion() && verCola().some((x) => x.id === accion.id && x.estado === 'pendiente')) await sincronizar()
    const r = resultados.get(accion.id)
    resultados.delete(accion.id)
    if (r?.tipo === 'ok') return r.res
    if (r?.tipo === 'error') {
      await quitarAccion(accion.id) // el usuario ve el error ahora, igual que antes
      return r.res
    }
  }
  // Sin señal: queda guardada; la app sigue como si se hubiera hecho
  const prefer = encabezado(headers, 'Prefer') ?? ''
  if (fn) return respuesta('null', 200)
  if (metodo === 'DELETE') return respuesta('', 204)
  if (/return=representation/.test(prefer)) {
    const filas = Array.isArray(cuerpo) ? cuerpo : cuerpo ? [cuerpo] : []
    const objeto = /vnd\.pgrst\.object/.test(encabezado(headers, 'Accept') ?? '')
    return respuesta(JSON.stringify(objeto ? filas[0] ?? null : filas), metodo === 'POST' ? 201 : 200)
  }
  return respuesta('', metodo === 'POST' ? 201 : 204)
}
