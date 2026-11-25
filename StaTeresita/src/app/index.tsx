// app/index.tsx
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { cuentaActiva } from '@/lib/notificaciones'
import { formatearRut, normalizarRut, rutValido } from '@/lib/rut'
import { Palette } from '@/constants/palette'


const Index = () => {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [rut, setRut] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revisando, setRevisando] = useState(true)

  // Si ya hay una sesión guardada en el teléfono y la cuenta sigue activa, entra directo
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const user = data.session?.user
        if (user) {
          const activa = await cuentaActiva(user.id)
          if (activa === false) {
            await supabase.auth.signOut()
            Alert.alert('Cuenta desactivada', 'Tu cuenta fue desactivada. Habla con el gerente.')
          } else {
            router.replace('./(tabs)/home')
            return
          }
        }
      } catch { /* sin sesión: mostrar el login */ }
      setRevisando(false)
    })()
  }, [router])

  // Con RUT: la función login-rut de Supabase busca la cuenta por el RUT y devuelve la sesión
  const entrarConRut = async (): Promise<{ data: { user: any } ; error: { message: string } | null }> => {
    const { data, error } = await supabase.functions.invoke('login-rut', { body: { rut: normalizarRut(rut), password } })
    if (error) {
      let mensaje = 'RUT o contraseña incorrectos'
      try {
        const ctx = (error as any).context
        if (ctx?.status === 404) mensaje = 'El inicio con RUT aún no está activado. Entra con correo.'
        else { const j = await ctx?.json?.(); if (j?.error) mensaje = j.error }
      } catch {
        mensaje = 'No hay conexión. Revisa tu internet e inténtalo de nuevo.'
      }
      if ((error as any).name === 'FunctionsFetchError') mensaje = 'No hay conexión. Revisa tu internet e inténtalo de nuevo.'
      return { data: { user: null }, error: { message: mensaje } }
    }
    const r = await supabase.auth.setSession({ access_token: (data as any).access_token, refresh_token: (data as any).refresh_token })
    return { data: { user: r.data.user }, error: r.error ? { message: r.error.message } : null }
  }

  const handleLogin = async () => {
    if (!rut || !password) {
      Alert.alert('Error', 'Por favor ingresa tu RUT y contraseña')
      return
    }
    if (!rutValido(rut)) {
      Alert.alert('Error', 'Revisa el RUT: el dígito verificador no calza')
      return
    }
    setLoading(true)

    const { data, error } = await entrarConRut()

    // Un trabajador desactivado por el gerente no puede entrar
    let desactivado = false
    if (!error && data.user) {
      const { data: perfil } = await supabase.from('perfiles').select('*').eq('id', data.user.id).maybeSingle()
      desactivado = !perfil || perfil.activo === false || !perfil.rol
    }

    if (error) {
      // Supabase responde "User is banned" cuando la cuenta fue desactivada
      const baneado = /banned/i.test(error.message)
      Alert.alert('Error al iniciar sesión', baneado ? 'Tu cuenta está desactivada. Habla con el gerente.' : error.message)
      setLoading(false)
    } else if (desactivado) {
      await supabase.auth.signOut()
      Alert.alert('Cuenta desactivada', 'Tu cuenta está desactivada. Habla con el gerente.')
      setLoading(false)
    } else {
      setLoading(false)
      router.replace('./(tabs)/home');

    }

  }

  if (revisando) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.navy }]}>
        <ActivityIndicator size="large" color={Palette.onNavy} />
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {/* Cabecera de marca */}
      <View style={[styles.hero, { paddingTop: insets.top + 40 }]}>
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>ST</Text>
        </View>
        <Text style={styles.brand}>Santa Teresita</Text>
        <Text style={styles.brandSubtitle}>Artículos para el hogar, casa por casa</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Bienvenido</Text>
          <Text style={styles.subtitle}>Inicia sesión para continuar</Text>

          <Text style={styles.label}>RUT</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="id-card-outline" size={20} color={Palette.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="12.345.678-9"
              placeholderTextColor={Palette.textFaint}
              value={rut}
              onChangeText={(t) => setRut(formatearRut(t))}
              keyboardType="visible-password"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
            />
          </View>

          {/* Campo de contraseña */}
          <Text style={styles.label}>Contraseña</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color={Palette.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Contraseña"
              placeholderTextColor={Palette.textFaint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!mostrarPassword}
            />
            <Pressable 
              onPress={() => setMostrarPassword(!mostrarPassword)}
              style={styles.eyeIcon}
            >
              <Ionicons 
                name={mostrarPassword ? "eye-outline" : "eye-off-outline"} 
                size={20} 
                color={Palette.textMuted} 
              />
            </Pressable>
          </View>

          {/* Botón de inicio de sesión */}
          <Pressable 
            onPress={handleLogin}
            disabled={loading}
            style={({ pressed }) => [
              styles.loginButton,
              (pressed || loading) && styles.buttonPressed
            ]}
          >
            {loading ? (
              <ActivityIndicator color={Palette.onNavy} />
            ) : (
              <Text style={styles.loginButtonText}>Iniciar Sesión</Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  hero: {
    backgroundColor: Palette.navy,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 96,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  logoBox: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: Palette.onNavyFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logoText: { color: Palette.onNavy, fontSize: 22, fontWeight: '800' },
  brand: { fontSize: 30, fontWeight: '800', color: Palette.onNavy },
  brandSubtitle: { fontSize: 14, color: Palette.onNavyMuted, marginTop: 6, textAlign: 'center' },
  content: { paddingHorizontal: 20, marginTop: -64 },
  card: {
    backgroundColor: Palette.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Palette.border,
    shadowColor: Palette.navyDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  title: { fontSize: 20, fontWeight: '700', color: Palette.text },
  subtitle: { fontSize: 14, color: Palette.textMuted, marginTop: 4, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: Palette.text, marginBottom: 6 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.inputFill,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    height: 52,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: Palette.text },
  eyeIcon: { padding: 8 },
  loginButton: {
    backgroundColor: Palette.navy,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonPressed: { opacity: 0.7 },
  loginButtonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
})

export default Index
