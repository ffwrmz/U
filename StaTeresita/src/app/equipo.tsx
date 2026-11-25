import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { Companero, listarEquipo } from '@/lib/ajustes'
import { supabase } from '@/lib/supabase'
import { abrirWhatsApp, tieneWhatsapp } from '@/lib/whatsapp'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Equipo: los trabajadores activos con un botón para escribirles por WhatsApp.
const Equipo = () => {
  const [lista, setLista] = useState<Companero[]>([])
  const [yo, setYo] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setYo(user?.id ?? null)
      setLista(await listarEquipo())
      setCargando(false)
    })()
  }, []))

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Equipo" subtitle="Escríbele a un compañero por WhatsApp" />
      {cargando ? <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          {lista.length === 0 && <Text style={styles.vacio}>No hay trabajadores para mostrar.</Text>}
          {lista.filter((t) => t.id !== yo).map((t) => {
            const wsp = tieneWhatsapp(t.telefono)
            return (
              <View key={t.id} style={styles.card}>
                <View style={[styles.avatar, { backgroundColor: t.rol === 'dueno' ? Palette.navy : Palette.orange }]}>
                  <Text style={styles.avatarText}>{t.nombre.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nombre} numberOfLines={1}>{t.nombre}</Text>
                  <Text style={styles.sub}>{t.rol === 'dueno' ? 'Gerente' : 'Casero'}{wsp ? '' : ' · sin teléfono'}</Text>
                </View>
                {wsp && (
                  <Pressable style={({ pressed }) => [styles.wsp, pressed && { opacity: 0.8 }]} onPress={() => abrirWhatsApp(t.telefono)}
                    accessibilityLabel={`Escribirle a ${t.nombre} por WhatsApp`} hitSlop={6}>
                    <Ionicons name="logo-whatsapp" size={22} color={Palette.onNavy} />
                  </Pressable>
                )}
              </View>
            )
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Palette.onNavy, fontSize: 18, fontWeight: '800' },
  nombre: { fontSize: 16, fontWeight: '700', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  wsp: { width: 44, height: 44, borderRadius: 22, backgroundColor: Palette.green, alignItems: 'center', justifyContent: 'center' },
})

export default Equipo
