import { Palette } from '@/constants/palette'
import { direccionDesdeMiUbicacion, normalizar } from '@/lib/direccionActual'
import { Catalogo, DireccionForm } from '@/lib/zonas'
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Opcion { id: string | null; nombre: string }
type Campo = 'comuna_id' | 'sector_id' | 'pasaje_id' | 'calle_id'

interface Props {
  catalogo: Catalogo
  value: DireccionForm
  onChange: (d: DireccionForm) => void
  editable?: boolean
  conUbicacion?: boolean // botón "Usar mi ubicación"
}
const CLAVE_NUEVO: Record<string, 'comuna' | 'sector' | 'calle'> = { comuna_id: 'comuna', sector_id: 'sector', calle_id: 'calle' }

// Dirección en cadena: comuna → sector → pasaje, más número y referencia.
// "Pasaje" es la calle del catálogo (calles, obligatoria). El pasaje opcional del catálogo (pasajes) ya no se
// elige aquí, pero si una dirección antigua lo tiene se conserva y se sigue mostrando en el texto de la dirección.
// Las opciones salen del catálogo que administra el gerente (pantalla Zonas).
const SelectorDireccion = ({ catalogo, value, onChange, editable = true, conUbicacion }: Props) => {
  const [abierto, setAbierto] = useState<Campo | null>(null)
  const [busca, setBusca] = useState('')
  const [ubicando, setUbicando] = useState(false)
  const [precision, setPrecision] = useState<number | null | undefined>(undefined)

  const usarMiUbicacion = async () => {
    setUbicando(true)
    try {
      const r = await direccionDesdeMiUbicacion(catalogo, value)
      onChange(r.direccion)
      setPrecision(r.precision)
    } catch (e: any) {
      Alert.alert('Ubicación', e.message ?? String(e))
    } finally {
      setUbicando(false)
    }
  }

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

  // Elegir del catálogo (id) o escribir uno nuevo (texto, se crea al guardar)
  const elegir = (campo: Campo, id: string | null, textoNuevo?: string) => {
    const k = CLAVE_NUEVO[campo]
    const nuevo = { ...(value.nuevo ?? {}) }
    const antes = k ? (value[campo] ?? nuevo[k] ?? null) : value[campo]
    if (k) nuevo[k] = textoNuevo
    const d: DireccionForm = { ...value, [campo]: textoNuevo ? null : id, nuevo }
    const cambio = (textoNuevo ?? id) !== antes
    // Al cambiar un nivel se limpian los que dependen de él
    if (campo === 'comuna_id' && cambio) { d.sector_id = null; d.pasaje_id = null; d.calle_id = null; nuevo.sector = undefined; nuevo.calle = undefined }
    if (campo === 'sector_id' && cambio) { d.pasaje_id = null; d.calle_id = null; nuevo.calle = undefined }
    onChange(d)
    setAbierto(null)
    setBusca('')
  }

  const campos: { campo: Campo; label: string; vacio: string; requiere: string | null }[] = [
    { campo: 'comuna_id', label: 'Comuna *', vacio: 'Elegir comuna', requiere: null },
    { campo: 'sector_id', label: 'Sector *', vacio: 'Elegir sector', requiere: value.comuna_id ?? value.nuevo?.comuna ?? null },
    { campo: 'calle_id', label: 'Pasaje *', vacio: 'Elegir pasaje', requiere: value.sector_id ?? value.nuevo?.sector ?? null },
  ]

  const lista = abierto ? opciones[abierto].filter((o) => normalizar(o.nombre).includes(normalizar(busca))) : []
  // "+ Agregar" cuando lo buscado no existe todavía (no para el pasaje opcional antiguo)
  const puedeAgregar = !!abierto && !!CLAVE_NUEVO[abierto] && busca.trim().length > 1
    && !opciones[abierto].some((o) => normalizar(o.nombre) === normalizar(busca))

  return (
    <View>
      {conUbicacion && editable && (
        <>
          <Pressable style={({ pressed }) => [styles.ubicacion, pressed && { opacity: 0.85 }]} onPress={usarMiUbicacion} disabled={ubicando}>
            {ubicando ? <ActivityIndicator size="small" color={Palette.onNavy} /> : <Ionicons name="locate" size={18} color={Palette.onNavy} />}
            <Text style={styles.ubicacionText}>{ubicando ? 'Buscando dónde estás…' : 'Usar mi ubicación'}</Text>
          </Pressable>
          {precision !== undefined && value.gps && (
            <Text style={styles.ubicacionAviso}>
              Dirección tomada de tu ubicación{precision != null ? ` (precisión ± ${Math.round(precision)} m)` : ''}. Revisa y corrige si hace falta.
            </Text>
          )}
        </>
      )}
      {campos.map(({ campo, label, vacio, requiere }) => {
        const bloqueado = !editable || (campo !== 'comuna_id' && !requiere)
        const k = CLAVE_NUEVO[campo]
        const nuevoTexto = k ? value.nuevo?.[k] : undefined
        const nombre = todos[campo].find((x) => x.id === value[campo])?.nombre ?? (nuevoTexto ? `${nuevoTexto} (nuevo)` : undefined)
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
            ListHeaderComponent={puedeAgregar && abierto ? (
              <Pressable style={[styles.opcion, styles.agregar]} onPress={() => elegir(abierto, null, busca.trim())}>
                <Ionicons name="add-circle" size={20} color={Palette.orange} />
                <Text style={[styles.opcionText, { flex: 1, color: Palette.orange }]}>Agregar "{busca.trim()}"</Text>
              </Pressable>
            ) : undefined}
            ListEmptyComponent={puedeAgregar ? undefined : <Text style={styles.vacio}>No hay opciones. Escribe el nombre en el buscador para agregarlo.</Text>}
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
  ubicacion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Palette.navy, borderRadius: 12, paddingVertical: 13, marginTop: 14 },
  ubicacionText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
  ubicacionAviso: { fontSize: 12, color: Palette.green, fontWeight: '700', marginTop: 6 },
  agregar: { gap: 10, borderColor: Palette.orange, borderStyle: 'dashed', justifyContent: 'flex-start' },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14, paddingHorizontal: 20 },
})

export default SelectorDireccion
