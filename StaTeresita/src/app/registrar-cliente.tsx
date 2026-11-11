import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Header from '../components/Header'
import { supabase } from '../lib/supabase'
import { Palette } from '@/constants/palette'
import { normalizarTelefono } from '@/lib/format'
import TelefonoInput from '@/components/TelefonoInput'
import SelectorDireccion from '@/components/SelectorDireccion'
import { Catalogo, catalogoVacio, cargarCatalogo, direccionVacia, guardarDireccion, textoDireccion, validarDireccion } from '@/lib/zonas'

const RegistrarCliente = () => {
  const router = useRouter()
  
  const [nombre, setNombre] = useState('')
  const [rut, setRut] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState(direccionVacia)
  const [catalogo, setCatalogo] = useState<Catalogo>(catalogoVacio)

  useEffect(() => { cargarCatalogo().then((r) => setCatalogo(r.catalogo)) }, [])
  
  const [loading, setLoading] = useState(false)

  const guardarCliente = async () => {
    // 1. Validamos que los campos obligatorios no estén vacíos
    if (!nombre || !telefono || !rut) {
      Alert.alert('Error', 'El nombre, RUT y teléfono son obligatorios')
      return
    }
    const faltaDireccion = validarDireccion(direccion)
    if (faltaDireccion) {
      Alert.alert('Error', faltaDireccion)
      return
    }

    // Normalizamos el teléfono a solo dígitos con código de país: 569XXXXXXXX
    const telefonoLimpio = normalizarTelefono(telefono)
    if (!telefonoLimpio) {
      Alert.alert('Error', 'El celular debe tener 9 dígitos y empezar con 9 (ej. 9 1234 5678)')
      return
    }

    setLoading(true)
    try {
      // 2. Obtenemos el ID del usuario que está usando la app
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        Alert.alert('Error', 'No hay una sesión activa')
        setLoading(false)
        return
      }

      // 3. Reutilizamos la dirección si ya existe (varios clientes pueden compartirla) o la creamos
      const direccionId = await guardarDireccion(direccion)

      // 4. Insertamos los datos en la tabla clientes
      const { error } = await supabase
        .from('clientes')
        .insert([
          { 
            nombre: nombre,
            rut: rut,
            telefono: telefonoLimpio,
            direccion_id: direccionId,
            direccion: textoDireccion(catalogo, direccion), // texto antiguo, para pantallas que aún lo muestran
            creado_por: user.id 
          }
        ])

      if (error) throw error

      Alert.alert('Éxito', 'Cliente registrado correctamente')
      
      // 4. Limpiamos el formulario y volvemos al menú
      setNombre('')
      setRut('')
      setTelefono('')
      setDireccion(direccionVacia)
      router.back()
      
    } catch (error: any) {
      console.error(error)
      Alert.alert('Error al guardar', error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Nuevo Cliente"/>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Nombre completo *</Text>
        <TextInput 
          style={styles.input} 
          value={nombre} 
          onChangeText={setNombre} 
          placeholder="Ej. Juan Pérez" 
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.label}>RUT *</Text>
        <TextInput 
          style={styles.input} 
          value={rut} 
          onChangeText={setRut} 
          placeholder="Ej. 12345678-9" 
          placeholderTextColor={Palette.textFaint}
          editable={!loading}
        />

        <Text style={styles.label}>Teléfono *</Text>
        <TelefonoInput value={telefono} onChangeText={setTelefono} editable={!loading} style={{ marginBottom: 18 }} />

        <Text style={styles.seccion}>Dirección</Text>
        <SelectorDireccion catalogo={catalogo} value={direccion} onChange={setDireccion} editable={!loading} />

        <Pressable 
          style={[styles.submitButton, loading && styles.submitButtonDisabled]} 
          onPress={guardarCliente}
          disabled={loading}
        >
          <Text style={styles.submitButtonText}>
            {loading ? 'Guardando...' : 'Guardar Cliente'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  form: { padding: 24, paddingBottom: 40 },
  seccion: { fontSize: 13, fontWeight: '700', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  label: { fontSize: 14, color: Palette.text, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 18,
    fontSize: 16,
    color: Palette.text,
  },
  submitButton: {
    backgroundColor: Palette.navy,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  submitButtonDisabled: {
    backgroundColor: '#8C90B5',
  },
  submitButtonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
})

export default RegistrarCliente