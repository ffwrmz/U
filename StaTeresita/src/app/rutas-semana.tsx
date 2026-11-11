import DireccionCliente from '@/components/DireccionCliente'
import Header from '@/components/Header'
import SelectorClientes from '@/components/SelectorClientes'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import {
  agregarParadasBase, ClienteRuta, copiarRutaBase, DIAS, diaSemana, hoyChile, listarRutasBase, moverParadaBase,
  nombreDia, obtenerOCrearRutaBase, ParadaBase, quitarParadaBase, RutaBase, SELECT_CLIENTE,
} from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Casero { id: string; nombre: string }

// Rutas de la semana (solo gerente): la ruta base de cada casero para cada día (lunes a domingo).
// Cada día, al preparar la jornada, Supabase copia la ruta base de ese día a la ruta de hoy (preparar_jornada_hoy).
// Lee/escribe rutas_base y rutas_base_paradas (lib/rutas.ts).
const RutasSemana = () => {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [dia, setDia] = useState(() => diaSemana(hoyChile()))
  const [rutas, setRutas] = useState<RutaBase[]>([])
  const [caseros, setCaseros] = useState<Casero[]>([])
  const [clientes, setClientes] = useState<ClienteRuta[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [agregarA, setAgregarA] = useState<Casero | null>(null)
  const [copiarDe, setCopiarDe] = useState<RutaBase | null>(null)

  const recargar = async () => setRutas(await listarRutasBase())

  const cargar = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
        setSoyGerente(esGerente(perfil?.rol))
      }
      const [rs, vs, cs] = await Promise.all([
        listarRutasBase(),
        supabase.from('perfiles').select('id, nombre').in('rol', ['vendedor', 'dueno']).neq('activo', false).order('nombre', { ascending: true }),
        supabase.from('clientes').select(SELECT_CLIENTE).order('nombre', { ascending: true }),
      ])
      setRutas(rs)
      setCaseros((vs.data as Casero[]) || [])
      setClientes(((cs.data as any[]) || []) as ClienteRuta[])
      setError(vs.error?.message ?? cs.error?.message ?? null)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  // Ejecuta un cambio, muestra el error si falla y vuelve a leer las rutas
  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true)
    try {
      await accion()
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e))
    } finally {
      try { await recargar() } catch {}
      setOcupado(false)
    }
  }

  const delDia = rutas.filter((r) => r.dia_semana === dia)
  const rutaDe = (vendedorId: string) => delDia.find((r) => r.vendedor_id === vendedorId) ?? null
  const totalDia = (n: number) => rutas.filter((r) => r.dia_semana === n).reduce((t, r) => t + r.paradas.length, 0)
  const nombreDe = (id: string) => caseros.find((c) => c.id === id)?.nombre ?? 'otro casero'

  // Para el selector: los clientes que ese día ya van con otro casero se muestran bloqueados
  const ocupadosPara = (vendedorId: string) => {
    const r: Record<string, string> = {}
    delDia.filter((x) => x.vendedor_id !== vendedorId).forEach((x) =>
      x.paradas.forEach((p) => { r[p.cliente_id] = `Ya en la ruta de ${nombreDe(x.vendedor_id)}` }))
    return r
  }
  const disponiblesPara = (vendedorId: string) => {
    const propios = new Set(rutaDe(vendedorId)?.paradas.map((p) => p.cliente_id) ?? [])
    return clientes.filter((c) => !propios.has(c.id))
  }

  const agregar = async (ids: string[]) => {
    const casero = agregarA
    setAgregarA(null)
    if (!casero || ids.length === 0) return
    await ejecutar(async () => agregarParadasBase(await obtenerOCrearRutaBase(dia, casero.id), ids))
  }

  const copiar = (destino: number) => {
    const origen = copiarDe
    setCopiarDe(null)
    if (!origen) return
    const yaHay = rutas.find((r) => r.dia_semana === destino && r.vendedor_id === origen.vendedor_id)?.paradas.length ?? 0
    const hacer = () => ejecutar(async () => {
      const r = await copiarRutaBase(origen, destino)
      Alert.alert('Ruta copiada', `Se copiaron ${r.copiados} clientes al ${nombreDia(destino)}.` +
        (r.omitidos ? `\n${r.omitidos} no se copiaron porque ese día ya van con otro casero.` : ''))
    })
    if (yaHay === 0) { hacer(); return }
    Alert.alert('Reemplazar ruta', `${nombreDe(origen.vendedor_id)} ya tiene ${yaHay} clientes el ${nombreDia(destino)}. Se reemplazarán.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reemplazar', style: 'destructive', onPress: hacer },
    ])
  }

  const mover = (r: RutaBase, p: ParadaBase, delta: -1 | 1) => ejecutar(() => moverParadaBase(r.paradas, p.id, delta))
  const quitar = (p: ParadaBase) => ejecutar(() => quitarParadaBase(p.id))

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Rutas de la semana" />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : !soyGerente ? (
        <Text style={styles.vacio}>Solo el gerente puede modificar las rutas de la semana.</Text>
      ) : (
        <>
          {/* Selector de día */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.dias}>
            {DIAS.map((d) => {
              const on = d.n === dia
              const n = totalDia(d.n)
              return (
                <Pressable key={d.n} style={[styles.dia, on && styles.diaActivo]} onPress={() => setDia(d.n)}>
                  <Text style={[styles.diaText, on && { color: Palette.onNavy }]}>{d.corto}</Text>
                  <Text style={[styles.diaNum, on && { color: Palette.onNavyMuted }]}>{n}</Text>
                </Pressable>
              )
            })}
          </ScrollView>

          <ScrollView contentContainerStyle={styles.content}>
            {error && <Text style={styles.error}>No se pudo cargar: {error}</Text>}
            <View style={styles.ayudaFila}>
              <Text style={styles.ayuda}>
                Ruta base de cada {nombreDia(dia)}. Al preparar el día se carga sola en Gestionar ruta, y ahí se puede cambiar solo para ese día.
              </Text>
              {ocupado && <ActivityIndicator size="small" color={Palette.navy} />}
            </View>

            {caseros.length === 0 && <Text style={styles.vacio}>No hay trabajadores activos.</Text>}
            {caseros.map((c) => {
              const r = rutaDe(c.id)
              const lista = r?.paradas ?? []
              return (
                <View key={c.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{c.nombre.slice(0, 1).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.casero}>{c.nombre}</Text>
                      <Text style={styles.sub}>{lista.length} cliente{lista.length === 1 ? '' : 's'} los {nombreDia(dia)}</Text>
                    </View>
                    {r && lista.length > 0 && (
                      <Pressable style={styles.botonSec} disabled={ocupado} onPress={() => setCopiarDe(r)} hitSlop={4}>
                        <Ionicons name="copy-outline" size={15} color={Palette.navy} />
                      </Pressable>
                    )}
                    <Pressable style={[styles.botonChico, ocupado && { opacity: 0.6 }]} disabled={ocupado} onPress={() => setAgregarA(c)}>
                      <Ionicons name="add" size={16} color={Palette.onNavy} />
                      <Text style={styles.botonChicoText}>Agregar</Text>
                    </Pressable>
                  </View>

                  {lista.length === 0 && <Text style={styles.sub}>Sin clientes este día.</Text>}
                  {lista.map((p, i) => (
                    <View key={p.id} style={styles.parada}>
                      <View style={styles.numero}><Text style={styles.numeroText}>{i + 1}</Text></View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.nombre} numberOfLines={1}>{p.cliente?.nombre ?? 'Cliente'}</Text>
                        {p.cliente && <DireccionCliente c={p.cliente} />}
                      </View>
                      <View style={styles.acciones}>
                        <Pressable onPress={() => r && mover(r, p, -1)} disabled={ocupado || i === 0} hitSlop={6}>
                          <Ionicons name="chevron-up" size={20} color={i === 0 ? Palette.border : Palette.navy} />
                        </Pressable>
                        <Pressable onPress={() => r && mover(r, p, 1)} disabled={ocupado || i === lista.length - 1} hitSlop={6}>
                          <Ionicons name="chevron-down" size={20} color={i === lista.length - 1 ? Palette.border : Palette.navy} />
                        </Pressable>
                        <Pressable onPress={() => quitar(p)} disabled={ocupado} hitSlop={6}>
                          <Ionicons name="close-circle-outline" size={20} color={Palette.textFaint} />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )
            })}
          </ScrollView>
        </>
      )}

      <SelectorClientes
        visible={!!agregarA}
        titulo={`${agregarA?.nombre ?? ''} · ${nombreDia(dia)}`}
        clientes={agregarA ? disponiblesPara(agregarA.id) : []}
        ocupados={agregarA ? ocupadosPara(agregarA.id) : {}}
        onClose={() => setAgregarA(null)}
        onConfirm={agregar}
      />

      {/* Copiar la ruta de un casero a otro día */}
      {copiarDe && (
        <Pressable style={styles.capa} onPress={() => setCopiarDe(null)}>
          <Pressable style={styles.hoja} onPress={() => {}}>
            <Text style={styles.hojaTitulo}>Copiar ruta de {nombreDe(copiarDe.vendedor_id)} ({nombreDia(dia)}) a…</Text>
            <View style={styles.hojaDias}>
              {DIAS.filter((d) => d.n !== dia).map((d) => (
                <Pressable key={d.n} style={styles.hojaDia} onPress={() => copiar(d.n)}>
                  <Text style={styles.hojaDiaText}>{d.largo.charAt(0).toUpperCase() + d.largo.slice(1)}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={[styles.hojaDia, { backgroundColor: Palette.grayPill }]} onPress={() => setCopiarDe(null)}>
              <Text style={[styles.hojaDiaText, { color: Palette.text }]}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  dias: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, gap: 8 },
  dia: { alignItems: 'center', minWidth: 48, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10 },
  diaActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  diaText: { fontSize: 14, fontWeight: '800', color: Palette.navy },
  diaNum: { fontSize: 11, fontWeight: '700', color: Palette.textMuted, marginTop: 2 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  ayudaFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ayuda: { flex: 1, fontSize: 12, color: Palette.textMuted },
  error: { color: Palette.amber, fontSize: 13 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14, paddingHorizontal: 20 },
  card: { backgroundColor: Palette.card, borderRadius: 18, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: Palette.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Palette.onNavy, fontWeight: '800', fontSize: 16 },
  casero: { fontSize: 16, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  botonChico: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  botonChicoText: { color: Palette.onNavy, fontSize: 13, fontWeight: '700' },
  botonSec: { width: 36, height: 36, borderRadius: 10, backgroundColor: Palette.navySoft, alignItems: 'center', justifyContent: 'center' },
  parada: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 14, padding: 10 },
  numero: { width: 26, height: 26, borderRadius: 13, backgroundColor: Palette.grayPill, alignItems: 'center', justifyContent: 'center' },
  numeroText: { fontSize: 12, fontWeight: '700', color: Palette.textMuted },
  nombre: { fontSize: 15, fontWeight: '700', color: Palette.text },
  acciones: { alignItems: 'center', gap: 2 },
  capa: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  hoja: { backgroundColor: Palette.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32, gap: 12 },
  hojaTitulo: { fontSize: 17, fontWeight: '800', color: Palette.text },
  hojaDias: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hojaDia: { backgroundColor: Palette.navy, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  hojaDiaText: { color: Palette.onNavy, fontSize: 14, fontWeight: '800' },
})

export default RutasSemana
