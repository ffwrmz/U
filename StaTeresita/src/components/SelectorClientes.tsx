import DireccionCliente from '@/components/DireccionCliente'
import { Palette } from '@/constants/palette'
import { ClienteRuta, comunaDe, sectorDe } from '@/lib/rutas'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Orden = 'zona' | 'comuna' | 'sector' | 'calle' | 'nombre'
type Selector = 'comuna' | 'sector' | 'calle' | 'orden'
const ORDENES: { k: Orden; t: string }[] = [
  { k: 'zona', t: 'Sector, calle y número' },
  { k: 'comuna', t: 'Comuna' },
  { k: 'sector', t: 'Sector' },
  { k: 'calle', t: 'Calle / pasaje' },
  { k: 'nombre', t: 'Nombre' },
]

// Una dirección se puede filtrar por su calle o por su pasaje
const callesDe = (c: ClienteRuta) => [c.dir?.calle?.nombre, c.dir?.pasaje?.nombre].filter(Boolean) as string[]
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true })
const unicos = (l: string[]) => Array.from(new Set(l.filter(Boolean))).sort(cmp)

interface Props {
  visible: boolean
  titulo: string
  // Clientes que se pueden elegir
  clientes: ClienteRuta[]
  // Clientes que se muestran pero no se pueden elegir, con el motivo (ej. "Ya en la ruta de Juan")
  ocupados?: Record<string, string>
  onClose: () => void
  // Recibe los clientes elegidos en el orden en que se ven en la lista
  onConfirm: (ids: string[]) => void
}

// Selector de clientes con búsqueda, filtros múltiples en cadena (comuna → sector → calle/pasaje),
// orden y "Seleccionar todos". Se usa en Gestionar ruta y en Rutas de la semana.
const SelectorClientes = ({ visible, titulo, clientes, ocupados = {}, onClose, onConfirm }: Props) => {
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [busqueda, setBusqueda] = useState('')
  // Filtros de selección múltiple (lista vacía = "Todos")
  const [fComuna, setFComuna] = useState<string[]>([])
  const [fSector, setFSector] = useState<string[]>([])
  const [fCalle, setFCalle] = useState<string[]>([])
  const [orden, setOrden] = useState<Orden>('zona')
  const [selector, setSelector] = useState<Selector | null>(null)

  // Al abrir se parte sin selección ni búsqueda (los filtros se mantienen para seguir en la misma zona)
  useEffect(() => {
    if (visible) { setSeleccion([]); setBusqueda(''); setSelector(null) }
  }, [visible])

  const todos = clientes
  const conZona = todos.filter((c) => c.dir)
  const opcionesComuna = unicos(conZona.map(comunaDe))
  const enComunas = (c: ClienteRuta, l: string[]) => l.length === 0 || l.includes(comunaDe(c))
  const enSectores = (c: ClienteRuta, l: string[]) => l.length === 0 || l.includes(sectorDe(c))
  const enCalles = (c: ClienteRuta, l: string[]) => l.length === 0 || callesDe(c).some((x) => l.includes(x))
  const sectoresPara = (comunas: string[]) => unicos(conZona.filter((c) => enComunas(c, comunas)).map(sectorDe))
  const callesPara = (comunas: string[], sectores: string[]) =>
    unicos(conZona.filter((c) => enComunas(c, comunas) && enSectores(c, sectores)).flatMap(callesDe))
  const opcionesSector = sectoresPara(fComuna)
  const opcionesCalle = callesPara(fComuna, fSector)
  const nFiltros = fComuna.length + fSector.length + fCalle.length
  const hayFiltroZona = nFiltros > 0
  const limpiarFiltros = () => { setFComuna([]); setFSector([]); setFCalle([]) }

  const t = busqueda.trim().toLowerCase()
  const filtrados = todos
    .filter((c) => !t || c.nombre.toLowerCase().includes(t))
    .filter((c) => !hayFiltroZona || (!!c.dir
      && enComunas(c, fComuna) && enSectores(c, fSector) && enCalles(c, fCalle)))
    .sort((a, b) => {
      // Ocupados y clientes sin zona siempre al final
      if (!ocupados[a.id] !== !ocupados[b.id]) return ocupados[a.id] ? 1 : -1
      if (!a.dir !== !b.dir) return a.dir ? -1 : 1
      const calleNum = (c: ClienteRuta) => `${c.dir?.calle?.nombre ?? ''} ${c.dir?.pasaje?.nombre ?? ''} ${c.dir?.numero ?? ''}`
      const claves: Record<Orden, (c: ClienteRuta) => string[]> = {
        zona: (c) => [sectorDe(c), calleNum(c), c.nombre],
        comuna: (c) => [comunaDe(c), sectorDe(c), calleNum(c), c.nombre],
        sector: (c) => [sectorDe(c), c.nombre],
        calle: (c) => [calleNum(c), c.nombre],
        nombre: (c) => [c.nombre],
      }
      const ka = claves[orden](a), kb = claves[orden](b)
      for (let i = 0; i < ka.length; i++) { const r = cmp(ka[i], kb[i]); if (r) return r }
      return 0
    })
  const elegibles = filtrados.filter((c) => !ocupados[c.id])

  // Marca/desmarca una opción; al cambiar comunas o sectores se quitan los niveles de abajo que ya no corresponden
  const aplicarFiltros = (comunas: string[], sectores: string[], calles: string[]) => {
    const sectoresOk = sectores.filter((x) => sectoresPara(comunas).includes(x))
    const callesOk = calles.filter((x) => callesPara(comunas, sectoresOk).includes(x))
    setFComuna(comunas); setFSector(sectoresOk); setFCalle(callesOk)
  }
  const alternarEn = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v])
  const alternarFiltro = (valor: string | null) => {
    if (selector === 'comuna') aplicarFiltros(valor === null ? [] : alternarEn(fComuna, valor), fSector, fCalle)
    if (selector === 'sector') aplicarFiltros(fComuna, valor === null ? [] : alternarEn(fSector, valor), fCalle)
    if (selector === 'calle') aplicarFiltros(fComuna, fSector, valor === null ? [] : alternarEn(fCalle, valor))
  }
  const marcados = selector === 'comuna' ? fComuna : selector === 'sector' ? fSector : selector === 'calle' ? fCalle : []
  const opcionesSelector: { valor: string | null; texto: string }[] =
    selector === 'orden' ? ORDENES.map((o) => ({ valor: o.k, texto: o.t }))
    : [{ valor: null, texto: 'Todos' }, ...(selector === 'comuna' ? opcionesComuna : selector === 'sector' ? opcionesSector : opcionesCalle).map((x) => ({ valor: x, texto: x }))]
  const estaActivo = (valor: string | null) =>
    selector === 'orden' ? valor === orden : valor === null ? marcados.length === 0 : marcados.includes(valor)
  const textoChip = (l: string[], plural: string) => (l.length === 0 ? 'Todos' : l.length === 1 ? l[0] : `${l.length} ${plural}`)

  const alternar = (id: string) => setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const todosSeleccionados = elegibles.length > 0 && elegibles.every((c) => seleccion.includes(c.id))
  const seleccionarTodos = () => setSeleccion((s) => todosSeleccionados
    ? s.filter((id) => !elegibles.some((c) => c.id === id))
    : Array.from(new Set([...s, ...elegibles.map((c) => c.id)])))

  const confirmar = () => {
    // Se respeta el orden en que aparecen en la lista (filtros y orden elegidos)
    const ids = filtrados.map((c) => c.id).filter((id) => seleccion.includes(id))
    const resto = seleccion.filter((id) => !ids.includes(id))
    onConfirm([...ids, ...resto])
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{titulo}</Text>
          <Pressable onPress={onClose}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
        </View>
        <View style={{ padding: 16, paddingBottom: 0, gap: 10 }}>
          <TextInput style={styles.input} value={busqueda} onChangeText={setBusqueda}
            placeholder="Buscar por nombre" placeholderTextColor={Palette.textFaint} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {([
              ['comuna', 'Comuna', fComuna, 'comunas'],
              ['sector', 'Sector', fSector, 'sectores'],
              ['calle', 'Calle / pasaje', fCalle, 'calles'],
            ] as const).map(([k, etiqueta, lista, plural]) => {
              const on = lista.length > 0
              return (
                <Pressable key={k} style={[styles.chip, on && styles.chipActivo]} onPress={() => setSelector(k)}>
                  <Text style={[styles.chipText, on && { color: Palette.onNavy }]} numberOfLines={1}>{etiqueta}: {textoChip(lista, plural)}</Text>
                  <Ionicons name="chevron-down" size={14} color={on ? Palette.onNavy : Palette.navy} />
                </Pressable>
              )
            })}
            <Pressable style={styles.chip} onPress={() => setSelector('orden')}>
              <Ionicons name="swap-vertical" size={14} color={Palette.navy} />
              <Text style={styles.chipText}>{ORDENES.find((o) => o.k === orden)?.t}</Text>
            </Pressable>
          </ScrollView>
          <View style={styles.filaSeleccion}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={styles.sub}>{elegibles.length} cliente{elegibles.length === 1 ? '' : 's'}</Text>
              {hayFiltroZona && (
                <Pressable onPress={limpiarFiltros} hitSlop={6}>
                  <Text style={styles.linkNavy}>Limpiar filtros ({nFiltros})</Text>
                </Pressable>
              )}
            </View>
            {elegibles.length > 0 && (
              <Pressable onPress={seleccionarTodos} hitSlop={6}>
                <Text style={styles.linkText}>{todosSeleccionados ? 'Quitar todos' : 'Seleccionar todos'}</Text>
              </Pressable>
            )}
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          {filtrados.length === 0 && <Text style={styles.sub}>{todos.length === 0 ? 'No quedan clientes por asignar.' : 'Ningún cliente coincide con los filtros.'}</Text>}
          {filtrados.map((c) => {
            const ocupado = ocupados[c.id]
            const activo = seleccion.includes(c.id)
            return (
              <Pressable key={c.id} style={[styles.opcion, activo && styles.opcionActiva, !!ocupado && { opacity: 0.5 }]}
                onPress={() => alternar(c.id)} disabled={!!ocupado}>
                <Ionicons name={ocupado ? 'remove-circle-outline' : activo ? 'checkbox' : 'square-outline'} size={22}
                  color={activo ? Palette.navy : Palette.textFaint} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.nombre}>{c.nombre}</Text>
                  <DireccionCliente c={c} />
                  {!!ocupado && <Text style={styles.ocupado}>{ocupado}</Text>}
                </View>
              </Pressable>
            )
          })}
        </ScrollView>
        <View style={{ padding: 16 }}>
          <Pressable style={[styles.boton, seleccion.length === 0 && { opacity: 0.5 }]} onPress={confirmar} disabled={seleccion.length === 0}>
            <Text style={styles.botonText}>{`Agregar ${seleccion.length} cliente${seleccion.length === 1 ? '' : 's'}`}</Text>
          </Pressable>
        </View>

        {/* Selector de filtro / orden (encima del modal) */}
        {selector && (
          <Pressable style={styles.capa} onPress={() => setSelector(null)}>
            <Pressable style={styles.hoja} onPress={() => {}}>
              <Text style={styles.hojaTitulo}>
                {selector === 'orden' ? 'Ordenar por' : selector === 'calle' ? 'Calle / pasaje' : selector === 'sector' ? 'Sector' : 'Comuna'}
              </Text>
              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 6 }}>
                {opcionesSelector.length <= 1 && selector !== 'orden' && (
                  <Text style={styles.sub}>No hay opciones con los filtros actuales.</Text>
                )}
                {opcionesSelector.map((o) => {
                  const activo = estaActivo(o.valor)
                  const multiple = selector !== 'orden' && o.valor !== null
                  return (
                    <Pressable key={o.valor ?? 'todos'} style={[styles.opcionHoja, activo && styles.opcionHojaActiva]}
                      onPress={() => (selector === 'orden' ? (setOrden(o.valor as Orden), setSelector(null)) : alternarFiltro(o.valor))}>
                      {multiple && <Ionicons name={activo ? 'checkbox' : 'square-outline'} size={20} color={activo ? Palette.onNavy : Palette.textFaint} />}
                      <Text style={[styles.opcionHojaText, { flex: 1 }, activo && { color: Palette.onNavy }]}>{o.texto}</Text>
                      {activo && !multiple && <Ionicons name="checkmark" size={18} color={Palette.onNavy} />}
                    </Pressable>
                  )
                })}
              </ScrollView>
              {selector !== 'orden' && (
                <Pressable style={styles.boton} onPress={() => setSelector(null)}>
                  <Text style={styles.botonText}>Listo{marcados.length ? ` (${marcados.length})` : ''}</Text>
                </Pressable>
              )}
            </Pressable>
          </Pressable>
        )}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text, flex: 1, marginRight: 8 },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 16, color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  nombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  ocupado: { fontSize: 12, fontWeight: '700', color: Palette.amber },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12 },
  opcionActiva: { borderColor: Palette.navy, backgroundColor: Palette.navySoft },
  boton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center' },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 18, paddingHorizontal: 12, height: 36, maxWidth: 220 },
  chipActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  chipText: { fontSize: 13, fontWeight: '700', color: Palette.navy, flexShrink: 1 },
  filaSeleccion: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkText: { fontSize: 13, fontWeight: '800', color: Palette.orange },
  linkNavy: { fontSize: 13, fontWeight: '800', color: Palette.navy },
  capa: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  hoja: { backgroundColor: Palette.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32, gap: 12 },
  hojaTitulo: { fontSize: 17, fontWeight: '800', color: Palette.text },
  opcionHoja: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  opcionHojaActiva: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  opcionHojaText: { fontSize: 15, fontWeight: '600', color: Palette.text },
})

export default SelectorClientes
