import Header from '@/components/Header'
import SolicitudesInventario from '@/components/SolicitudesInventario'
import { Palette } from '@/constants/palette'
import { cambiosDe, Correccion, escucharCorrecciones, ESTADO_TEXTO, listarCorrecciones, resolverCorreccion, TITULO_TIPO } from '@/lib/correcciones'
import { fechaCorta } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Solicitudes de corrección (gerente): lo que pidieron corregir los caseros, con Aprobar / Rechazar.
// Al aprobar, la base aplica el cambio (pago, producto vendido con su stock, o datos del cliente).
const Solicitudes = () => {
  // Dos tipos de solicitudes de los caseros: corrección de datos e inventario del furgón
  const { tab } = useLocalSearchParams<{ tab?: string }>()
  const [seccion, setSeccion] = useState<'correcciones' | 'inventario'>(tab === 'inventario' ? 'inventario' : 'correcciones')
  const router = useRouter()
  const [pestana, setPestana] = useState<'pendiente' | 'resueltas'>('pendiente')
  const [lista, setLista] = useState<Correccion[]>([])
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [comentarios, setComentarios] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    try {
      const l = await listarCorrecciones(pestana)
      setLista(l)
      setError(null)
      const ids = Array.from(new Set(l.map((c) => c.solicitado_por)))
      if (ids.length) {
        const { data } = await supabase.from('perfiles').select('id, nombre').in('id', ids)
        setNombres(Object.fromEntries(((data as any[]) || []).map((p) => [p.id, p.nombre])))
      }
    } catch (e: any) {
      console.warn('solicitudes:', e?.message ?? e)
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [pestana])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))
  useEffect(() => escucharCorrecciones(cargar), [cargar])

  const resolver = async (c: Correccion, aprobar: boolean) => {
    setProcesando(c.id)
    try {
      await resolverCorreccion(c.id, aprobar, comentarios[c.id])
      setComentarios((x) => { const { [c.id]: _, ...resto } = x; return resto })
    } catch (e: any) {
      Alert.alert('No se pudo resolver', e.message ?? String(e))
    } finally {
      setProcesando(null)
      cargar()
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Solicitudes" subtitle="Lo que pidieron los caseros" />
      <View style={styles.secciones}>
        {([['correcciones', 'Correcciones'], ['inventario', 'Inventario']] as const).map(([k, t]) => (
          <Pressable key={k} style={[styles.seccionBtn, seccion === k && styles.seccionSel]} onPress={() => setSeccion(k)}>
            <Text style={[styles.seccionText, seccion === k && { color: Palette.navy }]}>{t}</Text>
          </Pressable>
        ))}
      </View>
      {seccion === 'inventario' ? <SolicitudesInventario /> : (
      <>
      <View style={styles.tabs}>
        {(['pendiente', 'resueltas'] as const).map((t) => (
          <Pressable key={t} style={[styles.tab, pestana === t && styles.tabSel]} onPress={() => { setPestana(t); setCargando(true) }}>
            <Text style={[styles.tabText, pestana === t && { color: Palette.onNavy }]}>{t === 'pendiente' ? 'Pendientes' : 'Historial'}</Text>
          </Pressable>
        ))}
      </View>
      {cargando ? <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error && <Text style={styles.vacio}>No se pudieron cargar las solicitudes. Revisa tu conexión e intenta de nuevo.</Text>}
          {!error && lista.length === 0 && (
            <Text style={styles.vacio}>{pestana === 'pendiente' ? 'No hay solicitudes pendientes.' : 'Aún no hay solicitudes resueltas.'}</Text>
          )}
          {lista.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={styles.filaTop}>
                <Text style={styles.tipo}>{TITULO_TIPO[c.tipo]}</Text>
                {c.estado !== 'pendiente' && (
                  <View style={[styles.pill, { backgroundColor: c.estado === 'aprobada' ? Palette.greenSoft : Palette.grayPill }]}>
                    <Text style={[styles.pillText, { color: c.estado === 'aprobada' ? Palette.green : Palette.orange }]}>{ESTADO_TEXTO[c.estado]}</Text>
                  </View>
                )}
              </View>
              <Pressable onPress={() => c.cliente_id && router.push(`/cliente/${c.cliente_id}` as any)}>
                <Text style={styles.cliente}>{c.clientes?.nombre ?? 'Cliente'} <Ionicons name="chevron-forward" size={13} color={Palette.navy} /></Text>
              </Pressable>
              <Text style={styles.sub}>Pide: {nombres[c.solicitado_por] ?? 'Casero'} · {fechaCorta(c.solicitado_en)}</Text>
              <View style={styles.cambios}>
                {cambiosDe(c).map((x) => (
                  <View key={x.campo} style={styles.cambio}>
                    <Text style={styles.campo}>{x.campo}</Text>
                    <Text style={styles.antes}>{x.antes}</Text>
                    <Ionicons name="arrow-forward" size={14} color={Palette.textMuted} />
                    <Text style={styles.despues}>{x.despues}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.motivo}>“{c.motivo}”</Text>
              {c.estado === 'pendiente' ? (
                <>
                  <TextInput style={styles.input} value={comentarios[c.id] ?? ''} onChangeText={(t) => setComentarios((x) => ({ ...x, [c.id]: t }))}
                    placeholder="Comentario (opcional)" placeholderTextColor={Palette.textFaint} />
                  <View style={styles.botones}>
                    <Pressable style={[styles.boton, styles.rechazar]} disabled={!!procesando} onPress={() => resolver(c, false)}>
                      <Text style={[styles.botonText, { color: Palette.navy }]}>Rechazar</Text>
                    </Pressable>
                    <Pressable style={[styles.boton, styles.aprobar]} disabled={!!procesando} onPress={() => resolver(c, true)}>
                      {procesando === c.id ? <ActivityIndicator color={Palette.onNavy} /> : <Text style={styles.botonText}>Aprobar</Text>}
                    </Pressable>
                  </View>
                </>
              ) : !!c.comentario_gerente && <Text style={styles.sub}>Tu comentario: {c.comentario_gerente}</Text>}
            </View>
          ))}
        </ScrollView>
      )}
      </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  secciones: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, backgroundColor: Palette.navy, borderRadius: 12, padding: 4 },
  seccionBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  seccionSel: { backgroundColor: Palette.cream },
  seccionText: { fontSize: 14, fontWeight: '800', color: Palette.onNavy },
  container: { flex: 1, backgroundColor: Palette.cream },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 999, backgroundColor: Palette.navySoft, alignItems: 'center' },
  tabSel: { backgroundColor: Palette.navy },
  tabText: { fontSize: 14, fontWeight: '800', color: Palette.navy },
  content: { padding: 16, gap: 12 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14 },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 6 },
  filaTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tipo: { fontSize: 13, fontWeight: '800', color: Palette.orange, textTransform: 'uppercase' },
  cliente: { fontSize: 16, fontWeight: '800', color: Palette.navy },
  sub: { fontSize: 13, color: Palette.textMuted },
  cambios: { backgroundColor: Palette.cream, borderRadius: 12, padding: 10, gap: 6 },
  cambio: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  campo: { fontSize: 13, fontWeight: '700', color: Palette.text, minWidth: 80 },
  antes: { fontSize: 14, color: Palette.textMuted, textDecorationLine: 'line-through' },
  despues: { fontSize: 14, fontWeight: '800', color: Palette.navy },
  motivo: { fontSize: 14, color: Palette.text, fontStyle: 'italic' },
  input: { backgroundColor: Palette.inputFill, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 14, color: Palette.text },
  botones: { flexDirection: 'row', gap: 10 },
  boton: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  rechazar: { backgroundColor: Palette.navySoft },
  aprobar: { backgroundColor: Palette.green },
  botonText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '800' },
})

export default Solicitudes
