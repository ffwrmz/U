import Header from '@/components/Header'
import TelefonoInput from '@/components/TelefonoInput'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { normalizarTelefono } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Trabajador { id: string; nombre: string; rol: string; activo?: boolean | null; email?: string | null; telefono?: string | null }
type Filtro = 'activos' | 'inactivos' | 'todos'

const ROLES = [
  { k: 'vendedor', t: 'Casero (vendedor)' },
  { k: 'dueno', t: 'Gerente' },
] as const

// Error de la Edge Function con el mensaje en español y si el trabajador tiene historial
class ErrorFuncion extends Error { historial = false }

// Llama a la Edge Function "gestionar-trabajador" (crear, activar, desactivar, eliminar cuentas).
const llamar = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke('gestionar-trabajador', { body })
  if (error) {
    // El mensaje de la función viene en el cuerpo de la respuesta (error.context es la Response)
    const err = new ErrorFuncion(error.message)
    try {
      const cuerpo = await (error as any).context?.json()
      if (cuerpo?.error) err.message = cuerpo.error
      err.historial = !!cuerpo?.historial
    } catch {}
    throw err
  }
  if (data?.error) throw new ErrorFuncion(data.error)
  return data
}

// Contraseña temporal fácil de dictar (sin letras parecidas como l/1 u O/0)
const generarPassword = () => {
  const letras = 'abcdefghjkmnpqrstuvwxyz', numeros = '23456789'
  const al = (s: string) => s[Math.floor(Math.random() * s.length)]
  return Array.from({ length: 4 }, () => al(letras)).join('') + Array.from({ length: 4 }, () => al(numeros)).join('')
}

// Trabajadores (solo gerente): ver, agregar, activar/desactivar y eliminar.
// Lee perfiles; los cambios de cuentas los hace la Edge Function (supabase/functions/trabajadores).
const Trabajadores = () => {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [yo, setYo] = useState<string | null>(null)
  const [lista, setLista] = useState<Trabajador[]>([])
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('activos')

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ nombre: '', email: '', password: '', telefono: '', rol: 'vendedor' as 'vendedor' | 'dueno' })
  const [verPassword, setVerPassword] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    setYo(user?.id ?? null)
    if (user) {
      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
      setSoyGerente(esGerente(perfil?.rol))
    }
    // select('*') para que funcione aunque todavía no existan las columnas activo/email
    const { data, error: e } = await supabase.from('perfiles').select('*').in('rol', ['dueno', 'vendedor']).order('nombre', { ascending: true })
    setError(e?.message ?? null)
    setLista((data as Trabajador[]) || [])
    setCargando(false)
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const activo = (t: Trabajador) => t.activo !== false

  const aplicarActivo = async (t: Trabajador, valor: boolean) => {
    setOcupado(t.id)
    try {
      await llamar({ accion: valor ? 'activar' : 'desactivar', id: t.id })
      setLista((l) => l.map((x) => (x.id === t.id ? { ...x, activo: valor } : x)))
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setOcupado(null)
    }
  }

  const cambiarActivo = (t: Trabajador, valor: boolean) => {
    if (valor) { aplicarActivo(t, true); return }
    Alert.alert('Desactivar trabajador', `${t.nombre} no podrá iniciar sesión ni aparecerá en rutas. Sus ventas y pagos se conservan.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Desactivar', style: 'destructive', onPress: () => aplicarActivo(t, false) },
    ])
  }

  const eliminar = (t: Trabajador) => {
    Alert.alert(
      'Eliminar trabajador',
      `Se borrará la cuenta de ${t.nombre} y ya no podrá entrar. Esto no se puede deshacer.\n\nSi tiene ventas, pagos o rutas registradas no se podrá eliminar: en ese caso desactívalo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive', onPress: async () => {
            setOcupado(t.id)
            try {
              await llamar({ accion: 'eliminar', id: t.id })
              setLista((l) => l.filter((x) => x.id !== t.id))
            } catch (e: any) {
              if (e instanceof ErrorFuncion && e.historial) {
                Alert.alert('No se puede eliminar', `${e.message}\n\n¿Quieres desactivarlo? No podrá iniciar sesión, pero se conserva su historial.`, [
                  { text: 'Cancelar', style: 'cancel' },
                  ...(activo(t) ? [{ text: 'Desactivar', onPress: () => aplicarActivo(t, false) }] : []),
                ])
              } else {
                Alert.alert('No se pudo eliminar', e.message)
              }
            } finally {
              setOcupado(null)
            }
          },
        },
      ]
    )
  }

  const abrirNuevo = () => {
    setForm({ nombre: '', email: '', password: generarPassword(), telefono: '', rol: 'vendedor' })
    setVerPassword(false)
    setModal(true)
  }

  const crear = async () => {
    const nombre = form.nombre.trim()
    const email = form.email.trim()
    if (!nombre || !email) { Alert.alert('Error', 'El nombre y el correo son obligatorios'); return }
    if (!/^\S+@\S+\.\S+$/.test(email)) { Alert.alert('Error', 'Revisa el correo'); return }
    if (form.password.length < 6) { Alert.alert('Error', 'La contraseña debe tener al menos 6 caracteres'); return }
    const telefono = form.telefono ? normalizarTelefono(form.telefono) : null
    if (form.telefono && !telefono) { Alert.alert('Error', 'El celular debe tener 9 dígitos y empezar con 9 (ej. 9 1234 5678)'); return }
    setGuardando(true)
    try {
      await llamar({ accion: 'crear', nombre, email, password: form.password, rol: form.rol, ...(telefono ? { telefono } : {}) })
      setModal(false)
      Alert.alert('Trabajador creado', `Pásale estos datos a ${nombre} para que entre a la app:\n\nCorreo: ${email}\nContraseña: ${form.password}`)
      cargar()
    } catch (e: any) {
      Alert.alert('No se pudo crear', e.message)
    } finally {
      setGuardando(false)
    }
  }

  const activos = lista.filter(activo).length
  const visibles = lista.filter((t) => filtro === 'todos' || (filtro === 'activos') === activo(t))

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Trabajadores" />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : !soyGerente ? (
        <Text style={styles.vacio}>Solo el gerente puede administrar a los trabajadores.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {error && <Text style={styles.error}>No se pudo cargar: {error}</Text>}
          <View style={styles.filaTop}>
            <Text style={styles.resumen}>{activos} activos · {lista.length - activos} desactivados</Text>
            <Pressable style={({ pressed }) => [styles.agregar, pressed && { opacity: 0.85 }]} onPress={abrirNuevo}>
              <Ionicons name="person-add-outline" size={16} color={Palette.onNavy} />
              <Text style={styles.agregarText}>Agregar</Text>
            </Pressable>
          </View>

          <View style={styles.filtros}>
            {([['activos', 'Activos'], ['inactivos', 'Inactivos'], ['todos', 'Todos']] as const).map(([k, t]) => (
              <Pressable key={k} style={[styles.filtro, filtro === k && styles.filtroActivo]} onPress={() => setFiltro(k)}>
                <Text style={[styles.filtroText, filtro === k && { color: Palette.onNavy }]}>{t}</Text>
              </Pressable>
            ))}
          </View>

          {visibles.length === 0 && <Text style={styles.vacio}>{lista.length === 0 ? 'Aún no hay trabajadores.' : 'No hay trabajadores en esta lista.'}</Text>}
          {visibles.map((t) => {
            const on = activo(t)
            const soyYo = t.id === yo
            return (
              <View key={t.id} style={[styles.card, !on && { opacity: 0.6 }]}>
                <View style={[styles.avatar, { backgroundColor: t.rol === 'dueno' ? Palette.navy : Palette.orange }]}>
                  <Text style={styles.avatarText}>{t.nombre.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nombre} numberOfLines={1}>{t.nombre}{soyYo ? ' (tú)' : ''}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {t.rol === 'dueno' ? 'Gerente' : 'Casero'}{t.email ? ` · ${t.email}` : ''}
                  </Text>
                  {!!t.telefono && <Text style={styles.sub}>+{t.telefono}</Text>}
                  <View style={[styles.badge, { backgroundColor: on ? Palette.greenSoft : Palette.grayPill }]}>
                    <Text style={[styles.badgeText, { color: on ? Palette.green : Palette.textMuted }]}>{on ? 'Activo' : 'Inactivo'}</Text>
                  </View>
                </View>
                {ocupado === t.id ? (
                  <ActivityIndicator size="small" color={Palette.navy} />
                ) : soyYo ? null : (
                  <>
                    <Switch value={on} onValueChange={(v) => cambiarActivo(t, v)}
                      trackColor={{ false: Palette.grayPill, true: Palette.green }} thumbColor={Palette.card} />
                    <Pressable onPress={() => eliminar(t)} hitSlop={8} accessibilityLabel={`Eliminar a ${t.nombre}`}>
                      <Ionicons name="trash-outline" size={20} color={Palette.orange} />
                    </Pressable>
                  </>
                )}
              </View>
            )
          })}
          <Text style={styles.nota}>Un trabajador desactivado no puede iniciar sesión, pero se conservan sus ventas, pagos y rutas.</Text>
        </ScrollView>
      )}

      <Modal visible={modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuevo trabajador</Text>
            <Pressable onPress={() => setModal(false)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Nombre *</Text>
            <TextInput style={styles.input} value={form.nombre} onChangeText={(t) => setForm((f) => ({ ...f, nombre: t }))}
              placeholder="Ej. Juan Pérez" placeholderTextColor={Palette.textFaint} editable={!guardando} />

            <Text style={styles.label}>Correo *</Text>
            <TextInput style={styles.input} value={form.email} onChangeText={(t) => setForm((f) => ({ ...f, email: t }))}
              placeholder="correo@ejemplo.cl" placeholderTextColor={Palette.textFaint} editable={!guardando}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

            <Text style={styles.label}>Teléfono</Text>
            <TelefonoInput value={form.telefono} onChangeText={(t) => setForm((f) => ({ ...f, telefono: t }))} editable={!guardando} />

            <View style={styles.labelFila}>
              <Text style={[styles.label, { flex: 1 }]}>Contraseña temporal *</Text>
              <Pressable onPress={() => { setForm((f) => ({ ...f, password: generarPassword() })); setVerPassword(true) }} hitSlop={6}>
                <Text style={styles.link}>Generar otra</Text>
              </Pressable>
            </View>
            <View style={styles.inputFila}>
              <TextInput style={styles.inputFlex} value={form.password} onChangeText={(t) => setForm((f) => ({ ...f, password: t }))}
                placeholder="Mínimo 6 caracteres" placeholderTextColor={Palette.textFaint} editable={!guardando}
                secureTextEntry={!verPassword} autoCapitalize="none" autoCorrect={false} />
              <Pressable onPress={() => setVerPassword((v) => !v)} hitSlop={8}>
                <Ionicons name={verPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Palette.textMuted} />
              </Pressable>
            </View>

            <Text style={styles.label}>Rol</Text>
            <View style={styles.roles}>
              {ROLES.map((r) => (
                <Pressable key={r.k} style={[styles.rol, form.rol === r.k && styles.rolActivo]} onPress={() => setForm((f) => ({ ...f, rol: r.k }))}>
                  <Text style={[styles.rolText, form.rol === r.k && { color: Palette.onNavy }]}>{r.t}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.nota}>El trabajador entra a la app con este correo y contraseña. Al crearlo te los mostraremos para que se los pases.</Text>

            <Pressable style={[styles.botonGuardar, guardando && { opacity: 0.6 }]} onPress={crear} disabled={guardando}>
              <Text style={styles.botonGuardarText}>{guardando ? 'Creando...' : 'Crear trabajador'}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  filaTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resumen: { fontSize: 13, color: Palette.textMuted, fontWeight: '600' },
  agregar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Palette.orange, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  agregarText: { color: Palette.onNavy, fontSize: 13, fontWeight: '800' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Palette.onNavy, fontWeight: '800', fontSize: 16 },
  nombre: { fontSize: 16, fontWeight: '700', color: Palette.text },
  sub: { fontSize: 12, color: Palette.textMuted, marginTop: 1 },
  badge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  filtros: { flexDirection: 'row', gap: 8 },
  filtro: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
  filtroActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  filtroText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  labelFila: { flexDirection: 'row', alignItems: 'flex-end' },
  link: { fontSize: 13, fontWeight: '800', color: Palette.orange, marginBottom: 6 },
  nota: { fontSize: 12, color: Palette.textMuted, marginTop: 14 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14, paddingHorizontal: 20 },
  error: { color: Palette.amber, fontSize: 13 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text },
  label: { fontSize: 14, fontWeight: '600', color: Palette.text, marginBottom: 6, marginTop: 16 },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15, color: Palette.text },
  inputFila: { flexDirection: 'row', alignItems: 'center', backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  inputFlex: { flex: 1, fontSize: 15, color: Palette.text, height: '100%' },
  roles: { flexDirection: 'row', gap: 8 },
  rol: { flex: 1, alignItems: 'center', backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingVertical: 12 },
  rolActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  rolText: { fontSize: 14, fontWeight: '700', color: Palette.navy },
  botonGuardar: { backgroundColor: Palette.navy, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  botonGuardarText: { color: Palette.onNavy, fontSize: 16, fontWeight: '800' },
})

export default Trabajadores
