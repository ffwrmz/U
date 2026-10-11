// app/cliente/[id].tsx
import React, { useState } from 'react'
import { 
  View, Text, StyleSheet, ScrollView, 
  Pressable, Alert, TextInput 
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import FadeInView from '@/components/FadeInView'

// 📊 Datos de ejemplo - SOLO CUOTAS PAGADAS
const CUOTAS_DEMO = [
  { id: '1', monto: 25000, fecha: '10 Septiembre 2026' },
  { id: '2', monto: 25000, fecha: '10 Octubre 2026' },
  { id: '3', monto: 25000, fecha: '10 Noviembre 2026' },
]

const ClienteDetalle = () => {
  const router = useRouter()
  const { id } = useLocalSearchParams()
  const [cuotas, setCuotas] = useState(CUOTAS_DEMO)
  const [mostrarInfo, setMostrarInfo] = useState(false)
  const [nuevaCuota, setNuevaCuota] = useState({
    monto: '',
    fecha: ''
  })

  // Datos del cliente (fijos para demo)
  const cliente = {
    id: id,
    nombre: 'María González',
    calle: 'Los Álamos 123',
    barrio: 'Villa Alegre',
    sector: 'A',
    referencias: 'Casa verde, esquina con calle 7',
    telefono: '9 1234 5678',
    fechaInicio: '15/03/2026',
    deudaTotal: 150000, // Deuda total acordada
  }

  // Calcular total pagado y saldo pendiente
  const totalPagado = cuotas.reduce((sum, c) => sum + c.monto, 0)
  const saldoPendiente = cliente.deudaTotal - totalPagado
  const totalCuotas = cuotas.length

  const agregarCuota = () => {
    if (!nuevaCuota.monto || !nuevaCuota.fecha) {
      Alert.alert('Error', 'Por favor completa todos los campos')
      return
    }

    const monto = parseInt(nuevaCuota.monto)
    
    // Validar que el monto no supere la deuda total
    if (totalPagado + monto > cliente.deudaTotal) {
      Alert.alert('Error', `El monto excede la deuda total ($${cliente.deudaTotal.toLocaleString()})`)
      return
    }

    const nueva = {
      id: Date.now().toString(),
      monto: monto,
      fecha: nuevaCuota.fecha
    }

    setCuotas([...cuotas, nueva])
    setNuevaCuota({ monto: '', fecha: '' })
    Alert.alert('✅ Éxito', 'Cuota agregada correctamente')
  }

  return (
    <SafeAreaView style={styles.container}>
      <FadeInView>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back-outline" size={24} color="#1a1a1a" />
          </Pressable>
          <Text style={styles.headerTitle}>Cliente</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
          {/* Tarjeta del cliente */}
          <View style={styles.clienteCard}>
            <View style={styles.clienteHeader}>
              <View style={styles.clienteNombreContainer}>
                <View style={styles.avatarGrande}>
                  <Text style={styles.avatarGrandeTexto}>
                    {cliente.nombre.split(' ').map(n => n[0]).join('')}
                  </Text>
                </View>
                <View>
                  <Text style={styles.clienteNombre}>{cliente.nombre}</Text>
                  <View style={styles.sectorBadge}>
                    <Text style={styles.sectorText}>Sector {cliente.sector}</Text>
                  </View>
                </View>
              </View>
              
              <Pressable 
                style={styles.infoButton}
                onPress={() => setMostrarInfo(!mostrarInfo)}
              >
                <Ionicons 
                  name={mostrarInfo ? "chevron-up" : "information-circle-outline"} 
                  size={28} 
                  color="#6366f1" 
                />
              </Pressable>
            </View>

            {mostrarInfo && (
              <View style={styles.infoContainer}>
                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={18} color="#666" />
                  <Text style={styles.infoText}>{cliente.calle}, {cliente.barrio}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="call-outline" size={18} color="#666" />
                  <Text style={styles.infoText}>{cliente.telefono}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="calendar-outline" size={18} color="#666" />
                  <Text style={styles.infoText}>Desde: {cliente.fechaInicio}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="information-circle-outline" size={18} color="#666" />
                  <Text style={styles.infoText}>Ref: {cliente.referencias}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="cash-outline" size={18} color="#666" />
                  <Text style={styles.infoText}>Deuda Total: ${cliente.deudaTotal.toLocaleString()}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Resumen de pagos con saldo pendiente */}
          <View style={styles.resumenContainer}>
            <View style={styles.resumenItem}>
              <Text style={styles.resumenNumero}>{totalCuotas}</Text>
              <Text style={styles.resumenLabel}>Cuotas Pagadas</Text>
            </View>
            <View style={styles.resumenDivider} />
            <View style={styles.resumenItem}>
              <Text style={[styles.resumenNumero, styles.resumenTotal]}>
                ${totalPagado.toLocaleString()}
              </Text>
              <Text style={styles.resumenLabel}>Total Pagado</Text>
            </View>
            <View style={styles.resumenDivider} />
            <View style={styles.resumenItem}>
              <Text style={[styles.resumenNumero, styles.resumenSaldo]}>
                ${saldoPendiente.toLocaleString()}
              </Text>
              <Text style={styles.resumenLabel}>Saldo Pendiente</Text>
            </View>
          </View>

          {/* 📋 Tabla de pagos con saldo */}
          <View style={styles.tablaContainer}>
            <View style={styles.tablaHeader}>
              <Text style={[styles.tablaHeaderText, styles.colFecha]}>Fecha</Text>
              <Text style={[styles.tablaHeaderText, styles.colAbono]}>Abono $</Text>
              <Text style={[styles.tablaHeaderText, styles.colSaldo]}>Saldo $</Text>
            </View>

            {cuotas.map((cuota, index) => {
              // Calcular saldo después de cada pago
              const pagosAnteriores = cuotas
                .slice(0, index)
                .reduce((sum, c) => sum + c.monto, 0)
              const saldoDespuesPago = cliente.deudaTotal - (pagosAnteriores + cuota.monto)
              
              return (
                <View key={cuota.id} style={styles.tablaFila}>
                  <Text style={[styles.tablaFilaText, styles.colFecha]}>
                    {cuota.fecha}
                  </Text>
                  <Text style={[styles.tablaFilaText, styles.colAbono, styles.textoVerde]}>
                    ${cuota.monto.toLocaleString()}
                  </Text>
                  <Text style={[styles.tablaFilaText, styles.colSaldo, styles.textoSaldo]}>
                    ${saldoDespuesPago.toLocaleString()}
                  </Text>
                </View>
              )
            })}

            {/* Si no hay cuotas */}
            {cuotas.length === 0 && (
              <View style={styles.tablaFila}>
                <Text style={[styles.tablaFilaText, styles.colFecha, styles.textoGris]}>
                  Sin pagos registrados
                </Text>
                <Text style={[styles.tablaFilaText, styles.colAbono, styles.textoGris]}>-</Text>
                <Text style={[styles.tablaFilaText, styles.colSaldo, styles.textoGris]}>-</Text>
              </View>
            )}

            {/* Fila de saldo inicial */}
            <View style={[styles.tablaFila, styles.filaSaldoInicial]}>
              <Text style={[styles.tablaFilaText, styles.colFecha, styles.textoNegrita]}>
                Saldo Inicial
              </Text>
              <Text style={[styles.tablaFilaText, styles.colAbono, styles.textoGris]}>-</Text>
              <Text style={[styles.tablaFilaText, styles.colSaldo, styles.textoNegrita]}>
                ${cliente.deudaTotal.toLocaleString()}
              </Text>
            </View>
          </View>

          {/* Agregar nueva cuota pagada */}
          <View style={styles.nuevaCuotaContainer}>
            <Text style={styles.nuevaCuotaTitle}>➕ Agregar Pago</Text>
            
            <View style={styles.nuevaCuotaRow}>
              <View style={[styles.nuevaCuotaInputContainer, { flex: 2 }]}>
                <Text style={styles.nuevaCuotaLabel}>Fecha (Ej: 10 Septiembre 2026)</Text>
                <TextInput
                  style={styles.nuevaCuotaInput}
                  placeholder="10 Septiembre 2026"
                  value={nuevaCuota.fecha}
                  onChangeText={(text) => setNuevaCuota({...nuevaCuota, fecha: text})}
                />
              </View>
              
              <View style={[styles.nuevaCuotaInputContainer, { flex: 1 }]}>
                <Text style={styles.nuevaCuotaLabel}>Monto $</Text>
                <TextInput
                  style={styles.nuevaCuotaInput}
                  placeholder="25000"
                  keyboardType="numeric"
                  value={nuevaCuota.monto}
                  onChangeText={(text) => setNuevaCuota({...nuevaCuota, monto: text})}
                />
              </View>
            </View>

            {/* Mostrar saldo pendiente actual */}
            <View style={styles.saldoInfoContainer}>
              <Text style={styles.saldoInfoText}>
                Saldo pendiente actual: 
                <Text style={[styles.saldoInfoText, styles.saldoInfoValor]}>
                  ${saldoPendiente.toLocaleString()}
                </Text>
              </Text>
            </View>

            <Pressable 
              style={styles.agregarButton}
              onPress={agregarCuota}
            >
              <Text style={styles.agregarButtonText}>Agregar Pago</Text>
            </Pressable>
          </View>

          {/* Espacio al final */}
          <View style={{ height: 20 }} />
        </ScrollView>
      </FadeInView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f5f5f5',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  clienteCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  clienteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  clienteNombreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarGrande: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarGrandeTexto: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  clienteNombre: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  sectorBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  sectorText: {
    fontSize: 12,
    color: '#6366f1',
    fontWeight: '600',
  },
  infoButton: {
    padding: 4,
    marginLeft: 8,
  },
  infoContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 10,
  },
  resumenContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  resumenItem: {
    alignItems: 'center',
  },
  resumenNumero: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  resumenTotal: {
    color: '#22c55e',
  },
  resumenSaldo: {
    color: '#ef4444',
  },
  resumenLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  resumenDivider: {
    width: 1,
    height: '80%',
    backgroundColor: '#e0e0e0',
  },
  // 📋 Estilos de la tabla
  tablaContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  tablaHeader: {
    flexDirection: 'row',
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
    marginBottom: 8,
  },
  tablaHeaderText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  tablaFila: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    alignItems: 'center',
  },
  filaSaldoInicial: {
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
  },
  tablaFilaText: {
    fontSize: 14,
    color: '#1a1a1a',
  },
  colFecha: {
    flex: 2,
  },
  colAbono: {
    flex: 1.5,
    textAlign: 'right',
  },
  colSaldo: {
    flex: 1.5,
    textAlign: 'right',
  },
  textoVerde: {
    color: '#22c55e',
    fontWeight: '500',
  },
  textoSaldo: {
    color: '#6366f1',
    fontWeight: '500',
  },
  textoGris: {
    color: '#999',
  },
  textoNegrita: {
    fontWeight: 'bold',
  },
  // Formulario de nueva cuota
  nuevaCuotaContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  nuevaCuotaTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  nuevaCuotaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  nuevaCuotaInputContainer: {
    flex: 1,
  },
  nuevaCuotaLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  nuevaCuotaInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#1a1a1a',
    backgroundColor: '#fafafa',
  },
  saldoInfoContainer: {
    backgroundColor: '#f0f4ff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  saldoInfoText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  saldoInfoValor: {
    fontWeight: 'bold',
    color: '#ef4444',
  },
  agregarButton: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  agregarButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
})

export default ClienteDetalle