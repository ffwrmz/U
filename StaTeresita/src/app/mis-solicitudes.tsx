import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { fechaCorta } from '@/lib/format'
import { listarMisSolicitudes, marcarMisSolicitudesVistas, MiSolicitud } from '@/lib/misSolicitudes'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const ESTADO: Record<string, { t: string; fondo: string; color: string }> = {
  pendiente: { t: 'Pendiente', fondo: Palette.amberSoft, color: Palette.amber },
  aprobada: { t: 'Aprobada', fondo: Palette.greenSoft, color: Palette.green },
  usada: { t: 'Usada', fondo: Palette.greenSoft, color: Palette.green },
  rechazada: { t: 'Rechazada', fondo: Palette.grayPill, color: Palette.orangeDark },
}
const COLOR_TIPO = { 'Corrección': Palette.sky, 'Descuento': Palette.lilac, 'Inventario': Palette.teal }

// Mis solicitudes (casero): correcciones, descuentos e inventario que le pidió al gerente, con su estado.
const MisSolicitudes = () => {
  const [lista, setLista] = useState<MiSolicitud[]>([])
  const [cargando, setCargando] = useState(true)

  useFocusEffect(useCallback(() => {
    listarMisSolicitudes().then((l) => { setLista(l); setCargando(false); marcarMisSolicitudesVistas() })
  }, []))

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Mis solicitudes" subtitle="Lo que le pediste al gerente" />
      {cargando ? <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          {lista.length === 0 && <Text style={styles.vacio}>Todavía no has hecho solicitudes.</Text>}
          {lista.map((s) => {
            const e = ESTADO[s.estado] ?? ESTADO.pendiente
            return (
              <View key={s.id} style={[styles.card, { borderLeftColor: COLOR_TIPO[s.tipo] }]}>
                <View style={styles.top}>
                  <Text style={[styles.tipo, { color: COLOR_TIPO[s.tipo] }]}>{s.tipo}</Text>
                  <View style={[styles.pill, { backgroundColor: e.fondo }]}><Text style={[styles.pillText, { color: e.color }]}>{e.t}</Text></View>
                </View>
                <Text style={styles.detalle}>{s.detalle}</Text>
                <Text style={styles.sub}>{fechaCorta(s.creado_en)}</Text>
                {!!s.comentario && <Text style={styles.comentario}>Gerente: {s.comentario}</Text>}
              </View>
            )
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14 },
  card: { backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, borderLeftWidth: 4, padding: 12, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tipo: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '800' },
  detalle: { fontSize: 15, fontWeight: '700', color: Palette.text },
  sub: { fontSize: 12, color: Palette.textMuted },
  comentario: { fontSize: 13, fontStyle: 'italic', color: Palette.text },
})

export default MisSolicitudes
