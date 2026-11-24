import CalendarioMes from '@/components/CalendarioMes'
import DireccionCliente from '@/components/DireccionCliente'
import Header from '@/components/Header'
import ListasFijas from '@/components/ListasFijas'
import SelectorClientes from '@/components/SelectorClientes'
import { Palette } from '@/constants/palette'
import { esGerente } from '@/lib/roles'
import { omitirDia } from '@/lib/listasFijas'
import { fechaISO, fechaLarga, PreDia, preasignar, quitarPreasignacion, resolverPreasignados } from '@/lib/preasignaciones'
import { ClienteRuta, SELECT_CLIENTE } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Calendario (solo gerente): qué clientes hay que visitar cada día (hoy y los días siguientes).
// Se trabaja solo con clientes: el casero se elige recién al asignar la ruta del día (Asignar clientes).
// Cada día junta las preasignaciones hechas a mano y los clientes de las listas fijas que calzan con ese día.
const Calendario = () => {
  const router = useRouter()
  const hoy = fechaISO(new Date())
  const [mes, setMes] = useState(() => new Date())
  const [dia, setDia] = useState(hoy)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [soyGerente, setSoyGerente] = useState(false)
  const [pre, setPre] = useState<PreDia[]>([])
  const [clientes, setClientes] = useState<ClienteRuta[]>([])
  const [agregando, setAgregando] = useState(false)
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
      const [ps, cs] = await Promise.all([
        resolverPreasignados(desde, hasta), // a mano + listas fijas
        supabase.from('clientes').select(SELECT_CLIENTE).order('nombre', { ascending: true }),
      ])
      setPre(ps)
      setClientes(((cs.data as any[]) || []) as ClienteRuta[])
      setError(cs.error?.message ?? null)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true)
    try { await accion() } catch (e: any) {
      Alert.alert('Error', e.code === '23502'
        ? 'Falta aplicar en Supabase el cambio "preasignaciones_sin_casero".'
        : e.message ?? String(e))
    } finally { await cargar(); setOcupado(false) }
  }

  const conteos: Record<string, number> = {}
  pre.forEach((p) => { conteos[p.fecha] = (conteos[p.fecha] || 0) + 1 })
  const delDia = pre.filter((p) => p.fecha === dia)
  const pasado = dia < hoy

  const agregar = (ids: string[]) => {
    setAgregando(false)
    if (ids.length === 0) return
    ejecutar(() => preasignar(dia, null, ids))
  }

  // Quitar: una preasignación se borra; un cliente de lista se saca solo de este día
  const quitar = (p: PreDia) => ejecutar(() => (p.origen === 'lista' && p.lista ? omitirDia(dia, p.lista.id, p.cliente_id) : quitarPreasignacion(p.id!)))

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
            <View style={{ flex: 1 }}>
              <Text style={styles.diaTitulo}>{fechaLarga(dia)}{dia === hoy ? ' (hoy)' : ''}</Text>
              <Text style={styles.nota}>
                {delDia.length} {delDia.length === 1 ? 'cliente' : 'clientes'}
                {pasado ? ' · día pasado, solo para ver' : ' · el casero se elige en Asignar clientes'}
              </Text>
            </View>
            {ocupado && <ActivityIndicator size="small" color={Palette.navy} />}
            {!pasado && (
              <Pressable style={[styles.boton, ocupado && { opacity: 0.6 }]} disabled={ocupado} onPress={() => setAgregando(true)}>
                <Ionicons name="add" size={16} color={Palette.onNavy} />
                <Text style={styles.botonText}>Agregar clientes</Text>
              </Pressable>
            )}
          </View>

          {delDia.length === 0 && <Text style={styles.vacioDia}>No hay clientes para este día.</Text>}
          {delDia.map((p) => (
            <View key={`${p.cliente_id}-${p.id ?? p.lista?.id}`} style={styles.fila}>
              <Pressable style={{ flex: 1, gap: 2 }} onPress={() => router.push({ pathname: '/cliente/[id]', params: { id: p.cliente_id } } as any)}>
                <Text style={styles.nombre} numberOfLines={1}>{p.cliente?.nombre ?? 'Cliente'}</Text>
                {p.cliente && <DireccionCliente c={p.cliente} compacta />}
                {p.lista && (
                  <View style={[styles.etiqueta, { backgroundColor: p.lista.color ?? Palette.navy }]}>
                    <Text style={styles.etiquetaText}>{p.lista.nombre}</Text>
                  </View>
                )}
              </Pressable>
              {!pasado && (
                <Pressable onPress={() => quitar(p)} disabled={ocupado} hitSlop={8} accessibilityLabel="Quitar de este día">
                  <Ionicons name="close-circle-outline" size={22} color={Palette.textFaint} />
                </Pressable>
              )}
            </View>
          ))}

          {/* Listas fijas: Lunes a Viernes y etiquetas propias (quincena, día 20...) */}
          <ListasFijas clientes={clientes} onCambio={cargar} />
        </ScrollView>
      )}

      <SelectorClientes
        visible={agregando}
        titulo={`Clientes para el ${fechaLarga(dia)}`}
        clientes={clientes.filter((c) => !delDia.some((p) => p.cliente_id === c.id))}
        revisarAntes="Agregar"
        revisarDescripcion={(n) => `Vas a agregar ${n} ${n === 1 ? 'cliente' : 'clientes'} para el ${fechaLarga(dia)}`}
        onClose={() => setAgregando(false)}
        onConfirm={agregar}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  error: { color: Palette.amber, fontSize: 13 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 20, fontSize: 14, paddingHorizontal: 20 },
  vacioDia: { color: Palette.textMuted, fontSize: 13 },
  diaFila: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  diaTitulo: { fontSize: 17, fontWeight: '800', color: Palette.text, textTransform: 'capitalize' },
  nota: { fontSize: 12, color: Palette.textMuted },
  boton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  botonText: { color: Palette.onNavy, fontSize: 13, fontWeight: '700' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.card, borderRadius: 12, borderWidth: 1, borderColor: Palette.border, padding: 10 },
  nombre: { fontSize: 14, fontWeight: '700', color: Palette.text },
  etiqueta: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginTop: 2 },
  etiquetaText: { fontSize: 11, fontWeight: '800', color: Palette.onNavy },
})

export default Calendario
