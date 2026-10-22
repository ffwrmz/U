import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Header from '../components/Header'
import { supabase } from '../lib/supabase'


interface Cliente {
  id: string;
  nombre: string;
}

const RegistrarVenta = () => {
  const router = useRouter()
  const [monto, setMonto] = useState('')
  const [loading, setLoading] = useState(false)


  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [cargandoClientes, setCargandoClientes] = useState(true)


  useEffect(() => {
    const obtenerClientes = async () => {
      try {
        const { data, error } = await supabase
          .from('clientes')
          .select('id, nombre')
          .order('nombre', { ascending: true })

        if (error) throw error
        if (data) setClientes(data)
      } catch (error) {
        console.error('Error al cargar clientes:', error)
      } finally {
        setCargandoClientes(false)
      }
    }

    obtenerClientes()
  }, [])

  const guardarVenta = async () => {
    if (!monto || !clienteSeleccionado) {
      Alert.alert('Error', 'Por favor ingresa el monto y selecciona un cliente')
      return
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        Alert.alert('Error', 'No hay una sesión activa')
        setLoading(false)
        return
      }

      const { error } = await supabase
        .from('ventas_pedidos')
        .insert([
          {
            monto_total: parseFloat(monto),
            saldo_pendiente: parseFloat(monto),
            vendedor_id: user.id,
            cliente_id: clienteSeleccionado.id
          }
        ])

      if (error) throw error

      Alert.alert('Éxito', 'Venta registrada correctamente')
      setMonto('')
      setClienteSeleccionado(null)
      router.back()
    } catch (error: any) {
      Alert.alert('Error al guardar', error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Registrar Venta" />

      <View style={styles.form}>

        <Text style={styles.label}>Cliente</Text>
        <Pressable
          style={styles.selectorContainer}
          onPress={() => setModalVisible(true)}
        >
          <Text style={[styles.selectorText, !clienteSeleccionado && styles.placeholderText]}>
            {clienteSeleccionado ? clienteSeleccionado.nombre : 'Seleccionar cliente...'}
          </Text>
          <Ionicons name="chevron-down" size={20} color="#666" />
        </Pressable>


        <Text style={styles.label}>Monto Total del Pedido</Text>
        <View style={styles.inputContainer}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            keyboardType="numeric"
            value={monto}
            onChangeText={setMonto}
            editable={!loading}
          />
        </View>

        <Pressable
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={guardarVenta}
          disabled={loading}
        >
          <Text style={styles.submitButtonText}>
            {loading ? 'Guardando...' : 'Guardar Venta'}
          </Text>
        </Pressable>
      </View>

      {/* Modal para elegir cliente */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Seleccionar Cliente</Text>
            <Pressable onPress={() => setModalVisible(false)} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#1a1a1a" />
            </Pressable>
          </View>


          <FlatList
            data={clientes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={<Text style={styles.emptyText}>No hay clientes registrados.</Text>}
            renderItem={({ item }) => (
              <Pressable
                style={styles.clienteItem}
                onPress={() => {
                  setClienteSeleccionado(item)
                  setModalVisible(false)
                }}
              >
                <Text style={styles.clienteNombre}>{item.nombre}</Text>
                <Ionicons name="chevron-forward" size={20} color="#ccc" />
              </Pressable>
            )}
          />

        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  form: { padding: 24 },
  label: { fontSize: 16, color: '#333', marginBottom: 8, fontWeight: '500' },
  selectorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 56,
    marginBottom: 24,
  },
  selectorText: { fontSize: 16, color: '#000' },
  placeholderText: { color: '#999' },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 56,
    marginBottom: 24,
  },
  currency: { fontSize: 18, color: '#666', marginRight: 8 },
  input: { flex: 1, fontSize: 18, color: '#000' },
  submitButton: {
    backgroundColor: '#6366f1',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: { backgroundColor: '#a5a6f6' },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  // Estilos del Modal
  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  closeButton: { padding: 4 },
  listContainer: { padding: 16 },
  clienteItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  clienteNombre: { fontSize: 16, color: '#333' },
  emptyText: { textAlign: 'center', color: '#666', marginTop: 20 },
})

export default RegistrarVenta