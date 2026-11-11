import { Palette } from '@/constants/palette'
import { ClienteRuta, lineaDireccion, lineaZona } from '@/lib/rutas'
import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'

// Dirección de un cliente: "Calle 123 (Pasaje)", "Sector · Comuna" e indicaciones de la casa
const DireccionCliente = ({ c }: { c: ClienteRuta }) => (
  <View style={{ gap: 1 }}>
    <View style={styles.dirRow}>
      <Ionicons name="location-outline" size={13} color={Palette.textMuted} />
      <Text style={styles.dirText} numberOfLines={1}>{lineaDireccion(c) || 'Sin dirección'}</Text>
      {!c.dir && <View style={styles.sinZona}><Text style={styles.sinZonaText}>Sin zona</Text></View>}
    </View>
    {!!c.dir && <Text style={styles.zonaText} numberOfLines={1}>{lineaZona(c)}</Text>}
    {!!c.dir?.referencia && <Text style={styles.referencia} numberOfLines={2}>{c.dir.referencia}</Text>}
  </View>
)

const styles = StyleSheet.create({
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dirText: { flex: 1, fontSize: 12, color: Palette.textMuted },
  zonaText: { fontSize: 12, fontWeight: '600', color: Palette.navy, marginLeft: 17 },
  referencia: { fontSize: 12, fontStyle: 'italic', color: Palette.textFaint, marginLeft: 17 },
  sinZona: { backgroundColor: Palette.amberSoft, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  sinZonaText: { fontSize: 10, fontWeight: '800', color: Palette.amber },
})

export default DireccionCliente
