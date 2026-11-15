import MapaClientes from '@/components/MapaClientes'
import { Palette } from '@/constants/palette'
import { ubicacionesDeParadas } from '@/lib/mapa'
import { ClienteRuta } from '@/lib/rutas'
import { Ionicons } from '@expo/vector-icons'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Props {
  visible: boolean
  titulo: string
  // Paradas en el orden de la ruta
  paradas: { cliente: ClienteRuta | null; estado?: string }[]
  onClose: () => void
  onPressCliente?: (clienteId: string) => void
}

// Colores por estado de visita: pendiente azul, visitado verde, no estaba naranja
const COLORES = { pendiente: Palette.navy, visitado: Palette.green, no_estaba: Palette.orange }

// Mapa de una ruta: paradas numeradas en orden y una línea que las une.
const MapaRuta = ({ visible, titulo, paradas, onClose, onPressCliente }: Props) => {
  const ubicaciones = ubicacionesDeParadas(paradas, COLORES)
  const sinUbicacion = paradas.filter((p) => !(p.cliente?.dir?.latitud != null && p.cliente?.dir?.longitud != null)).length

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.titulo} numberOfLines={1}>{titulo}</Text>
          <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
        </View>
        <View style={styles.mapa}>
          {visible && <MapaClientes ubicaciones={ubicaciones} trazarRuta onPressCliente={onPressCliente} />}
        </View>
        <View style={styles.pie}>
          <View style={styles.leyenda}>
            {([['Pendiente', COLORES.pendiente], ['Visitado', COLORES.visitado], ['No estaba', COLORES.no_estaba]] as const).map(([t, c]) => (
              <View key={t} style={styles.leyendaItem}>
                <View style={[styles.punto, { backgroundColor: c }]} />
                <Text style={styles.leyendaText}>{t}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.nota}>
            {paradas.length === 0 ? 'Esta ruta no tiene paradas.'
              : sinUbicacion === 0 ? `${paradas.length} paradas en el mapa.`
              : `${paradas.length - sinUbicacion} de ${paradas.length} paradas en el mapa. ${sinUbicacion} aún no tienen ubicación (se calculan desde Zonas).`}
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  titulo: { flex: 1, fontSize: 18, fontWeight: '700', color: Palette.text },
  mapa: { flex: 1, backgroundColor: Palette.card },
  pie: { padding: 14, gap: 8, borderTopWidth: 1, borderTopColor: Palette.border },
  leyenda: { flexDirection: 'row', gap: 14 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  punto: { width: 12, height: 12, borderRadius: 6 },
  leyendaText: { fontSize: 12, color: Palette.textMuted, fontWeight: '600' },
  nota: { fontSize: 12, color: Palette.textMuted },
})

export default MapaRuta
