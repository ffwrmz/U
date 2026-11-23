import DireccionCliente from '@/components/DireccionCliente'
import Header from '@/components/Header'
import MapaClientes from '@/components/MapaClientes'
import type { UbicacionMapa } from '@/components/mapaClientes.types'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { clp, fechaCorta } from '@/lib/format'
import { abrirComoLlegar, distanciaMetros, obtenerMiUbicacion, registrarPosicion, ordenPorCalles, Punto, puntoDe, rutaPorCalles, RutaCalles, rutaSugerida, seguirMiUbicacion, textoDistancia, textoDuracion, ubicacionesDeParadas } from '@/lib/mapa'
import { cambiarEstadoJornada, esCaseroPrincipal, EstadoParada, EstadosCaseros, estadoRutaDe, iniciarMiRuta, listarEstadosCaseros, ordenarCaseros, Jornada, lineaDireccion, listarParadas, marcarParada, moverParada, reordenarParadas, obtenerOCrearJornadaHoy, Parada, textoEstadoJornada } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { abrirWhatsApp, tieneWhatsapp } from '@/lib/whatsapp'
import { Ionicons, MaterialIcons } from '@expo/vector-icons'
import { CeldaArrastrable, ProveedorArrastre, useArrastre } from '@/components/ruta/useArrastre'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, FlatList, LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const ESTADO = {
  pendiente: { texto: 'Pendiente', fondo: Palette.grayPill, color: Palette.textMuted },
  visitado: { texto: 'Estaba', fondo: Palette.greenSoft, color: Palette.green },
  no_estaba: { texto: 'No estaba', fondo: Palette.amberSoft, color: Palette.orange },
} as const
// Colores de los números en el mapa según el estado de la visita
const COLORES_MAPA = { pendiente: Palette.navy, visitado: Palette.green, no_estaba: Palette.orange }

const hora = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

interface PagoCuota { monto_abonado: number; metodo_pago: string | null; fecha_pago: string | null; creado_en: string | null }
interface VentaCuota { id: string; monto_total: number; saldo_pendiente: number; descripcion: string | null; fecha_venta: string | null; pagos: PagoCuota[] }
interface Cuotas { deuda: number; ventas: VentaCuota[]; pagos: (PagoCuota & { venta: string })[] }

// Deuda, compras con saldo y últimos pagos de un cliente (ventas_pedidos + pagos)
const leerCuotas = async (clienteId: string): Promise<Cuotas> => {
  const { data, error } = await supabase.from('ventas_pedidos')
    .select('id, monto_total, saldo_pendiente, descripcion, fecha_venta, pagos ( monto_abonado, metodo_pago, fecha_pago, creado_en )')
    .eq('cliente_id', clienteId).neq('estado_pago', 'anulada')
    .order('fecha_venta', { ascending: false })
  if (error) throw error
  const ventas = ((data as any[]) || []) as VentaCuota[]
  const fechaPago = (p: PagoCuota) => p.fecha_pago ?? p.creado_en ?? ''
  return {
    deuda: ventas.reduce((n, v) => n + Number(v.saldo_pendiente), 0),
    ventas: ventas.filter((v) => Number(v.saldo_pendiente) > 0),
    pagos: ventas.flatMap((v) => (v.pagos || []).map((p) => ({ ...p, venta: v.descripcion ?? 'Compra' })))
      .sort((a, b) => fechaPago(b).localeCompare(fechaPago(a))).slice(0, 5),
  }
}

interface Casero { id: string; nombre: string }

// Pantalla de ruta con dos modos:
//  - 'organizar' (jornada en preparación): mapa, orden de la ruta (sugerido desde mi ubicación, subir/bajar)
//    e información del cliente solo para ver. Termina con "Terminar organización y comenzar ruta".
//  - 'recorrido' (jornada en curso): lo mismo más los botones para trabajar (Estaba / No estaba / Vender / Cobrar).
// El casero ve su ruta; el gerente puede elegir de quién. Se usa en app/organizar-ruta.tsx y app/ruta-en-curso.tsx.
export type ModoRuta = 'organizar' | 'recorrido'

const PantallaRuta = ({ modo }: { modo: ModoRuta }) => {
  const organizando = modo === 'organizar'
  const router = useRouter()
  // ?editar=1: reorganizar la ruta propia aunque ya esté en curso (las visitas ya marcadas quedan fijas arriba)
  const { editar } = useLocalSearchParams<{ editar?: string }>()
  const reorganizando = organizando && editar === '1'
  const { height } = useWindowDimensions()
  const lista = useRef<FlatList<Parada>>(null)

  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [estados, setEstados] = useState<EstadosCaseros>({})
  const [todas, setTodas] = useState<Parada[]>([])
  const [yo, setYo] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [caseros, setCaseros] = useState<Casero[]>([])
  const [verDe, setVerDe] = useState<string | null>(null) // casero cuya ruta se muestra
  const [seleccion, setSeleccion] = useState<string | null>(null) // id de la parada seleccionada
  const [marcando, setMarcando] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null) // parada con las cuotas desplegadas
  const [cuotas, setCuotas] = useState<Record<string, Cuotas | 'cargando' | { error: string }>>({})
  // Mi ubicación y ruta sugerida desde ella
  const [miUbicacion, setMiUbicacion] = useState<Punto | null>(null)
  const [ubicacionEstado, setUbicacionEstado] = useState<'buscando' | 'ok' | 'sin_permiso'>('buscando')
  const [ordenVista, setOrdenVista] = useState<'ruta' | 'sugerida'>('ruta')
  const [guardandoOrden, setGuardandoOrden] = useState(false)
  // Camino por calles (OSRM) y orden sugerido en auto
  const [camino, setCamino] = useState<RutaCalles | null>(null)
  const [sinServicio, setSinServicio] = useState(false)
  const [ordenAuto, setOrdenAuto] = useState<number[] | null>(null)

  const actualizarUbicacion = useCallback(async () => {
    setUbicacionEstado('buscando')
    const p = await obtenerMiUbicacion()
    setMiUbicacion(p)
    setUbicacionEstado(p ? 'ok' : 'sin_permiso')
    return p
  }, [])

  // Al abrir: pide la ubicación y la sigue mientras la pantalla está abierta (cada ~30 s o 50 m)
  useEffect(() => {
    let dejar: (() => void) | null = null
    let activo = true
    actualizarUbicacion().then(async (p) => {
      if (!p || !activo) return
      // Mientras se simula la ubicación, el GPS no la reemplaza
      const fn = await seguirMiUbicacion((q) => setMiUbicacion(q))
      if (activo) dejar = fn; else fn()
    })
    return () => { activo = false; dejar?.() }
  }, [actualizarUbicacion])

  const cargar = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No hay sesión activa')
      setYo(user.id)
      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
      const gerente = esGerente(perfil?.rol)
      setSoyGerente(gerente)
      const j = await obtenerOCrearJornadaHoy(false)
      // Cada modo corresponde a un estado de la jornada: si no calza, se va a la pantalla que corresponde
      // Estado de la ruta de cada casero (cada uno puede comenzar la suya)
      const est = j ? await listarEstadosCaseros(j.id) : {}
      const miEstado = estadoRutaDe(j, est, user.id)
      if (organizando && miEstado === 'en_curso' && !reorganizando) { router.replace('/ruta-en-curso' as any); return }
      if (!organizando && miEstado === 'preparacion') { router.replace('/organizar-ruta' as any); return }
      setEstados(est)
      setJornada(j)
      const ps = j ? await listarParadas(j.id, gerente ? undefined : user.id) : []
      setTodas(ps)
      if (gerente) {
        const ids = Array.from(new Set(ps.map((p) => p.vendedor_id)))
        const { data: pe } = ids.length ? await supabase.from('perfiles').select('id, nombre').in('id', ids) : { data: [] }
        const lista = ordenarCaseros((pe as Casero[]) || [])
        setCaseros(lista)
        // Por defecto la ruta de Gonzalo; si no está, la propia del gerente; si no, la del primer casero
        const gonzalo = lista.find((c) => esCaseroPrincipal(c.nombre))?.id
        setVerDe((actual) => actual && ids.includes(actual) ? actual : gonzalo ?? (ids.includes(user.id) ? user.id : lista[0]?.id ?? null))
      } else {
        setVerDe(user.id)
      }
      setError(null)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
      setRefrescando(false)
    }
  }, [organizando, reorganizando, router])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const enOrden = todas.filter((p) => p.vendedor_id === verDe).sort((a, b) => a.orden - b.orden)
  // Distancia aproximada (línea recta) desde mi ubicación a cada parada con coordenadas
  const distancia = (p: Parada) => {
    const q = puntoDe(p.cliente)
    return miUbicacion && q ? distanciaMetros(miUbicacion, q) : null
  }
  // Ruta sugerida: las pendientes con ubicación, ordenadas para recorrerlas desde donde estoy.
  // Si el servicio de rutas (OSRM) responde, se usa su orden por calles; si no, el cálculo en línea recta.
  const pendientesConPunto = enOrden.filter((p) => p.estado === 'pendiente' && puntoDe(p.cliente))
  const sugeridaRecta = miUbicacion ? rutaSugerida(miUbicacion, pendientesConPunto.map((p) => puntoDe(p.cliente) as Punto)) : null
  const ordenAutoValido = ordenAuto && ordenAuto.length === pendientesConPunto.length ? ordenAuto : null
  const sugerida = sugeridaRecta && ordenAutoValido && miUbicacion ? (() => {
    // Con el orden por calles, los tramos en línea recta se recalculan para ese orden (respaldo si falta el camino)
    const pts = ordenAutoValido.map((i) => puntoDe(pendientesConPunto[i].cliente) as Punto)
    const tramos = pts.map((q, k) => distanciaMetros(k === 0 ? miUbicacion : pts[k - 1], q))
    return { orden: ordenAutoValido, tramos, total: tramos.reduce((n, x) => n + x, 0) }
  })() : sugeridaRecta
  const sugeridas = sugerida ? sugerida.orden.map((i) => pendientesConPunto[i]) : []
  const tramoDe: Record<string, number> = {}
  sugeridas.forEach((p, k) => { tramoDe[p.id] = sugerida!.tramos[k] })
  const pendientesSinPunto = enOrden.filter((p) => p.estado === 'pendiente' && !puntoDe(p.cliente))
  const yaMarcadas = enOrden.filter((p) => p.estado !== 'pendiente')
  const enSugerida = ordenVista === 'sugerida' && !!sugerida
  // En "Ruta sugerida" la lista y el mapa siguen ese orden (solo la vista, hasta apretar "Usar este orden")
  // En Ruta en curso la lista se reordena según la visita: arriba los que "No estaba" (para volver a pasar
  // al terminar), al medio los pendientes en el orden de la ruta y al final los que "Estaba".
  const porHora = (a: Parada, b: Parada) => (a.visitado_en ?? '').localeCompare(b.visitado_en ?? '')
  const paradas = enSugerida ? [...sugeridas, ...pendientesSinPunto, ...yaMarcadas]
    : organizando ? enOrden
    : [
      ...enOrden.filter((x) => x.estado === 'no_estaba').sort(porHora),
      ...enOrden.filter((x) => x.estado === 'pendiente'),
      ...enOrden.filter((x) => x.estado === 'visitado').sort(porHora),
    ]
  const paradasRef = useRef(paradas)
  paradasRef.current = paradas
  const numeroDe = (p: Parada) => paradas.findIndex((x) => x.id === p.id) + 1
  // Seguimiento: con mi ruta en curso, cada nueva lectura del GPS (cada ~30 s o 50 m, solo con la app abierta)
  // se guarda en posiciones_vendedor para que el gerente vea mi recorrido. Si falla, no se avisa.
  useEffect(() => {
    if (organizando || !miUbicacion || !jornada || !yo) return
    if (estadoRutaDe(jornada, estados, yo) !== 'en_curso') return
    if (!todas.some((p) => p.vendedor_id === yo)) return
    registrarPosicion(jornada.id, yo, miUbicacion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miUbicacion])

  // Estado de la ruta que se está viendo (la jornada, o el casero si la comenzó él)
  const estado = estadoRutaDe(jornada, estados, verDe)
  const esMia = verDe === yo
  // Marca el casero en su propia ruta, o el gerente en cualquiera; solo con la jornada en curso
  // Solo se marca, vende y cobra en la ruta propia; el gerente ve las de los caseros en modo solo lectura
  const puedeMarcar = !organizando && estado === 'en_curso' && esMia
  const hechas = paradas.filter((p) => p.estado !== 'pendiente').length
  const visitadas = paradas.filter((p) => p.estado === 'visitado').length

  // En modo sugerido el mapa muestra solo lo que falta, en el orden sugerido
  const enMapa = enSugerida ? [...sugeridas, ...pendientesSinPunto] : enOrden
  const ubicaciones = ubicacionesDeParadas(enMapa.map((p) => ({ cliente: p.cliente, estado: p.estado })), COLORES_MAPA)
  const ubicacionDe = (p: Parada) => ubicaciones.find((u) => u.clientes.some((c) => c.id === p.cliente_id))?.id ?? null

  // Camino en auto desde mi ubicación por las paradas pendientes, en el orden que se muestra.
  // La ubicación se redondea (~200 m) para no consultar de nuevo con cada actualización del GPS.
  // Camino: pendientes en el orden que se muestra y, en Ruta en curso, al final los "No estaba" (para volver a pasar)
  const pendientesEnVista = [
    ...paradas.filter((p) => p.estado === 'pendiente' && puntoDe(p.cliente)),
    ...(organizando ? [] : enOrden.filter((p) => p.estado === 'no_estaba' && puntoDe(p.cliente))),
  ]
  const redondear = (q: Punto) => ({ latitud: Math.round(q.latitud * 500) / 500, longitud: Math.round(q.longitud * 500) / 500 })
  const inicioLinea = miUbicacion ? redondear(miUbicacion) : null
  const puntosLinea = [...(inicioLinea ? [inicioLinea] : []), ...pendientesEnVista.map((p) => puntoDe(p.cliente) as Punto)]
  const claveLinea = puntosLinea.map((q) => `${q.latitud.toFixed(5)},${q.longitud.toFixed(5)}`).join(';')
  useEffect(() => {
    let vigente = true
    if (puntosLinea.length < 2) { setCamino(null); setSinServicio(false); return }
    rutaPorCalles(puntosLinea).then((r) => {
      if (!vigente) return
      setCamino(r)
      setSinServicio(!r)
    })
    return () => { vigente = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveLinea])
  // Tramo en auto que llega a cada parada pendiente (desde la anterior o desde mi ubicación)
  const tramoAuto: Record<string, { distancia: number; duracion: number }> = {}
  if (camino) pendientesEnVista.forEach((p, k) => {
    const t = camino.tramos[inicioLinea ? k : k - 1]
    if (t) tramoAuto[p.id] = t
  })

  // Orden sugerido por calles (solo al ver la ruta sugerida)
  const clavePendientes = pendientesConPunto.map((p) => p.id).join(',')
  const claveInicio = inicioLinea ? `${inicioLinea.latitud},${inicioLinea.longitud}` : ''
  useEffect(() => {
    let vigente = true
    setOrdenAuto(null)
    if (ordenVista !== 'sugerida' || !inicioLinea || pendientesConPunto.length < 2) return
    ordenPorCalles(inicioLinea, pendientesConPunto.map((p) => puntoDe(p.cliente) as Punto)).then((o) => { if (vigente) setOrdenAuto(o) })
    return () => { vigente = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenVista, clavePendientes, claveInicio])
  const paradaSel = paradas.find((p) => p.id === seleccion)

  const seleccionar = (p: Parada, desdeMapa: boolean) => {
    setSeleccion(p.id)
    if (desdeMapa) {
      const i = paradasRef.current.findIndex((x) => x.id === p.id)
      if (i >= 0) lista.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0 })
    }
  }
  const tocarPunto = (u: UbicacionMapa) => {
    const p = paradas.find((x) => u.clientes.some((c) => c.id === x.cliente_id))
    if (p) seleccionar(p, true)
  }

  // Etiquetas "Orden de la ruta" / "Ruta sugerida desde mi ubicación": al elegir la sugerida se aplica y se guarda
  // al tiro (sin preguntar), recordando el orden anterior; al volver a "Orden de la ruta" se restaura ese orden.
  const puedeReordenar = (esMia || soyGerente) && estado !== 'finalizada'
  const ordenAnterior = useRef<string[] | null>(null)
  const guardarOrden = async (ids: string[]) => {
    setTodas((l) => l.map((x) => (ids.includes(x.id) ? { ...x, orden: ids.indexOf(x.id) + 1 } : x)))
    setGuardandoOrden(true)
    try { await reordenarParadas(ids, jornada?.id) } catch (e: any) { Alert.alert('Error', e.message ?? String(e)); cargar() }
    finally { setGuardandoOrden(false) }
  }
  const elegirOrden = (k: 'ruta' | 'sugerida') => {
    if (k === ordenVista) return
    setOrdenVista(k)
    if (!puedeReordenar) return // viendo la ruta de otro casero: solo cambia la vista
    if (k === 'sugerida' && sugerida) {
      ordenAnterior.current = enOrden.map((p) => p.id)
      guardarOrden([...yaMarcadas, ...sugeridas, ...pendientesSinPunto].map((p) => p.id))
    } else if (k === 'ruta' && ordenAnterior.current) {
      const previo = ordenAnterior.current.filter((id) => enOrden.some((p) => p.id === id))
      ordenAnterior.current = null
      guardarOrden(previo)
    }
  }

  // Organizar: subir / bajar paradas (antes de iniciar la ruta)
  const editable = !!estado && estado !== 'finalizada'
  const puedeMover = organizando && editable && (esMia || soyGerente) && !enSugerida
  const mover = async (p: Parada, delta: -1 | 1) => {
    setMarcando(p.id)
    try {
      await moverParada(enOrden, p.id, delta, jornada?.id)
      const i = enOrden.findIndex((x) => x.id === p.id)
      const otro = enOrden[i + delta]
      if (otro) setTodas((l) => l.map((x) => (x.id === p.id ? { ...x, orden: i + delta + 1 } : x.id === otro.id ? { ...x, orden: i + 1 } : x)))
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e))
    } finally {
      setMarcando(null)
    }
  }

  // Organizar: arrastrar un cliente con la manilla (debajo del número) para cambiar el orden.
  // Funciona también sobre la ruta sugerida; al soltar se guarda el orden y se vuelve a "Orden de la ruta".
  const puedeArrastrar = organizando && editable && (esMia || soyGerente)
  const soltar = async (desde: number, hacia: number) => {
    const nueva = [...paradas]
    const [movida] = nueva.splice(desde, 1)
    nueva.splice(hacia, 0, movida)
    // Las ya visitadas quedan fijas arriba; después las pendientes en el nuevo orden
    const ids = [...yaMarcadas, ...nueva.filter((x) => x.estado === 'pendiente')].map((x) => x.id)
    setTodas((l) => l.map((x) => (ids.includes(x.id) ? { ...x, orden: ids.indexOf(x.id) + 1 } : x)))
    setOrdenVista('ruta')
    ordenAnterior.current = null // el orden arrastrado a mano pasa a ser el de la ruta
    try {
      await reordenarParadas(ids, jornada?.id)
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e))
      cargar()
    }
  }
  // Separación entre tarjetas: más compacta al organizar (debe calzar con el gap de la lista)
  const GAP = organizando ? 6 : 10
  const arrastre = useArrastre(paradas.map((x) => x.id), soltar, GAP)

  // Terminar la organización: (si se está viendo la ruta sugerida, ofrece guardarla) y pasar a la ruta en curso.
  // Iniciar la jornada lo hace el gerente; el casero solo deja guardado el orden.
  const [terminando, setTerminando] = useState(false)
  const terminarOrganizacion = () => {
    if (!jornada) return
    const comenzar = async () => {
      setTerminando(true)
      try {
        if (soyGerente && !esMia) {
          await cambiarEstadoJornada(jornada.id, 'en_curso')
          router.replace('/ruta-en-curso' as any)
        } else {
          // El casero comienza su propia ruta (el orden ya se guardó al moverlo)
          await iniciarMiRuta(jornada.id)
          router.replace('/ruta-en-curso' as any)
        }
      } catch (e: any) {
        Alert.alert('Error', e.message ?? String(e))
      } finally {
        setTerminando(false)
      }
    }
    comenzar() // sin confirmación: se inicia al tiro
  }


  const destello = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aviso2, setAviso2] = useState<string | null>(null) // aviso breve, no bloqueante
  const avisar = (t: string) => { setAviso2(t); setTimeout(() => setAviso2((a) => (a === t ? null : a)), 4000) }

  const marcar = async (p: Parada, nuevo: EstadoParada) => {
    setMarcando(p.id)
    try {
      await marcarParada(p.id, nuevo)
      // Animación suave: la tarjeta se va arriba (No estaba) o al final (Estaba)
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      setTodas((l) => l.map((x) => (x.id === p.id ? { ...x, estado: nuevo, visitado_en: nuevo === 'pendiente' ? null : new Date().toISOString() } : x)))
      // Al marcar "Estaba", pasa al siguiente cliente pendiente: la lista baja hasta él, se destaca un momento
      // y el mapa se centra en su casa. Si no quedan pendientes, avisa "Ruta completada" (sin bloquear).
      if (nuevo !== 'pendiente') {
        if (abierta === p.id) setAbierta(null)
        // Siguiente pendiente en el orden de la ruta (después del marcado; si no hay, el primero que quede)
        const pend = enOrden.filter((x) => x.estado === 'pendiente' && x.id !== p.id)
        const iRuta = enOrden.findIndex((x) => x.id === p.id)
        const siguiente = pend.find((x) => enOrden.indexOf(x) > iRuta) ?? pend[0]
        // Si ya no hay pendientes, se pasa a los que "No estaba" para volver a visitarlos
        const volver = enOrden.filter((x) => x.estado === 'no_estaba' && x.id !== p.id)
        if (nuevo === 'no_estaba') volver.push(p)
        const destino = siguiente ?? (nuevo === 'visitado' ? volver[0] : undefined)
        if (destino) {
          // Se espera a que la lista se reordene (el marcado se va arriba o al final) antes de bajar hasta él
          setTimeout(() => seleccionar(destino, true), 80)
          if (destello.current) clearTimeout(destello.current)
          destello.current = setTimeout(() => setSeleccion((sel) => (sel === destino.id ? null : sel)), 1500)
        } else {
          setSeleccion(null)
        }
        if (!siguiente) {
          avisar(volver.length > 0
            ? `Quedan ${volver.length} ${volver.length === 1 ? 'casa' : 'casas'} por volver a visitar.`
            : 'Ruta completada: no quedan clientes pendientes.')
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e))
    } finally {
      setMarcando(null)
    }
  }

  const alternarCuotas = async (p: Parada) => {
    if (abierta === p.id) { setAbierta(null); return }
    setAbierta(p.id)
    setSeleccion(p.id)
    const id = p.cliente_id
    if (cuotas[id] && cuotas[id] !== 'cargando' && !('error' in (cuotas[id] as any))) return
    setCuotas((c) => ({ ...c, [id]: 'cargando' }))
    try {
      const r = await leerCuotas(id)
      setCuotas((c) => ({ ...c, [id]: r }))
    } catch (e: any) {
      setCuotas((c) => ({ ...c, [id]: { error: e.message ?? String(e) } }))
    }
  }

  const aviso =
    !jornada ? 'Hoy todavía no hay una ruta creada.'
    : organizando ? (soyGerente || esMia ? 'Revisa el orden y la información de cada cliente. Los cobros y ventas se hacen al comenzar la ruta.' : 'Estás viendo la ruta de otro casero.')
    : estado === 'preparacion' ? 'La ruta aún no se inicia. Podrás marcar las visitas cuando el gerente la inicie.'
    : estado === 'finalizada' ? 'La jornada de hoy terminó. Solo puedes ver cómo quedó.'
    : !esMia ? `Estás viendo la ruta de ${caseros.find((c) => c.id === verDe)?.nombre ?? 'otro casero'} (solo lectura).`
    : null

  const PanelCuotas = ({ p }: { p: Parada }) => {
    const c = cuotas[p.cliente_id]
    if (!c || c === 'cargando') return <ActivityIndicator size="small" color={Palette.navy} style={{ marginVertical: 8 }} />
    if ('error' in c) return <Text style={styles.cuotaError}>No se pudo cargar: {c.error}</Text>
    return (
      <View style={styles.cuotas}>
        <View style={styles.cuotaFila}>
          <Text style={styles.cuotaTitulo}>Deuda total</Text>
          <Text style={[styles.cuotaTotal, { color: c.deuda > 0 ? Palette.orange : Palette.green }]}>{c.deuda > 0 ? clp(c.deuda) : 'Al día'}</Text>
        </View>
        {c.ventas.length > 0 && (
          <>
            <Text style={styles.cuotaSub}>Compras con saldo</Text>
            {c.ventas.map((v) => (
              <View key={v.id} style={styles.cuotaFila}>
                <Text style={styles.cuotaTexto} numberOfLines={1}>{fechaCorta(v.fecha_venta)} · {v.descripcion || 'Compra'} ({clp(Number(v.monto_total))})</Text>
                <Text style={styles.cuotaMonto}>debe {clp(Number(v.saldo_pendiente))}</Text>
              </View>
            ))}
          </>
        )}
        <Text style={styles.cuotaSub}>Últimos pagos</Text>
        {c.pagos.length === 0 && <Text style={styles.cuotaTexto}>Todavía no tiene pagos.</Text>}
        {c.pagos.map((pg, i) => (
          <View key={i} style={styles.cuotaFila}>
            <Text style={styles.cuotaTexto} numberOfLines={1}>
              {fechaCorta(pg.fecha_pago ?? pg.creado_en)} · {pg.metodo_pago === 'transferencia' ? 'Transferencia' : 'Efectivo'}
            </Text>
            <Text style={styles.cuotaMonto}>{clp(Number(pg.monto_abonado))}</Text>
          </View>
        ))}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title={organizando ? 'Organizar ruta' : 'Ruta en curso'} subtitle={organizando ? 'Ordena las visitas antes de salir' : 'Marca cada visita, vende y cobra'} />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Gerente: elegir de quién es la ruta que se ve */}
          {soyGerente && caseros.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.caserosFila} contentContainerStyle={styles.caseros}>
              {caseros.map((c) => {
                const on = c.id === verDe
                return (
                  <Pressable key={c.id} style={[styles.chip, on && styles.chipActivo]} onPress={() => { setVerDe(c.id); setSeleccion(null); setAbierta(null) }}>
                    <Text style={[styles.chipText, on && { color: Palette.onNavy }]}>{c.id === yo ? 'Mi ruta' : c.nombre}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          )}

          {/* Mapa arriba */}
          {/* Mapa más bajo (máx. 220 px) y recortado para que no tape los botones de los caseros */}
          <View style={[styles.mapa, { height: Math.min(220, Math.round(height * 0.28)) }]}>
            <MapaClientes
              ubicaciones={ubicaciones}
              trazarRuta
              trazado={camino?.trazado}
              seleccionId={paradaSel ? ubicacionDe(paradaSel) : null}
              onPressUbicacion={tocarPunto}
              miUbicacion={miUbicacion}
            />
            {paradas.length > 0 && ubicaciones.length === 0 && (
              <View style={styles.mapaAviso}><Text style={styles.mapaAvisoText}>Estas direcciones aún no tienen ubicación en el mapa.</Text></View>
            )}
          </View>

          {/* Avance */}
          <View style={styles.avance}>
            <View style={styles.avanceFila}>
              <Text style={styles.avanceTexto}>{textoEstadoJornada(estado)} · {hechas} de {paradas.length} paradas</Text>
              {!organizando && <Text style={styles.avanceSub}>{visitadas} estaban · {hechas - visitadas} no estaban</Text>}
            </View>
            <View style={styles.avanceFila}>
              {camino ? (
                <Text style={styles.auto}>
                  <Ionicons name="car-outline" size={13} color={Palette.navy} /> {textoDistancia(camino.distancia)} · {textoDuracion(camino.duracion)} en auto
                  {inicioLinea ? ' desde tu ubicación' : ''}
                </Text>
              ) : sinServicio ? (
                <Text style={styles.avanceSub}>Sin conexión al servicio de rutas: se muestra línea recta y distancias aproximadas.</Text>
              ) : null}
            </View>
            {!organizando && esMia && estado === 'en_curso' && paradas.some((x) => x.estado === 'pendiente') && (
              <Pressable style={styles.reorganizar} onPress={() => router.push('/organizar-ruta?editar=1' as any)}>
                <MaterialIcons name="drag-indicator" size={16} color={Palette.navy} />
                <Text style={styles.reorganizarText}>Cambiar el orden de las visitas que faltan</Text>
              </Pressable>
            )}
            {!organizando && <View style={styles.track}><View style={[styles.fill, { width: `${paradas.length ? (hechas / paradas.length) * 100 : 0}%` }]} /></View>}
          </View>

          <ProveedorArrastre id={arrastre.arrastrandoId}>
          <FlatList
            ref={lista}
            data={paradas}
            scrollEnabled={!arrastre.arrastrando}
            // La fila que se arrastra se dibuja encima de las demás (componente fijo para no cortar el gesto)
            CellRendererComponent={CeldaArrastrable}
            keyExtractor={(p) => p.id}
            contentContainerStyle={[styles.content, { gap: GAP }]}
            onScrollToIndexFailed={(info) => setTimeout(() => lista.current?.scrollToIndex({ index: info.index, animated: true }), 300)}
            refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => { setRefrescando(true); setCuotas({}); cargar() }} tintColor={Palette.navy} />}
            ListHeaderComponent={
              <View style={{ gap: 8 }}>
                {error && <Text style={styles.error}>No se pudo cargar la ruta: {error}</Text>}
                {aviso2 && (
                  <View style={styles.completada}>
                    <Ionicons name="checkmark-circle" size={18} color={Palette.green} />
                    <Text style={styles.completadaText}>{aviso2}</Text>
                  </View>
                )}
                {/* Leyenda de colores de las tarjetas (Ruta en curso) */}
                {!organizando && paradas.length > 0 && (
                  <View style={styles.leyenda}>
                    {([['Pendiente', Palette.navy], ['Estaba', Palette.green], ['No estaba', Palette.orange]] as const).map(([t, color]) => (
                      <View key={t} style={styles.leyendaItem}>
                        <View style={[styles.leyendaPunto, { backgroundColor: color }]} />
                        <Text style={styles.leyendaText}>{t}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {aviso && !organizando && (
                  <View style={styles.avisoNavy}>
                    <Ionicons name="information-circle-outline" size={18} color={Palette.navy} />
                    <Text style={styles.avisoNavyText}>{aviso}</Text>
                  </View>
                )}

                {/* Orden de la lista (solo al organizar; en curso se sigue el orden guardado) */}
                {organizando && (
                <View style={styles.ordenFila}>
                  {([['ruta', 'Orden de la ruta'], ['sugerida', 'Ruta sugerida desde mi ubicación']] as const).map(([k, t]) => {
                    const sinUbicacion = k === 'sugerida' && !sugerida
                    return (
                      <Pressable key={k} style={[styles.chip, ordenVista === k && styles.chipActivo, sinUbicacion && { opacity: 0.5 }]}
                        disabled={sinUbicacion || guardandoOrden} onPress={() => elegirOrden(k)}>
                        <Text style={[styles.chipText, ordenVista === k && { color: Palette.cream }]}>
                          {sinUbicacion ? 'Ruta sugerida (activa la ubicación)' : t}
                        </Text>
                      </Pressable>
                    )
                  })}
                  {guardandoOrden && <ActivityIndicator size="small" color={Palette.navy} />}
                </View>
                )}
              </View>
            }
            ListEmptyComponent={!error && jornada ? <Text style={styles.vacio}>No hay clientes en esta ruta hoy.</Text> : undefined}
            renderItem={({ item: p }) => {
              const index = numeroDe(p) - 1
              // En la ruta sugerida se muestra el tramo desde la parada anterior; si no, la distancia desde mi ubicación
              const dist = p.estado !== 'pendiente' ? null : enSugerida ? (tramoDe[p.id] ?? null) : distancia(p)
              const auto = tramoAuto[p.id]
              const e = ESTADO[p.estado] ?? ESTADO.pendiente
              const c = p.cliente
              const sel = p.id === seleccion
              const ocupado = marcando === p.id
              return (
                <Animated.View onLayout={(e) => arrastre.setAltura(p.id, e.nativeEvent.layout.height)} style={arrastre.estiloDe(p.id)}>
                {/* Encabezado discreto al empezar cada grupo (Ruta en curso) */}
                {!organizando && (() => {
                  const i = paradas.findIndex((x) => x.id === p.id)
                  if (i > 0 && paradas[i - 1].estado === p.estado) return null
                  const t = p.estado === 'no_estaba' ? 'Volver a visitar' : p.estado === 'visitado' ? 'Visitados' : 'Pendientes'
                  return <Text style={styles.grupo}>{t}</Text>
                })()}
                <Pressable style={[styles.card, organizando && styles.cardCompacta,
                  // En Ruta en curso el estado se ve en el color de la tarjeta: verde = estaba, naranja = no estaba
                  !organizando && styles.cardPendiente,
                  !organizando && p.estado === 'visitado' && styles.cardVisitada,
                  !organizando && p.estado === 'no_estaba' && styles.cardNoEstaba,
                  sel && styles.cardSel, arrastre.arrastrandoId === p.id && styles.cardArrastrada]} onPress={() => seleccionar(p, false)}>
                  <View style={styles.cardTop}>
                    {/* Manilla para mover: solo al organizar (sin número de orden) */}
                    {organizando && (
                    <View style={[styles.numeroCol, styles.numeroColCompacta]}>
                      {/* Manilla para agarrar y mover al cliente */}
                      {puedeArrastrar && p.estado === 'pendiente' && (
                        <View {...arrastre.handlers(p.id)} hitSlop={10} style={[styles.manilla, organizando && styles.manillaCompacta]} accessibilityLabel="Mantén y arrastra para mover">
                          <MaterialIcons name="drag-indicator" size={organizando ? 22 : 26} color={Palette.navy} />
                        </View>
                      )}
                    </View>
                    )}
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={styles.nombreFila}>
                        <Text style={[styles.nombre, { flex: 1 }]} numberOfLines={1}>{c?.nombre ?? 'Cliente'}</Text>
                        {auto ? (
                          <Text style={styles.dist}>{textoDistancia(auto.distancia)} · {textoDuracion(auto.duracion)}</Text>
                        ) : dist != null ? (
                          <Text style={styles.dist}>{textoDistancia(dist)}</Text>
                        ) : null}
                      </View>
                      {c && <DireccionCliente c={c} compacta />}
                    </View>
                    {puedeMover && (
                      <View style={styles.flechas}>
                        <Pressable onPress={() => mover(p, -1)} disabled={!!marcando || index === 0} hitSlop={6}>
                          <Ionicons name="chevron-up" size={16} color={index === 0 ? Palette.border : Palette.textMuted} />
                        </Pressable>
                        <Pressable onPress={() => mover(p, 1)} disabled={!!marcando || index === enOrden.length - 1} hitSlop={6}>
                          <Ionicons name="chevron-down" size={16} color={index === enOrden.length - 1 ? Palette.border : Palette.textMuted} />
                        </Pressable>
                      </View>
                    )}
                    <View style={[styles.iconos, organizando && styles.iconosCompactos]}>
                      {organizando && c && (
                        <Pressable style={[styles.icono, styles.iconoCompacto, { backgroundColor: Palette.navySoft }]} hitSlop={8} accessibilityLabel="Ver ficha del cliente"
                          onPress={() => router.push({ pathname: '/cliente/[id]', params: { id: c.id } } as any)}>
                          <Ionicons name="person-outline" size={15} color={Palette.navy} />
                        </Pressable>
                      )}
                      {!organizando && c && tieneWhatsapp(c.telefono) ? (
                        <Pressable style={[styles.icono, { backgroundColor: Palette.green }]} onPress={() => abrirWhatsApp(c.telefono)} hitSlop={6} accessibilityLabel="Escribir por WhatsApp">
                          <Ionicons name="logo-whatsapp" size={18} color={Palette.onNavy} />
                        </Pressable>
                      ) : null}
                      {c && (
                        <Pressable style={[styles.icono, organizando && styles.iconoCompacto, { backgroundColor: Palette.navySoft }]} onPress={() => abrirComoLlegar(c)} hitSlop={8} accessibilityLabel="Cómo llegar">
                          <Ionicons name="navigate" size={organizando ? 15 : 17} color={Palette.navy} />
                        </Pressable>
                      )}
                    </View>
                  </View>

                  {/* Botones rápidos (no se muestran al organizar la ruta) */}
                  {!organizando && (
                  <View style={styles.botones}>
                    {ocupado ? (
                      <ActivityIndicator size="small" color={Palette.navy} style={{ flex: 2 }} />
                    ) : !puedeMarcar ? null : p.estado === 'pendiente' ? (
                      <>
                        <Pressable style={[styles.boton, { backgroundColor: Palette.green }]} onPress={() => marcar(p, 'visitado')}>
                          <Ionicons name="checkmark" size={18} color={Palette.onNavy} />
                          <Text style={[styles.botonText, { color: Palette.onNavy }]}>Estaba</Text>
                        </Pressable>
                        <Pressable style={[styles.boton, { backgroundColor: Palette.amberSoft }]} onPress={() => marcar(p, 'no_estaba')}>
                          <Ionicons name="close" size={18} color={Palette.orange} />
                          <Text style={[styles.botonText, { color: Palette.orange }]}>No estaba</Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                      {/* A los que no estaban se les puede volver a visitar */}
                      {p.estado === 'no_estaba' && (
                        <Pressable style={[styles.boton, { backgroundColor: Palette.green }]} onPress={() => marcar(p, 'visitado')}>
                          <Ionicons name="checkmark" size={18} color={Palette.onNavy} />
                          <Text style={[styles.botonText, { color: Palette.onNavy }]}>Estaba</Text>
                        </Pressable>
                      )}
                      <Pressable style={[styles.boton, { backgroundColor: Palette.grayPill }]} onPress={() => marcar(p, 'pendiente')}>
                        <Ionicons name="arrow-undo-outline" size={16} color={Palette.navy} />
                        <Text style={[styles.botonText, { color: Palette.navy }]}>Deshacer</Text>
                      </Pressable>
                      </>
                    )}
                    <Pressable style={[styles.boton, { backgroundColor: abierta === p.id ? Palette.navy : Palette.navySoft }]} onPress={() => alternarCuotas(p)}>
                      <Ionicons name={abierta === p.id ? 'chevron-up' : 'cash-outline'} size={17} color={abierta === p.id ? Palette.onNavy : Palette.navy} />
                      <Text style={[styles.botonText, { color: abierta === p.id ? Palette.onNavy : Palette.navy }]}>Cuotas</Text>
                    </Pressable>
                  </View>
                  )}

                  {!organizando && abierta === p.id && (
                    <>
                      <PanelCuotas p={p} />
                      <View style={styles.botones}>
                        {/* Vender y Cobrar solo con la ruta comenzada (no al organizar) */}
                        {puedeMarcar && (
                          <>
                            <Pressable style={[styles.boton, { backgroundColor: Palette.navy }]}
                              onPress={() => router.push({ pathname: '/registrar-venta', params: { clienteId: p.cliente_id } } as any)}>
                              <Ionicons name="cart-outline" size={17} color={Palette.onNavy} />
                              <Text style={[styles.botonText, { color: Palette.onNavy }]}>Vender</Text>
                            </Pressable>
                            <Pressable style={[styles.boton, { backgroundColor: Palette.orange }]}
                              onPress={() => router.push({ pathname: '/registrar-pago', params: { clienteId: p.cliente_id } } as any)}>
                              <Ionicons name="wallet-outline" size={17} color={Palette.onNavy} />
                              <Text style={[styles.botonText, { color: Palette.onNavy }]}>Cobrar</Text>
                            </Pressable>
                          </>
                        )}
                        <Pressable style={[styles.boton, { backgroundColor: Palette.grayPill }]}
                          onPress={() => router.push({ pathname: '/cliente/[id]', params: { id: p.cliente_id } } as any)}>
                          <Ionicons name="person-outline" size={16} color={Palette.navy} />
                          <Text style={[styles.botonText, { color: Palette.navy }]}>Ficha</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </Pressable>
                </Animated.View>
              )
            }}
          />
          </ProveedorArrastre>
        </>
      )}
      {/* Organizar: botón principal para terminar y comenzar la ruta */}
      {reorganizando && !cargando && estado === 'en_curso' && (
        <View style={styles.pie}>
          <Pressable style={styles.terminar} onPress={() => router.replace('/ruta-en-curso' as any)}>
            <Ionicons name="checkmark" size={18} color={Palette.onNavy} />
            <Text style={styles.terminarText}>Listo, volver a la ruta</Text>
          </Pressable>
        </View>
      )}
      {organizando && !cargando && jornada && estado === 'preparacion' && (esMia || soyGerente) && enOrden.length > 0 && (
        <View style={styles.pie}>
          <Pressable style={[styles.terminar, terminando && { opacity: 0.6 }]} disabled={terminando} onPress={terminarOrganizacion}>
            {terminando ? <ActivityIndicator size="small" color={Palette.onNavy} /> : <Ionicons name="flag-outline" size={18} color={Palette.onNavy} />}
            <Text style={styles.terminarText}>Terminar organización y comenzar ruta</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  caseros: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
  chipActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  chipText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  mapa: { backgroundColor: Palette.card, borderBottomWidth: 1, borderBottomColor: Palette.border, overflow: 'hidden', zIndex: 0, position: 'relative' },
  caserosFila: { flexGrow: 0, flexShrink: 0, zIndex: 2, backgroundColor: Palette.cream },
  mapaAviso: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 10, padding: 8 },
  mapaAvisoText: { fontSize: 12, color: Palette.textMuted, textAlign: 'center' },
  avance: { paddingHorizontal: 16, paddingTop: 10, gap: 6 },
  avanceFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  avanceTexto: { fontSize: 13, fontWeight: '800', color: Palette.text },
  avanceSub: { fontSize: 12, color: Palette.textMuted },
  auto: { fontSize: 12, fontWeight: '700', color: Palette.navy },
  track: { height: 6, borderRadius: 3, backgroundColor: Palette.grayPill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: Palette.green },
  content: { padding: 12, gap: 10, paddingBottom: 40 },
  flechas: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  reorganizar: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: Palette.navySoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  reorganizarText: { fontSize: 12, fontWeight: '800', color: Palette.navy },
  pie: { padding: 12, borderTopWidth: 1, borderTopColor: Palette.border, backgroundColor: Palette.cream },
  terminar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Palette.orange, borderRadius: 14, paddingVertical: 15 },
  terminarText: { fontSize: 16, fontWeight: '800', color: Palette.onNavy },
  error: { color: Palette.amber, fontSize: 13 },
  avisoNavy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Palette.navySoft, borderRadius: 12, padding: 10 },
  avisoNavyText: { flex: 1, fontSize: 13, color: Palette.navy },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 20, fontSize: 14 },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 12, gap: 10 },
  cardCompacta: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, gap: 6 },
  numeroColCompacta: { gap: 4, alignSelf: 'center' },
  numeroCompacto: { width: 26, height: 26, borderRadius: 13 },
  manillaCompacta: { width: 28, height: 28, borderRadius: 8 },
  iconosCompactos: { flexDirection: 'row', gap: 6, alignSelf: 'center' },
  iconoCompacto: { width: 30, height: 30, borderRadius: 15 },
  cardArrastrada: { backgroundColor: Palette.inputFill, borderColor: Palette.navy, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  numeroCol: { alignItems: 'center', gap: 6 },
  manilla: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.navySoft },
  // Ruta en curso: franja izquierda y fondo según el estado (los mismos colores de los números del mapa)
  cardPendiente: { borderColor: Palette.navySoft, borderLeftWidth: 5, borderLeftColor: Palette.navy },
  cardVisitada: { backgroundColor: Palette.greenSoft, borderColor: Palette.green, borderLeftColor: Palette.green },
  cardNoEstaba: { backgroundColor: Palette.amberSoft, borderColor: Palette.orange, borderLeftColor: Palette.orange },
  grupo: { fontSize: 11, fontWeight: '800', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 4 },
  completada: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Palette.greenSoft, borderRadius: 12, padding: 10 },
  completadaText: { flex: 1, fontSize: 13, fontWeight: '700', color: Palette.green },
  leyenda: { flexDirection: 'row', gap: 14, paddingHorizontal: 2 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leyendaPunto: { width: 10, height: 10, borderRadius: 5 },
  leyendaText: { fontSize: 12, fontWeight: '600', color: Palette.textMuted },
  cardSel: { borderColor: Palette.orange, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  numero: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  numeroText: { fontSize: 13, fontWeight: '800', color: Palette.onNavy },
  nombre: { fontSize: 16, fontWeight: '800', color: Palette.text },
  nombreFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dist: { fontSize: 12, fontWeight: '700', color: Palette.textMuted },
  cerca: { backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12, gap: 8 },
  cercaTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cercaTitulo: { flex: 1, fontSize: 14, fontWeight: '800', color: Palette.text },
  link: { fontSize: 12, fontWeight: '800', color: Palette.orange },
  cercaFila: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.navySoft, borderRadius: 10, padding: 8 },
  cercaNumero: { width: 26, height: 26, borderRadius: 13, backgroundColor: Palette.navy, alignItems: 'center', justifyContent: 'center' },
  cercaNumeroText: { fontSize: 12, fontWeight: '800', color: Palette.onNavy },
  cercaNombre: { fontSize: 14, fontWeight: '800', color: Palette.text },
  cercaDir: { fontSize: 12, color: Palette.textMuted },
  cercaDist: { fontSize: 13, fontWeight: '800', color: Palette.navy },
  cercaNota: { fontSize: 12, color: Palette.textMuted },
  ordenFila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  usarOrden: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Palette.orange, borderRadius: 12, paddingVertical: 11 },
  usarOrdenText: { fontSize: 14, fontWeight: '800', color: Palette.onNavy },
  pill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  pillText: { fontSize: 12, fontWeight: '800' },
  iconos: { gap: 8 },
  icono: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  botones: { flexDirection: 'row', gap: 8 },
  boton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, paddingVertical: 11 },
  botonText: { fontSize: 14, fontWeight: '800' },
  cuotas: { backgroundColor: Palette.cream, borderRadius: 12, padding: 10, gap: 4 },
  cuotaFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cuotaTitulo: { fontSize: 14, fontWeight: '800', color: Palette.text },
  cuotaTotal: { fontSize: 16, fontWeight: '800' },
  cuotaSub: { fontSize: 11, fontWeight: '800', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  cuotaTexto: { flex: 1, fontSize: 13, color: Palette.text },
  cuotaMonto: { fontSize: 13, fontWeight: '800', color: Palette.text },
  cuotaError: { fontSize: 13, color: Palette.amber },
})

export default PantallaRuta
