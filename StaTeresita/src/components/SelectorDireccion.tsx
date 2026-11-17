import { Palette } from '@/constants/palette'
import { Catalogo, DireccionForm } from '@/lib/zonas'
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Opcion { id: string | null; nombre: string }
type Campo = 'comuna_id' | 'sector_id' | 'pasaje_id' | 'calle_id'

interface Props {
  catalogo: Catalogo
  value: DireccionForm
  onChange: (d: DireccionForm) => void
  editable?: boolean
}

// Dirección en cadena: comuna → sector → pasaje (opcional) → calle, más número y referencia.
// Las opciones salen del catálogo que administra el gerente (pantalla Zonas).
const SelectorDireccion = ({ catalogo, value, onChange, editable = true }: Props) => {
  const [abierto, setAbierto] = useState<Campo | null>(null)
  const [busca, setBusca] = useState('')

  const activos = <T extends { activo: boolean }>(l: T[]) => l.filter((x) => x.activo)
  const opciones: Record<Campo, Opcion[]> = {
    comuna_id: activos(catalogo.comunas),
    sector_id: activos(catalogo.sectores).filter((s) => s.comuna_id === value.comuna_id),
    pasaje_id: [{ id: null, nombre: 'Sin pasaje' }, ...activos(catalogo.pasajes).filter((p) => p.sector_id === value.sector_id)],
    calle_id: activos(catalogo.calles).filter((c) => c.sector_id === value.sector_id),
  }
  const todos: Record<Campo, { id: string; nombre: string }[]> = {
    comuna_id: catalogo.comunas, sector_id: catalogo.sectores, pasaje_id: catalogo.pasajes, calle_id: catalogo.calles,
  }

  const elegir = (campo: Campo, id: string | null) => {
    const d = { ...value, [campo]: id }
    // Al cambiar un nivel se limpian los que dependen de él
    if (campo === 'comuna_id' && id !== value.comuna_id) { d.sector_id = null; d.pasaje_id = null; d.calle_id = null }
    if (campo === 'sector_id' && id !== value.sector_id) { d.pasaje_id = null; d.calle_id = null }
    onChange(d)
    setAbierto(null)
    setBusca('')
  }

  const campos: { campo: Campo; label: string; vacio: string; requiere: string | null }[] = [
    { campo: 'comuna_id', label: 'Comuna *', vacio: 'Elegir comuna', requiere: null },
    { campo: 'sector_id', label: 'Sector *', vacio: 'Elegir sector', requiere: value.comuna_id },
    { campo: 'pasaje_id', label: 'Pasaje', vacio: 'Sin pasaje', requiere: value.sector_id },
    { campo: 'calle_id', label: 'Calle *', vacio: 'Elegir calle', requiere: value.sector_id },
  ]

  const lista = abierto ? opciones[abierto].filter((o) => o.nombre.toLowerCase().includes(busca.trim().toLowerCase())) : []

  return (
    <View>
      {campos.map(({ campo, label, vacio, requiere }) => {
        const bloqueado = !editable || (campo !== 'comuna_id' && !requiere)
        const nombre = todos[campo].find((x) => x.id === value[campo])?.nombre
        return (
          <View key={campo}>
            <Text style={styles.label}>{label}</Text>
            <Pressable style={[styles.campo, bloqueado && styles.campoOff]} disabled={bloqueado} onPress={() => setAbierto(campo)}>
              <Text style={[styles.campoText, !nombre && { color: Palette.textFaint }]} numberOfLines={1}>{nombre ?? vacio}</Text>
              <Ionicons name="chevron-down" size={18} color={bloqueado ? Palette.textFaint : Palette.navy} />
            </Pressable>
          </View>
        )
      })}

      <Text style={styles.label}>Número</Text>
      <TextInput style={styles.campo} value={value.numero} onChangeText={(t) => onChange({ ...value, numero: t })}
        placeholder="Ej. 123 o S/N" placeholderTextColor={Palette.textFaint} editable={editable} />

      <Text style={styles.label}>Referencia</Text>
      <TextInput style={styles.campo} value={value.referencia} onChangeText={(t) => onChange({ ...value, referencia: t })}
        placeholder="Ej. casa azul frente a la escuela" placeholderTextColor={Palette.textFaint} editable={editable} />

      <Modal visible={abierto !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAbierto(null)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{campos.find((c) => c.campo === abierto)?.label.replace(' *', '')}</Text>
            <Pressable onPress={() => { setAbierto(null); setBusca('') }}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <View style={styles.buscador}>
            <Ionicons name="search" size={18} color={Palette.textFaint} />
            <TextInput style={styles.buscadorInput} value={busca} onChangeText={setBusca} placeholder="Buscar" placeholderTextColor={Palette.textFaint} />
          </View>
          <FlatList
            data={lista}
            keyExtractor={(o) => o.id ?? 'ninguno'}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            ListEmptyComponent={<Text style={styles.vacio}>No hay opciones. El gerente las agrega en la pantalla Zonas.</Text>}
            renderItem={({ item }) => {
              const activo = abierto ? value[abierto] === item.id : false
              return (
                <Pressable style={[styles.opcion, activo && styles.opcionActiva]} onPress={() => abierto && elegir(abierto, item.id)}>
                  <Text style={[styles.opcionText, activo && { color: Palette.onNavy }]}>{item.nombre}</Text>
                  {activo ? <Ionicons name="checkmark" size={18} color={Palette.onNavy} /> : null}
                </Pressable>
              )
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: Palette.text, marginBottom: 6, marginTop: 14 },
  campo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15, color: Palette.text },
  campoOff: { backgroundColor: Palette.inputFill },
  campoText: { flex: 1, fontSize: 15, color: Palette.text },
  modal: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text },
  buscador: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 12, height: 46, margin: 16 },
  buscadorInput: { flex: 1, fontSize: 15, color: Palette.text },
  opcion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8 },
  opcionActiva: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  opcionText: { fontSize: 15, fontWeight: '600', color: Palette.text },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14, paddingHorizontal: 20 },
})

export default SelectorDireccion
