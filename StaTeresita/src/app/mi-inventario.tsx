import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { fechaCorta } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Fila { producto_id: string; nombre: string; cantidad: number }
interface Solicitud { id: string; producto_id: string; tipo: Tipo; cantidad: number; nota: string | null; estado: string; comentario_gerente: string | null; creado_en: string }
type Tipo = 'agregar' | 'devolver' | 'corregir'

const TIPOS: [Tipo, string, string][] = [
  ['agregar', 'Agregar', 'Que me carguen más desde la bodega'],
  ['devolver', 'Devolver', 'Devolver unidades a la bodega'],
  ['corregir', 'Corregir', 'La cantidad real es otra'],
]
const ESTADO: Record<string, { t: string; fondo: string; color: string }> = {
  pendiente: { t: 'Pendiente', fondo: Palette.amberSoft, color: Palette.amber },
  aprobada: { t: 'Aprobada', fondo: Palette.greenSoft, color: Palette.green },
  rechazada: { t: 'Rechazada', fondo: Palette.grayPill, color: Palette.orangeDark },
}

// Mi inventario (casero): lo que lleva su furgón y pedirle al gerente que lo cambie.
const MiInventario = () => {
  const [cargando, setCargando] = useState(true)
  const [furgon, setFurgon] = useState<{ id: string; nombre: string } | null>(null)
  const [filas, setFilas] = useState<Fila[]>([])
  const [productos, setProductos] = useState<{ id: string; nombre: string }[]>([])
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState<{ producto_id: string | null; tipo: Tipo; cantidad: string; nota: string } | null>(null)
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: u } = await supabase.from('ubicaciones_inventario').select('id, nombre').eq('tipo', 'furgon').eq('responsable_id', user.id).eq('activo', true).limit(1).maybeSingle()
    setFurgon((u as any) ?? null)
    const [st, ps, sol] = await Promise.all([
      u ? supabase.from('inventario_stock').select('producto_id, cantidad, productos ( nombre )').eq('ubicacion_id', (u as any).id) : Promise.resolve({ data: [] } as any),
      supabase.from('productos').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('solicitudes_inventario').select('*').eq('solicitante_id', user.id).order('creado_en', { ascending: false }).limit(30),
    ])
    setFilas((((st as any).data as any[]) || []).map((x) => ({ producto_id: x.producto_id, nombre: x.productos?.nombre ?? 'Producto', cantidad: Number(x.cantidad) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
    setProductos((ps.data as any[]) || [])
    setSolicitudes(sol.error ? [] : ((sol.data as Solicitud[]) || []))
    setCargando(false)
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const nombreDe = (id: string) => productos.find((p) => p.id === id)?.nombre ?? filas.find((f) => f.producto_id === id)?.nombre ?? 'Producto'
  const visibles = filas.filter((f) => f.nombre.toLowerCase().includes(busca.trim().toLowerCase()))
  const total = filas.reduce((n, f) => n + f.cantidad, 0)

  const enviar = async () => {
    if (!form || !furgon) return
    const cantidad = parseInt(form.cantidad, 10)
    if (!form.producto_id) { Alert.alert('Falta el producto', 'Elige el producto'); return }
    if (isNaN(cantidad) || cantidad < 0 || (form.tipo !== 'corregir' && cantidad === 0)) { Alert.alert('Cantidad inválida', 'Escribe una cantidad válida'); return }
    setEnviando(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('solicitudes_inventario').insert({
      solicitante_id: user?.id, ubicacion_id: furgon.id, producto_id: form.producto_id, tipo: form.tipo, cantidad, nota: form.nota.trim() || null,
    })
    setEnviando(false)
    if (error) {
      Alert.alert('No se pudo enviar', /solicitudes_inventario/.test(error.message) ? 'Falta correr en Supabase el archivo 20261125040000_fuera_de_ruta_inventario.sql' : error.message)
      return
    }
    setForm(null)
    Alert.alert('Solicitud enviada', 'El gerente la revisará y te llegará el aviso.')
    cargar()
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Mi inventario" subtitle={furgon?.nombre ?? 'Lo que llevas en el furgón'} />
      {cargando ? <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} /> : !furgon ? (
        <Text style={styles.vacio}>Todavía no tienes un furgón asignado. Pídele al gerente que te asigne uno.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.resumen}>
            <Text style={styles.resumenNum}>{total}</Text>
            <Text style={styles.resumenTxt}>unidades en {filas.filter((f) => f.cantidad > 0).length} productos</Text>
          </View>
          <Pressable style={styles.boton} onPress={() => setForm({ producto_id: null, tipo: 'agregar', cantidad: '', nota: '' })}>
            <Ionicons name="swap-vertical" size={18} color={Palette.onNavy} />
            <Text style={styles.botonText}>Solicitar cambio</Text>
          </Pressable>

          <View style={styles.buscador}>
            <Ionicons name="search" size={18} color={Palette.textFaint} />
            <TextInput style={styles.buscadorInput} value={busca} onChangeText={setBusca} placeholder="Buscar producto" placeholderTextColor={Palette.textFaint} />
          </View>
          {visibles.length === 0 && <Text style={styles.vacio}>No hay productos.</Text>}
          {visibles.map((f) => (
            <View key={f.producto_id} style={[styles.fila, { borderLeftColor: f.cantidad > 0 ? Palette.teal : Palette.textFaint }]}>
              <Text style={styles.nombre} numberOfLines={1}>{f.nombre}</Text>
              <Text style={[styles.cantidad, f.cantidad === 0 && { color: Palette.textFaint }]}>{f.cantidad}</Text>
            </View>
          ))}

          {solicitudes.length > 0 && <Text style={styles.seccion}>Mis solicitudes</Text>}
          {solicitudes.map((s) => {
            const e = ESTADO[s.estado] ?? ESTADO.pendiente
            return (
              <View key={s.id} style={styles.sol}>
                <View style={styles.solTop}>
                  <Text style={styles.solTitulo} numberOfLines={1}>
                    {s.tipo === 'agregar' ? 'Agregar' : s.tipo === 'devolver' ? 'Devolver' : 'Dejar en'} {s.cantidad} · {nombreDe(s.producto_id)}
                  </Text>
                  <View style={[styles.pill, { backgroundColor: e.fondo }]}><Text style={[styles.pillText, { color: e.color }]}>{e.t}</Text></View>
                </View>
                <Text style={styles.sub}>{fechaCorta(s.creado_en)}{s.nota ? ` · ${s.nota}` : ''}</Text>
                {!!s.comentario_gerente && <Text style={styles.comentario}>Gerente: {s.comentario_gerente}</Text>}
              </View>
            )
          })}
        </ScrollView>
      )}

      <Modal visible={!!form} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setForm(null)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Solicitar cambio</Text>
            <Pressable onPress={() => setForm(null)} hitSlop={8}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          {form && (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Qué necesitas</Text>
              {TIPOS.map(([k, t, d]) => (
                <Pressable key={k} style={[styles.opcion, form.tipo === k && styles.opcionActiva]} onPress={() => setForm({ ...form, tipo: k })}>
                  <Text style={[styles.opcionTitulo, form.tipo === k && { color: Palette.onNavy }]}>{t}</Text>
                  <Text style={[styles.sub, form.tipo === k && { color: Palette.onNavyMuted }]}>{d}</Text>
                </Pressable>
              ))}
              <Text style={styles.label}>Producto</Text>
              <View style={styles.chips}>
                {(form.tipo === 'agregar' ? productos : filas.map((f) => ({ id: f.producto_id, nombre: f.nombre }))).map((p) => (
                  <Pressable key={p.id} style={[styles.chip, form.producto_id === p.id && styles.chipActivo]} onPress={() => setForm({ ...form, producto_id: p.id })}>
                    <Text style={[styles.chipText, form.producto_id === p.id && { color: Palette.onNavy }]}>{p.nombre}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>{form.tipo === 'corregir' ? 'Cantidad real en el furgón' : 'Cantidad'}</Text>
              <TextInput style={styles.input} value={form.cantidad} onChangeText={(t) => setForm({ ...form, cantidad: t.replace(/\D/g, '') })}
                keyboardType="number-pad" placeholder="0" placeholderTextColor={Palette.textFaint} />
              <Text style={styles.label}>Nota (opcional)</Text>
              <TextInput style={styles.input} value={form.nota} onChangeText={(t) => setForm({ ...form, nota: t })}
                placeholder="Ej. se me acabaron" placeholderTextColor={Palette.textFaint} />
              <Pressable style={[styles.boton, enviando && { opacity: 0.6 }]} disabled={enviando} onPress={enviar}>
                {enviando ? <ActivityIndicator color={Palette.onNavy} /> : <Text style={styles.botonText}>Enviar al gerente</Text>}
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 20, fontSize: 14, paddingHorizontal: 20 },
  resumen: { backgroundColor: Palette.teal, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  resumenNum: { fontSize: 28, fontWeight: '900', color: Palette.onNavy },
  resumenTxt: { fontSize: 14, fontWeight: '700', color: Palette.onNavyMuted },
  boton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Palette.navy, borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  botonText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
  buscador: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  buscadorInput: { flex: 1, fontSize: 15, color: Palette.text },
  fila: { flexDirection: 'row', alignItems: 'center', backgroundColor: Palette.card, borderRadius: 12, borderWidth: 1, borderColor: Palette.border, borderLeftWidth: 4, paddingHorizontal: 12, paddingVertical: 11 },
  nombre: { flex: 1, fontSize: 15, fontWeight: '700', color: Palette.text },
  cantidad: { fontSize: 18, fontWeight: '900', color: Palette.teal },
  seccion: { fontSize: 13, fontWeight: '800', color: Palette.navy, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },
  sol: { backgroundColor: Palette.card, borderRadius: 12, borderWidth: 1, borderColor: Palette.border, padding: 12, gap: 3 },
  solTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  solTitulo: { flex: 1, fontSize: 14, fontWeight: '800', color: Palette.text },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '800' },
  sub: { fontSize: 12, color: Palette.textMuted },
  comentario: { fontSize: 13, fontStyle: 'italic', color: Palette.text },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text },
  label: { fontSize: 14, fontWeight: '700', color: Palette.text, marginTop: 6 },
  opcion: { backgroundColor: Palette.card, borderRadius: 12, borderWidth: 1, borderColor: Palette.border, padding: 12, gap: 2 },
  opcionActiva: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  opcionTitulo: { fontSize: 15, fontWeight: '800', color: Palette.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: Palette.tealSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipActivo: { backgroundColor: Palette.teal },
  chipText: { fontSize: 13, fontWeight: '700', color: Palette.teal },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 16, color: Palette.text },
})

export default MiInventario
