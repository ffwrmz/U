import { Palette } from '@/constants/palette'
import { Companero, listarEquipo } from '@/lib/ajustes'
import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

interface Props {
  titulo: string // ej. "¿Quién hizo la venta?"
  valor: string | null // null = yo (el gerente)
  onCambiar: (trabajadorId: string | null) => void
}

// Solo para el gerente: registrar una venta o un cobro a nombre de otro trabajador
// (por ejemplo, un cliente que no estaba en la ruta de ese día).
const QuienLoHizo = ({ titulo, valor, onCambiar }: Props) => {
  const [equipo, setEquipo] = useState<Companero[]>([])
  const [yo, setYo] = useState<string | null>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setYo(data.user?.id ?? null))
    listarEquipo().then(setEquipo)
  }, [])
  const otros = equipo.filter((t) => t.id !== yo)
  if (otros.length === 0) return null
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{titulo}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Pressable style={[styles.chip, !valor && styles.chipActivo]} onPress={() => onCambiar(null)}>
          <Text style={[styles.chipText, !valor && { color: Palette.onNavy }]}>Yo</Text>
        </Pressable>
        {otros.map((t) => (
          <Pressable key={t.id} style={[styles.chip, valor === t.id && styles.chipActivo]} onPress={() => onCambiar(t.id)}>
            <Text style={[styles.chipText, valor === t.id && { color: Palette.onNavy }]}>{t.nombre}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {!!valor && <Text style={styles.nota}>Queda a nombre de ese trabajador. Si el cliente no estaba en su ruta de hoy, se agrega como visita "fuera de ruta".</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: Palette.text },
  chips: { gap: 8 },
  chip: { backgroundColor: Palette.lilacSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipActivo: { backgroundColor: Palette.lilac },
  chipText: { fontSize: 14, fontWeight: '700', color: Palette.lilac },
  nota: { fontSize: 12, color: Palette.textMuted },
})

export default QuienLoHizo
