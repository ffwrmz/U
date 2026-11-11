import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import {
  asignarParadas, cambiarEstadoJornada, cargarRutasBase, ClienteRuta, diaSemana, EstadoJornada, Jornada, listarParadas,
  moverParada, nombreDia, obtenerOCrearJornadaHoy, Parada, quitarParada, SELECT_CLIENTE, textoEstadoJornada,
} from '@/lib/rutas'
import DireccionCliente from '@/components/DireccionCliente'
import SelectorClientes from '@/components/SelectorClientes'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Cliente = ClienteRuta

const VISITA = {
  pendiente: { texto: 'Pendiente', fondo: Palette.grayPill, color: Palette.textMuted },
  visitado: { texto: 'Visitado', fondo: Palette.greenSoft, color: Palette.green },
  no_estaba: { texto: 'No estaba', fondo: Palette.amberSoft, color: Palette.amber },
} as const

// Ruta del día guardada en Supabase (jornadas + ruta_paradas, ver lib/rutas.ts).
// También lee el rol, los trabajadores, su furgón y los clientes con su dirección por zonas.
const GestionRuta = () => {
  const router = useRouter()
  const [soyGerente, setSoyGerente] = useState(false)
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [paradas, setParadas] = useState<Parada[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [vendedores, setVendedores] = useState<{ casero_id: string; nombre: string; furgon: string | null }[]>([])

  const [caseroModal, setCaseroModal] = useState<{ casero_id: string; nombre: string } | null>(null)

  const estado: EstadoJornada = jornada?.estado ?? 'preparacion'
  // El gerente solo puede cambiar la ruta mientras la jornada está en preparación
  const editable = estado === 'preparacion' && soyGerente
  const caseros = vendedores

  const recargarParadas = async (j: Jornada | null = jornada) => {
    if (!j) { setParadas([]); return }
    setParadas(await listarParadas(j.id))
  }

  // Ruta base del día de la semana (Rutas de la semana)
  const dia = jornada ? nombreDia(diaSemana(jornada.fecha)) : ''
  const cargarBase = (reemplazar: boolean) => {
    if (!jornada) return
    const hacer = () => ejecutar(async () => {
      const n = await cargarRutasBase(jornada.id, reemplazar)
      setJornada({ ...jornada, cargada_desde_base: true })
      Alert.alert('Ruta del ' + dia, n === 0 ? 'No había clientes nuevos que agregar.' : `Se agregaron ${n} cliente${n === 1 ? '' : 's'}.`)
    })
    if (!reemplazar) { hacer(); return }
    Alert.alert('Recargar desde la ruta base', `Se borrarán los clientes asignados hoy y se cargará de nuevo la ruta del ${dia}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Recargar', style: 'destructive', onPress: hacer },
    ])
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
        const { data: vs } = await supabase.from('perfiles').select('id, nombre, rol, activo').in('rol', ['vendedor', 'dueno'])
          .neq('activo', false).order('nombre', { ascending: true })
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
  const abrirAsignar = (c: { casero_id: string; nombre: string }) => setCaseroModal(c)

  const guardarAsignacion = async (ids: string[]) => {
    if (!caseroModal || ids.length === 0 || !jornada) return
    const casero = caseroModal.casero_id
    setCaseroModal(null)
    await ejecutar(() => asignarParadas(jornada.id, casero, ids))
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
            {soyGerente && jornada && (
              <Text style={styles.resumenNota}>
                {jornada.cargada_desde_base ? `Cargada desde la ruta del ${dia}. ` : ''}Los cambios aquí son solo para hoy; no cambian la ruta de la semana.
              </Text>
            )}
            {!editable && (
              <Text style={styles.resumenNota}>
                {!soyGerente ? 'Solo el gerente puede modificar las rutas.'
                  : estado === 'finalizada' ? 'La jornada de hoy ya terminó.' : 'La jornada ya inició: la ruta está bloqueada.'}
              </Text>
            )}
          </View>

          {soyGerente && (
            <View style={styles.baseFila}>
              {editable && (
                <>
                  <Pressable style={[styles.baseBtn, ocupado && { opacity: 0.6 }]} disabled={ocupado} onPress={() => cargarBase(false)}>
                    <Ionicons name="download-outline" size={15} color={Palette.navy} />
                    <Text style={styles.baseBtnText}>Cargar ruta base</Text>
                  </Pressable>
                  <Pressable style={[styles.baseBtn, ocupado && { opacity: 0.6 }]} disabled={ocupado} onPress={() => cargarBase(true)}>
                    <Ionicons name="refresh" size={15} color={Palette.navy} />
                    <Text style={styles.baseBtnText}>Recargar desde la base</Text>
                  </Pressable>
                </>
              )}
              <Pressable style={styles.baseBtn} onPress={() => router.push('../rutas-semana')}>
                <Ionicons name="calendar-outline" size={15} color={Palette.navy} />
                <Text style={styles.baseBtnText}>Rutas de la semana</Text>
              </Pressable>
            </View>
          )}

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

      <SelectorClientes
        visible={!!caseroModal}
        titulo={`Clientes para ${caseroModal?.nombre ?? ''}`}
        clientes={sinAsignar}
        onClose={() => setCaseroModal(null)}
        onConfirm={guardarAsignacion}
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
  parada: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 14, padding: 10 },
  numero: { width: 26, height: 26, borderRadius: 13, backgroundColor: Palette.grayPill, alignItems: 'center', justifyContent: 'center' },
  numeroText: { fontSize: 12, fontWeight: '700', color: Palette.textMuted },
  paradaNombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dirText: { flex: 1, fontSize: 12, color: Palette.textMuted },
  pill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  acciones: { alignItems: 'center', gap: 2 },
  baseFila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  baseBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Palette.navySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  baseBtnText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
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
