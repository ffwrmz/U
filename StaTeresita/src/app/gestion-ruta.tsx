import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import {
  asignarParadas, cambiarEstadoJornada, ClienteRuta, EstadoJornada, Jornada, listarParadas, moverParada,
  comunaDe, obtenerOCrearJornadaHoy, Parada, quitarParada, sectorDe, SELECT_CLIENTE, textoEstadoJornada,
} from '@/lib/rutas'
import DireccionCliente from '@/components/DireccionCliente'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Cliente = ClienteRuta

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
const callesDe = (c: Cliente) => [c.dir?.calle?.nombre, c.dir?.pasaje?.nombre].filter(Boolean) as string[]
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true })
const unicos = (l: string[]) => Array.from(new Set(l.filter(Boolean))).sort(cmp)

const VISITA = {
  pendiente: { texto: 'Pendiente', fondo: Palette.grayPill, color: Palette.textMuted },
  visitado: { texto: 'Visitado', fondo: Palette.greenSoft, color: Palette.green },
  no_estaba: { texto: 'No estaba', fondo: Palette.amberSoft, color: Palette.amber },
} as const

// Ruta del día guardada en Supabase (jornadas + ruta_paradas, ver lib/rutas.ts).
// También lee el rol, los trabajadores, su furgón y los clientes con su dirección por zonas.
const GestionRuta = () => {
  const [soyGerente, setSoyGerente] = useState(false)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [paradas, setParadas] = useState<Parada[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [vendedores, setVendedores] = useState<{ casero_id: string; nombre: string; furgon: string | null }[]>([])

  const [caseroModal, setCaseroModal] = useState<{ casero_id: string; nombre: string } | null>(null)
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [busqueda, setBusqueda] = useState('')
  // Filtros de selección múltiple (lista vacía = "Todos")
  const [fComuna, setFComuna] = useState<string[]>([])
  const [fSector, setFSector] = useState<string[]>([])
  const [fCalle, setFCalle] = useState<string[]>([])
  const [orden, setOrden] = useState<Orden>('zona')
  const [selector, setSelector] = useState<Selector | null>(null)

  const estado: EstadoJornada = jornada?.estado ?? 'preparacion'
  // El gerente solo puede cambiar la ruta mientras la jornada está en preparación
  const editable = estado === 'preparacion' && soyGerente
  const caseros = vendedores

  const recargarParadas = async (j: Jornada | null = jornada) => {
    if (!j) { setParadas([]); return }
    setParadas(await listarParadas(j.id))
  }

  // Ejecuta un cambio en Supabase, muestra el error si falla y vuelve a leer las paradas
  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true)
    try {
      await accion()
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e))
    } finally {
      try { await recargarParadas() } catch {}
      setOcupado(false)
    }
  }

  useFocusEffect(
    useCallback(() => {
      const leer = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        let gerente = false
        if (user) {
          const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
          gerente = esGerente(perfil?.rol)
          setSoyGerente(gerente)
        }
        try {
          const j = await obtenerOCrearJornadaHoy(gerente)
          setJornada(j)
          setParadas(j ? await listarParadas(j.id) : [])
          setError(null)
        } catch (e: any) {
          setError(e.message ?? String(e))
        }
        const { data: cs, error: ec } = await supabase.from('clientes')
          .select(SELECT_CLIENTE)
          .order('nombre', { ascending: true })
        if (ec) {
          // Si falla la consulta con zonas, al menos se muestran los clientes con la dirección en texto
          const { data: simples } = await supabase.from('clientes').select('id, nombre, direccion').order('nombre', { ascending: true })
          setClientes(((simples as any[]) || []).map((c) => ({ ...c, dir: null })))
        } else {
          setClientes(((cs as any[]) || []) as Cliente[])
        }
        const { data: vs } = await supabase.from('perfiles').select('id, nombre, rol').in('rol', ['vendedor', 'dueno']).order('nombre', { ascending: true })
        // Furgón asignado a cada trabajador (si ya se ejecutó asignar_furgon.sql)
        const { data: fs } = await supabase.from('ubicaciones_inventario').select('nombre, responsable_id').eq('tipo', 'furgon').eq('activo', true)
        const furgonDe = (id: string) => ((fs as any[]) || []).find((f) => f.responsable_id === id)?.nombre ?? null
        setVendedores(((vs as any[]) || []).map((v) => ({ casero_id: v.id, nombre: v.nombre, furgon: furgonDe(v.id) })))
        setCargando(false)
      }
      leer()
    }, [])
  )

  const paradasDe = (casero_id: string) => paradas.filter((p) => p.vendedor_id === casero_id).sort((a, b) => a.orden - b.orden)
  const nombreCasero = (id: string) => vendedores.find((v) => v.casero_id === id)?.nombre ?? 'otro casero'
  const sinAsignar = clientes.filter((c) => !paradas.some((p) => p.cliente_id === c.id))

  // ---------- Asignar ----------
  const abrirAsignar = (c: { casero_id: string; nombre: string }) => {
    setSeleccion([]); setBusqueda(''); setSelector(null)
    setCaseroModal(c)
  }

  const alternar = (id: string) =>
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const guardarAsignacion = async () => {
    if (!caseroModal || seleccion.length === 0 || !jornada) return
    // Se respeta el orden en que aparecen en la lista (filtros y orden elegidos)
    const ids = filtrados.map((c) => c.id).filter((id) => seleccion.includes(id))
    const resto = seleccion.filter((id) => !ids.includes(id))
    const casero = caseroModal.casero_id
    setCaseroModal(null)
    await ejecutar(() => asignarParadas(jornada.id, casero, [...ids, ...resto]))
  }

  const quitar = (p: Parada) => ejecutar(() => quitarParada(p.id))

  const mover = (p: Parada, delta: -1 | 1) => ejecutar(() => moverParada(paradasDe(p.vendedor_id), p.id, delta))

  const cambiarEstado = (nuevo: EstadoJornada) => {
    if (!jornada) return
    const iniciar = nuevo === 'en_curso'
    Alert.alert(
      iniciar ? 'Iniciar ruta' : 'Finalizar ruta',
      iniciar ? 'Al iniciar se bloquean los clientes asignados y su orden.' : 'Se cerrará la jornada de hoy.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: iniciar ? 'Iniciar' : 'Finalizar', onPress: () => ejecutar(async () => setJornada(await cambiarEstadoJornada(jornada.id, nuevo))) },
      ]
    )
  }

  // ---------- Filtros y orden (para elegir clientes) ----------
  const conZona = sinAsignar.filter((c) => c.dir)
  const opcionesComuna = unicos(conZona.map(comunaDe))
  const enComunas = (c: Cliente, l: string[]) => l.length === 0 || l.includes(comunaDe(c))
  const enSectores = (c: Cliente, l: string[]) => l.length === 0 || l.includes(sectorDe(c))
  const enCalles = (c: Cliente, l: string[]) => l.length === 0 || callesDe(c).some((x) => l.includes(x))
  const sectoresPara = (comunas: string[]) => unicos(conZona.filter((c) => enComunas(c, comunas)).map(sectorDe))
  const callesPara = (comunas: string[], sectores: string[]) =>
    unicos(conZona.filter((c) => enComunas(c, comunas) && enSectores(c, sectores)).flatMap(callesDe))
  const opcionesSector = sectoresPara(fComuna)
  const opcionesCalle = callesPara(fComuna, fSector)
  const nFiltros = fComuna.length + fSector.length + fCalle.length
  const hayFiltroZona = nFiltros > 0
  const limpiarFiltros = () => { setFComuna([]); setFSector([]); setFCalle([]) }

  const t = busqueda.trim().toLowerCase()
  const filtrados = sinAsignar
    .filter((c) => !t || c.nombre.toLowerCase().includes(t))
    .filter((c) => !hayFiltroZona || (!!c.dir
      && enComunas(c, fComuna) && enSectores(c, fSector) && enCalles(c, fCalle)))
    .sort((a, b) => {
      // Los clientes sin zona siempre al final
      if (!a.dir !== !b.dir) return a.dir ? -1 : 1
      const calleNum = (c: Cliente) => `${c.dir?.calle?.nombre ?? ''} ${c.dir?.pasaje?.nombre ?? ''} ${c.dir?.numero ?? ''}`
      const claves: Record<Orden, (c: Cliente) => string[]> = {
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

  const todosSeleccionados = filtrados.length > 0 && filtrados.every((c) => seleccion.includes(c.id))
  const seleccionarTodos = () => setSeleccion((s) => todosSeleccionados
    ? s.filter((id) => !filtrados.some((c) => c.id === id))
    : Array.from(new Set([...s, ...filtrados.map((c) => c.id)])))

  const clienteDe = (id: string) => clientes.find((c) => c.id === id)

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Gestionar ruta" />

      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {error && (
            <View style={styles.aviso}>
              <Ionicons name="warning-outline" size={22} color={Palette.amber} />
              <Text style={styles.avisoText}>No se pudo leer la ruta guardada: {error}</Text>
            </View>
          )}
          {/* Resumen */}
          <View style={styles.resumen}>
            <View style={styles.resumenTop}>
              <Text style={[styles.resumenLabel, { flex: 1 }]}>Jornada de hoy · {textoEstadoJornada(estado)}</Text>
              {ocupado && <ActivityIndicator size="small" color={Palette.onNavy} />}
              {soyGerente && jornada && estado !== 'finalizada' && (
                <Pressable style={styles.jornadaBtn} disabled={ocupado}
                  onPress={() => cambiarEstado(estado === 'preparacion' ? 'en_curso' : 'finalizada')}>
                  <Ionicons name={estado === 'preparacion' ? 'play' : 'stop'} size={13} color={Palette.onNavy} />
                  <Text style={styles.jornadaBtnText}>{estado === 'preparacion' ? 'Iniciar ruta' : 'Finalizar ruta'}</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.resumenRow}>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum}>{caseros.length}</Text>
                <Text style={styles.resumenTxt}>caseros</Text>
              </View>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum}>{paradas.length}</Text>
                <Text style={styles.resumenTxt}>clientes asignados</Text>
              </View>
              <View style={styles.resumenItem}>
                <Text style={styles.resumenNum}>{sinAsignar.length}</Text>
                <Text style={styles.resumenTxt}>sin asignar</Text>
              </View>
            </View>
            {!editable && (
              <Text style={styles.resumenNota}>
                {!soyGerente ? 'Solo el gerente puede modificar las rutas.'
                  : estado === 'finalizada' ? 'La jornada de hoy ya terminó.' : 'La jornada ya inició: la ruta está bloqueada.'}
              </Text>
            )}
          </View>

          {caseros.length === 0 && (
            <View style={styles.aviso}>
              <Ionicons name="information-circle-outline" size={22} color={Palette.navy} />
              <Text style={[styles.avisoText, { color: Palette.text }]}>
                No hay trabajadores (vendedor o dueno) en la tabla perfiles.
              </Text>
            </View>
          )}

          {caseros.map((c) => {
            const lista = paradasDe(c.casero_id)
            return (
              <View key={c.casero_id} style={styles.caseroCard}>
                <View style={styles.caseroTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{c.nombre.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.caseroNombre}>{c.nombre}</Text>
                    <Text style={styles.sub}>{c.furgon ? `${c.furgon} · ` : ''}{lista.length} clientes</Text>
                  </View>
                  {editable && (
                    <Pressable style={[styles.botonChico, ocupado && { opacity: 0.6 }]} disabled={ocupado} onPress={() => abrirAsignar(c)}>
                      <Ionicons name="add" size={16} color={Palette.onNavy} />
                      <Text style={styles.botonChicoText}>Asignar</Text>
                    </Pressable>
                  )}
                </View>

                {lista.length === 0 && <Text style={styles.sub}>Sin clientes asignados.</Text>}
                {lista.map((p, i) => {
                  const v = VISITA[p.estado] ?? VISITA.pendiente
                  const cp = p.cliente ?? clienteDe(p.cliente_id)
                  return (
                    <View key={p.id} style={styles.parada}>
                      <View style={styles.numero}><Text style={styles.numeroText}>{i + 1}</Text></View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.paradaNombre} numberOfLines={1}>{cp?.nombre ?? 'Cliente'}</Text>
                        {cp && <DireccionCliente c={cp} />}
                        <View style={[styles.pill, { backgroundColor: v.fondo }]}>
                          <Text style={[styles.pillText, { color: v.color }]}>{v.texto}</Text>
                        </View>
                      </View>
                      {editable && (
                        <View style={styles.acciones}>
                          <Pressable onPress={() => mover(p, -1)} disabled={ocupado} hitSlop={6}><Ionicons name="chevron-up" size={20} color={i === 0 ? Palette.border : Palette.navy} /></Pressable>
                          <Pressable onPress={() => mover(p, 1)} disabled={ocupado} hitSlop={6}><Ionicons name="chevron-down" size={20} color={i === lista.length - 1 ? Palette.border : Palette.navy} /></Pressable>
                          <Pressable onPress={() => quitar(p)} disabled={ocupado} hitSlop={6}><Ionicons name="close-circle-outline" size={20} color={Palette.textFaint} /></Pressable>
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            )
          })}
        </ScrollView>
      )}

      {/* Modal: asignar clientes */}
      <Modal visible={!!caseroModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCaseroModal(null)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Clientes para {caseroModal?.nombre}</Text>
            <Pressable onPress={() => setCaseroModal(null)}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
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
                <Text style={styles.sub}>{filtrados.length} cliente{filtrados.length === 1 ? '' : 's'}</Text>
                {hayFiltroZona && (
                  <Pressable onPress={limpiarFiltros} hitSlop={6}>
                    <Text style={styles.linkNavy}>Limpiar filtros ({nFiltros})</Text>
                  </Pressable>
                )}
              </View>
              {filtrados.length > 0 && (
                <Pressable onPress={seleccionarTodos} hitSlop={6}>
                  <Text style={styles.linkText}>{todosSeleccionados ? 'Quitar todos' : 'Seleccionar todos'}</Text>
                </Pressable>
              )}
            </View>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {filtrados.length === 0 && <Text style={styles.sub}>{sinAsignar.length === 0 ? 'No quedan clientes sin asignar.' : 'Ningún cliente coincide con los filtros.'}</Text>}
            {filtrados.map((c) => {
              const activo = seleccion.includes(c.id)
              return (
                <Pressable key={c.id} style={[styles.opcion, activo && styles.opcionActiva]} onPress={() => alternar(c.id)}>
                  <Ionicons name={activo ? 'checkbox' : 'square-outline'} size={22} color={activo ? Palette.navy : Palette.textFaint} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.paradaNombre}>{c.nombre}</Text>
                    <DireccionCliente c={c} />
                  </View>
                </Pressable>
              )
            })}
          </ScrollView>
          <View style={{ padding: 16 }}>
            <Pressable style={[styles.boton, seleccion.length === 0 && { opacity: 0.5 }]}
              onPress={guardarAsignacion} disabled={seleccion.length === 0}>
              <Text style={styles.botonText}>{`Asignar ${seleccion.length} cliente${seleccion.length === 1 ? '' : 's'}`}</Text>
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 20, gap: 12 },
  aviso: { margin: 0, padding: 16, borderRadius: 14, backgroundColor: Palette.amberSoft, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avisoText: { flex: 1, color: Palette.amber, fontSize: 14, lineHeight: 20 },
  resumen: { backgroundColor: Palette.navy, borderRadius: 18, padding: 16 },
  resumenLabel: { fontSize: 12, color: Palette.onNavyMuted },
  resumenTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jornadaBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.orange, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  jornadaBtnText: { color: Palette.onNavy, fontSize: 12, fontWeight: '800' },
  resumenRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  resumenItem: { flex: 1, backgroundColor: Palette.onNavyFill, borderRadius: 12, padding: 10 },
  resumenNum: { fontSize: 22, fontWeight: '800', color: Palette.onNavy },
  resumenTxt: { fontSize: 12, color: Palette.onNavyMuted },
  resumenNota: { fontSize: 12, color: Palette.onNavyMuted, marginTop: 10 },
  caseroCard: { backgroundColor: Palette.card, borderRadius: 18, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10 },
  caseroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: Palette.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Palette.onNavy, fontWeight: '800', fontSize: 16 },
  caseroNombre: { fontSize: 16, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  botonChico: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  botonChicoText: { color: Palette.onNavy, fontSize: 13, fontWeight: '700' },
  parada: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 14, padding: 10 },
  numero: { width: 26, height: 26, borderRadius: 13, backgroundColor: Palette.grayPill, alignItems: 'center', justifyContent: 'center' },
  numeroText: { fontSize: 12, fontWeight: '700', color: Palette.textMuted },
  paradaNombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dirText: { flex: 1, fontSize: 12, color: Palette.textMuted },
  pill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  acciones: { alignItems: 'center', gap: 2 },
  modalContainer: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Palette.text, flex: 1, marginRight: 8 },
  input: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 16, color: Palette.text },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12 },
  opcionActiva: { borderColor: Palette.navy, backgroundColor: Palette.navySoft },
  boton: { backgroundColor: Palette.navy, padding: 16, borderRadius: 12, alignItems: 'center' },
  botonText: { color: Palette.onNavy, fontSize: 16, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 18, paddingHorizontal: 12, height: 36, maxWidth: 220 },
  chipActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  chipText: { fontSize: 13, fontWeight: '700', color: Palette.navy, flexShrink: 1 },
  filaSeleccion: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkText: { fontSize: 13, fontWeight: '800', color: Palette.orange },
  capa: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  hoja: { backgroundColor: Palette.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32, gap: 12 },
  hojaTitulo: { fontSize: 17, fontWeight: '800', color: Palette.text },
  linkNavy: { fontSize: 13, fontWeight: '800', color: Palette.navy },
  opcionHoja: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  opcionHojaActiva: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  opcionHojaText: { fontSize: 15, fontWeight: '600', color: Palette.text },
})

export default GestionRuta
