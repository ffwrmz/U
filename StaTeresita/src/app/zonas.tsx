import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { supabase } from '@/lib/supabase'
import { Catalogo, catalogoVacio, cargarCatalogo, Comuna, Sector } from '@/lib/zonas'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Tabla = 'comunas' | 'sectores' | 'pasajes' | 'calles'
interface Item { id: string; nombre: string; activo: boolean }
interface Edicion { tabla: Tabla; id: string | null; nombre: string; padre: Record<string, string> }

const SINGULAR: Record<Tabla, string> = { comunas: 'comuna', sectores: 'sector', pasajes: 'pasaje', calles: 'calle' }

// Catálogo de zonas (solo gerente): comunas → sectores → pasajes y calles.
// Se crean, renombran y desactivan (no se borran, para no romper direcciones que ya las usan).
const Zonas = () => {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [cat, setCat] = useState<Catalogo>(catalogoVacio)
  const [comuna, setComuna] = useState<Comuna | null>(null)
  const [sector, setSector] = useState<Sector | null>(null)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
      setSoyGerente(esGerente(perfil?.rol))
    }
    const r = await cargarCatalogo()
    setError(r.error)
    setCat(r.catalogo)
    setCargando(false)
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const guardar = async () => {
    if (!edicion) return
    const nombre = edicion.nombre.trim()
    if (!nombre) { Alert.alert('Error', 'Escribe un nombre'); return }
    setGuardando(true)
    const { error: e } = edicion.id
      ? await supabase.from(edicion.tabla).update({ nombre }).eq('id', edicion.id)
      : await supabase.from(edicion.tabla).insert([{ nombre, ...edicion.padre }])
    setGuardando(false)
    if (e) {
      Alert.alert('Error', e.code === '23505' ? `Ya existe un(a) ${SINGULAR[edicion.tabla]} con ese nombre aquí` : e.message)
      return
    }
    setEdicion(null)
    cargar()
  }

  const alternarActivo = async (tabla: Tabla, item: Item) => {
    const { error: e } = await supabase.from(tabla).update({ activo: !item.activo }).eq('id', item.id)
    if (e) Alert.alert('Error', e.message)
    cargar()
  }

  const nuevo = (tabla: Tabla, padre: Record<string, string> = {}) => setEdicion({ tabla, id: null, nombre: '', padre })

  const Fila = ({ tabla, item, onPress, sub }: { tabla: Tabla; item: Item; onPress?: () => void; sub?: string }) => (
    <Pressable style={({ pressed }) => [styles.fila, !item.activo && { opacity: 0.55 }, pressed && onPress && { opacity: 0.8 }]}
      onPress={onPress} disabled={!onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.filaNombre}>{item.nombre}</Text>
        <Text style={styles.filaSub}>{item.activo ? sub ?? '' : 'Desactivado'}</Text>
      </View>
      <Pressable hitSlop={8} onPress={() => setEdicion({ tabla, id: item.id, nombre: item.nombre, padre: {} })}>
        <Ionicons name="create-outline" size={20} color={Palette.navy} />
      </Pressable>
      <Pressable hitSlop={8} onPress={() => alternarActivo(tabla, item)}>
        <Ionicons name={item.activo ? 'eye-outline' : 'eye-off-outline'} size={20} color={item.activo ? Palette.navy : Palette.textFaint} />
      </Pressable>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={Palette.textFaint} /> : null}
    </Pressable>
  )

  const BotonAgregar = ({ texto, onPress }: { texto: string; onPress: () => void }) => (
    <Pressable style={({ pressed }) => [styles.agregar, pressed && { opacity: 0.85 }]} onPress={onPress}>
      <Ionicons name="add-circle-outline" size={18} color={Palette.onNavy} />
      <Text style={styles.agregarText}>{texto}</Text>
    </Pressable>
  )

  const volver = () => (sector ? setSector(null) : setComuna(null))
  const sectoresDe = (id: string) => cat.sectores.filter((s) => s.comuna_id === id)

  let contenido
  if (!comuna) {
    contenido = (
      <>
        <BotonAgregar texto="Agregar comuna" onPress={() => nuevo('comunas')} />
        {cat.comunas.length === 0 ? <Text style={styles.vacio}>Aún no hay comunas. Empieza agregando una.</Text> : null}
        {cat.comunas.map((c) => (
          <Fila key={c.id} tabla="comunas" item={c} onPress={() => setComuna(c)} sub={`${sectoresDe(c.id).length} sectores`} />
        ))}
      </>
    )
  } else if (!sector) {
    const lista = sectoresDe(comuna.id)
    contenido = (
      <>
        <BotonAgregar texto="Agregar sector" onPress={() => nuevo('sectores', { comuna_id: comuna.id })} />
        {lista.length === 0 ? <Text style={styles.vacio}>Esta comuna aún no tiene sectores.</Text> : null}
        {lista.map((s) => {
          const np = cat.pasajes.filter((p) => p.sector_id === s.id).length
          const nc = cat.calles.filter((c) => c.sector_id === s.id).length
          return <Fila key={s.id} tabla="sectores" item={s} onPress={() => setSector(s)} sub={`${np} pasajes · ${nc} calles`} />
        })}
      </>
    )
  } else {
    const pasajes = cat.pasajes.filter((p) => p.sector_id === sector.id)
    const calles = cat.calles.filter((c) => c.sector_id === sector.id)
    contenido = (
      <>
        <Text style={styles.seccion}>Calles</Text>
        <BotonAgregar texto="Agregar calle" onPress={() => nuevo('calles', { sector_id: sector.id })} />
        {calles.length === 0 ? <Text style={styles.vacioMini}>Sin calles.</Text> : null}
        {calles.map((c) => <Fila key={c.id} tabla="calles" item={c} />)}

        <Text style={styles.seccion}>Pasajes</Text>
        <BotonAgregar texto="Agregar pasaje" onPress={() => nuevo('pasajes', { sector_id: sector.id })} />
        {pasajes.length === 0 ? <Text style={styles.vacioMini}>Sin pasajes.</Text> : null}
        {pasajes.map((p) => <Fila key={p.id} tabla="pasajes" item={p} />)}
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Zonas" />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : !soyGerente ? (
        <Text style={styles.vacio}>Solo el gerente puede administrar las zonas.</Text>
      ) : error ? (
        <Text style={styles.vacio}>No se pudieron cargar las zonas: {error}{'\n'}¿Ya se ejecutó el SQL de zonas en Supabase?</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {comuna ? (
            <Pressable style={styles.migas} onPress={volver}>
              <Ionicons name="chevron-back" size={18} color={Palette.navy} />
              <Text style={styles.migasText} numberOfLines={1}>
                {comuna.nombre}{sector ? ` › ${sector.nombre}` : ''}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.ayuda}>Organiza las direcciones: comuna → sector → pasajes y calles. Desactivar oculta la opción en los formularios sin borrar nada.</Text>
          )}
          {contenido}
        </ScrollView>
      )}

      <Modal visible={edicion !== null} transparent animationType="fade" onRequestClose={() => setEdicion(null)}>
        <View style={styles.fondo}>
          <View style={styles.dialogo}>
            <Text style={styles.dialogoTitulo}>
              {edicion?.id ? 'Renombrar' : 'Nueva'} {edicion ? SINGULAR[edicion.tabla] : ''}
            </Text>
            <TextInput style={styles.input} value={edicion?.nombre ?? ''} autoFocus
              onChangeText={(t) => setEdicion((e) => (e ? { ...e, nombre: t } : e))}
              placeholder="Nombre" placeholderTextColor={Palette.textFaint} editable={!guardando} />
            <View style={styles.dialogoBotones}>
              <Pressable style={[styles.boton, styles.botonSecundario]} onPress={() => setEdicion(null)}>
                <Text style={styles.botonSecundarioText}>Cancelar</Text>
              </Pressable>
              <Pressable style={[styles.boton, guardando && { opacity: 0.6 }]} onPress={guardar} disabled={guardando}>
                <Text style={styles.botonText}>{guardando ? 'Guardando...' : 'Guardar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  ayuda: { fontSize: 13, color: Palette.textMuted },
  migas: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  migasText: { fontSize: 15, fontWeight: '700', color: Palette.navy, flex: 1 },
  seccion: { fontSize: 13, fontWeight: '700', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 14 },
  filaNombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  filaSub: { fontSize: 12, color: Palette.textMuted, marginTop: 1 },
  agregar: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Palette.orange, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  agregarText: { color: Palette.onNavy, fontSize: 13, fontWeight: '800' },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14, paddingHorizontal: 20 },
  vacioMini: { color: Palette.textFaint, fontSize: 13 },
  fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  dialogo: { backgroundColor: Palette.cream, borderRadius: 18, padding: 20, gap: 14 },
  dialogoTitulo: { fontSize: 17, fontWeight: '800', color: Palette.text },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15, color: Palette.text },
  dialogoBotones: { flexDirection: 'row', gap: 10 },
  boton: { flex: 1, backgroundColor: Palette.navy, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  botonText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
  botonSecundario: { backgroundColor: Palette.grayPill },
  botonSecundarioText: { color: Palette.text, fontSize: 15, fontWeight: '700' },
})

export default Zonas
