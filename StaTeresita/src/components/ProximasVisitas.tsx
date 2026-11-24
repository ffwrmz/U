import CalendarioMes from '@/components/CalendarioMes'
import { Palette } from '@/constants/palette'
import { omitirDia } from '@/lib/listasFijas'
import { fechaISO, fechaLarga, PreDia, programarVisita, quitarPreasignacion, resolverPreasignados } from '@/lib/preasignaciones'
import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'

// "Próximas visitas" en la ficha del cliente (plegable).
// Plegada: la fecha de la próxima visita. Desplegada: un calendario con los días de visita marcados
// (a mano o por una lista fija, con el color de la lista). Al tocar un día marcado se ve el detalle con X para
// quitarlo de ese día; el gerente puede tocar un día libre para programar una visita ahí.
const ProximasVisitas = ({ clienteId, soyGerente }: { clienteId: string; soyGerente: boolean }) => {
  const hoy = fechaISO(new Date())
  const [abierto, setAbierto] = useState(false)
  const [proxima, setProxima] = useState<PreDia | null>(null)
  const [delMes, setDelMes] = useState<PreDia[]>([])
  const [mes, setMes] = useState(() => new Date())
  const [dia, setDia] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)

  // Próxima visita (hasta 90 días) y visitas del mes que se muestra (desde hoy)
  const cargar = useCallback(async () => {
    try {
      const hasta90 = new Date(); hasta90.setDate(hasta90.getDate() + 90)
      const inicioMes = fechaISO(new Date(mes.getFullYear(), mes.getMonth(), 1))
      const finMes = fechaISO(new Date(mes.getFullYear(), mes.getMonth() + 1, 0))
      const desde = inicioMes > hoy ? inicioMes : hoy
      const [prox, m] = await Promise.all([
        resolverPreasignados(hoy, fechaISO(hasta90)),
        finMes >= hoy ? resolverPreasignados(desde, finMes) : Promise.resolve([] as PreDia[]),
      ])
      setProxima(prox.filter((x) => x.cliente_id === clienteId).sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null)
      setDelMes(m.filter((x) => x.cliente_id === clienteId))
    } catch {
      setProxima(null); setDelMes([]) // si las tablas aún no existen, la sección queda vacía
    } finally {
      setCargando(false)
    }
  }, [clienteId, hoy, mes])

  useEffect(() => { cargar() }, [cargar])

  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true)
    try { await accion() } catch (e: any) { Alert.alert('Error', e.message ?? String(e)) }
    finally { await cargar(); setOcupado(false) }
  }

  const conteos: Record<string, number> = {}
  const colores: Record<string, string> = {}
  delMes.forEach((v) => { conteos[v.fecha] = 1; colores[v.fecha] = v.lista?.color ?? Palette.navy })
  const visitasDia = dia ? delMes.filter((v) => v.fecha === dia) : []

  // Quitar de ese día: una visita a mano se borra; una de lista se omite solo ese día
  const quitar = (v: PreDia) => ejecutar(() => (v.origen === 'lista' && v.lista ? omitirDia(v.fecha, v.lista.id, v.cliente_id) : quitarPreasignacion(v.id!)))

  return (
    <View style={styles.card}>
      <Pressable style={styles.top} onPress={() => setAbierto((a) => !a)}>
        <Ionicons name="calendar-outline" size={18} color={Palette.navy} />
        <View style={{ flex: 1 }}>
          <Text style={styles.titulo}>Próximas visitas</Text>
          {cargando ? <Text style={styles.sub}>Cargando…</Text> : proxima ? (
            <Text style={styles.sub}>
              Próxima visita: <Text style={styles.fecha}>{fechaLarga(proxima.fecha)}{proxima.fecha === hoy ? ' (hoy)' : ''}</Text>
              {proxima.lista ? ` · Lista: ${proxima.lista.nombre}` : ''}
            </Text>
          ) : <Text style={styles.sub}>Sin visitas programadas</Text>}
        </View>
        {ocupado && <ActivityIndicator size="small" color={Palette.navy} />}
        <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={20} color={Palette.navy} />
      </Pressable>

      {abierto && (
        <View style={{ gap: 8 }}>
          <CalendarioMes mes={mes} hoy={hoy} seleccion={dia} conteos={conteos} colores={colores}
            onCambiarMes={(m) => { setMes(m); setDia(null) }} onElegir={setDia} bloquearPasados />
          {dia && (
            <View style={styles.detalle}>
              <Text style={styles.detalleTitulo}>{fechaLarga(dia)}</Text>
              {visitasDia.length > 0 ? visitasDia.map((v) => (
                <View key={`${v.id ?? v.lista?.id}`} style={styles.fila}>
                  <Text style={[styles.sub, { flex: 1 }]}>{v.lista ? `Visita por la lista "${v.lista.nombre}"` : 'Visita programada'}</Text>
                  {soyGerente && (
                    <Pressable onPress={() => quitar(v)} disabled={ocupado} hitSlop={8} accessibilityLabel="Quitar visita de este día">
                      <Ionicons name="close-circle-outline" size={22} color={Palette.textFaint} />
                    </Pressable>
                  )}
                </View>
              )) : soyGerente ? (
                <Pressable style={styles.programar} disabled={ocupado} onPress={() => ejecutar(() => programarVisita(clienteId, dia))}>
                  <Ionicons name="add" size={16} color={Palette.onNavy} />
                  <Text style={styles.programarText}>Programar visita este día</Text>
                </Pressable>
              ) : <Text style={styles.sub}>Sin visita este día.</Text>}
            </View>
          )}
          {soyGerente && !dia && <Text style={styles.sub}>Toca un día para ver la visita o programar una nueva.</Text>}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titulo: { fontSize: 15, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  fecha: { fontWeight: '800', color: Palette.navy, textTransform: 'capitalize' },
  detalle: { backgroundColor: Palette.cream, borderRadius: 12, padding: 10, gap: 8 },
  detalleTitulo: { fontSize: 14, fontWeight: '800', color: Palette.text, textTransform: 'capitalize' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  programar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Palette.orange, borderRadius: 10, paddingVertical: 10 },
  programarText: { color: Palette.onNavy, fontSize: 13, fontWeight: '800' },
})

export default ProximasVisitas
