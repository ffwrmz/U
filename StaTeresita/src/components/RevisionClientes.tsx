import DireccionCliente from '@/components/DireccionCliente'
import { Palette } from '@/constants/palette'
import { ClienteRuta } from '@/lib/rutas'
import { Ionicons } from '@expo/vector-icons'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Props {
  descripcion: string // ej. "Vas a preasignar 5 clientes a Gonzalo el lunes 24 de noviembre"
  clientes: ClienteRuta[] // en el orden en que quedarán
  notas?: Record<string, string> // texto extra por cliente (ej. "Se moverá desde Juan")
  textoBoton: string // ej. "Preasignar" (se le agrega la cantidad)
  onQuitar: (id: string) => void
  onVolver: () => void
  onConfirmar: () => void
}

// Paso de revisión antes de guardar: la lista elegida con una X para quitar cada cliente.
export const ContenidoRevision = ({ descripcion, clientes, notas = {}, textoBoton, onQuitar, onVolver, onConfirmar }: Props) => (
  <View style={styles.contenedor}>
    <View style={styles.header}>
      <Pressable onPress={onVolver} hitSlop={8} accessibilityLabel="Volver"><Ionicons name="arrow-back" size={24} color={Palette.text} /></Pressable>
      <Text style={styles.titulo}>Revisa antes de confirmar</Text>
    </View>
    <Text style={styles.descripcion}>{descripcion}</Text>
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 8 }}>
      {clientes.length === 0 && <Text style={styles.sub}>No quedan clientes. Vuelve para elegir otros.</Text>}
      {clientes.map((c) => (
        <View key={c.id} style={styles.fila}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.nombre}>{c.nombre}</Text>
            <DireccionCliente c={c} compacta />
            {!!notas[c.id] && <Text style={styles.nota}>{notas[c.id]}</Text>}
          </View>
          <Pressable onPress={() => onQuitar(c.id)} hitSlop={8} accessibilityLabel={`Quitar a ${c.nombre}`}>
            <Ionicons name="close-circle" size={24} color={Palette.orange} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
    <View style={styles.botones}>
      <Pressable style={[styles.boton, styles.botonSec]} onPress={onVolver}>
        <Text style={[styles.botonText, { color: Palette.navy }]}>Volver</Text>
      </Pressable>
      <Pressable style={[styles.boton, { flex: 1 }, clientes.length === 0 && { opacity: 0.5 }]} disabled={clientes.length === 0} onPress={onConfirmar}>
        <Text style={styles.botonText}>{`${textoBoton} ${clientes.length}`}</Text>
      </Pressable>
    </View>
  </View>
)

// La misma revisión en su propia ventana (para usarla fuera de otra ventana)
const RevisionClientes = (props: Props & { visible: boolean }) => (
  <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onVolver}>
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.cream }}>
      <ContenidoRevision {...props} />
    </SafeAreaView>
  </Modal>
)

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: Palette.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  titulo: { fontSize: 18, fontWeight: '700', color: Palette.text },
  descripcion: { fontSize: 14, fontWeight: '700', color: Palette.navy, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  sub: { fontSize: 13, color: Palette.textMuted },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12 },
  nombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  nota: { fontSize: 12, fontWeight: '700', color: Palette.amber },
  botones: { flexDirection: 'row', gap: 10, padding: 16 },
  boton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center' },
  botonSec: { backgroundColor: Palette.navySoft, paddingHorizontal: 20 },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
})

export default RevisionClientes
