import EstadoSync from '@/components/EstadoSync'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { reiniciarDia } from '@/components/DepuracionDia'
import MapaClientes from '@/components/MapaClientes'
import { Punto, puntoDe, ubicacionesDeClientes } from '@/lib/mapa'
import { cambiarEstadoJornada, ClienteRuta, estadoRutaDe, Jornada, listarEstadosCaseros, listarParadas, obtenerOCrearJornadaHoy, SELECT_CLIENTE, textoEstadoJornada } from '@/lib/rutas'
import { contarPendientes, escucharCorrecciones } from '@/lib/correcciones'
import { contarNoLeidas, escucharNotificaciones } from '@/lib/notificaciones'
import { clp } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface ClienteFila {
  id: string
  nombre: string
  direccion: string | null
}

const HomeScreen = () => {

  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [rolUsuario, setRolUsuario] = useState<string | null>(null);
  const [nombreUsuario, setNombreUsuario] = useState<string | null>(null);
  const [clientes, setClientes] = useState<ClienteFila[]>([])
  const [deudas, setDeudas] = useState<Record<string, number>>({})
  // Clientes con su dirección y coordenadas, para el mapa del gerente
  const [clientesMapa, setClientesMapa] = useState<ClienteRuta[]>([])
  const [jornada, setJornada] = useState<Jornada | null>(null)
  // Mi ruta de hoy (paradas asignadas a este usuario)
  const [miRuta, setMiRuta] = useState<{ estado: Jornada['estado'] | null; total: number; pendientes: number }>({ estado: null, total: 0, pendientes: 0 })
  // Clientes asignados hoy a mí (para el mapa "Mis clientes asignados" del gerente)
  const [misClientes, setMisClientes] = useState<string[]>([])
  const [vistaMapa, setVistaMapa] = useState<'todos' | 'asignados'>('todos')
  const soyGerente = esGerente(rolUsuario)
  // Solicitudes de corrección pendientes (campana del gerente; en tiempo real y al volver a la pantalla)
  const [correccionesPendientes, setCorreccionesPendientes] = useState(0)
  const esDueno = rolUsuario === 'dueno'
  useFocusEffect(useCallback(() => {
    if (esDueno) contarPendientes().then(setCorreccionesPendientes)
  }, [esDueno]))
  useEffect(() => {
    if (!esDueno) return
    return escucharCorrecciones(() => { contarPendientes().then(setCorreccionesPendientes) })
  }, [esDueno])
  // Notificaciones sin leer (campana para todos)
  const [noLeidas, setNoLeidas] = useState(0)
  const [miId, setMiId] = useState<string | null>(null)
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMiId(data.user?.id ?? null)) }, [])
  useFocusEffect(useCallback(() => { contarNoLeidas().then(setNoLeidas) }, []))
  useEffect(() => {
    if (!miId) return
    return escucharNotificaciones(miId, () => { contarNoLeidas().then(setNoLeidas) })
  }, [miId])


  useEffect(() => {
    const obtenerRol = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase
          .from('perfiles')
          .select('rol, nombre')
          .eq('id', user.id)
          .single();
        
        if (data) {
          setRolUsuario(data.rol);
          setNombreUsuario((data as any).nombre ?? null);
        }
      }
    };
    obtenerRol();
  }, []);

  // Clientes y lo que debe cada uno (se refresca al volver a esta pantalla)
  useFocusEffect(
    useCallback(() => {
      const cargar = async () => {
        const { data: cs } = await supabase
          .from('clientes')
          .select('id, nombre, direccion')
          .order('nombre', { ascending: true })
        const { data: vs } = await supabase
          .from('ventas_pedidos')
          .select('cliente_id, saldo_pendiente')
          .gt('saldo_pendiente', 0)
          .neq('estado_pago', 'anulada') // las ventas anuladas no cuentan como deuda

        const mapa: Record<string, number> = {}
        ;(vs || []).forEach((v: any) => {
          mapa[v.cliente_id] = (mapa[v.cliente_id] || 0) + Number(v.saldo_pendiente)
        })
        setClientes((cs as ClienteFila[]) || [])
        setDeudas(mapa)
        const { data: cm } = await supabase.from('clientes').select(SELECT_CLIENTE)
        setClientesMapa(((cm as any[]) || []) as ClienteRuta[])
      }
      cargar()
    }, [])
  )

  // Jornada de hoy (tabla jornadas). El gerente la crea si aún no existe.
  useFocusEffect(
    useCallback(() => {
      if (!soyGerente) return
      obtenerOCrearJornadaHoy(true).then(setJornada).catch(() => setJornada(null))
    }, [soyGerente])
  )

  useFocusEffect(
    useCallback(() => {
      const leer = async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser()
          const j = await obtenerOCrearJornadaHoy(false)
          if (!user || !j) { setMiRuta({ estado: j?.estado ?? null, total: 0, pendientes: 0 }); return }
          const ps = await listarParadas(j.id, user.id)
          const est = await listarEstadosCaseros(j.id)
          setMiRuta({ estado: estadoRutaDe(j, est, user.id) ?? j.estado, total: ps.length, pendientes: ps.filter((p) => p.estado === 'pendiente').length })
          setMisClientes(ps.map((p) => p.cliente_id))
        } catch {
          setMiRuta({ estado: null, total: 0, pendientes: 0 })
        }
      }
      leer()
    }, [])
  )

  // Iniciar / finalizar la jornada de hoy (se guarda en Supabase)
  const cambiarEstado = (nuevo: 'en_curso' | 'finalizada') => {
    if (!jornada) return
    const iniciar = nuevo === 'en_curso'
    Alert.alert(
      iniciar ? 'Iniciar ruta' : 'Finalizar ruta',
      iniciar
        ? 'Al iniciar se bloquean los clientes asignados y su orden. Las ventas y los abonos siguen funcionando.'
        : 'Se cerrará la jornada de hoy.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: iniciar ? 'Iniciar' : 'Finalizar', onPress: () => {
          cambiarEstadoJornada(jornada.id, nuevo)
            .then(setJornada)
            .catch((e) => Alert.alert('Error', e.message))
        } },
      ]
    )
  }

  const conDeuda = clientes.filter((c) => (deudas[c.id] || 0) > 0).length
  const totalPorCobrar = (Object.values(deudas) as number[]).reduce((s, n) => s + n, 0)
  const progreso = clientes.length ? (clientes.length - conDeuda) / clientes.length : 0
  
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Cabecera con resumen */}
        <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroHello}>Hola{nombreUsuario ? `, ${nombreUsuario}` : ''}</Text>
              <Text style={styles.heroBrand}>Santa Teresita</Text>
              <View style={{ alignItems: 'flex-start' }}><EstadoSync /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => router.push('../notificaciones')} style={styles.iconButton} accessibilityLabel="Notificaciones">
                <Ionicons name={noLeidas > 0 ? 'notifications' : 'notifications-outline'} size={22} color={Palette.onNavy} />
                {noLeidas > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{noLeidas > 99 ? '99+' : noLeidas}</Text></View>
                )}
              </Pressable>
              <Pressable onPress={async () => { await supabase.auth.signOut(); router.replace('/') }} style={styles.iconButton} accessibilityLabel="Cerrar sesión">
                <Ionicons name="log-out-outline" size={22} color={Palette.onNavy} />
              </Pressable>
            </View>
          </View>

          {esDueno && correccionesPendientes > 0 && (
            <Pressable style={({ pressed }) => [styles.bannerCorr, pressed && styles.cardPressed]} onPress={() => router.push('../solicitudes')}>
              <Ionicons name="alert-circle" size={20} color={Palette.navy} />
              <Text style={styles.bannerCorrText}>
                Tienes {correccionesPendientes} {correccionesPendientes === 1 ? 'solicitud' : 'solicitudes'} de corrección
              </Text>
              <Ionicons name="chevron-forward" size={18} color={Palette.navy} />
            </Pressable>
          )}

          {soyGerente ? (
            <>
            <View style={styles.sectionRow}>
                <Text style={styles.heroJornadaTitle}>Jornada de hoy</Text>
              </View>
              <View style={{ height: 14 }} />
            <View style={styles.gestionRow}>
                <Pressable
                  style={({ pressed }) => [styles.gestionCard, styles.gestionMint, pressed && styles.cardPressed]}
                  onPress={() => router.push('../inventario-gerente')}
                >
                  <View style={[styles.gestionIcon, { backgroundColor: Palette.onNavy }]}>
                    <Ionicons name="cube-outline" size={24} color={Palette.navy} />
                  </View>
                  <Text style={styles.gestionTitulo}>Gestionar inventario</Text>
                  <Text style={styles.gestionSub}>Revisa stock, productos y movimientos.</Text>
                  <Ionicons name="chevron-forward" size={20} color={Palette.onNavyMuted} style={styles.gestionChevron} />
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.gestionCard, styles.gestionLila, pressed && styles.cardPressed]}
                  onPress={() => router.push('../gestion-ruta')}
                >
                  <View style={[styles.gestionIcon, { backgroundColor: Palette.onNavy }]}>
                    <Ionicons name="map-outline" size={24} color={Palette.navy} />
                  </View>
                  <Text style={styles.gestionTitulo}>Gestionar ruta</Text>
                  <Text style={styles.gestionSub}>Revisa asignaciones, furgones y estado de visitas.</Text>
                  <Ionicons name="chevron-forward" size={20} color={Palette.onNavyMuted} style={styles.gestionChevron} />
                </Pressable>
              </View>
            </>
          ) : null
          /* Recuadro "Cobranza" del casero (comentado por ahora)
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Cobranza</Text>
            <Text style={styles.summaryBig}>{conDeuda} de {clientes.length} clientes por visitar</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progreso * 100}%` }]} />
            </View>
            <Text style={styles.summarySmall}>Por cobrar: {clp(totalPorCobrar)}</Text>
          </View>
          */}

          {rolUsuario && !soyGerente && (
            <View style={[styles.sectionRow, { marginBottom: 14 }]}>
              <Text style={styles.heroJornadaTitle}>Jornada de hoy</Text>
            </View>
          )}

          {/* Mi ruta de hoy: el casero siempre; el gerente solo si también tiene paradas asignadas */}
          {rolUsuario && (!soyGerente || miRuta.total > 0) && (
            <Pressable
              style={({ pressed }) => [styles.summaryCard, soyGerente && { marginTop: 12 }, pressed && styles.cardPressed]}
              onPress={() => router.push(
                miRuta.estado === 'en_curso' ? '../ruta-en-curso'
                : miRuta.estado === 'preparacion' && miRuta.total > 0 ? '../organizar-ruta'
                : '../mi-ruta')}
            >
              <View style={styles.sectionRow}>
                <Text style={styles.summaryLabel}>Mi ruta de hoy · {textoEstadoJornada(miRuta.estado)}</Text>
                <Ionicons name="chevron-forward" size={18} color={Palette.onNavyMuted} />
              </View>
              <Text style={styles.summaryBig}>
                {miRuta.total === 0 ? 'Sin clientes asignados' : `${miRuta.pendientes} de ${miRuta.total} por visitar`}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${miRuta.total ? ((miRuta.total - miRuta.pendientes) / miRuta.total) * 100 : 0}%` }]} />
              </View>
            </Pressable>
          )}
        </View>

        <View style={styles.actionsContainer}>
          <Text style={styles.sectionTitle}>Accesos rápidos</Text>

          <View style={styles.quickRow}>
            <Pressable
              style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
              onPress={() => router.push('../registrar-cliente')}
            >
              <View style={[styles.quickIcon, { backgroundColor: Palette.navySoft }]}>
                <Ionicons name="person-add-outline" size={24} color={Palette.navy} />
              </View>
              <Text style={styles.quickText}>Nuevo cliente</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
              onPress={() => router.push('../registrar-venta')}
            >
              <View style={[styles.quickIcon, { backgroundColor: Palette.navySoft }]}>
                <Ionicons name="cart-outline" size={24} color={Palette.navy} />
              </View>
              <Text style={styles.quickText}>Registrar venta</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
              onPress={() => router.push('../clientes')}
            >
              <View style={[styles.quickIcon, { backgroundColor: Palette.navySoft }]}>
                <Ionicons name="people-outline" size={24} color={Palette.navy} />
              </View>
              <Text style={styles.quickText}>Clientes</Text>
            </Pressable>

            {/* Registrar pago: oculto para el gerente (paga desde la ficha de cada cliente) */}
            {!soyGerente && (
            <Pressable
              style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
              onPress={() => router.push('../registrar-pago')}
            >
              <View style={[styles.quickIcon, { backgroundColor: Palette.greenSoft }]}>
                <Ionicons name="cash-outline" size={24} color={Palette.green} />
              </View>
              <Text style={styles.quickText}>Registrar pago</Text>
            </Pressable>
            )}

            {rolUsuario === 'dueno' && (
              <Pressable
                style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
                onPress={() => router.push('../ver-historial')}
              >
                <View style={[styles.quickIcon, { backgroundColor: Palette.amberSoft }]}>
                  <Ionicons name="time-outline" size={24} color={Palette.orange} />
                </View>
                <Text style={styles.quickText}>Historial</Text>
              </Pressable>
            )}

            {rolUsuario === 'dueno' && (
              <Pressable
                style={({ pressed }) => [styles.quick, { borderColor: Palette.orange, borderStyle: 'dashed', borderWidth: 1.5 }, pressed && styles.cardPressed]}
                onPress={() => reiniciarDia(jornada?.id, () => { obtenerOCrearJornadaHoy(true).then(setJornada).catch(() => {}) })}
              >
                <View style={[styles.quickIcon, { backgroundColor: Palette.amberSoft }]}>
                  <Ionicons name="bug-outline" size={24} color={Palette.orange} />
                </View>
                <Text style={styles.quickText}>Depuración del día</Text>
              </Pressable>
            )}

            {rolUsuario === 'dueno' && (
              <Pressable
                style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
                onPress={() => router.push('../calendario')}
              >
                <View style={[styles.quickIcon, { backgroundColor: Palette.amberSoft }]}>
                  <Ionicons name="calendar-outline" size={24} color={Palette.orange} />
                </View>
                <Text style={styles.quickText}>Calendario</Text>
              </Pressable>
            )}

            {rolUsuario === 'dueno' && (
              <Pressable
                style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
                onPress={() => router.push('../seguimiento')}
              >
                <View style={[styles.quickIcon, { backgroundColor: Palette.navySoft }]}>
                  <Ionicons name="navigate-circle-outline" size={24} color={Palette.navy} />
                </View>
                <Text style={styles.quickText}>Seguimiento</Text>
              </Pressable>
            )}

            {rolUsuario === 'dueno' && (
              <Pressable
                style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
                onPress={() => router.push('../trabajadores')}
              >
                <View style={[styles.quickIcon, { backgroundColor: Palette.navySoft }]}>
                  <Ionicons name="people" size={24} color={Palette.navy} />
                </View>
                <Text style={styles.quickText}>Trabajadores</Text>
              </Pressable>
            )}

            {rolUsuario === 'dueno' && (
              <Pressable
                style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
                onPress={() => router.push('../zonas')}
              >
                <View style={[styles.quickIcon, { backgroundColor: Palette.greenSoft }]}>
                  <Ionicons name="map-outline" size={24} color={Palette.green} />
                </View>
                <Text style={styles.quickText}>Zonas</Text>
              </Pressable>
            )}

            {rolUsuario === 'dueno' && (
              <Pressable
                style={({ pressed }) => [styles.quick, pressed && styles.cardPressed]}
                onPress={() => router.push('../solicitudes-descuento')}
              >
                <View style={[styles.quickIcon, { backgroundColor: Palette.navySoft }]}>
                  <Ionicons name="pricetag-outline" size={24} color={Palette.navy} />
                </View>
                <Text style={styles.quickText}>Descuentos</Text>
              </Pressable>
            )}
          </View>

          {!!rolUsuario && (() => {
            // Dos vistas: todos los clientes, o solo los asignados hoy a mi ruta
            const enVista = vistaMapa === 'todos' ? clientesMapa : clientesMapa.filter((c) => misClientes.includes(c.id))
            const ubicaciones = ubicacionesDeClientes(enVista, deudas)
            const conUbicacion = ubicaciones.reduce((n, u) => n + u.clientes.length, 0)
            const conDeudaMapa = ubicaciones.reduce((n, u) => n + u.clientes.filter((c) => c.deuda > 0).length, 0)
            const sinUbicacion = enVista.length - conUbicacion
            return (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Mapa de clientes</Text>
                <View style={styles.vistaFila}>
                  {([['todos', 'Todos los clientes'], ['asignados', `Mis clientes asignados (${misClientes.length})`]] as const).map(([k, t]) => (
                    <Pressable key={k} style={[styles.vistaChip, vistaMapa === k && styles.vistaChipActivo]} onPress={() => setVistaMapa(k)}>
                      <Text style={[styles.vistaChipText, vistaMapa === k && { color: Palette.cream }]}>{t}</Text>
                    </Pressable>
                  ))}
                </View>
                {vistaMapa === 'asignados' && misClientes.length === 0 ? (
                  <Text style={styles.leyendaText}>No tienes clientes asignados hoy.</Text>
                ) : (
                <View style={styles.mapContainer}>
                  <MapaClientes ubicaciones={ubicaciones} estilo="punto" onPressCliente={(id) => router.push({ pathname: '/cliente/[id]', params: { id } } as any)} />
                </View>
                )}
                {/* Leyenda: verde al día, amarillo con deuda */}
                <View style={styles.leyendaMapa}>
                  <View style={styles.leyendaItem}>
                    <View style={[styles.leyendaPunto, { backgroundColor: Palette.green, borderColor: '#FFFFFF' }]} />
                    <Text style={styles.leyendaText}>{conUbicacion - conDeudaMapa} al día</Text>
                  </View>
                  <View style={styles.leyendaItem}>
                    <View style={[styles.leyendaPunto, { backgroundColor: Palette.yellow, borderColor: Palette.yellowBorder }]} />
                    <Text style={styles.leyendaText}>{conDeudaMapa} con deuda</Text>
                  </View>
                  {sinUbicacion > 0 && <Text style={styles.leyendaText}>· {sinUbicacion} sin ubicación</Text>}
                </View>
              </>
            )
          })()}

          {/* Lista de clientes: el gerente ve solo 5 (primero los que más deben) y un enlace a Clientes */}
          <>
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Clientes con más deuda</Text>
            {clientes.length > 5 && (
              <Pressable onPress={() => router.push('../clientes')} hitSlop={6}>
                <Text style={styles.verTodos}>Ver todos los clientes</Text>
              </Pressable>
            )}
          </View>

          {clientes.length === 0 && (
            <Text style={styles.emptyText}>Aún no hay clientes registrados.</Text>
          )}

          {[...clientes].sort((a, b) => (deudas[b.id] || 0) - (deudas[a.id] || 0) || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 5).map((c, i) => {
            const deuda = deudas[c.id] || 0
            return (
              <View key={c.id} style={styles.clienteRow}>
                <View style={styles.numero}>
                  <Text style={styles.numeroText}>{i + 1}</Text>
                </View>
                <View style={styles.clienteInfo}>
                  <Text style={styles.clienteNombre} numberOfLines={1}>{c.nombre}</Text>
                  {!!c.direccion && (
                    <View style={styles.dirRow}>
                      <Ionicons name="location-outline" size={13} color={Palette.textMuted} />
                      <Text style={styles.dirText} numberOfLines={1}>{c.direccion}</Text>
                    </View>
                  )}
                  <View style={[styles.pill, { backgroundColor: deuda > 0 ? Palette.amberSoft : Palette.greenSoft }]}>
                    <Text style={[styles.pillText, { color: deuda > 0 ? Palette.amber : Palette.green }]}>
                      {deuda > 0 ? `Debe ${clp(deuda)}` : 'Al día'}
                    </Text>
                  </View>
                </View>
                {deuda > 0 && (
                  <Pressable
                    style={({ pressed }) => [styles.cobrarBtn, pressed && { opacity: 0.8 }]}
                    onPress={() => router.push({ pathname: '/registrar-pago', params: { clienteId: c.id } } as any)}
                  >
                    <Text style={styles.cobrarText}>Cobrar/Abonar</Text>
                  </Pressable>
                )}
              </View>
            )
          })}
          </>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.cream,
  },
  hero: {
    backgroundColor: Palette.navy,
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  heroHello: { fontSize: 13, color: Palette.onNavyMuted },
  heroBrand: { fontSize: 22, fontWeight: '800', color: Palette.onNavy },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: Palette.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Palette.navy },
  badgeText: { color: Palette.onNavy, fontSize: 10, fontWeight: '800' },
  bannerCorr: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.yellow, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  bannerCorrText: { flex: 1, fontSize: 14, fontWeight: '800', color: Palette.navy },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.onNavyFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    backgroundColor: Palette.onNavyFill,
    borderRadius: 18,
    padding: 16,
  },
  summaryLabel: { fontSize: 12, fontWeight: '600', color: Palette.onNavyMuted },
  summaryBig: { fontSize: 20, fontWeight: '800', color: Palette.onNavy, marginTop: 4 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.onNavyFill,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: Palette.orange },
  jornadaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Palette.orange, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 3 },
  jornadaBtnText: { color: Palette.onNavy, fontSize: 13, fontWeight: '800' },
  heroJornadaTitle: { fontSize: 13, fontWeight: '700', color: Palette.onNavyMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  gestionRow: { flexDirection: 'row', gap: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gestionChevron: { position: 'absolute', top: 14, right: 12 },
  gestionCard: { flex: 1, gap: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)', backgroundColor: Palette.onNavyFill, padding: 14, minHeight: 148 },
  gestionMint: {},
  gestionLila: {},
  gestionIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  gestionTitulo: { fontSize: 16, fontWeight: '800', color: Palette.onNavy },
  gestionSub: { fontSize: 12, lineHeight: 16, color: Palette.onNavyMuted },
  summarySmall: { fontSize: 13, color: Palette.onNavyMuted, marginTop: 10 },
  actionsContainer: {
    padding: 20,
    gap: 12,
  },
  mapContainer: { height: 280, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.card, marginBottom: 6 },
  verTodos: { fontSize: 13, fontWeight: '800', color: Palette.orange, marginTop: 8 },
  vistaFila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  vistaChip: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
  vistaChipActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  vistaChipText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  leyendaMapa: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leyendaPunto: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  leyendaText: { fontSize: 12, color: Palette.textMuted },
  mapHint: { fontSize: 12, color: Palette.textMuted, marginBottom: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  quick: {
    width: '47.5%',
    flexGrow: 1,
    backgroundColor: Palette.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickText: { flex: 1, fontSize: 14, fontWeight: '700', color: Palette.text },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  emptyText: { color: Palette.textMuted, textAlign: 'center', marginTop: 8 },
  clienteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    padding: 12,
    gap: 10,
  },
  numero: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Palette.grayPill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numeroText: { fontSize: 13, fontWeight: '700', color: Palette.textMuted },
  clienteInfo: { flex: 1, gap: 4 },
  clienteNombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dirText: { flex: 1, fontSize: 12, color: Palette.textMuted },
  pill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  cobrarBtn: {
    backgroundColor: Palette.navy,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cobrarText: { color: Palette.onNavy, fontSize: 12, fontWeight: '700' },
})

export default HomeScreen
