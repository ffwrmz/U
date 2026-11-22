import { Palette } from '@/constants/palette'
import { fechaISO } from '@/lib/preasignaciones'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'

const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

interface Props {
  mes: Date // cualquier día del mes que se muestra
  seleccion: string | null // YYYY-MM-DD
  hoy: string // YYYY-MM-DD
  conteos?: Record<string, number> // clientes preasignados por día
  onCambiarMes: (mes: Date) => void
  onElegir: (fecha: string) => void
  bloquearPasados?: boolean // los días anteriores a hoy no se pueden elegir
}

// Calendario mensual simple (lunes a domingo) con un número por día (clientes preasignados).
const CalendarioMes = ({ mes, seleccion, hoy, conteos = {}, onCambiarMes, onElegir, bloquearPasados }: Props) => {
  const y = mes.getFullYear()
  const m = mes.getMonth()
  const primero = new Date(y, m, 1)
  const diasMes = new Date(y, m + 1, 0).getDate()
  const blancos = (primero.getDay() + 6) % 7 // lunes = 0
  const celdas: (string | null)[] = [
    ...Array.from({ length: blancos }, () => null),
    ...Array.from({ length: diasMes }, (_, i) => fechaISO(new Date(y, m, i + 1))),
  ]
  while (celdas.length % 7) celdas.push(null)
  const titulo = primero.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })

  return (
    <View style={styles.caja}>
      <View style={styles.top}>
        <Pressable onPress={() => onCambiarMes(new Date(y, m - 1, 1))} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={Palette.navy} />
        </Pressable>
        <Text style={styles.titulo}>{titulo.charAt(0).toUpperCase() + titulo.slice(1)}</Text>
        <Pressable onPress={() => onCambiarMes(new Date(y, m + 1, 1))} hitSlop={8}>
          <Ionicons name="chevron-forward" size={22} color={Palette.navy} />
        </Pressable>
      </View>
      <View style={styles.fila}>
        {DIAS.map((d, i) => <Text key={i} style={styles.diaSemana}>{d}</Text>)}
      </View>
      {Array.from({ length: celdas.length / 7 }, (_, semana) => (
        <View key={semana} style={styles.fila}>
          {celdas.slice(semana * 7, semana * 7 + 7).map((f, i) => {
            if (!f) return <View key={i} style={styles.celda} />
            const pasado = f < hoy
            const sel = f === seleccion
            const n = conteos[f] ?? 0
            return (
              <Pressable key={f} style={[styles.celda, sel && styles.celdaSel, f === hoy && !sel && styles.celdaHoy]}
                disabled={bloquearPasados && pasado} onPress={() => onElegir(f)}>
                <Text style={[styles.numero, pasado && styles.pasado, sel && { color: Palette.onNavy }]}>{Number(f.slice(8))}</Text>
                {n > 0 && (
                  <View style={[styles.conteo, sel && { backgroundColor: Palette.orange }]}>
                    <Text style={styles.conteoText}>{n}</Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  caja: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 10, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 4 },
  titulo: { fontSize: 16, fontWeight: '800', color: Palette.text },
  fila: { flexDirection: 'row' },
  diaSemana: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: Palette.textMuted },
  celda: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, margin: 1 },
  celdaSel: { backgroundColor: Palette.navy },
  celdaHoy: { borderWidth: 1.5, borderColor: Palette.orange },
  numero: { fontSize: 14, fontWeight: '700', color: Palette.text },
  pasado: { color: Palette.textFaint },
  conteo: { minWidth: 18, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: Palette.navySoft, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  conteoText: { fontSize: 10, fontWeight: '800', color: Palette.navy },
})

export default CalendarioMes
