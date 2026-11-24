import { Palette } from '@/constants/palette'
import { Parada } from '@/lib/rutas'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Props {
  paradas: Parada[] | null // las que no se visitaron o no estaban (null = cerrado)
  ocupado?: boolean
  onClose: () => void
  onFinalizar: (clientesParaManana: string[]) => void
}

// Al finalizar la ruta: ¿pasar a la ruta de mañana los clientes que no se visitaron o no estaban?
// Parten todos marcados; se puede desmarcar alguno.
const PasarAManana = ({ paradas, ocupado, onClose, onFinalizar }: Props) => {
  const [marcados, setMarcados] = useState<string[]>([])
  useEffect(() => { setMarcados((paradas ?? []).map((p) => p.cliente_id)) }, [paradas])

  return (
    <Modal visible={!!paradas} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.contenedor}>
        <View style={styles.header}>
          <Text style={styles.titulo}>Finalizar ruta del día</Text>
          <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
        </View>
        <Text style={styles.pregunta}>¿Agregar a la ruta de mañana los clientes que no se visitaron o no estaban?</Text>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          {(paradas ?? []).map((p) => {
            const on = marcados.includes(p.cliente_id)
            return (
              <Pressable key={p.id} style={styles.item}
                onPress={() => setMarcados((m) => (on ? m.filter((x) => x !== p.cliente_id) : [...m, p.cliente_id]))}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? Palette.navy : Palette.textFaint} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.nombre} numberOfLines={1}>{p.cliente?.nombre ?? 'Cliente'}</Text>
                  <Text style={[styles.estado, { color: p.estado === 'no_estaba' ? Palette.orange : Palette.navy }]}>
                    {p.estado === 'no_estaba' ? 'No estaba' : 'No se visitó'}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </ScrollView>
        <View style={{ padding: 16, gap: 10 }}>
          <Pressable style={[styles.boton, (marcados.length === 0 || ocupado) && { opacity: 0.5 }]} disabled={marcados.length === 0 || ocupado}
            onPress={() => onFinalizar(marcados)}>
            {ocupado ? <ActivityIndicator color={Palette.onNavy} /> : <Text style={styles.botonText}>{`Agregar ${marcados.length} a mañana y finalizar`}</Text>}
          </Pressable>
          <Pressable style={[styles.boton, { backgroundColor: Palette.grayPill }]} disabled={ocupado} onPress={() => onFinalizar([])}>
            <Text style={[styles.botonText, { color: Palette.text }]}>Finalizar sin agregar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: Palette.cream },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  titulo: { fontSize: 18, fontWeight: '700', color: Palette.text },
  pregunta: { fontSize: 14, fontWeight: '700', color: Palette.navy, padding: 16, paddingBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12 },
  nombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  estado: { fontSize: 12, fontWeight: '700' },
  boton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center' },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
})

export default PasarAManana
