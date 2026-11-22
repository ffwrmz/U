import TelefonoInput from '@/components/TelefonoInput'
import { Palette } from '@/constants/palette'
import { crearCorreccion } from '@/lib/correcciones'
import { clp, normalizarTelefono, telefonoLocal } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Qué se quiere corregir (con los valores actuales)
export type ObjetivoCorreccion =
  | { tipo: 'pago'; clienteId: string; ventaId: string; pagoId: string; monto: number; fecha: string }
  | { tipo: 'venta_item'; clienteId: string; ventaId: string; itemId: string; productoId: string; productoNombre: string; cantidad: number; precio: number }
  | { tipo: 'cliente'; clienteId: string; telefono: string | null; referencia: string | null }

interface Props {
  objetivo: ObjetivoCorreccion | null // null = cerrado
  onClose: () => void
  onEnviado: () => void
}

interface Producto { id: string; nombre: string; precio_venta: number }

const miles = (t: string) => t.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const numero = (t: string) => parseInt(t.replace(/\D/g, ''), 10)

// Formulario "Pedir corrección": muestra el valor actual, se escribe el correcto y el motivo (obligatorio).
// La solicitud le llega al gerente, que la aprueba o la rechaza.
const PedirCorreccion = ({ objetivo, onClose, onEnviado }: Props) => {
  const [monto, setMonto] = useState('')
  const [productoId, setProductoId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [precio, setPrecio] = useState('')
  const [telefono, setTelefono] = useState('')
  const [referencia, setReferencia] = useState('')
  const [motivo, setMotivo] = useState('')
  const [productos, setProductos] = useState<Producto[]>([])
  const [verProductos, setVerProductos] = useState(false)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!objetivo) return
    setMotivo(''); setVerProductos(false)
    if (objetivo.tipo === 'pago') setMonto(miles(String(Math.round(objetivo.monto))))
    if (objetivo.tipo === 'venta_item') {
      setProductoId(objetivo.productoId); setCantidad(String(objetivo.cantidad)); setPrecio(miles(String(Math.round(objetivo.precio))))
      supabase.from('productos').select('id, nombre, precio_venta').eq('activo', true).order('nombre')
        .then(({ data }) => setProductos((data as Producto[]) || []))
    }
    if (objetivo.tipo === 'cliente') { setTelefono(telefonoLocal(objetivo.telefono)); setReferencia(objetivo.referencia ?? '') }
  }, [objetivo])

  if (!objetivo) return null
  const productoElegido = productos.find((p) => p.id === productoId)

  const enviar = async () => {
    if (!motivo.trim()) { Alert.alert('Falta el motivo', 'Cuenta brevemente qué pasó (ej. "anoté 40.000 y eran 30.000").'); return }
    let anteriores: Record<string, any> = {}
    let nuevos: Record<string, any> = {}
    if (objetivo.tipo === 'pago') {
      const n = numero(monto)
      if (isNaN(n)) { Alert.alert('Error', 'Escribe el monto correcto (0 si el pago no existió)'); return }
      if (n === objetivo.monto) { Alert.alert('Sin cambios', 'El monto es el mismo que está registrado.'); return }
      anteriores = { monto_abonado: objetivo.monto }
      nuevos = { monto_abonado: n }
    } else if (objetivo.tipo === 'venta_item') {
      const c = parseInt(cantidad, 10)
      const p = numero(precio)
      if (isNaN(c) || c < 0) { Alert.alert('Error', 'Cantidad inválida (0 si no se vendió)'); return }
      if (isNaN(p)) { Alert.alert('Error', 'Escribe el precio por unidad'); return }
      anteriores = { producto_id: objetivo.productoId, producto_nombre: objetivo.productoNombre, cantidad: objetivo.cantidad, precio_final: objetivo.precio }
      if (productoId !== objetivo.productoId) nuevos = { producto_id: productoId, producto_nombre: productoElegido?.nombre ?? '' }
      if (c !== objetivo.cantidad) nuevos.cantidad = c
      if (p !== Math.round(objetivo.precio) || productoId !== objetivo.productoId) nuevos.precio_final = p
      if (Object.keys(nuevos).length === 0) { Alert.alert('Sin cambios', 'No cambiaste nada del producto.'); return }
    } else {
      const tel = telefono ? normalizarTelefono(telefono) : null
      if (telefono && !tel) { Alert.alert('Error', 'El celular debe tener 9 dígitos y empezar con 9'); return }
      if (tel !== (objetivo.telefono || null)) { anteriores.telefono = objetivo.telefono; nuevos.telefono = tel }
      if (referencia.trim() !== (objetivo.referencia ?? '').trim()) { anteriores.referencia = objetivo.referencia; nuevos.referencia = referencia.trim() }
      if (Object.keys(nuevos).length === 0) { Alert.alert('Sin cambios', 'No cambiaste ningún dato.'); return }
    }
    setEnviando(true)
    try {
      await crearCorreccion({
        tipo: objetivo.tipo,
        cliente_id: objetivo.clienteId,
        venta_id: objetivo.tipo === 'cliente' ? null : objetivo.ventaId,
        pago_id: objetivo.tipo === 'pago' ? objetivo.pagoId : null,
        venta_item_id: objetivo.tipo === 'venta_item' ? objetivo.itemId : null,
        datos_anteriores: anteriores,
        datos_nuevos: nuevos,
        motivo: motivo.trim(),
      })
      onEnviado()
    } catch (e: any) {
      Alert.alert('No se pudo enviar', e.message ?? String(e))
    } finally {
      setEnviando(false)
    }
  }

  const titulo = objetivo.tipo === 'pago' ? 'Corregir un pago' : objetivo.tipo === 'venta_item' ? 'Corregir un producto vendido' : 'Corregir datos del cliente'

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.contenedor}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Cerrar"><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          <Text style={styles.titulo}>{titulo}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.cuerpo} keyboardShouldPersistTaps="handled">
          <View style={styles.aviso}>
            <Ionicons name="information-circle-outline" size={18} color={Palette.navy} />
            <Text style={styles.avisoText}>El gerente revisará tu solicitud. Mientras tanto no cambia nada.</Text>
          </View>

          {objetivo.tipo === 'pago' && (
            <>
              <Text style={styles.label}>Registrado: <Text style={styles.actual}>{clp(objetivo.monto)}</Text>{objetivo.fecha ? ` (${objetivo.fecha})` : ''}</Text>
              <Text style={styles.label}>Monto correcto</Text>
              <TextInput style={styles.input} value={monto} onChangeText={(t) => setMonto(miles(t))} keyboardType="number-pad" placeholder="0" placeholderTextColor={Palette.textFaint} />
              <Text style={styles.ayuda}>Pon 0 si ese pago no existió.</Text>
            </>
          )}

          {objetivo.tipo === 'venta_item' && (
            <>
              <Text style={styles.label}>Registrado: <Text style={styles.actual}>{objetivo.cantidad} × {objetivo.productoNombre} a {clp(objetivo.precio)}</Text></Text>
              <Text style={styles.label}>Producto correcto</Text>
              <Pressable style={[styles.input, styles.selector]} onPress={() => setVerProductos((v) => !v)}>
                <Text style={styles.selectorText} numberOfLines={1}>{productoElegido?.nombre ?? objetivo.productoNombre}</Text>
                <Ionicons name={verProductos ? 'chevron-up' : 'chevron-down'} size={18} color={Palette.navy} />
              </Pressable>
              {verProductos && (
                <ScrollView style={styles.lista} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {productos.length === 0 && <ActivityIndicator color={Palette.navy} style={{ padding: 10 }} />}
                  {productos.map((p) => (
                    <Pressable key={p.id} style={[styles.opcion, p.id === productoId && styles.opcionSel]}
                      onPress={() => {
                        setProductoId(p.id); setVerProductos(false)
                        setPrecio(miles(String(Math.round(p.id === objetivo.productoId ? objetivo.precio : Number(p.precio_venta)))))
                      }}>
                      <Text style={styles.opcionText}>{p.nombre}</Text>
                      <Text style={styles.ayuda}>{clp(Number(p.precio_venta))}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.label}>Cantidad</Text>
                  <TextInput style={styles.input} value={cantidad} onChangeText={(t) => setCantidad(t.replace(/\D/g, ''))} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1.4, gap: 6 }}>
                  <Text style={styles.label}>Precio por unidad</Text>
                  <TextInput style={styles.input} value={precio} onChangeText={(t) => setPrecio(miles(t))} keyboardType="number-pad" />
                </View>
              </View>
              <Text style={styles.ayuda}>Cantidad 0 si ese producto no se vendió. Al aprobarse se ajusta el stock y la deuda.</Text>
            </>
          )}

          {objetivo.tipo === 'cliente' && (
            <>
              <Text style={styles.label}>Teléfono</Text>
              <TelefonoInput value={telefono} onChangeText={setTelefono} />
              <Text style={styles.label}>Indicaciones de la casa</Text>
              <TextInput style={[styles.input, styles.multilinea]} value={referencia} onChangeText={setReferencia} multiline
                placeholder="Ej. reja verde, al lado del almacén" placeholderTextColor={Palette.textFaint} />
            </>
          )}

          <Text style={styles.label}>Motivo (obligatorio)</Text>
          <TextInput style={[styles.input, styles.multilinea]} value={motivo} onChangeText={setMotivo} multiline
            placeholder="¿Qué pasó?" placeholderTextColor={Palette.textFaint} />
        </ScrollView>
        <View style={styles.pie}>
          <Pressable style={[styles.boton, enviando && { opacity: 0.6 }]} disabled={enviando} onPress={enviar}>
            {enviando ? <ActivityIndicator color={Palette.onNavy} /> : <Text style={styles.botonText}>Enviar al gerente</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: Palette.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  titulo: { fontSize: 18, fontWeight: '700', color: Palette.text },
  cuerpo: { padding: 16, gap: 8 },
  aviso: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: Palette.navySoft, borderRadius: 12, padding: 10 },
  avisoText: { flex: 1, fontSize: 13, color: Palette.navy },
  label: { fontSize: 14, fontWeight: '700', color: Palette.text, marginTop: 6 },
  actual: { color: Palette.navy, fontWeight: '800' },
  ayuda: { fontSize: 12, color: Palette.textMuted },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 52, fontSize: 16, color: Palette.text },
  multilinea: { height: 84, paddingTop: 12, textAlignVertical: 'top' },
  selector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectorText: { flex: 1, fontSize: 16, color: Palette.text },
  lista: { backgroundColor: Palette.card, borderRadius: 12, borderWidth: 1, borderColor: Palette.border, maxHeight: 260 },
  opcion: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Palette.border },
  opcionSel: { backgroundColor: Palette.navySoft },
  opcionText: { fontSize: 14, color: Palette.text, flex: 1 },
  pie: { padding: 16 },
  boton: { backgroundColor: Palette.orange, padding: 16, borderRadius: 12, alignItems: 'center' },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '800' },
})

export default PedirCorreccion
