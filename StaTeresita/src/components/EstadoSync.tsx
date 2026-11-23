import { Palette } from '@/constants/palette'
import { Accion, escucharCola, quitarAccion, reintentarFallidas, verCola } from '@/lib/offline/cola'
import { escucharSincronizando, estaSincronizando, sincronizar } from '@/lib/offline/fetchOffline'
import { alCambiarConexion, hayConexion } from '@/lib/offline/red'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const hora = (iso: string) => new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// Estado de la conexión y de lo que falta subir. No muestra nada si hay señal y todo está subido.
// Al tocarlo se ve la lista de acciones pendientes y las que fallaron.
export const useEstadoSync = () => {
  const [enLinea, setEnLinea] = useState(hayConexion())
  const [cola, setCola] = useState<Accion[]>(verCola())
  const [sinc, setSinc] = useState(estaSincronizando())
  useEffect(() => {
    const a = alCambiarConexion(setEnLinea)
    const b = escucharCola(() => setCola(verCola()))
    const c = escucharSincronizando(setSinc)
    setCola(verCola())
    return () => { a(); b(); c() }
  }, [])
  return { enLinea, cola, sinc, pendientes: cola.filter((x) => x.estado === 'pendiente'), fallidas: cola.filter((x) => x.estado === 'fallida') }
}

const EstadoSync = ({ claro }: { claro?: boolean }) => {
  const { enLinea, cola, sinc, pendientes, fallidas } = useEstadoSync()
  const [abierto, setAbierto] = useState(false)
  if (enLinea && cola.length === 0) return null

  const texto = !enLinea
    ? `Sin conexión${pendientes.length ? ` · ${pendientes.length} por subir` : ''}`
    : sinc ? 'Sincronizando…'
    : fallidas.length ? `${fallidas.length} no se pudo subir`
    : `${pendientes.length} por subir`
  const alerta = fallidas.length > 0
  return (
    <>
      <Pressable style={[styles.pill, claro ? styles.pillClaro : styles.pillOscuro, alerta && styles.pillAlerta]} onPress={() => setAbierto(true)} hitSlop={6}>
        <Ionicons name={!enLinea ? 'cloud-offline-outline' : sinc ? 'sync-outline' : alerta ? 'alert-circle-outline' : 'cloud-upload-outline'} size={13}
          color={alerta ? Palette.onNavy : claro ? Palette.navy : Palette.onNavy} />
        <Text style={[styles.pillText, { color: alerta ? Palette.onNavy : claro ? Palette.navy : Palette.onNavy }]}>{texto}</Text>
      </Pressable>

      <Modal visible={abierto} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAbierto(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.titulo}>Acciones por subir</Text>
            <Pressable onPress={() => setAbierto(false)} hitSlop={8}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
          </View>
          <Text style={styles.sub}>
            {enLinea ? 'Hay conexión. Se suben solas, en el orden en que se hicieron.' : 'Sin conexión. Todo queda guardado en el teléfono y se sube solo, en orden, cuando vuelva la señal.'}
          </Text>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {cola.length === 0 && <Text style={styles.sub}>No hay nada pendiente.</Text>}
            {cola.map((a, i) => (
              <View key={a.id} style={[styles.fila, a.estado === 'fallida' && styles.filaFallida]}>
                <Text style={styles.num}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.desc}>{a.descripcion}</Text>
                  <Text style={styles.hora}>{hora(a.creado_en)}{a.estado === 'fallida' ? ' · No se pudo subir' : ''}</Text>
                  {!!a.error && <Text style={styles.error}>{a.error}</Text>}
                </View>
                {a.estado === 'fallida' && (
                  <Pressable onPress={() => quitarAccion(a.id)} hitSlop={8} accessibilityLabel="Descartar">
                    <Ionicons name="trash-outline" size={20} color={Palette.orange} />
                  </Pressable>
                )}
              </View>
            ))}
          </ScrollView>
          {cola.length > 0 && (
            <View style={{ padding: 16 }}>
              <Pressable style={[styles.boton, !enLinea && { opacity: 0.5 }]} disabled={!enLinea || sinc}
                onPress={async () => { await reintentarFallidas(); sincronizar() }}>
                <Text style={styles.botonText}>{sinc ? 'Subiendo…' : 'Subir ahora'}</Text>
              </Pressable>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 },
  pillOscuro: { backgroundColor: Palette.onNavyFill },
  pillClaro: { backgroundColor: Palette.navySoft },
  pillAlerta: { backgroundColor: Palette.orange },
  pillText: { fontSize: 12, fontWeight: '800' },
  modal: { flex: 1, backgroundColor: Palette.cream },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  titulo: { fontSize: 18, fontWeight: '700', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted, paddingHorizontal: 16, paddingTop: 12 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderRadius: 14, borderWidth: 1, borderColor: Palette.border, padding: 12 },
  filaFallida: { borderColor: Palette.orange, backgroundColor: Palette.amberSoft },
  num: { width: 24, height: 24, borderRadius: 12, backgroundColor: Palette.navy, color: Palette.onNavy, textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: '800', overflow: 'hidden' },
  desc: { fontSize: 14, fontWeight: '700', color: Palette.text },
  hora: { fontSize: 12, color: Palette.textMuted },
  error: { fontSize: 12, color: Palette.orange, marginTop: 2 },
  boton: { backgroundColor: Palette.navy, borderRadius: 12, padding: 15, alignItems: 'center' },
  botonText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
})

export default EstadoSync
