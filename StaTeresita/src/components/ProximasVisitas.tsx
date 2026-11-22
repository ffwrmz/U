import CalendarioMes from '@/components/CalendarioMes'
import { Palette } from '@/constants/palette'
import { fechaISO, fechaLarga, Preasignacion, preasignacionesDeCliente, programarVisita, quitarPreasignacion } from '@/lib/preasignaciones'
import { ordenarCaseros } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Casero { id: string; nombre: string }

// "Próximas visitas" en la ficha del cliente: días en que está preasignado (desde hoy) y con qué casero.
// El gerente puede programar una visita (fecha + casero) o quitarla. Tabla preasignaciones.
const ProximasVisitas = ({ clienteId, soyGerente }: { clienteId: string; soyGerente: boolean }) => {
  const hoy = fechaISO(new Date())
  const [visitas, setVisitas] = useState<Preasignacion[]>([])
  const [caseros, setCaseros] = useState<Casero[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [mes, setMes] = useState(() => new Date())
  const [fecha, setFecha] = useState<string | null>(null)
  const [casero, setCasero] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [v, pe] = await Promise.all([
        preasignacionesDeCliente(clienteId, hoy),
        supabase.from('perfiles').select('id, nombre').in('rol', ['vendedor', 'dueno']).neq('activo', false),
      ])
      setVisitas(v)
      setCaseros(ordenarCaseros((pe.data as Casero[]) || []))
    } catch {
      setVisitas([]) // si la tabla aún no existe en Supabase, la sección queda vacía
    } finally {
      setCargando(false)
    }
  }, [clienteId, hoy])

  useEffect(() => { cargar() }, [cargar])

  const nombreDe = (id: string) => caseros.find((c) => c.id === id)?.nombre ?? 'Casero'

  const abrir = () => { setFecha(null); setCasero(caseros[0]?.id ?? null); setMes(new Date()); setModal(true) }

  const guardar = async () => {
    if (!fecha || !casero) { Alert.alert('Programar visita', 'Elige el día y el casero.'); return }
    setGuardando(true)
    try {
      await programarVisita(clienteId, fecha, casero)
      setModal(false)
      cargar()
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e))
    } finally {
      setGuardando(false)
    }
  }

  const quitar = async (id: string) => {
    try { await quitarPreasignacion(id); cargar() } catch (e: any) { Alert.alert('Error', e.message ?? String(e)) }
  }

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Ionicons name="calendar-outline" size={18} color={Palette.navy} />
        <Text style={styles.titulo}>Próximas visitas</Text>
        {soyGerente && (
          <Pressable style={styles.boton} onPress={abrir}>
            <Ionicons name="add" size={15} color={Palette.onNavy} />
            <Text style={styles.botonText}>Programar visita</Text>
          </Pressable>
        )}
      </View>
      {cargando ? <ActivityIndicator size="small" color={Palette.navy} />
        : visitas.length === 0 ? <Text style={styles.sub}>No tiene visitas programadas.</Text>
        : visitas.map((v) => (
          <View key={v.id} style={styles.fila}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fecha}>{fechaLarga(v.fecha)}{v.fecha === hoy ? ' (hoy)' : ''}</Text>
              <Text style={styles.sub}>Con {nombreDe(v.vendedor_id)}</Text>
            </View>
            {soyGerente && (
              <Pressable onPress={() => quitar(v.id)} hitSlop={8} accessibilityLabel="Quitar visita">
                <Ionicons name="close-circle-outline" size={22} color={Palette.textFaint} />
              </Pressable>
            )}
          </View>
        ))}

      <Modal visible={modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitulo}>Programar visita</Text>
            <Pressable onPress={() => setModal(false)} hitSlop={8}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={styles.label}>Día</Text>
            <CalendarioMes mes={mes} hoy={hoy} seleccion={fecha} onCambiarMes={setMes} onElegir={setFecha} bloquearPasados />
            <Text style={styles.label}>Casero</Text>
            <View style={styles.caseros}>
              {caseros.map((c) => (
                <Pressable key={c.id} style={[styles.chip, casero === c.id && styles.chipActivo]} onPress={() => setCasero(c.id)}>
                  <Text style={[styles.chipText, casero === c.id && { color: Palette.cream }]}>{c.nombre}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={[styles.guardar, (!fecha || !casero || guardando) && { opacity: 0.6 }]} disabled={!fecha || !casero || guardando} onPress={guardar}>
              <Text style={styles.guardarText}>{guardando ? 'Guardando...' : fecha ? `Programar para el ${fechaLarga(fecha)}` : 'Elige un día'}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titulo: { flex: 1, fontSize: 15, fontWeight: '800', color: Palette.text },
  boton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.navy, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  botonText: { color: Palette.onNavy, fontSize: 12, fontWeight: '800' },
  sub: { fontSize: 12, color: Palette.textMuted },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 10, padding: 10 },
  fecha: { fontSize: 14, fontWeight: '700', color: Palette.text, textTransform: 'capitalize' },
  modal: { flex: 1, backgroundColor: Palette.cream },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  modalTitulo: { fontSize: 18, fontWeight: '700', color: Palette.text },
  label: { fontSize: 14, fontWeight: '700', color: Palette.text },
  caseros: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  chipActivo: { backgroundColor: Palette.navy, borderColor: Palette.navy },
  chipText: { fontSize: 13, fontWeight: '700', color: Palette.navy },
  guardar: { backgroundColor: Palette.orange, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  guardarText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
})

export default ProximasVisitas
