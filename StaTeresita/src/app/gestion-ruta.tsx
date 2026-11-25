import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/roles'
import {
  asignarParadas, ClienteRuta, EstadoJornada, Jornada, listarParadas,
  comunaDe, listarEstadosCaseros, obtenerOCrearJornadaHoy, ordenarCaseros, Parada, quitarParada, sectorDe, SELECT_CLIENTE, textoEstadoJornada,
} from '@/lib/rutas'
import DireccionCliente from '@/components/DireccionCliente'
import { fechaISO, PreDia, resolverPreasignados } from '@/lib/preasignaciones'
import MapaRuta from '@/components/MapaRuta'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Cliente = ClienteRuta

type Orden = 'zona' | 'comuna' | 'sector' | 'calle' | 'nombre'
type Selector = 'comuna' | 'sector' | 'calle' | 'orden'
const ORDENES: { k: Orden; t: string }[] = [
  { k: 'zona', t: 'Sector, pasaje y número' },
  { k: 'comuna', t: 'Comuna' },
  { k: 'sector', t: 'Sector' },
  { k: 'calle', t: 'Pasaje' },
  { k: 'nombre', t: 'Nombre' },
]

// Una dirección se puede filtrar por su calle o por su pasaje
const callesDe = (c: Cliente) => [c.dir?.calle?.nombre, c.dir?.pasaje?.nombre].filter(Boolean) as string[]
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true })
const unicos = (l: string[]) => Array.from(new Set(l.filter(Boolean))).sort(cmp)

// Ruta del día guardada en Supabase (jornadas + ruta_paradas, ver lib/rutas.ts).
// También lee el rol, los trabajadores, su furgón y los clientes con su dirección por zonas.
const GestionRuta = () => {
  const router = useRouter()
  const [mapaDe, setMapaDe] = useState<{ casero_id: string; nombre: string } | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [paradas, setParadas] = useState<Parada[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [vendedores, setVendedores] = useState<{ casero_id: string; nombre: string; furgon: string | null }[]>([])

  const [caseroModal, setCaseroModal] = useState<{ casero_id: string; nombre: string } | null>(null)
  const [preHoy, setPreHoy] = useState<PreDia[]>([])
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [busqueda, setBusqueda] = useState('')
  // Filtros de selección múltiple (lista vacía = "Todos")
  const [fComuna, setFComuna] = useState<string[]>([])
  const [fSector, setFSector] = useState<string[]>([])
  const [fCalle, setFCalle] = useState<string[]>([])
  const [orden, setOrden] = useState<Orden>('zona')
  const [selector, setSelector] = useState<Selector | null>(null)

  const estado: EstadoJornada = jornada?.estado ?? 'preparacion'
  // Cada casero (o el gerente en su propia ruta) comienza y finaliza su ruta en Ruta en curso;
  // con alguna ruta ya comenzada aquí no se ofrece "Organizar e iniciar".
  const [rutasIniciadas, setRutasIniciadas] = useState(0)
  const enCurso = estado === 'en_curso' || (estado === 'preparacion' && rutasIniciadas > 0)
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
          setRutasIniciadas(j ? Object.values(await listarEstadosCaseros(j.id)).filter((e) => e === 'en_curso').length : 0)
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
        const { data: vs } = await supabase.from('perfiles').select('id, nombre, rol, activo').in('rol', ['vendedor', 'dueno'])
          .neq('activo', false).order('nombre', { ascending: true })
        // Furgón asignado a cada trabajador (si ya se ejecutó asignar_furgon.sql)
        const { data: fs } = await supabase.from('ubicaciones_inventario').select('nombre, responsable_id').eq('tipo', 'furgon').eq('activo', true)
        const furgonDe = (id: string) => ((fs as any[]) || []).find((f) => f.responsable_id === id)?.nombre ?? null
        // Gonzalo aparece primero; el resto por nombre
        setVendedores(ordenarCaseros(((vs as any[]) || []).map((v) => ({ casero_id: v.id, nombre: v.nombre, furgon: furgonDe(v.id) }))))
        // Preasignados para hoy (Calendario); si la tabla aún no existe, no hay
        try { const hoy = fechaISO(new Date()); setPreHoy(await resolverPreasignados(hoy, hoy)) } catch { setPreHoy([]) }
        setCargando(false)
      }
      leer()
    }, [])
  )

  const paradasDe = (casero_id: string) => paradas.filter((p) => p.vendedor_id === casero_id).sort((a, b) => a.orden - b.orden)
  const sinAsignar = clientes.filter((c) => !paradas.some((p) => p.cliente_id === c.id))
  // Preasignados para hoy que todavía no están en la ruta de nadie
  const preDe = (clienteId: string) => preHoy.find((p) => p.cliente_id === clienteId)
  const prePendientes = (caseroId: string) => preHoy
    .filter((p) => p.vendedor_id === caseroId && sinAsignar.some((c) => c.id === p.cliente_id))
    .sort((a, b) => a.orden - b.orden)
  const nombreCaseroDe = (id: string) => vendedores.find((v) => v.casero_id === id)?.nombre ?? 'otro casero'

  // Desplegable "Preasignados para hoy" bajo cada casero: clientes del calendario de hoy (a mano o de listas fijas)
  // que aún no están en ninguna ruta (y no son de otro casero). Plegado por defecto.
  const [preAbiertos, setPreAbiertos] = useState<string[]>([])
  const alternarPre = (id: string) => setPreAbiertos((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const prePara = (caseroId: string) => preHoy
    .filter((p) => (!p.vendedor_id || p.vendedor_id === caseroId) && sinAsignar.some((c) => c.id === p.cliente_id)
      && !(ocultosPre[caseroId] ?? []).includes(p.cliente_id))
    .sort((a, b) => a.orden - b.orden)
  const recargarPre = async () => {
    try { const hoy = fechaISO(new Date()); setPreHoy(await resolverPreasignados(hoy, hoy)) } catch {}
  }
  // Agregar a la ruta de hoy del casero, sin confirmación (todos o uno). Los que no se agreguen siguen
  // apareciendo en el desplegable de los demás caseros para dárselos a otro.
  const agregarPre = (caseroId: string, ids: string[]) => {
    if (!jornada || ids.length === 0) return
    ejecutar(async () => { await asignarParadas(jornada.id, caseroId, ids); await recargarPre() })
  }
  // La X del desplegable solo oculta al cliente para ESE casero (no lo saca del día ni de la lista):
  // así se puede "Agregar todos" a un casero sin algunos, y esos siguen disponibles para los demás.
  const [ocultosPre, setOcultosPre] = useState<Record<string, string[]>>({})
  const ocultarPre = (caseroId: string, clienteId: string) =>
    setOcultosPre((o) => ({ ...o, [caseroId]: [...(o[caseroId] ?? []), clienteId] }))

  // ---------- Asignar ----------
  // Cada vez que se abre "Asignar" (para cualquier casero) parte limpio: sin selección, búsqueda ni filtros
  const abrirAsignar = (c: { casero_id: string; nombre: string }) => {
    setSeleccion([]); setBusqueda(''); setSelector(null)
    setFComuna([]); setFSector([]); setFCalle([])
    // Los preasignados para hoy a este casero parten marcados
    setSeleccion(prePendientes(c.casero_id).map((p) => p.cliente_id))
    setCaseroModal(c)
  }
  // Casero con la lista de clientes asignados desplegada (por defecto todas plegadas)
  const [desplegados, setDesplegados] = useState<string[]>([])
  const alternarDesplegado = (id: string) => setDesplegados((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))

  const alternar = (id: string) =>
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const guardarAsignacion = async () => {
    if (!caseroModal || seleccion.length === 0 || !jornada) return
    // Se respeta el orden en que aparecen en la lista (filtros y orden elegidos)
    // Mismo orden que se ve: primero los preasignados a este casero, luego otros preasignados y el resto
    const visibles = [
      ...filtrados.filter((c) => preDe(c.id) && (!preDe(c.id)?.vendedor_id || preDe(c.id)?.vendedor_id === caseroModal.casero_id)),
      ...filtrados.filter((c) => preDe(c.id)?.vendedor_id && preDe(c.id)?.vendedor_id !== caseroModal.casero_id),
      ...filtrados.filter((c) => !preDe(c.id)),
    ]
    const ids = visibles.map((c) => c.id).filter((id) => seleccion.includes(id))
    const resto = seleccion.filter((id) => !ids.includes(id))
    const casero = caseroModal.casero_id
    setCaseroModal(null)
    await ejecutar(() => asignarParadas(jornada.id, casero, [...ids, ...resto]))
  }

  const quitar = (p: Parada) => ejecutar(() => quitarParada(p.id))


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
      <Header title="Asignar clientes" subtitle="Elige qué clientes visita cada casero hoy" />

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
              {soyGerente && jornada && estado !== 'finalizada' && !enCurso && (
                <Pressable style={styles.jornadaBtn} disabled={ocupado} onPress={() => router.push('../organizar-ruta')}>
                  <Ionicons name="play" size={13} color={Palette.onNavy} />
                  <Text style={styles.jornadaBtnText}>Organizar e iniciar ruta</Text>
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
                  {/* Desplegar u ocultar los clientes ya asignados */}
                  <Pressable onPress={() => alternarDesplegado(c.casero_id)} hitSlop={8} disabled={lista.length === 0}
                    accessibilityLabel={desplegados.includes(c.casero_id) ? 'Ocultar clientes asignados' : 'Ver clientes asignados'}>
                    <Ionicons name={desplegados.includes(c.casero_id) ? 'chevron-down' : 'chevron-forward'} size={22}
                      color={lista.length === 0 ? Palette.border : Palette.navy} />
                  </Pressable>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{c.nombre.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.caseroNombre}>{c.nombre}</Text>
                    <Text style={styles.sub}>{c.furgon ? `${c.furgon} · ` : ''}{lista.length} {lista.length === 1 ? 'cliente asignado' : 'clientes asignados'}</Text>
                  </View>
                  {lista.length > 0 && (
                    <Pressable style={styles.botonMapa} onPress={() => setMapaDe(c)} accessibilityLabel={`Ver la ruta de ${c.nombre} en el mapa`} hitSlop={4}>
                      <Ionicons name="map-outline" size={18} color={Palette.navy} />
                    </Pressable>
                  )}
                  {editable && (
                    <Pressable style={[styles.botonChico, ocupado && { opacity: 0.6 }]} disabled={ocupado} onPress={() => abrirAsignar(c)}>
                      <Ionicons name="add" size={16} color={Palette.onNavy} />
                      <Text style={styles.botonChicoText}>Asignar</Text>
                    </Pressable>
                  )}
                </View>

                {/* Preasignados para hoy (calendario), solo si hay */}
                {editable && (prePara(c.casero_id).length > 0 || (ocultosPre[c.casero_id] ?? []).some((id) => sinAsignar.some((x) => x.id === id) && preHoy.some((p) => p.cliente_id === id))) && (() => {
                  const pres = prePara(c.casero_id)
                  const abierto = preAbiertos.includes(c.casero_id)
                  return (
                    <View style={styles.preCaja}>
                      <Pressable style={styles.preFila} onPress={() => alternarPre(c.casero_id)}>
                        <Ionicons name={abierto ? 'chevron-down' : 'chevron-forward'} size={18} color={Palette.navy} />
                        <Ionicons name="calendar-outline" size={16} color={Palette.navy} />
                        <Text style={[styles.preTitulo, { flex: 1 }]}>Preasignados para hoy ({pres.length})</Text>
                        <Pressable style={[styles.preBoton, ocupado && { opacity: 0.6 }]} disabled={ocupado}
                          onPress={() => agregarPre(c.casero_id, pres.map((p) => p.cliente_id))}>
                          <Text style={styles.preBotonText}>Agregar todos a {c.nombre}</Text>
                        </Pressable>
                      </Pressable>
                      {(ocultosPre[c.casero_id] ?? []).filter((id) => sinAsignar.some((x) => x.id === id)).length > 0 && (
                        <Pressable onPress={() => setOcultosPre((o) => ({ ...o, [c.casero_id]: [] }))} hitSlop={6}>
                          <Text style={styles.mostrarOcultos}>Mostrar ocultos ({(ocultosPre[c.casero_id] ?? []).filter((id) => sinAsignar.some((x) => x.id === id)).length})</Text>
                        </Pressable>
                      )}
                      {abierto && pres.map((p) => {
                        const cp = p.cliente ?? clienteDe(p.cliente_id)
                        return (
                          <View key={`${p.cliente_id}-${p.id ?? p.lista?.id}`} style={styles.preItem}>
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={styles.paradaNombre} numberOfLines={1}>{cp?.nombre ?? 'Cliente'}</Text>
                              {cp && <DireccionCliente c={cp} compacta />}
                              {p.lista && <Text style={styles.preLista}>Lista: {p.lista.nombre}</Text>}
                              {!!p.nota?.startsWith('De ayer') && <Text style={styles.deAyer}>{p.nota}</Text>}
                            </View>
                            <Pressable onPress={() => agregarPre(c.casero_id, [p.cliente_id])} disabled={ocupado} hitSlop={6} accessibilityLabel={`Agregar a la ruta de ${c.nombre}`}>
                              <Ionicons name="add-circle" size={24} color={Palette.navy} />
                            </Pressable>
                            <Pressable onPress={() => ocultarPre(c.casero_id, p.cliente_id)} disabled={ocupado} hitSlop={6} accessibilityLabel={`No asignar a ${c.nombre}`}>
                              <Ionicons name="close-circle-outline" size={22} color={Palette.textFaint} />
                            </Pressable>
                          </View>
                        )
                      })}
                    </View>
                  )
                })()}

                {lista.length === 0 && <Text style={styles.sub}>Sin clientes asignados.</Text>}
                {desplegados.includes(c.casero_id) && lista.map((p, i) => {
                  const cp = p.cliente ?? clienteDe(p.cliente_id)
                  return (
                    <View key={p.id} style={styles.parada}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.paradaNombre} numberOfLines={1}>{cp?.nombre ?? 'Cliente'}</Text>
                        {cp && <DireccionCliente c={cp} />}
                      </View>
                      {editable && (
                        <View style={styles.acciones}>
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
                ['calle', 'Pasaje', fCalle, 'pasajes'],
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
            {/* Grupos: preasignados hoy a este casero, preasignados a otro casero y sin preasignar */}
            {([
              // Para hoy: los del calendario (a mano o de listas fijas) que aún no están en ninguna ruta
              ['Para hoy', filtrados.filter((c) => preDe(c.id) && (!preDe(c.id)?.vendedor_id || preDe(c.id)?.vendedor_id === caseroModal?.casero_id))],
              // Solo para preasignaciones antiguas que tenían otro casero
              ['Preasignados a otro casero', filtrados.filter((c) => preDe(c.id)?.vendedor_id && preDe(c.id)?.vendedor_id !== caseroModal?.casero_id)],
              ['Sin preasignar', filtrados.filter((c) => !preDe(c.id))],
            ] as const).map(([titulo, grupo]) => grupo.length === 0 ? null : (
              <View key={titulo} style={{ gap: 8 }}>
                {preHoy.length > 0 && <Text style={styles.grupoTitulo}>{titulo} ({grupo.length})</Text>}
                {grupo.map((c) => {
                  const activo = seleccion.includes(c.id)
                  const otro = preDe(c.id) && preDe(c.id)?.vendedor_id !== caseroModal?.casero_id ? preDe(c.id)!.vendedor_id : null
                  return (
                    <Pressable key={c.id} style={[styles.opcion, activo && styles.opcionActiva]} onPress={() => alternar(c.id)}>
                      <Ionicons name={activo ? 'checkbox' : 'square-outline'} size={22} color={activo ? Palette.navy : Palette.textFaint} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.paradaNombre}>{c.nombre}</Text>
                        <DireccionCliente c={c} />
                        {otro && <Text style={styles.preOtro}>Preasignado a {nombreCaseroDe(otro)}</Text>}
                        {preDe(c.id)?.lista && <Text style={styles.preLista}>Lista: {preDe(c.id)!.lista!.nombre}</Text>}
                        {!!preDe(c.id)?.nota?.startsWith('De ayer') && <Text style={styles.deAyer}>{preDe(c.id)!.nota}</Text>}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            ))}
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
                  {selector === 'orden' ? 'Ordenar por' : selector === 'calle' ? 'Pasaje' : selector === 'sector' ? 'Sector' : 'Comuna'}
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
      <MapaRuta
        visible={!!mapaDe}
        titulo={`Ruta de ${mapaDe?.nombre ?? ''}`}
        paradas={mapaDe ? paradasDe(mapaDe.casero_id).map((p) => ({ cliente: p.cliente ?? clienteDe(p.cliente_id) ?? null, estado: p.estado })) : []}
        onClose={() => setMapaDe(null)}
        onPressCliente={(id) => { setMapaDe(null); router.push({ pathname: '/cliente/[id]', params: { id } } as any) }}
      />
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
  botonMapa: { width: 36, height: 36, borderRadius: 10, backgroundColor: Palette.navySoft, alignItems: 'center', justifyContent: 'center' },
  parada: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 14, padding: 10 },
  paradaNombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  acciones: { alignItems: 'center', gap: 2 },
  preFila: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Palette.navySoft, borderRadius: 12, padding: 10 },
  grupoTitulo: { fontSize: 11, fontWeight: '800', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  mostrarOcultos: { fontSize: 12, fontWeight: '700', color: Palette.orange, paddingHorizontal: 4 },
  preCaja: { backgroundColor: Palette.navySoft, borderRadius: 12, padding: 8, gap: 6 },
  preTitulo: { fontSize: 13, fontWeight: '800', color: Palette.navy },
  preBoton: { backgroundColor: Palette.orange, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  preBotonText: { color: Palette.onNavy, fontSize: 12, fontWeight: '800' },
  preItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.card, borderRadius: 10, padding: 8 },
  preLista: { fontSize: 12, fontWeight: '700', color: Palette.navy },
  deAyer: { fontSize: 12, fontWeight: '800', color: Palette.orange },
  preOtro: { fontSize: 12, fontWeight: '700', color: Palette.amber },
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
  capa: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Palette.overlay, justifyContent: 'flex-end' },
  hoja: { backgroundColor: Palette.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32, gap: 12 },
  hojaTitulo: { fontSize: 17, fontWeight: '800', color: Palette.text },
  linkNavy: { fontSize: 13, fontWeight: '800', color: Palette.navy },
  opcionHoja: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  opcionHojaActiva: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  opcionHojaText: { fontSize: 15, fontWeight: '600', color: Palette.text },
})

export default GestionRuta
