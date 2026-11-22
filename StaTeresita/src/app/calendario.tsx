import CalendarioMes from '@/components/CalendarioMes'
import DireccionCliente from '@/components/DireccionCliente'
import Header from '@/components/Header'
import SelectorClientes from '@/components/SelectorClientes'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/demoJornada'
import { fechaISO, fechaLarga, listarPreasignaciones, Preasignacion, preasignar, programarVisita, quitarPreasignacion } from '@/lib/preasignaciones'
import { ClienteRuta, ordenarCaseros, SELECT_CLIENTE } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Casero { id: string; nombre: string }

// Calendario (solo gerente): deja clientes preasignados a cada casero para hoy y los días siguientes.
// Al asignar la ruta del día (Asignar clientes), los preasignados para hoy aparecen separados y ya marcados.
// Lee y escribe la tabla preasignaciones (lib/preasignaciones.ts).
const Calendario = () => {
  const router = useRouter()
  const hoy = fechaISO(new Date())
  const [mes, setMes] = useState(() => new Date())
  const [dia, setDia] = useState(hoy)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [pre, setPre] = useState<Preasignacion[]>([])
  const [caseros, setCaseros] = useState<Casero[]>([])
  const [clientes, setClientes] = useState<ClienteRuta[]>([])
  const [agregarA, setAgregarA] = useState<Casero | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Rango del mes mostrado
  const desde = fechaISO(new Date(mes.getFullYear(), mes.getMonth(), 1))
  const hasta = fechaISO(new Date(mes.getFullYear(), mes.getMonth() + 1, 0))

  const cargar = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
        setSoyGerente(esGerente(perfil?.rol))
      }
      const [ps, pe, cs] = await Promise.all([
        listarPreasignaciones(desde, hasta),
        supabase.from('perfiles').select('id, nombre').in('rol', ['vendedor', 'dueno']).neq('activo', false),
        supabase.from('clientes').select(SELECT_CLIENTE).order('nombre', { ascending: true }),
      ])
      setPre(ps)
      setCaseros(ordenarCaseros((pe.data as Casero[]) || []))
      setClientes(((cs.data as any[]) || []) as ClienteRuta[])
      setError(pe.error?.message ?? cs.error?.message ?? null)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true)
    try { await accion() } catch (e: any) { Alert.alert('Error', e.message ?? String(e)) }
    finally { await cargar(); setOcupado(false) }
  }

  const conteos: Record<string, number> = {}
  pre.forEach((p) => { conteos[p.fecha] = (conteos[p.fecha] || 0) + 1 })
  const delDia = pre.filter((p) => p.fecha === dia)
  const pasado = dia < hoy
  const nombreDe = (id: string) => caseros.find((c) => c.id === id)?.nombre ?? 'otro casero'

  // Para el selector: los que ese día ya están con otro casero se pueden mover (se marcan con su nombre)
  const ocupadosPara = (vendedorId: string) => {
    const r: Record<string, string> = {}
    delDia.filter((p) => p.vendedor_id !== vendedorId).forEach((p) => { r[p.cliente_id] = `Preasignado a ${nombreDe(p.vendedor_id)} (se moverá)` })
    return r
  }
  const disponiblesPara = (vendedorId: string) => {
    const propios = new Set(delDia.filter((p) => p.vendedor_id === vendedorId).map((p) => p.cliente_id))
    return clientes.filter((c) => !propios.has(c.id))
  }

  const agregar = (ids: string[]) => {
    const casero = agregarA
    setAgregarA(null)
    if (!casero || ids.length === 0) return
    const otros = new Set(delDia.filter((p) => p.vendedor_id !== casero.id).map((p) => p.cliente_id))
    ejecutar(async () => {
      // Los que estaban con otro casero se mueven; el resto se agrega
      for (const id of ids.filter((x) => otros.has(x))) await programarVisita(id, dia, casero.id)
      await preasignar(dia, casero.id, ids.filter((x) => !otros.has(x)))
    })
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Calendario" subtitle="Programa las visitas de los próximos días" />
      {cargando ? (
        <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} />
      ) : !soyGerente ? (
        <Text style={styles.vacio}>Solo el gerente puede usar el calendario.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {error && <Text style={styles.error}>No se pudo cargar: {error}</Text>}
          <CalendarioMes mes={mes} hoy={hoy} seleccion={dia} conteos={conteos}
            onCambiarMes={(m) => setMes(m)} onElegir={setDia} />

          <View style={styles.diaFila}>
            <Text style={styles.diaTitulo}>{fechaLarga(dia)}{dia === hoy ? ' (hoy)' : ''}</Text>
            {ocupado && <ActivityIndicator size="small" color={Palette.navy} />}
          </View>
          {pasado && <Text style={styles.nota}>Día pasado: solo para ver.</Text>}
          {dia === hoy && <Text style={styles.nota}>Los preasignados de hoy aparecen ya marcados en Asignar clientes.</Text>}

          {caseros.map((c) => {
            const lista = delDia.filter((p) => p.vendedor_id === c.id)
            if (pasado && lista.length === 0) return null
            return (
              <View key={c.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{c.nombre.slice(0, 1).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.casero}>{c.nombre}</Text>
                    <Text style={styles.sub}>{lista.length} {lista.length === 1 ? 'cliente preasignado' : 'clientes preasignados'}</Text>
                  </View>
                  {!pasado && (
                    <Pressable style={[styles.boton, ocupado && { opacity: 0.6 }]} disabled={ocupado} onPress={() => setAgregarA(c)}>
                      <Ionicons name="add" size={16} color={Palette.onNavy} />
                      <Text style={styles.botonText}>Preasignar</Text>
                    </Pressable>
                  )}
                </View>
                {lista.map((p) => (
                  <View key={p.id} style={styles.fila}>
                    <Pressable style={{ flex: 1, gap: 2 }} onPress={() => router.push({ pathname: '/cliente/[id]', params: { id: p.cliente_id } } as any)}>
                      <Text style={styles.nombre} numberOfLines={1}>{p.cliente?.nombre ?? 'Cliente'}</Text>
                      {p.cliente && <DireccionCliente c={p.cliente} compacta />}
                    </Pressable>
                    {!pasado && (
                      <Pressable onPress={() => ejecutar(() => quitarPreasignacion(p.id))} disabled={ocupado} hitSlop={8} accessibilityLabel="Quitar">
                        <Ionicons name="close-circle-outline" size={22} color={Palette.textFaint} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )
          })}
          {pasado && delDia.length === 0 && <Text style={styles.vacio}>Ese día no hubo clientes preasignados.</Text>}
        </ScrollView>
      )}

      <SelectorClientes
        visible={!!agregarA}
        titulo={`${agregarA?.nombre ?? ''} · ${fechaLarga(dia)}`}
        clientes={agregarA ? disponiblesPara(agregarA.id) : []}
        ocupados={agregarA ? ocupadosPara(agregarA.id) : {}}
        moverOcupados
        onClose={() => setAgregarA(null)}
        onConfirm={agregar}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  error: { color: Palette.amber, fontSize: 13 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 20, fontSize: 14, paddingHorizontal: 20 },
  diaFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diaTitulo: { flex: 1, fontSize: 17, fontWeight: '800', color: Palette.text, textTransform: 'capitalize' },
  nota: { fontSize: 12, color: Palette.textMuted },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 12, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Palette.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Palette.onNavy, fontWeight: '800', fontSize: 15 },
  casero: { fontSize: 15, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 12, color: Palette.textMuted },
  boton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  botonText: { color: Palette.onNavy, fontSize: 13, fontWeight: '700' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 12, padding: 10 },
  nombre: { fontSize: 14, fontWeight: '700', color: Palette.text },
})

export default Calendario
