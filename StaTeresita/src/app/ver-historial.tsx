import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Header from '../components/Header';
import { supabase } from '../lib/supabase';

const Historial = () => {
  const [ventas, setVentas] = useState<any[]>([]);
  

const formatearMoneda = (valor: string | number) => {
    const numero = valor.toString().replace(/\D/g, '')
    return numero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  }


  const formatearFecha = (fechaOriginal: string) => {
    if (!fechaOriginal) return '';
    const fecha = new Date(fechaOriginal);
    return fecha.toLocaleDateString('es-CL');
  };

useEffect(() => {
    const cargarHistorial = async () => {
      const { data, error } = await supabase
        .from('ventas_pedidos')
        .select(`
          id,
          monto_total,
          descripcion,
          fecha_venta, 
          clientes ( nombre ),
          perfiles ( nombre ) 
        `)
        .order('fecha_venta', { ascending: false }); 

      if (error) {
        console.log("Error de Supabase en historial:", error.message);
      } else {
        setVentas(data || []);
      }
    };
    cargarHistorial();
  }, []);

return (
    <SafeAreaView style={styles.container}>
      <Header title="Historial de Ventas" />
      <FlatList
        data={ventas}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No hay ventas registradas.</Text>}
        renderItem={({ item }) => (
          <View style={styles.tarjeta}>
            <View style={styles.tarjetaHeader}>
              <Text style={styles.textoDestacado}>{item.clientes?.nombre}</Text>
              <Text style={styles.fechaText}>{formatearFecha(item.fecha_venta)}</Text>
            </View>
            
            <Text style={styles.descripcionText}>{item.descripcion}</Text>
            
            <View style={styles.detalleContainer}>
              <Text style={styles.vendedorText}>Vendedor: {item.perfiles?.nombre || 'Desconocido'}</Text>
              <Text style={styles.montoText}>${formatearMoneda(item.monto_total)}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  tarjeta: { 
    backgroundColor: '#fff', 
    padding: 16, 
    marginBottom: 16, 
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    elevation: 2,
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  tarjetaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  textoDestacado: { fontSize: 18, fontWeight: '700', color: '#1f2937' },
  fechaText: { fontSize: 14, color: '#6b7280' },
  descripcionText: { fontSize: 15, color: '#4b5563', marginBottom: 12 },
  detalleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 12,
  },
  vendedorText: { fontSize: 14, color: '#6b7280', fontStyle: 'italic' },
  montoText: { fontSize: 18, fontWeight: 'bold', color: '#10b981' },
  emptyText: { textAlign: 'center', color: '#6b7280', marginTop: 40, fontSize: 16 }
});

export default Historial;