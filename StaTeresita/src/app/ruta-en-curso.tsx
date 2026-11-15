import DireccionCliente from '@/components/DireccionCliente'
import Header from '@/components/Header'
import MapaClientes from '@/components/MapaClientes'
import type { UbicacionMapa } from '@/components/mapaClientes.types'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { clp, fechaCorta } from '@/lib/format'
import { abrirComoLlegar, ubicacionesDeParadas } from '@/lib/mapa'
import { EstadoParada, Jornada, listarParadas, marcarParada, obtenerOCrearJornadaHoy, Parada, textoEstadoJornada } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { abrirWhatsApp } from '@/lib/whatsapp'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
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

// Ruta en curso: arriba el mapa con las paradas numeradas, abajo la lista en orden con botones rápidos
// (Estaba / No estaba / Cuotas / Vender / Cobrar). El casero ve su ruta; el gerente puede elegir de quién.
const RutaEnCurso = () => {
  const router = useRouter()
  const { height } = useWindowDimensions()
  const lista = useRef<FlatList<Parada>>(null)

  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [todas, setTodas] = useState<Parada[]>([])
  const [yo, setYo] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [caseros, setCaseros] = useState<Casero[]>([])
  const [verDe, setVerDe] = useState<string | null>(null) // casero cuya ruta se muestra
  const [seleccion, setSeleccion] = useState<string | null>(null) // id de la parada seleccionada
  const [marcando, setMarcando] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null) // parada con las cuotas desplegadas
  const [cuotas, setCuotas] = useState<Record<string, Cuotas | 'cargando' | { error: string }>>({})

  const cargar = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No hay sesión activa')
      setYo(user.id)
      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
      const gerente = esGerente(perfil?.rol)
      setSoyGerente(gerente)
      const j = await obtenerOCrearJornadaHoy(false)
      setJornada(j)
      const ps = j ? await listarParadas(j.id, gerente ? undefined : user.id) : []
      setTodas(ps)
      if (gerente) {
        const ids = Array.from(new Set(ps.map((p) => p.vendedor_id)))
        const { data: pe } = ids.length ? await supabase.from('perfiles').select('id, nombre').in('id', ids) : { data: [] }
        const lista = ((pe as Casero[]) || []).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        setCaseros(lista)
        // Por defecto la propia ruta del gerente, si tiene; si no, la del primer casero
        setVerDe((actual) => actual && ids.includes(actual) ? actual : ids.includes(user.id) ? user.id : lista[0]?.id ?? null)
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
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const paradas = todas.filter((p) => p.vendedor_id === verDe).sort((a, b) => a.orden - b.orden)
  const estado = jornada?.estado
  const esMia = verDe === yo
  // Marca el casero en su propia ruta, o el gerente en cualquiera; solo con la jornada en curso
  const puedeMarcar = estado === 'en_curso' && (esMia || soyGerente)
  const hechas = paradas.filter((p) => p.estado !== 'pendiente').length
  const visitadas = paradas.filter((p) => p.estado === 'visitado').length

  const ubicaciones = ubicacionesDeParadas(paradas.map((p) => ({ cliente: p.cliente, estado: p.estado })), COLORES_MAPA)
  const ubicacionDe = (p: Parada) => ubicaciones.find((u) => u.clientes.some((c) => c.id === p.cliente_id))?.id ?? null
  const paradaSel = paradas.find((p) => p.id === seleccion)

  const seleccionar = (p: Parada, desdeMapa: boolean) => {
    setSeleccion(p.id)
    if (desdeMapa) {
      const i = paradas.findIndex((x) => x.id === p.id)
      if (i >= 0) lista.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0 })
    }
  }
  const tocarPunto = (u: UbicacionMapa) => {
    const p = paradas.find((x) => u.clientes.some((c) => c.id === x.cliente_id))
    if (p) seleccionar(p, true)
  }

  const marcar = async (p: Parada, nuevo: EstadoParada) => {
    setMarcando(p.id)
    try {
      await marcarParada(p.id, nuevo)
      setTodas((l) => l.map((x) => (x.id === p.id ? { ...x, estado: nuevo, visitado_en: nuevo === 'pendiente' ? null : new Date().toISOString() } : x)))
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
    : estado === 'preparacion' ? 'La ruta aún no se inicia. Podrás marcar las visitas cuando el gerente la inicie.'
    : estado === 'finalizada' ? 'La jornada de hoy terminó. Solo puedes ver cómo quedó.'
    : !puedeMarcar ? 'Estás viendo la ruta de otro casero.'
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
      <Header title="Ruta en curso" />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Gerente: elegir de quién es la ruta que se ve */}
          {soyGerente && caseros.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.caseros}>
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
          <View style={[styles.mapa, { height: Math.round(height * 0.4) }]}>
            <MapaClientes
              ubicaciones={ubicaciones}
              trazarRuta
              seleccionId={paradaSel ? ubicacionDe(paradaSel) : null}
              onPressUbicacion={tocarPunto}
            />
            {paradas.length > 0 && ubicaciones.length === 0 && (
              <View style={styles.mapaAviso}><Text style={styles.mapaAvisoText}>Estas direcciones aún no tienen ubicación en el mapa.</Text></View>
            )}
          </View>

          {/* Avance */}
          <View style={styles.avance}>
            <View style={styles.avanceFila}>
              <Text style={styles.avanceTexto}>{textoEstadoJornada(estado)} · {hechas} de {paradas.length} paradas</Text>
              <Text style={styles.avanceSub}>{visitadas} estaban · {hechas - visitadas} no estaban</Text>
            </View>
            <View style={styles.track}><View style={[styles.fill, { width: `${paradas.length ? (hechas / paradas.length) * 100 : 0}%` }]} /></View>
          </View>

          <FlatList
            ref={lista}
            data={paradas}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.content}
            onScrollToIndexFailed={(info) => setTimeout(() => lista.current?.scrollToIndex({ index: info.index, animated: true }), 300)}
            refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => { setRefrescando(true); setCuotas({}); cargar() }} tintColor={Palette.navy} />}
            ListHeaderComponent={
              <View style={{ gap: 8 }}>
                {error && <Text style={styles.error}>No se pudo cargar la ruta: {error}</Text>}
                {aviso && (
                  <View style={styles.avisoNavy}>
                    <Ionicons name="information-circle-outline" size={18} color={Palette.navy} />
                    <Text style={styles.avisoNavyText}>{aviso}</Text>
                  </View>
                )}
              </View>
            }
            ListEmptyComponent={!error && jornada ? <Text style={styles.vacio}>No hay clientes en esta ruta hoy.</Text> : undefined}
            renderItem={({ item: p, index }) => {
              const e = ESTADO[p.estado] ?? ESTADO.pendiente
              const c = p.cliente
              const sel = p.id === seleccion
              const ocupado = marcando === p.id
              return (
                <Pressable style={[styles.card, sel && styles.cardSel]} onPress={() => seleccionar(p, false)}>
                  <View style={styles.cardTop}>
                    <View style={[styles.numero, { backgroundColor: COLORES_MAPA[p.estado] ?? Palette.navy }]}>
                      <Text style={styles.numeroText}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.nombre} numberOfLines={1}>{c?.nombre ?? 'Cliente'}</Text>
                      {c && <DireccionCliente c={c} />}
                      <View style={[styles.pill, { backgroundColor: e.fondo }]}>
                        <Text style={[styles.pillText, { color: e.color }]}>
                          {e.texto}{p.visitado_en && p.estado !== 'pendiente' ? ` · ${hora(p.visitado_en)}` : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.iconos}>
                      {c?.telefono ? (
                        <Pressable style={[styles.icono, { backgroundColor: Palette.green }]} onPress={() => abrirWhatsApp(c.telefono)} hitSlop={6} accessibilityLabel="Escribir por WhatsApp">
                          <Ionicons name="logo-whatsapp" size={18} color={Palette.onNavy} />
                        </Pressable>
                      ) : null}
                      {c && (
                        <Pressable style={[styles.icono, { backgroundColor: Palette.navySoft }]} onPress={() => abrirComoLlegar(c)} hitSlop={6} accessibilityLabel="Cómo llegar">
                          <Ionicons name="navigate" size={17} color={Palette.navy} />
                        </Pressable>
                      )}
                    </View>
                  </View>

                  {/* Botones rápidos */}
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
                      <Pressable style={[styles.boton, { backgroundColor: Palette.grayPill }]} onPress={() => marcar(p, 'pendiente')}>
                        <Ionicons name="arrow-undo-outline" size={16} color={Palette.navy} />
                        <Text style={[styles.botonText, { color: Palette.navy }]}>Deshacer</Text>
                      </Pressable>
                    )}
                    <Pressable style={[styles.boton, { backgroundColor: abierta === p.id ? Palette.navy : Palette.navySoft }]} onPress={() => alternarCuotas(p)}>
                      <Ionicons name={abierta === p.id ? 'chevron-up' : 'cash-outline'} size={17} color={abierta === p.id ? Palette.onNavy : Palette.navy} />
                      <Text style={[styles.botonText, { color: abierta === p.id ? Palette.onNavy : Palette.navy }]}>Cuotas</Text>
                    </Pressable>
                  </View>

                  {abierta === p.id && (
                    <>
                      <PanelCuotas p={p} />
                      <View style={styles.botones}>
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
                        <Pressable style={[styles.boton, { backgroundColor: Palette.grayPill }]}
                          onPress={() => router.push({ pathname: '/cliente/[id]', params: { id: p.cliente_id } } as any)}>
                          <Ionicons name="person-outline" size={16} color={Palette.navy} />
                          <Text style={[styles.botonText, { color: Palette.navy }]}>Ficha</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </Pressable>
              )
            }}
          />
        </>
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
  mapa: { backgroundColor: Palette.card, borderBottomWidth: 1, borderBottomColor: Palette.border },
  mapaAviso: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 10, padding: 8 },
  mapaAvisoText: { fontSize: 12, color: Palette.textMuted, textAlign: 'center' },
  avance: { paddingHorizontal: 16, paddingTop: 10, gap: 6 },
  avanceFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  avanceTexto: { fontSize: 13, fontWeight: '800', color: Palette.text },
  avanceSub: { fontSize: 12, color: Palette.textMuted },
  track: { height: 6, borderRadius: 3, backgroundColor: Palette.grayPill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: Palette.green },
  content: { padding: 12, gap: 10, paddingBottom: 40 },
  error: { color: Palette.amber, fontSize: 13 },
  avisoNavy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Palette.navySoft, borderRadius: 12, padding: 10 },
  avisoNavyText: { flex: 1, fontSize: 13, color: Palette.navy },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 20, fontSize: 14 },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 12, gap: 10 },
  cardSel: { borderColor: Palette.orange, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  numero: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  numeroText: { fontSize: 13, fontWeight: '800', color: Palette.onNavy },
  nombre: { fontSize: 16, fontWeight: '800', color: Palette.text },
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

export default RutaEnCurso
