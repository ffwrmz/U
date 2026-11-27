import { cargarFurgones, nombreEquipo, principalEn } from '@/lib/furgones'
import DireccionCliente from '@/components/DireccionCliente'
import Header from '@/components/Header'
import MapaClientes from '@/components/MapaClientes'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/roles'
import { clp } from '@/lib/format'
import { haceCuanto, listarPosiciones, metrosRecorridos, Posicion, puntoDe, Punto, RutaCalles, rutaPorCalles, textoDistancia, textoDuracion, ubicacionesDeParadas } from '@/lib/mapa'
import {
  EstadosCaseros, estadoRutaDe, Jornada, listarEstadosCaseros, listarParadas, obtenerOCrearJornadaHoy, ordenarCaseros, Parada,
  textoEstadoJornada,
} from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Casero { id: string; nombre: string }
interface Movimiento { quien: string; monto: number; cliente_id: string | null; hora: string | null }

const COLORES = { pendiente: Palette.navy, visitado: Palette.green, no_estaba: Palette.orange }
const hora = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}
// Inicio del día de hoy (hora del teléfono) en formato ISO, para filtrar cobros y ventas de hoy
const inicioDeHoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

// Seguimiento (solo gerente): qué está haciendo cada casero hoy. Avance de su ruta, a quién visitó y a qué hora,
// su recorrido real (posiciones guardadas por su teléfono con la ruta en curso), cobros y ventas del día.
// Lee jornadas, ruta_paradas, jornada_vendedores, posiciones_vendedor, pagos y ventas_pedidos (el dueño puede leer todo).
const Seguimiento = () => {
  const router = useRouter()
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [estados, setEstados] = useState<EstadosCaseros>({})
  const [paradas, setParadas] = useState<Parada[]>([])
  const [caseros, setCaseros] = useState<Casero[]>([])
  const [cobros, setCobros] = useState<Movimiento[]>([])
  const [ventas, setVentas] = useState<Movimiento[]>([])
  const [abierto, setAbierto] = useState<string | null>(null) // casero elegido
  const [recorrido, setRecorrido] = useState<Record<string, RutaCalles | null>>({})
  const [posiciones, setPosiciones] = useState<Posicion[]>([])
  const [tick, setTick] = useState(0) // fuerza recargar las posiciones en cada actualización

  const cargar = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
        setSoyGerente(esGerente(perfil?.rol))
      }
      const j = await obtenerOCrearJornadaHoy(true)
      setJornada(j)
      const [ps, est] = j ? await Promise.all([listarParadas(j.id), listarEstadosCaseros(j.id)]) : [[], {}]
      setParadas(ps as Parada[])
      setEstados(est as EstadosCaseros)
      const desde = inicioDeHoy()
      const [pe, pg, vs] = await Promise.all([
        supabase.from('perfiles').select('id, nombre').in('rol', ['vendedor', 'dueno']).neq('activo', false),
        supabase.from('pagos').select('cobrador_id, monto_abonado, creado_en, venta:ventas_pedidos ( cliente_id )').gte('creado_en', desde),
        supabase.from('ventas_pedidos').select('vendedor_id, cliente_id, monto_total, creado_en').gte('creado_en', desde).neq('estado_pago', 'anulada'),
      ])
      // Los del mismo furgón se ven como un equipo ("Gonzalo - Juan") con la ruta del principal
      const fs = await cargarFurgones()
      const todos = (pe.data as Casero[]) || []
      const nombreDe = (id: string) => todos.find((x) => x.id === id)?.nombre
      setCaseros(ordenarCaseros(todos
        .filter((c) => principalEn(fs, c.id) === c.id || !todos.some((x) => x.id === principalEn(fs, c.id)))
        .map((c) => ({ ...c, nombre: nombreEquipo(fs, c.id, nombreDe) }))))
      setCobros(((pg.data as any[]) || []).map((x) => ({ quien: x.cobrador_id && principalEn(fs, x.cobrador_id), monto: Number(x.monto_abonado), cliente_id: x.venta?.cliente_id ?? null, hora: x.creado_en })))
      setVentas(((vs.data as any[]) || []).map((x) => ({ quien: x.vendedor_id && principalEn(fs, x.vendedor_id), monto: Number(x.monto_total), cliente_id: x.cliente_id, hora: x.creado_en })))
      setError(pe.error?.message ?? pg.error?.message ?? vs.error?.message ?? null)
      setTick((t) => t + 1)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
      setRefrescando(false)
    }
  }, [])

  useFocusEffect(useCallback(() => {
    cargar()
    // Se actualiza solo cada 30 segundos mientras la pantalla está abierta
    const t = setInterval(cargar, 30000)
    return () => clearInterval(t)
  }, [cargar]))

  // Datos de un casero
  const paradasDe = (id: string) => paradas.filter((p) => p.vendedor_id === id).sort((a, b) => a.orden - b.orden)
  // Visitas en el orden en que ocurrieron (Estaba / No estaba con su hora)
  const visitasDe = (id: string) => paradasDe(id).filter((p) => p.estado !== 'pendiente' && p.visitado_en)
    .sort((a, b) => (a.visitado_en ?? '').localeCompare(b.visitado_en ?? ''))
  const sumar = (l: Movimiento[], id: string) => l.filter((m) => m.quien === id).reduce((n, m) => n + m.monto, 0)
  const contar = (l: Movimiento[], id: string) => l.filter((m) => m.quien === id).length

  // Caseros con ruta hoy primero; después el resto (por si cobran o venden sin ruta)
  const conRuta = caseros.filter((c) => paradasDe(c.id).length > 0)
  const sinRuta = caseros.filter((c) => paradasDe(c.id).length === 0 && (contar(cobros, c.id) > 0 || contar(ventas, c.id) > 0))

  // Casero elegido por defecto: el primero con ruta (Gonzalo primero)
  useEffect(() => {
    if (!abierto && (conRuta[0] || sinRuta[0])) setAbierto((conRuta[0] ?? sinRuta[0]).id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conRuta.length, sinRuta.length])

  // Recorrido real: posiciones guardadas por el teléfono del casero elegido
  useEffect(() => {
    if (!abierto || !jornada) { setPosiciones([]); return }
    let vigente = true
    listarPosiciones(jornada.id, abierto).then((p) => { if (vigente) setPosiciones(p) })
    return () => { vigente = false }
  }, [abierto, jornada, tick])

  // Respaldo si aún no hay posiciones: camino en auto por las casas visitadas, en el orden de visita
  const claveAbierto = abierto ? visitasDe(abierto).map((p) => p.id).join(',') : ''
  useEffect(() => {
    if (!abierto) return
    const puntos = visitasDe(abierto).map((p) => puntoDe(p.cliente)).filter(Boolean) as Punto[]
    if (puntos.length < 2) { setRecorrido((r) => ({ ...r, [abierto]: null })); return }
    let vigente = true
    rutaPorCalles(puntos).then((r) => { if (vigente) setRecorrido((x) => ({ ...x, [abierto]: r })) })
    return () => { vigente = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, claveAbierto])

  const Tarjeta = ({ c }: { c: Casero }) => {
    const ps = paradasDe(c.id)
    const visitadas = ps.filter((p) => p.estado === 'visitado').length
    const noEstaba = ps.filter((p) => p.estado === 'no_estaba').length
    const pendientes = ps.length - visitadas - noEstaba
    const hechas = visitadas + noEstaba
    const visitas = visitasDe(c.id)
    const ultima = visitas[visitas.length - 1]
    const estado = estadoRutaDe(jornada, estados, c.id)
    const abiertoAqui = abierto === c.id
    const rec = recorrido[c.id]
    // Recorrido real (posiciones del teléfono del casero)
    const tramo = abiertoAqui ? posiciones : []
    const ultimaPos = tramo[tramo.length - 1]
    const kmReales = metrosRecorridos(tramo)
    const inicio = estado === 'en_curso' ? (estados[c.id] ? null : jornada?.iniciada_en ?? null) : null
    const nombreDe = (clienteId: string | null) => ps.find((p) => p.cliente_id === clienteId)?.cliente?.nombre ?? 'Cliente'
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{c.nombre.slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.nombre}>{c.nombre}</Text>
            <Text style={styles.sub}>
              {ps.length ? `${textoEstadoJornada(estado)} · ${hechas} de ${ps.length} visitas` : 'Sin ruta hoy'}
            </Text>
          </View>
        </View>
        {/* Posición actual */}
        <Text style={styles.ultima}>
          {ultimaPos ? `Última ubicación ${haceCuanto(ultimaPos.registrada_en)} (${hora(ultimaPos.registrada_en)})` : 'Sin ubicación registrada hoy (se guarda cuando tiene la ruta en curso y la app abierta).'}
          {inicio ? ` · Ruta iniciada a las ${hora(inicio)}` : ''}
        </Text>

        {ps.length > 0 && (
          <View style={styles.track}>
            <View style={[styles.fillVerde, { flex: visitadas }]} />
            <View style={[styles.fillNaranja, { flex: noEstaba }]} />
            <View style={{ flex: pendientes }} />
          </View>
        )}

        <View style={styles.datos}>
          {ps.length > 0 && <Dato icono="checkmark-circle" color={Palette.green} texto={`${visitadas} estaban`} />}
          {ps.length > 0 && <Dato icono="close-circle" color={Palette.orange} texto={`${noEstaba} no estaban`} />}
          {ps.length > 0 && <Dato icono="ellipse-outline" color={Palette.navy} texto={`${pendientes} pendientes`} />}
          <Dato icono="wallet-outline" color={Palette.navy} texto={`Cobrado ${clp(sumar(cobros, c.id))} (${contar(cobros, c.id)})`} />
          <Dato icono="cart-outline" color={Palette.navy} texto={`Vendido ${clp(sumar(ventas, c.id))} (${contar(ventas, c.id)})`} />
        </View>
        {ultima && (
          <Text style={styles.ultima}>Última visita: {ultima.cliente?.nombre ?? 'Cliente'} a las {hora(ultima.visitado_en)}</Text>
        )}

        {abiertoAqui && (
          <View style={{ gap: 10 }}>
            {/* Mapa: casas con colores por estado y el camino recorrido (casas visitadas en orden de visita) */}
            {(ps.some((p) => puntoDe(p.cliente)) || !!ultimaPos) && (
              <View style={styles.mapa}>
                <MapaClientes
                  ubicaciones={ubicacionesDeParadas(ps.map((p) => ({ cliente: p.cliente, estado: p.estado })), COLORES)}
                  trazarRuta={tramo.length > 1 || !!rec}
                  trazado={tramo.length > 1 ? tramo : rec?.trazado}
                  posicion={ultimaPos ? { latitud: ultimaPos.latitud, longitud: ultimaPos.longitud, titulo: `${c.nombre} · ${hora(ultimaPos.registrada_en)}` } : null}
                  onPressCliente={(id) => router.push({ pathname: '/cliente/[id]', params: { id } } as any)}
                />
              </View>
            )}
            <Text style={styles.recorrido}>
              <Ionicons name="car-outline" size={13} color={Palette.navy} />{' '}
              {tramo.length > 1 ? `Recorrido: ${textoDistancia(kmReales)} según su GPS (${tramo.length} posiciones)`
                : rec ? `Recorrido aprox.: ${textoDistancia(rec.distancia)} · ${textoDuracion(rec.duracion)} en auto (entre las casas visitadas)`
                : visitas.length < 2 ? 'Recorrido: todavía no hay suficientes visitas para calcularlo.'
                : 'Recorrido: no se pudo calcular (sin conexión al servicio de rutas).'}
            </Text>

            <Text style={styles.seccion}>Visitas en orden</Text>
            {visitas.length === 0 && <Text style={styles.sub}>Todavía no marca visitas.</Text>}
            {visitas.map((p) => {
              const cobrado = cobros.filter((m) => m.quien === c.id && m.cliente_id === p.cliente_id).reduce((n, m) => n + m.monto, 0)
              const vendido = ventas.filter((m) => m.quien === c.id && m.cliente_id === p.cliente_id).reduce((n, m) => n + m.monto, 0)
              return (
                <Pressable key={p.id} style={[styles.fila, { borderLeftColor: COLORES[p.estado] }]}
                  onPress={() => router.push({ pathname: '/cliente/[id]', params: { id: p.cliente_id } } as any)}>
                  <Text style={styles.filaHora}>{hora(p.visitado_en)}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.filaNombre} numberOfLines={1}>{p.cliente?.nombre ?? 'Cliente'}{p.fuera_de_ruta ? ' · fuera de ruta' : ''}</Text>
                    <Text style={[styles.filaEstado, { color: COLORES[p.estado] }]}>
                      {p.estado === 'visitado' ? 'Estaba' : 'No estaba'}
                      {cobrado > 0 ? ` · cobró ${clp(cobrado)}` : ''}{vendido > 0 ? ` · vendió ${clp(vendido)}` : ''}
                    </Text>
                  </View>
                </Pressable>
              )
            })}

            {pendientes > 0 && <Text style={styles.seccion}>Pendientes ({pendientes})</Text>}
            {ps.filter((p) => p.estado === 'pendiente').map((p) => (
              <Pressable key={p.id} style={[styles.fila, { borderLeftColor: COLORES.pendiente }]}
                onPress={() => router.push({ pathname: '/cliente/[id]', params: { id: p.cliente_id } } as any)}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.filaNombre} numberOfLines={1}>{p.cliente?.nombre ?? 'Cliente'}{p.fuera_de_ruta ? ' · fuera de ruta' : ''}</Text>
                  {p.cliente && <DireccionCliente c={p.cliente} compacta />}
                </View>
              </Pressable>
            ))}

            {/* Cobros y ventas a clientes que no estaban en su ruta de hoy */}
            {[...cobros, ...ventas].some((m) => m.quien === c.id && !ps.some((p) => p.cliente_id === m.cliente_id)) && (
              <>
                <Text style={styles.seccion}>Fuera de la ruta</Text>
                {cobros.filter((m) => m.quien === c.id && !ps.some((p) => p.cliente_id === m.cliente_id)).map((m, i) => (
                  <Text key={`c${i}`} style={styles.sub}>{hora(m.hora)} · cobró {clp(m.monto)}{m.cliente_id ? ` a ${nombreDe(m.cliente_id)}` : ''}</Text>
                ))}
                {ventas.filter((m) => m.quien === c.id && !ps.some((p) => p.cliente_id === m.cliente_id)).map((m, i) => (
                  <Text key={`v${i}`} style={styles.sub}>{hora(m.hora)} · vendió {clp(m.monto)}</Text>
                ))}
              </>
            )}
          </View>
        )}
      </View>
    )
  }

  const totalCobrado = cobros.reduce((n, m) => n + m.monto, 0)
  const totalVendido = ventas.reduce((n, m) => n + m.monto, 0)

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Seguimiento" subtitle="Lo que hace cada casero hoy" />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : !soyGerente ? (
        <Text style={styles.vacio}>Solo el gerente puede ver el seguimiento de los caseros.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => { setRefrescando(true); cargar() }} tintColor={Palette.navy} />}>
          {error && <Text style={styles.error}>Algunos datos no se pudieron cargar: {error}</Text>}
          <View style={styles.resumen}>
            <Text style={styles.resumenLabel}>Hoy · {textoEstadoJornada(jornada?.estado)}</Text>
            <View style={styles.resumenFila}>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum}>{paradas.filter((p) => p.estado !== 'pendiente').length}/{paradas.length}</Text>
                <Text style={styles.resumenTxt}>visitas</Text>
              </View>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum} numberOfLines={1} adjustsFontSizeToFit>{clp(totalCobrado)}</Text>
                <Text style={styles.resumenTxt}>cobrado</Text>
              </View>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum} numberOfLines={1} adjustsFontSizeToFit>{clp(totalVendido)}</Text>
                <Text style={styles.resumenTxt}>vendido</Text>
              </View>
            </View>
            <Text style={styles.resumenNota}>Se actualiza solo cada minuto. Desliza hacia abajo para actualizar ahora.</Text>
          </View>

          {conRuta.length === 0 && sinRuta.length === 0 && (
            <Text style={styles.vacio}>Hoy ningún casero tiene ruta asignada ni movimientos.</Text>
          )}
          {/* Selector de casero (Gonzalo primero) */}
          {[...conRuta, ...sinRuta].length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {[...conRuta, ...sinRuta].map((c) => {
                const on = c.id === abierto
                const ps = paradasDe(c.id)
                return (
                  <Pressable key={c.id} style={[styles.chip, on && styles.chipActivo]} onPress={() => setAbierto(c.id)}>
                    <Text style={[styles.chipText, on && { color: Palette.cream }]}>
                      {c.nombre}{ps.length ? ` · ${ps.filter((p) => p.estado !== 'pendiente').length}/${ps.length}` : ''}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          )}
          {[...conRuta, ...sinRuta].filter((c) => c.id === abierto).map((c) => <Tarjeta key={c.id} c={c} />)}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const Dato = ({ icono, color, texto }: { icono: keyof typeof Ionicons.glyphMap; color: string; texto: string }) => (
  <View style={styles.dato}>
    <Ionicons name={icono} size={14} color={color} />
    <Text style={styles.datoText}>{texto}</Text>
  </View>
)

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  error: { color: Palette.amber, fontSize: 13 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14, paddingHorizontal: 20 },
  resumen: { backgroundColor: Palette.navy, borderRadius: 18, padding: 16, gap: 10 },
  resumenLabel: { fontSize: 12, color: Palette.onNavyMuted },
  resumenFila: { flexDirection: 'row', gap: 8 },
  resumenItem: { flex: 1, backgroundColor: Palette.onNavyFill, borderRadius: 12, padding: 10 },
  resumenNum: { fontSize: 18, fontWeight: '800', color: Palette.onNavy },
  resumenTxt: { fontSize: 12, color: Palette.onNavyMuted },
  resumenNota: { fontSize: 11, color: Palette.onNavyMuted },
  chip: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  chipActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  chipText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Palette.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Palette.onNavy, fontWeight: '800', fontSize: 16 },
  nombre: { fontSize: 16, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  track: { flexDirection: 'row', height: 8, borderRadius: 4, backgroundColor: Palette.grayPill, overflow: 'hidden' },
  fillVerde: { backgroundColor: Palette.green },
  fillNaranja: { backgroundColor: Palette.orange },
  datos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dato: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  datoText: { fontSize: 12, color: Palette.text, fontWeight: '600' },
  ultima: { fontSize: 12, color: Palette.textMuted },
  mapa: { height: 220, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Palette.border },
  recorrido: { fontSize: 12, fontWeight: '700', color: Palette.navy },
  seccion: { fontSize: 11, fontWeight: '800', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 10, borderLeftWidth: 4, padding: 10 },
  filaHora: { fontSize: 13, fontWeight: '800', color: Palette.navy, width: 46 },
  filaNombre: { fontSize: 14, fontWeight: '700', color: Palette.text },
  filaEstado: { fontSize: 12, fontWeight: '700' },
})

export default Seguimiento
