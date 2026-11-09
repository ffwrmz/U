import DireccionCliente from '@/components/DireccionCliente'
import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { EstadoParada, Jornada, listarParadas, marcarParada, obtenerOCrearJornadaHoy, Parada, textoEstadoJornada } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { abrirWhatsApp } from '@/lib/whatsapp'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const ESTADO = {
  pendiente: { texto: 'Pendiente', fondo: Palette.grayPill, color: Palette.textMuted },
  visitado: { texto: 'Visitado', fondo: Palette.greenSoft, color: Palette.green },
  no_estaba: { texto: 'No estaba', fondo: Palette.amberSoft, color: Palette.orange },
} as const

const hora = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

// Ruta de hoy del usuario (casero): sus paradas en orden y marcar cada visita.
// Lee jornadas y ruta_paradas (lib/rutas.ts); el casero solo ve y marca sus propias paradas.
const MiRuta = () => {
  const router = useRouter()
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [paradas, setParadas] = useState<Parada[]>([])
  const [marcando, setMarcando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No hay sesión activa')
      const j = await obtenerOCrearJornadaHoy(false)
      setJornada(j)
      setParadas(j ? await listarParadas(j.id, user.id) : [])
      setError(null)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
      setRefrescando(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const estado = jornada?.estado
  const puedeMarcar = estado === 'en_curso'
  const hechas = paradas.filter((p) => p.estado !== 'pendiente').length
  const visitadas = paradas.filter((p) => p.estado === 'visitado').length
  const progreso = paradas.length ? hechas / paradas.length : 0

  const marcar = async (p: Parada, nuevo: EstadoParada) => {
    setMarcando(p.id)
    try {
      await marcarParada(p.id, nuevo)
      // Se actualiza en pantalla sin esperar a recargar todo
      setParadas((l) => l.map((x) => (x.id === p.id ? { ...x, estado: nuevo, visitado_en: nuevo === 'pendiente' ? null : new Date().toISOString() } : x)))
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e))
    } finally {
      setMarcando(null)
    }
  }

  const aviso =
    !jornada ? 'Hoy todavía no hay una ruta creada.'
    : estado === 'preparacion' ? 'La ruta aún no se inicia. Podrás marcar las visitas cuando el gerente la inicie.'
    : estado === 'finalizada' ? 'La jornada de hoy terminó. Solo puedes ver cómo quedó.'
    : null

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Mi ruta de hoy" />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={paradas}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => { setRefrescando(true); cargar() }} tintColor={Palette.navy} />}
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              {error && (
                <View style={styles.aviso}>
                  <Ionicons name="warning-outline" size={20} color={Palette.amber} />
                  <Text style={styles.avisoText}>No se pudo cargar la ruta: {error}</Text>
                </View>
              )}
              <View style={styles.resumen}>
                <Text style={styles.resumenLabel}>Jornada de hoy · {textoEstadoJornada(estado)}</Text>
                <Text style={styles.resumenBig}>{hechas} de {paradas.length} paradas</Text>
                <View style={styles.track}><View style={[styles.fill, { width: `${progreso * 100}%` }]} /></View>
                <Text style={styles.resumenSub}>{visitadas} visitadas · {hechas - visitadas} no estaban · {paradas.length - hechas} pendientes</Text>
              </View>
              {aviso && (
                <View style={styles.avisoNavy}>
                  <Ionicons name="information-circle-outline" size={20} color={Palette.navy} />
                  <Text style={styles.avisoNavyText}>{aviso}</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            !error && jornada ? (
              <View style={styles.vacio}>
                <Ionicons name="map-outline" size={36} color={Palette.textFaint} />
                <Text style={styles.vacioText}>No tienes clientes asignados hoy.{'\n'}Cuando el gerente arme tu ruta aparecerán aquí.</Text>
              </View>
            ) : undefined
          }
          renderItem={({ item: p, index }) => {
            const e = ESTADO[p.estado] ?? ESTADO.pendiente
            const c = p.cliente
            const ocupado = marcando === p.id
            return (
              <View style={[styles.card, p.estado !== 'pendiente' && { opacity: 0.85 }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.numero, { backgroundColor: e.fondo }]}>
                    <Text style={[styles.numeroText, { color: e.color }]}>{index + 1}</Text>
                  </View>
                  <Pressable style={{ flex: 1, gap: 3 }} disabled={!c}
                    onPress={() => c && router.push({ pathname: '/cliente/[id]', params: { id: c.id } } as any)}>
                    <Text style={styles.nombre} numberOfLines={1}>{c?.nombre ?? 'Cliente'}</Text>
                    {c && <DireccionCliente c={c} />}
                  </Pressable>
                  {c?.telefono ? (
                    <Pressable style={({ pressed }) => [styles.botonWhatsApp, pressed && { opacity: 0.8 }]}
                      onPress={() => abrirWhatsApp(c.telefono)} accessibilityLabel="Escribir por WhatsApp" hitSlop={8}>
                      <Ionicons name="logo-whatsapp" size={20} color={Palette.onNavy} />
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.cardBottom}>
                  <View style={[styles.pill, { backgroundColor: e.fondo }]}>
                    <Text style={[styles.pillText, { color: e.color }]}>
                      {e.texto}{p.visitado_en && p.estado !== 'pendiente' ? ` · ${hora(p.visitado_en)}` : ''}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  {ocupado ? (
                    <ActivityIndicator size="small" color={Palette.navy} />
                  ) : !puedeMarcar ? null : p.estado === 'pendiente' ? (
                    <>
                      <Pressable style={[styles.accion, { backgroundColor: Palette.amberSoft }]} onPress={() => marcar(p, 'no_estaba')}>
                        <Ionicons name="close" size={16} color={Palette.orange} />
                        <Text style={[styles.accionText, { color: Palette.orange }]}>No estaba</Text>
                      </Pressable>
                      <Pressable style={[styles.accion, { backgroundColor: Palette.green }]} onPress={() => marcar(p, 'visitado')}>
                        <Ionicons name="checkmark" size={16} color={Palette.onNavy} />
                        <Text style={[styles.accionText, { color: Palette.onNavy }]}>Visitado</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable style={styles.deshacer} onPress={() => marcar(p, 'pendiente')} hitSlop={6}>
                      <Ionicons name="arrow-undo-outline" size={15} color={Palette.navy} />
                      <Text style={styles.deshacerText}>Deshacer</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  resumen: { backgroundColor: Palette.navy, borderRadius: 18, padding: 16 },
  resumenLabel: { fontSize: 12, color: Palette.onNavyMuted },
  resumenBig: { fontSize: 22, fontWeight: '800', color: Palette.onNavy, marginTop: 4 },
  resumenSub: { fontSize: 12, color: Palette.onNavyMuted, marginTop: 8 },
  track: { height: 8, borderRadius: 4, backgroundColor: Palette.onNavyFill, marginTop: 10, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: Palette.orange },
  aviso: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Palette.amberSoft, borderRadius: 14, padding: 12 },
  avisoText: { flex: 1, fontSize: 13, color: Palette.amber },
  avisoNavy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Palette.navySoft, borderRadius: 14, padding: 12 },
  avisoNavyText: { flex: 1, fontSize: 13, color: Palette.navy },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 12, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  numero: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  numeroText: { fontSize: 13, fontWeight: '800' },
  nombre: { fontSize: 16, fontWeight: '800', color: Palette.text },
  botonWhatsApp: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.green },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  pillText: { fontSize: 12, fontWeight: '800' },
  accion: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  accionText: { fontSize: 13, fontWeight: '800' },
  deshacer: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6 },
  deshacerText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  vacio: { alignItems: 'center', gap: 10, marginTop: 30, paddingHorizontal: 20 },
  vacioText: { textAlign: 'center', color: Palette.textMuted, fontSize: 14, lineHeight: 20 },
})

export default MiRuta
