import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { escucharNotificaciones, listarNotificaciones, marcarLeida, marcarTodasLeidas, Notificacion } from '@/lib/notificaciones'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const ICONO: Record<string, keyof typeof Ionicons.glyphMap> = {
  ruta_asignada: 'map-outline',
  correccion_nueva: 'create-outline',
  correccion_resuelta: 'checkmark-done-outline',
  descuento_nuevo: 'pricetag-outline',
}

const hace = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

// Notificaciones del usuario: tocar una la marca como leída y abre su pantalla.
const Notificaciones = () => {
  const router = useRouter()
  const [lista, setLista] = useState<Notificacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [miId, setMiId] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLista(await listarNotificaciones())
    setCargando(false)
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMiId(data.user?.id ?? null)) }, [])
  useEffect(() => (miId ? escucharNotificaciones(miId, () => { cargar() }) : undefined), [miId, cargar])

  const abrir = async (n: Notificacion) => {
    if (!n.leida) { setLista((l) => l.map((x) => (x.id === n.id ? { ...x, leida: true } : x))); marcarLeida(n.id) }
    if (n.datos?.ruta) router.push(n.datos.ruta as any)
  }

  const noLeidas = lista.filter((n) => !n.leida).length

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Notificaciones" />
      {cargando ? <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          {noLeidas > 0 && (
            <Pressable style={styles.todas} onPress={async () => { setLista((l) => l.map((x) => ({ ...x, leida: true }))); await marcarTodasLeidas() }}>
              <Ionicons name="checkmark-done" size={16} color={Palette.navy} />
              <Text style={styles.todasText}>Marcar todas como leídas</Text>
            </Pressable>
          )}
          {lista.length === 0 && <Text style={styles.vacio}>No tienes notificaciones.</Text>}
          {lista.map((n) => (
            <Pressable key={n.id} style={({ pressed }) => [styles.card, !n.leida && styles.cardNueva, pressed && { opacity: 0.85 }]} onPress={() => abrir(n)}>
              <View style={[styles.icono, !n.leida && { backgroundColor: Palette.orange }]}>
                <Ionicons name={ICONO[n.tipo] ?? 'notifications-outline'} size={20} color={n.leida ? Palette.navy : Palette.onNavy} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.titulo}>{n.titulo}</Text>
                {!!n.cuerpo && <Text style={styles.cuerpo}>{n.cuerpo}</Text>}
                <Text style={styles.fecha}>{hace(n.creado_en)}</Text>
              </View>
              {!!n.datos?.ruta && <Ionicons name="chevron-forward" size={18} color={Palette.textFaint} />}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14 },
  todas: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingVertical: 4 },
  todasText: { fontSize: 13, fontWeight: '800', color: Palette.navy },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14 },
  cardNueva: { borderColor: Palette.orange, backgroundColor: Palette.amberSoft },
  icono: { width: 40, height: 40, borderRadius: 12, backgroundColor: Palette.navySoft, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 15, fontWeight: '800', color: Palette.text },
  cuerpo: { fontSize: 13, color: Palette.textMuted },
  fecha: { fontSize: 12, color: Palette.textFaint },
})

export default Notificaciones
