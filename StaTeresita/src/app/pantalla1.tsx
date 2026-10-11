// app/pantalla1.tsx
import React, { useState } from 'react'
import { 
  View, Text, StyleSheet, FlatList, 
  TextInput, Pressable, Image 
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import FadeInView from '@/components/FadeInView'
import Header from '@/components/Header'

// 📊 Datos de ejemplo (demo)
const CLIENTES_DEMO = [
  { 
    id: '1', 
    nombre: 'María González', 
    calle: 'Los Álamos 123', 
    barrio: 'Villa Alegre', 
    sector: 'A',
    deuda: 75000,
    cuotasPendientes: 3
  },
  { 
    id: '2', 
    nombre: 'Juan Pérez', 
    calle: 'Santa Rosa 456', 
    barrio: 'Centro', 
    sector: 'B',
    deuda: 32000,
    cuotasPendientes: 2
  },
  { 
    id: '3', 
    nombre: 'Ana Martínez', 
    calle: 'Los Cerezos 789', 
    barrio: 'Villa Nueva', 
    sector: 'A',
    deuda: 50000,
    cuotasPendientes: 4
  },
  { 
    id: '4', 
    nombre: 'Carlos López', 
    calle: 'Primavera 456', 
    barrio: 'El Bosque', 
    sector: 'C',
    deuda: 28000,
    cuotasPendientes: 1
  },
  { 
    id: '5', 
    nombre: 'Laura Fernández', 
    calle: 'Las Flores 789', 
    barrio: 'Jardín', 
    sector: 'B',
    deuda: 63000,
    cuotasPendientes: 5
  },
]

const Pantalla1 = () => {
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [clientes] = useState(CLIENTES_DEMO)

  // Filtrar clientes por nombre, calle o barrio
  const clientesFiltrados = clientes.filter(cliente => 
    cliente.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    cliente.calle.toLowerCase().includes(busqueda.toLowerCase()) ||
    cliente.barrio.toLowerCase().includes(busqueda.toLowerCase())
  )

  const irADetalle = (clienteId: string) => {
    router.push({
      pathname: '/cliente/[id]',
      params: { id: clienteId },
    })
  }

  const renderCliente = ({ item }: { item: typeof CLIENTES_DEMO[0] }) => (
    <Pressable 
      style={({ pressed }) => [
        styles.clienteCard,
        pressed && styles.cardPressed
      ]}
      onPress={() => irADetalle(item.id)}
    >
      {/* Avatar o icono */}
      <View style={styles.avatarContainer}>
        <Text style={styles.avatarTexto}>
          {item.nombre.split(' ').map(n => n[0]).join('')}
        </Text>
      </View>

      {/* Información del cliente */}
      <View style={styles.clienteInfo}>
        <Text style={styles.clienteNombre}>{item.nombre}</Text>
        <View style={styles.direccionRow}>
          <Ionicons name="location-outline" size={14} color="#666" />
          <Text style={styles.clienteDireccion}>{item.calle}, {item.barrio}</Text>
        </View>
        <View style={styles.sectorBadge}>
          <Text style={styles.sectorText}>Sector {item.sector}</Text>
        </View>
      </View>

      {/* Deuda y cuotas */}
      <View style={styles.deudaContainer}>
        <Text style={styles.deudaLabel}>Deuda</Text>
        <Text style={styles.deudaMonto}>${item.deuda.toLocaleString()}</Text>
        <View style={styles.cuotasBadge}>
          <Text style={styles.cuotasText}>{item.cuotasPendientes} cuotas</Text>
        </View>
      </View>
    </Pressable>
  )

  return (
    <SafeAreaView style={styles.container}>
      <FadeInView>
        <Header title="Clientes" />

        {/* Barra de búsqueda */}
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={20} color="#666" />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre, calle o barrio..."
            placeholderTextColor="#999"
            value={busqueda}
            onChangeText={setBusqueda}
          />
          {busqueda.length > 0 && (
            <Pressable onPress={() => setBusqueda('')}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </Pressable>
          )}
        </View>

        {/* Contador de resultados */}
        <View style={styles.resultadosContainer}>
          <Text style={styles.resultadosText}>
            {clientesFiltrados.length} clientes encontrados
          </Text>
        </View>

        {/* Lista de clientes */}
        <FlatList
          data={clientesFiltrados}
          renderItem={renderCliente}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.lista}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={60} color="#ccc" />
              <Text style={styles.emptyText}>No se encontraron clientes</Text>
              <Text style={styles.emptySubtext}>Intenta con otra búsqueda</Text>
            </View>
          }
        />
      </FadeInView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginBottom: 8,
    height: 48,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: '#1a1a1a',
  },
  resultadosContainer: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  resultadosText: {
    fontSize: 13,
    color: '#888',
  },
  lista: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 4,
  },
  clienteCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  avatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarTexto: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  clienteInfo: {
    flex: 1,
  },
  clienteNombre: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  direccionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  clienteDireccion: {
    fontSize: 13,
    color: '#666',
    marginLeft: 4,
  },
  sectorBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  sectorText: {
    fontSize: 11,
    color: '#6366f1',
    fontWeight: '600',
  },
  deudaContainer: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  deudaLabel: {
    fontSize: 11,
    color: '#999',
  },
  deudaMonto: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ef4444',
    marginVertical: 2,
  },
  cuotasBadge: {
    backgroundColor: '#fef2f2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  cuotasText: {
    fontSize: 11,
    color: '#ef4444',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
})

export default Pantalla1