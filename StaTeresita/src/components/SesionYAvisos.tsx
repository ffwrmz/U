import { Palette } from '@/constants/palette'
import { cuentaActiva, escucharNotificaciones, marcarLeida, Notificacion } from '@/lib/notificaciones'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { usePathname, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Notificaciones del sistema (expo-notifications). Si no se puede cargar (web), se usa solo el aviso dentro de la app.
let Notifs: typeof import('expo-notifications') | null = null
try {
  if (Platform.OS !== 'web') {
    Notifs = require('expo-notifications')
    Notifs!.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    })
  }
} catch { Notifs = null }

export const pedirPermisoNotificaciones = async () => {
  try {
    if (!Notifs) return
    const actual = await Notifs.getPermissionsAsync()
    if (!actual.granted && actual.canAskAgain) await Notifs.requestPermissionsAsync()
  } catch { /* sin permiso: solo aviso dentro de la app */ }
}

const notificarSistema = async (n: Notificacion) => {
  try {
    if (!Notifs) return
    await Notifs.scheduleNotificationAsync({ content: { title: n.titulo, body: n.cuerpo ?? undefined, data: { ruta: n.datos?.ruta, id: n.id } }, trigger: null })
  } catch { /* nada */ }
}

// Vigila la sesión y las notificaciones en toda la app:
// - si el gerente desactiva la cuenta, cierra la sesión y vuelve al login (al abrir, al volver a la app y cada minuto);
// - escucha en tiempo real las notificaciones del usuario: muestra un aviso arriba y una notificación del teléfono.
const SesionYAvisos = () => {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const [usuarioId, setUsuarioId] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Notificacion | null>(null)
  const vistas = useRef(new Set<string>())
  const enLogin = useRef(true)
  enLogin.current = pathname === '/'

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUsuarioId(data.session?.user.id ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => {
      setUsuarioId(sesion?.user.id ?? null)
      if (evento === 'SIGNED_OUT' && !enLogin.current) router.replace('/')
    })
    return () => sub.subscription.unsubscribe()
  }, [router])

  // Cuenta desactivada → fuera
  const revisarCuenta = useCallback(async () => {
    if (!usuarioId) return
    const activa = await cuentaActiva(usuarioId)
    if (activa === false) {
      await supabase.auth.signOut()
      router.replace('/')
      Alert.alert('Cuenta desactivada', 'Tu cuenta fue desactivada. Habla con el gerente.')
    }
  }, [usuarioId, router])

  useEffect(() => {
    if (!usuarioId) return
    revisarCuenta()
    pedirPermisoNotificaciones()
    const intervalo = setInterval(revisarCuenta, 60_000)
    const app = AppState.addEventListener('change', (e) => { if (e === 'active') revisarCuenta() })
    return () => { clearInterval(intervalo); app.remove() }
  }, [usuarioId, revisarCuenta])

  // Notificaciones nuevas en tiempo real
  useEffect(() => {
    if (!usuarioId) return
    return escucharNotificaciones(usuarioId, (n) => {
      if (!n || n.leida) return
      const clave = `${n.id}-${n.creado_en}`
      if (vistas.current.has(clave)) return
      vistas.current.add(clave)
      setAviso(n)
      notificarSistema(n)
    })
  }, [usuarioId])

  // Al tocar la notificación del teléfono, abrir su pantalla
  useEffect(() => {
    if (!Notifs) return
    const s = Notifs.addNotificationResponseReceivedListener((r) => {
      const d = r.notification.request.content.data as any
      if (d?.id) marcarLeida(String(d.id))
      if (d?.ruta) router.push(d.ruta)
    })
    return () => s.remove()
  }, [router])

  // El aviso de arriba se esconde solo
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(t)
  }, [aviso])

  if (!aviso || !usuarioId) return null
  return (
    <View style={[styles.capa, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable style={styles.aviso} onPress={() => {
        const n = aviso
        setAviso(null)
        marcarLeida(n.id)
        if (n.datos?.ruta) router.push(n.datos.ruta as any)
      }}>
        <Ionicons name="notifications" size={20} color={Palette.orange} />
        <View style={{ flex: 1 }}>
          <Text style={styles.titulo}>{aviso.titulo}</Text>
          {!!aviso.cuerpo && <Text style={styles.cuerpo} numberOfLines={2}>{aviso.cuerpo}</Text>}
        </View>
        <Pressable onPress={() => setAviso(null)} hitSlop={10}><Ionicons name="close" size={18} color={Palette.onNavyMuted} /></Pressable>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  capa: { position: 'absolute', left: 12, right: 12, zIndex: 1000, elevation: 20 },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.navyDark, borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  titulo: { color: Palette.onNavy, fontSize: 14, fontWeight: '800' },
  cuerpo: { color: Palette.onNavyMuted, fontSize: 13, marginTop: 2 },
})

export default SesionYAvisos
