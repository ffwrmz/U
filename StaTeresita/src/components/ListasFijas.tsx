import DireccionCliente from '@/components/DireccionCliente'
import SelectorClientes from '@/components/SelectorClientes'
import { Palette } from '@/constants/palette'
import {
  agregarALista, COLORES_LISTA, crearLista, editarLista, eliminarLista, ItemLista, itemsDeListas, ListaFija, listarListas,
  quitarDeLista, textoRegla,
} from '@/lib/listasFijas'
import { ClienteRuta } from '@/lib/rutas'
import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Casero { id: string; nombre: string }
// Grupo de una lista: un casero o "Sin casero" (id null)
type Grupo = { id: string | null; nombre: string }
const SIN_CASERO: Grupo = { id: null, nombre: 'Sin casero' }
interface Props { caseros: Casero[]; clientes: ClienteRuta[]; onCambio: () => void }
type Form = { id: string | null; nombre: string; dias_semana: number[]; dias_mes: number[]; ultimo_dia_mes: boolean; color: string }

const SEMANA = [['L', 1], ['M', 2], ['M', 3], ['J', 4], ['V', 5], ['S', 6], ['D', 7]] as const

// "Listas fijas" bajo el calendario: Lunes a Viernes y etiquetas propias (quincena, día 20, ...).
// Cada lista tiene clientes con su casero; los días que calzan con su regla cuentan como preasignados.
const ListasFijas = ({ caseros, clientes, onCambio }: Props) => {
  const [listas, setListas] = useState<ListaFija[]>([])
  const [items, setItems] = useState<ItemLista[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abierta, setAbierta] = useState<ListaFija | null>(null)
  const [agregarA, setAgregarA] = useState<Grupo | null>(null)
  const [mover, setMover] = useState<ItemLista | null>(null) // cliente a cambiar de casero dentro de la lista
  const [form, setForm] = useState<Form | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [l, it] = await Promise.all([listarListas(), itemsDeListas()])
      setListas(l); setItems(it); setError(null)
      setAbierta((a) => (a ? l.find((x) => x.id === a.id) ?? null : a))
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true)
    try { await accion() } catch (e: any) {
      // 23502: la columna vendedor_id aún no acepta vacío (falta aplicar la migración de listas sin casero)
      Alert.alert('Error', e.code === '23502'
        ? 'Todavía no se pueden dejar clientes sin casero: falta aplicar en Supabase el cambio "listas_fijas_sin_casero".'
        : e.message ?? String(e))
    }
    finally { await cargar(); onCambio(); setOcupado(false) }
  }

  const itemsDe = (listaId: string) => items.filter((x) => x.lista_id === listaId)
  const nombreDe = (id: string | null) => (id ? caseros.find((c) => c.id === id)?.nombre ?? 'Casero' : 'Sin casero')
  const grupos: Grupo[] = [...caseros, SIN_CASERO]

  // ----- Nueva etiqueta / editar regla -----
  const nueva = () => setForm({ id: null, nombre: '', dias_semana: [], dias_mes: [], ultimo_dia_mes: false, color: COLORES_LISTA[1] })
  const editar = (l: ListaFija) => setForm({ id: l.id, nombre: l.nombre, dias_semana: l.dias_semana ?? [], dias_mes: l.dias_mes ?? [], ultimo_dia_mes: l.ultimo_dia_mes, color: l.color ?? COLORES_LISTA[0] })
  const alternar = (l: number[], v: number) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v].sort((a, b) => a - b))
  const guardarForm = () => {
    if (!form) return
    const nombre = form.nombre.trim()
    if (!nombre) { Alert.alert('Etiqueta', 'Escribe un nombre'); return }
    if (!form.dias_semana.length && !form.dias_mes.length && !form.ultimo_dia_mes) { Alert.alert('Etiqueta', 'Elige al menos un día'); return }
    const datos = {
      nombre,
      dias_semana: form.dias_semana.length ? form.dias_semana : null,
      dias_mes: form.dias_mes.length ? form.dias_mes : null,
      ultimo_dia_mes: form.ultimo_dia_mes,
      color: form.color,
    }
    const id = form.id
    setForm(null)
    ejecutar(() => (id ? editarLista(id, datos) : crearLista(datos)))
  }
  const borrar = (l: ListaFija) => {
    Alert.alert('Eliminar lista', `Se eliminará "${l.nombre}" con sus clientes. Las visitas ya preasignadas en el calendario no se borran.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => { setAbierta(null); ejecutar(() => eliminarLista(l.id)) } },
    ])
  }

  // ----- Agregar clientes a la lista (con su casero) -----
  const agregar = (ids: string[]) => {
    const casero = agregarA
    const lista = abierta
    setAgregarA(null)
    if (!casero || !lista || ids.length === 0) return
    ejecutar(() => agregarALista(lista.id, casero.id, ids))
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.cabecera}>
        <Text style={styles.titulo}>Listas fijas</Text>
        <Pressable style={styles.nueva} onPress={nueva}>
          <Ionicons name="pricetag-outline" size={15} color={Palette.onNavy} />
          <Text style={styles.nuevaText}>Nueva etiqueta</Text>
        </Pressable>
      </View>
      <Text style={styles.ayuda}>Los clientes de cada lista quedan preasignados solos los días que calzan con su regla.</Text>
      {cargando ? <ActivityIndicator size="small" color={Palette.navy} />
        : error ? <Text style={styles.error}>No se pudieron cargar las listas: {error}</Text>
        : listas.map((l) => {
          const its = itemsDe(l.id)
          const deCaseros = Array.from(new Set(its.map((x) => x.vendedor_id))).map((id) => nombreDe(id))
          return (
            <Pressable key={l.id} style={styles.lista} onPress={() => setAbierta(l)}>
              <View style={[styles.punto, { backgroundColor: l.color ?? Palette.navy }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.listaNombre}>{l.nombre}</Text>
                <Text style={styles.sub}>{textoRegla(l)} · {its.length} {its.length === 1 ? 'cliente' : 'clientes'}{deCaseros.length ? ` · ${deCaseros.join(', ')}` : ''}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Palette.textFaint} />
            </Pressable>
          )
        })}

      {/* Detalle de una lista: clientes por casero */}
      <Modal visible={!!abierta} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAbierta(null)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <View style={[styles.punto, { backgroundColor: abierta?.color ?? Palette.navy }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitulo}>{abierta?.nombre}</Text>
              {abierta && <Text style={styles.sub}>{textoRegla(abierta)}</Text>}
            </View>
            {ocupado && <ActivityIndicator size="small" color={Palette.navy} />}
            <Pressable onPress={() => setAbierta(null)} hitSlop={8}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          {abierta && (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
              <View style={styles.acciones}>
                <Pressable style={styles.accion} onPress={() => editar(abierta)}>
                  <Ionicons name="create-outline" size={15} color={Palette.navy} />
                  <Text style={styles.accionText}>{abierta.sistema ? 'Cambiar color' : 'Editar nombre y días'}</Text>
                </Pressable>
                {!abierta.sistema && (
                  <Pressable style={styles.accion} onPress={() => borrar(abierta)}>
                    <Ionicons name="trash-outline" size={15} color={Palette.orange} />
                    <Text style={[styles.accionText, { color: Palette.orange }]}>Eliminar</Text>
                  </Pressable>
                )}
              </View>
              {grupos.map((c) => {
                const its = itemsDe(abierta.id).filter((x) => x.vendedor_id === c.id)
                return (
                  <View key={c.id ?? 'sin'} style={[styles.card, c.id === null && styles.cardSin]}>
                    <View style={styles.cardTop}>
                      <Text style={[styles.listaNombre, { flex: 1 }]}>{c.nombre} · {its.length}</Text>
                      <Pressable style={[styles.boton, ocupado && { opacity: 0.6 }]} disabled={ocupado} onPress={() => setAgregarA(c)}>
                        <Ionicons name="add" size={15} color={Palette.onNavy} />
                        <Text style={styles.botonText}>Agregar</Text>
                      </Pressable>
                    </View>
                    {its.map((it) => (
                      <View key={it.cliente_id} style={styles.fila}>
                        {/* Tocar el cliente permite cambiarlo de casero (o dejarlo sin casero) */}
                        <Pressable style={{ flex: 1, gap: 2 }} onPress={() => setMover(it)}>
                          <Text style={styles.nombre} numberOfLines={1}>{it.cliente?.nombre ?? 'Cliente'}</Text>
                          {it.cliente && <DireccionCliente c={it.cliente} compacta />}
                          <Text style={styles.cambiar}>Cambiar casero</Text>
                        </Pressable>
                        <Pressable onPress={() => ejecutar(() => quitarDeLista(abierta.id, it.cliente_id))} disabled={ocupado} hitSlop={8} accessibilityLabel="Quitar de la lista">
                          <Ionicons name="close-circle-outline" size={22} color={Palette.textFaint} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )
              })}
            </ScrollView>
          )}

          <SelectorClientes
            visible={!!agregarA}
            titulo={`${abierta?.nombre ?? ''} · ${agregarA?.nombre ?? ''}`}
            clientes={abierta && agregarA ? clientes.filter((x) => !itemsDe(abierta.id).some((it) => it.cliente_id === x.id && it.vendedor_id === agregarA.id)) : []}
            ocupados={abierta && agregarA ? Object.fromEntries(itemsDe(abierta.id).filter((it) => it.vendedor_id !== agregarA.id).map((it) => [it.cliente_id, `En esta lista con ${nombreDe(it.vendedor_id)} (se moverá)`])) : {}}
            moverOcupados
            revisarAntes="Agregar"
            revisarDescripcion={(n) => `Vas a agregar ${n} ${n === 1 ? 'cliente' : 'clientes'} a "${abierta?.nombre ?? ''}" ${agregarA?.id ? `con ${agregarA.nombre}` : 'sin casero'}`}
            onClose={() => setAgregarA(null)}
            onConfirm={agregar}
          />
          {/* Cambiar de casero a un cliente de la lista */}
          {mover && abierta && (
            <Pressable style={styles.capa} onPress={() => setMover(null)}>
              <Pressable style={styles.hoja} onPress={() => {}}>
                <Text style={styles.modalTitulo}>{mover.cliente?.nombre ?? 'Cliente'}: ¿con qué casero?</Text>
                <View style={styles.chips}>
                  {grupos.map((g) => (
                    <Pressable key={g.id ?? 'sin'} style={[styles.chip, mover.vendedor_id === g.id && styles.diaOn]}
                      onPress={() => { const it = mover; setMover(null); if (it.vendedor_id !== g.id) ejecutar(() => agregarALista(abierta.id, g.id, [it.cliente_id])) }}>
                      <Text style={[styles.chipText, mover.vendedor_id === g.id && { color: Palette.cream }]}>{g.nombre}</Text>
                    </Pressable>
                  ))}
                </View>
              </Pressable>
            </Pressable>
          )}
        </SafeAreaView>
      </Modal>

      {/* Nueva etiqueta / editar */}
      <Modal visible={!!form} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setForm(null)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitulo, { flex: 1 }]}>{form?.id ? 'Editar lista' : 'Nueva etiqueta'}</Text>
            <Pressable onPress={() => setForm(null)} hitSlop={8}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          {form && (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              {!listas.find((l) => l.id === form.id)?.sistema && (
                <>
                  <Text style={styles.label}>Nombre</Text>
                  <TextInput style={styles.input} value={form.nombre} onChangeText={(t) => setForm({ ...form, nombre: t })}
                    placeholder="Ej. Quincena" placeholderTextColor={Palette.textFaint} />

                  <Text style={styles.label}>Atajos</Text>
                  <View style={styles.chips}>
                    <Pressable style={styles.chip} onPress={() => setForm({ ...form, nombre: form.nombre || 'Quincena', dias_semana: [], dias_mes: [15], ultimo_dia_mes: true })}>
                      <Text style={styles.chipText}>Quincena (15 y último)</Text>
                    </Pressable>
                    <Pressable style={styles.chip} onPress={() => setForm({ ...form, nombre: form.nombre || 'Día 20', dias_semana: [], dias_mes: [20], ultimo_dia_mes: false })}>
                      <Text style={styles.chipText}>Día 20</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.label}>Días de la semana</Text>
                  <View style={styles.chips}>
                    {SEMANA.map(([t, n]) => (
                      <Pressable key={n} style={[styles.dia, form.dias_semana.includes(n) && styles.diaOn]} onPress={() => setForm({ ...form, dias_semana: alternar(form.dias_semana, n) })}>
                        <Text style={[styles.diaText, form.dias_semana.includes(n) && { color: Palette.cream }]}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.label}>Días del mes</Text>
                  <View style={styles.chips}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                      <Pressable key={n} style={[styles.dia, form.dias_mes.includes(n) && styles.diaOn]} onPress={() => setForm({ ...form, dias_mes: alternar(form.dias_mes, n) })}>
                        <Text style={[styles.diaText, form.dias_mes.includes(n) && { color: Palette.cream }]}>{n}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={[styles.chip, form.ultimo_dia_mes && styles.diaOn]} onPress={() => setForm({ ...form, ultimo_dia_mes: !form.ultimo_dia_mes })}>
                      <Text style={[styles.chipText, form.ultimo_dia_mes && { color: Palette.cream }]}>Último día del mes</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.sub}>{textoRegla({ dias_semana: form.dias_semana, dias_mes: form.dias_mes, ultimo_dia_mes: form.ultimo_dia_mes })}. Si un mes no tiene ese día (ej. 31), ese mes no aplica; para eso usa "Último día del mes".</Text>
                </>
              )}

              <Text style={styles.label}>Color</Text>
              <View style={styles.chips}>
                {COLORES_LISTA.map((col) => (
                  <Pressable key={col} style={[styles.color, { backgroundColor: col }, form.color === col && styles.colorOn]} onPress={() => setForm({ ...form, color: col })} />
                ))}
              </View>

              <Pressable style={styles.guardar} onPress={guardarForm}>
                <Text style={styles.guardarText}>{form.id ? 'Guardar cambios' : 'Crear etiqueta'}</Text>
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  titulo: { fontSize: 17, fontWeight: '800', color: Palette.text },
  ayuda: { fontSize: 12, color: Palette.textMuted },
  error: { color: Palette.amber, fontSize: 13 },
  nueva: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Palette.orange, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  nuevaText: { color: Palette.onNavy, fontSize: 12, fontWeight: '800' },
  lista: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12 },
  punto: { width: 12, height: 12, borderRadius: 6 },
  listaNombre: { fontSize: 15, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 12, color: Palette.textMuted },
  modal: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitulo: { fontSize: 18, fontWeight: '700', color: Palette.text },
  acciones: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  accion: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Palette.navySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  accionText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  card: { backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  boton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  botonText: { color: Palette.onNavy, fontSize: 12, fontWeight: '700' },
  cardSin: { borderStyle: 'dashed', borderColor: Palette.navy },
  cambiar: { fontSize: 11, fontWeight: '700', color: Palette.orange, marginTop: 2 },
  capa: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  hoja: { backgroundColor: Palette.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32, gap: 12 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 10, padding: 10 },
  nombre: { fontSize: 14, fontWeight: '700', color: Palette.text },
  label: { fontSize: 14, fontWeight: '700', color: Palette.text },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, color: Palette.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  dia: { width: 38, height: 34, borderRadius: 8, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.card, alignItems: 'center', justifyContent: 'center' },
  diaOn: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  diaText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  color: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: Palette.card },
  colorOn: { borderColor: Palette.orange, transform: [{ scale: 1.1 }] },
  guardar: { backgroundColor: Palette.orange, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  guardarText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
})

export default ListasFijas
