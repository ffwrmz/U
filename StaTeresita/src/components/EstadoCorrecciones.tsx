import { Palette } from '@/constants/palette'
import { cambiosDe, Correccion, ESTADO_TEXTO, TITULO_TIPO } from '@/lib/correcciones'
import { fechaCorta } from '@/lib/format'
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

const COLOR = {
  pendiente: { fondo: Palette.amberSoft, texto: Palette.amber },
  aprobada: { fondo: Palette.greenSoft, texto: Palette.green },
  rechazada: { fondo: Palette.grayPill, texto: Palette.orange },
}

// Solicitudes de corrección de un cliente (plegable): qué se pidió, el estado y el comentario del gerente.
const EstadoCorrecciones = ({ correcciones }: { correcciones: Correccion[] }) => {
  const [abierto, setAbierto] = useState(false)
  if (correcciones.length === 0) return null
  const pendientes = correcciones.filter((c) => c.estado === 'pendiente').length
  return (
    <View style={styles.card}>
      <Pressable style={styles.top} onPress={() => setAbierto((a) => !a)}>
        <Ionicons name="git-pull-request-outline" size={18} color={Palette.navy} />
        <View style={{ flex: 1 }}>
          <Text style={styles.titulo}>Solicitudes de corrección</Text>
          <Text style={styles.sub}>{pendientes > 0 ? `${pendientes} esperando al gerente` : 'Todas revisadas'}</Text>
        </View>
        <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={20} color={Palette.navy} />
      </Pressable>
      {abierto && correcciones.map((c) => (
        <View key={c.id} style={styles.fila}>
          <View style={styles.filaTop}>
            <Text style={styles.tipo}>{TITULO_TIPO[c.tipo]}</Text>
            <View style={[styles.pill, { backgroundColor: COLOR[c.estado].fondo }]}>
              <Text style={[styles.pillText, { color: COLOR[c.estado].texto }]}>{ESTADO_TEXTO[c.estado]}</Text>
            </View>
          </View>
          {cambiosDe(c).map((x) => (
            <Text key={x.campo} style={styles.sub}>{x.campo}: {x.antes} → <Text style={styles.nuevo}>{x.despues}</Text></Text>
          ))}
          <Text style={styles.sub}>Motivo: {c.motivo} · {fechaCorta(c.solicitado_en)}</Text>
          {!!c.comentario_gerente && <Text style={styles.comentario}>Gerente: {c.comentario_gerente}</Text>}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titulo: { fontSize: 15, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  fila: { backgroundColor: Palette.cream, borderRadius: 12, padding: 10, gap: 3 },
  filaTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tipo: { fontSize: 14, fontWeight: '800', color: Palette.text },
  nuevo: { fontWeight: '800', color: Palette.navy },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '800' },
  comentario: { fontSize: 13, fontWeight: '700', color: Palette.text, fontStyle: 'italic' },
})

export default EstadoCorrecciones
