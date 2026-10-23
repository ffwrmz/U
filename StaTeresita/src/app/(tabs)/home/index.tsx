import Header from '@/components/Header'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

const HomeScreen = () => {

  const router = useRouter()
  
  return (
    
    <View style={styles.container}>
      <Header title="Menú Principal" />

      <View style={styles.actionsContainer}>

        {/* Botón Registrar Usuario (PBI-01) */}
        <Pressable 
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push('../registrar-cliente')}
        >
          <View style={[styles.iconContainer, { backgroundColor: '#fdf4ff' }]}>
            <Ionicons name="person-add-outline" size={32} color="#be4bc2" />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Registrar Cliente</Text>
            <Text style={styles.cardDescription}>Añadir un nuevo cliente</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#ccc" />
        </Pressable>
        



        {/* Botón Registrar Venta (PBI-01) */}
        <Pressable 
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push('../registrar-venta')}
        >
          <View style={[styles.iconContainer, { backgroundColor: '#e0e7ff' }]}>
            <Ionicons name="cart-outline" size={32} color="#6366f1" />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Registrar Venta</Text>
            <Text style={styles.cardDescription}>Crear un nuevo pedido</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#ccc" />
        </Pressable>

        {/* Botón Registrar Pago (PBI-02) */}
        <Pressable 
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push('../registrar-pago')}
        >
          <View style={[styles.iconContainer, { backgroundColor: '#dcfce7' }]}>
            <Ionicons name="cash-outline" size={32} color="#10b981" />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Registrar Pago</Text>
            <Text style={styles.cardDescription}>Abonar a una deuda</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#ccc" />
        </Pressable>

      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  actionsContainer: {
    padding: 24,
    gap: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#666',
  },
})

export default HomeScreen