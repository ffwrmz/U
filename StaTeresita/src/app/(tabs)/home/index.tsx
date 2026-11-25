import { principalDe } from '@/lib/furgones'
import EstadoSync from '@/components/EstadoSync'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/roles'
import { reiniciarDia } from '@/components/DepuracionDia'
import MapaClientes from '@/components/MapaClientes'
import { ubicacionesDeClientes } from '@/lib/mapa'
import { ClienteRuta, estadoRutaDe, Jornada, listarEstadosCaseros, listarParadas, obtenerOCrearJornadaHoy, SELECT_CLIENTE, textoEstadoJornada } from '@/lib/rutas'
import { contarPendientes, escucharCorrecciones } from '@/lib/correcciones'
import { Permisos, permisosDe } from '@/lib/ajustes'
import { contarResueltasNoVistas } from '@/lib/misSolicitudes'
import { contarNoLeidas, escucharNotificaciones } from '@/lib/notificaciones'
import { clp } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Accesos rápidos agrupados, un color por grupo: fondo suave, círculo del ícono en el color fuerte y texto legible
const GRUPO = {
  hoy: { color: Palette.orange, fondo: Palette.orangeSoft, texto: Palette.orangeDark },
  seguimiento: { color: Palette.navy, fondo: Palette.navySoft, texto: Palette.navy },
  gestion: { color: Palette.teal, fondo: Palette.tealSoft, texto: Palette.teal },
  aprobaciones: { color: Palette.lilac, fondo: Palette.lilacSoft, texto: Palette.lilac },
}
type Acceso = { t: string; i: keyof typeof Ionicons.glyphMap; ruta: string; ver?: boolean; badge?: number }

const MODO_PRUEBAS = __DEV__ || process.env.EXPO_PUBLIC_MODO_PRUEBAS === '1'

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
  // Permisos del trabajador (Ajustes): ocultan los accesos que no puede usar
  const [permisos, setPermisos] = useState<Permisos>(permisosDe(null))
  // Solicitudes de corrección pendientes (campana del gerente; en tiempo real y al volver a la pantalla)
  const [correccionesPendientes, setCorreccionesPendientes] = useState(0)
  const esDueno = rolUsuario === 'dueno'
  // Todo lo que espera aprobación del gerente: correcciones + descuentos + inventario
  const contarAprobaciones = useCallback(async () => {
    const [c, d, i] = await Promise.all([
      contarPendientes(),
      supabase.from('solicitudes_descuento').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').then((r) => (r.error ? 0 : r.count ?? 0)),
      supabase.from('solicitudes_inventario').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').then((r) => (r.error ? 0 : r.count ?? 0)),
    ])
    setCorreccionesPendientes(c + d + i)
  }, [])
  const [resueltasNoVistas, setResueltasNoVistas] = useState(0)
  useFocusEffect(useCallback(() => {
    if (esDueno) contarAprobaciones()
    else if (rolUsuario) contarResueltasNoVistas().then(setResueltasNoVistas)
  }, [esDueno, rolUsuario, contarAprobaciones]))
  useEffect(() => {
    if (!esDueno) return
    return escucharCorrecciones(() => { contarAprobaciones() })
  }, [esDueno, contarAprobaciones])
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
        const { data } = await supabase
          .from('perfiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        if (data) {
          setRolUsuario(data.rol);
          setPermisos(permisosDe(data));
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
          // La ruta del equipo del furgón (si va con un compañero, es la misma para los dos)
          const dueñoRuta = await principalDe(user.id)
          const ps = await listarParadas(j.id, dueñoRuta)
          const est = await listarEstadosCaseros(j.id)
          setMiRuta({ estado: estadoRutaDe(j, est, dueñoRuta) ?? j.estado, total: ps.length, pendientes: ps.filter((p) => p.estado === 'pendiente').length })
          setMisClientes(ps.map((p) => p.cliente_id))
        } catch {
          setMiRuta({ estado: null, total: 0, pendientes: 0 })
        }
      }
      leer()
    }, [])
  )

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
              {esDueno && (
                <Pressable onPress={() => router.push('../ajustes')} style={styles.iconButton} accessibilityLabel="Ajustes">
                  <Ionicons name="settings-outline" size={22} color={Palette.onNavy} />
                </Pressable>
              )}
              <Pressable onPress={() => router.push('../notificaciones')} style={styles.iconButton} accessibilityLabel="Notificaciones">
                <Ionicons name={noLeidas > 0 ? 'notifications' : 'notifications-outline'} size={22} color={Palette.onNavy} />
                {noLeidas > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{noLeidas > 99 ? '99+' : noLeidas}</Text></View>
                )}
              </Pressable>
              <Pressable onPress={async () => { await supabase.auth.signOut(); router.replace('/') }} style={styles.salir} accessibilityLabel="Cerrar sesión">
                <Ionicons name="log-out-outline" size={18} color={Palette.onNavy} />
                <Text style={styles.salirText}>Salir</Text>
              </Pressable>
            </View>
          </View>

          {esDueno && correccionesPendientes > 0 && (
            <Pressable style={({ pressed }) => [styles.bannerCorr, pressed && styles.cardPressed]} onPress={() => router.push('../solicitudes')}>
              <Ionicons name="alert-circle" size={20} color={Palette.navy} />
              <Text style={styles.bannerCorrText}>
                Tienes {correccionesPendientes} {correccionesPendientes === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'} por aprobar
              </Text>
              <Ionicons name="chevron-forward" size={18} color={Palette.navy} />
            </Pressable>
          )}


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
                {miRuta.total === 0 ? 'Sin clientes asignados' : `${miRuta.total - miRuta.pendientes} de ${miRuta.total} visitados`}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${miRuta.total ? ((miRuta.total - miRuta.pendientes) / miRuta.total) * 100 : 0}%` }]} />
              </View>
            </Pressable>
          )}
        </View>

        <View style={styles.actionsContainer}>
          {soyGerente ? (
            <>
              <Grupo titulo="Hoy" g="hoy" grande router={router} items={[
                { t: 'Asignar clientes', i: 'map-outline', ruta: '../gestion-ruta' },
                { t: 'Registrar venta', i: 'cart-outline', ruta: '../registrar-venta' },
                { t: 'Registrar pago', i: 'cash-outline', ruta: '../registrar-pago' },
                { t: 'Nuevo cliente', i: 'person-add-outline', ruta: '../registrar-cliente' },
              ]} />
              <Grupo titulo="Seguimiento" g="seguimiento" router={router} items={[
                { t: 'Seguimiento', i: 'navigate-circle-outline', ruta: '../seguimiento' },
                { t: 'Calendario', i: 'calendar-outline', ruta: '../calendario' },
                { t: 'Historial', i: 'receipt-outline', ruta: '../ver-historial' },
              ]} />
              <Grupo titulo="Gestión" g="gestion" router={router} items={[
                { t: 'Clientes', i: 'people-outline', ruta: '../clientes' },
                { t: 'Trabajadores', i: 'people', ruta: '../trabajadores' },
                { t: 'Inventario', i: 'cube-outline', ruta: '../inventario-gerente' },
                { t: 'Zonas', i: 'location-outline', ruta: '../zonas' },
              ]} />
              <Grupo titulo="Aprobaciones" g="aprobaciones" router={router} items={[
                { t: 'Solicitudes', i: 'mail-unread-outline', ruta: '../solicitudes', badge: correccionesPendientes },
              ]} />
            </>
          ) : rolUsuario ? (
            <>
              <Grupo titulo="Mi trabajo" g="hoy" grande router={router} items={[
                { t: 'Vender', i: 'cart-outline', ruta: '../registrar-venta', ver: permisos.puede_vender },
                { t: 'Cobrar', i: 'cash-outline', ruta: '../registrar-pago', ver: permisos.puede_cobrar },
                { t: 'Mi inventario', i: 'cube-outline', ruta: '../mi-inventario' },
                { t: 'Trabajadores', i: 'people', ruta: '../trabajadores' },
              ]} />
              <View style={styles.enlaces}>
                {permisos.puede_crear_clientes && (
                  <Pressable style={styles.enlace} onPress={() => router.push('../registrar-cliente')}>
                    <Ionicons name="person-add-outline" size={16} color={Palette.navy} />
                    <Text style={styles.enlaceText}>Nuevo cliente</Text>
                  </Pressable>
                )}
                <Pressable style={styles.enlace} onPress={() => router.push('../mis-solicitudes')}>
                  <Ionicons name="mail-outline" size={16} color={Palette.navy} />
                  <Text style={styles.enlaceText}>Mis solicitudes</Text>
                  {resueltasNoVistas > 0 && <View style={styles.globito}><Text style={styles.globitoText}>{resueltasNoVistas}</Text></View>}
                </Pressable>
              </View>
            </>
          ) : null}

          {/* Solo para pruebas: en la app instalada no aparece, salvo con EXPO_PUBLIC_MODO_PRUEBAS=1 */}
          {MODO_PRUEBAS && esDueno && (
            <Pressable style={styles.depuracion} onPress={() => reiniciarDia(jornada?.id, () => { obtenerOCrearJornadaHoy(true).then(setJornada).catch(() => {}) })}>
              <Ionicons name="bug-outline" size={16} color={Palette.textMuted} />
              <Text style={styles.depuracionText}>Depuración del día</Text>
            </Pressable>
          )}

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
                    <View style={[styles.leyendaPunto, { backgroundColor: Palette.green, borderColor: Palette.white }]} />
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
              <View key={c.id} style={[styles.clienteRow, { borderLeftWidth: 4, borderLeftColor: deuda > 0 ? Palette.orange : Palette.green }]}>
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

// Grupo de accesos: título chico en mayúsculas y botones del color del grupo.
// "grande": 2 columnas con ícono y texto al lado; si no, 3 columnas con el ícono arriba.
const Grupo = ({ titulo, g, items, grande, router }: { titulo: string; g: keyof typeof GRUPO; items: Acceso[]; grande?: boolean; router: ReturnType<typeof useRouter> }) => {
  const c = GRUPO[g]
  const visibles = items.filter((a) => a.ver !== false)
  if (visibles.length === 0) return null
  return (
    <View style={{ gap: 8, marginBottom: 6 }}>
      <Text style={[styles.grupoTitulo, { color: c.texto }]}>{titulo}</Text>
      <View style={styles.grupoFila}>
        {visibles.map((a) => (
          <Pressable key={a.t} style={({ pressed }) => [grande ? styles.accesoGrande : styles.accesoChico, { backgroundColor: c.fondo }, pressed && styles.cardPressed]}
            onPress={() => router.push(a.ruta as any)}>
            <View style={[grande ? styles.accesoIconoGrande : styles.accesoIcono, { backgroundColor: c.color }]}>
              <Ionicons name={a.i} size={grande ? 24 : 26} color={Palette.onNavy} />
            </View>
            <Text style={[grande ? styles.accesoTextoGrande : styles.accesoTexto, { color: c.texto }]} numberOfLines={2}>{a.t}</Text>
            {!!a.badge && a.badge > 0 && <View style={styles.globito}><Text style={styles.globitoText}>{a.badge > 99 ? '99+' : a.badge}</Text></View>}
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  grupoTitulo: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  grupoFila: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  accesoGrande: { width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, padding: 14, minHeight: 72 },
  accesoIconoGrande: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  accesoTextoGrande: { flex: 1, fontSize: 15, fontWeight: '800' },
  accesoChico: { width: '31%', flexGrow: 1, alignItems: 'center', gap: 8, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 6 },
  accesoIcono: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  accesoTexto: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  globito: { position: 'absolute', top: 6, right: 6, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: Palette.orange, alignItems: 'center', justifyContent: 'center' },
  globitoText: { color: Palette.onNavy, fontSize: 12, fontWeight: '900' },
  enlaces: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  enlace: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, paddingRight: 30 },
  enlaceText: { fontSize: 14, fontWeight: '700', color: Palette.navy },
  depuracion: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  depuracionText: { fontSize: 12, color: Palette.textMuted, textDecorationLine: 'underline' },
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
  salir: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, borderRadius: 20, paddingHorizontal: 12, backgroundColor: Palette.orange },
  salirText: { color: Palette.onNavy, fontSize: 13, fontWeight: '800' },
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
  heroJornadaTitle: { fontSize: 13, fontWeight: '700', color: Palette.onNavyMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.navy,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
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
