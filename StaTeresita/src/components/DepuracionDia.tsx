import { CENTRO_INICIAL } from '@/components/mapaClientes.types'
import { Palette } from '@/constants/palette'
import { hayUbicacionSimulada, Punto, simularUbicacion } from '@/lib/mapa'
import { cambiarEstadoJornada, Jornada, reiniciarJornada, reiniciarJornadaHoy, reiniciarVisitas, textoEstadoJornada, vaciarRuta } from '@/lib/rutas'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Props {
  visible: boolean
  jornada: Jornada | null
  // Casas con ubicación (para simular estar en una de ellas)
  casas?: { nombre: string; punto: Punto }[]
  onClose: () => void
  // Se llama después de cada cambio para que la pantalla vuelva a cargar
  onCambio: () => void
}

// Depuración del día (solo gerente): herramientas para probar las rutas.
// Cambian la jornada y las paradas de HOY en Supabase; la ubicación simulada solo vive en este teléfono.
const DepuracionDia = ({ visible, jornada, casas = [], onClose, onCambio }: Props) => {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [, refrescar] = useState(0)

  const hacer = (titulo: string, mensaje: string, accion: () => Promise<unknown>, destructivo = false) => {
    if (!jornada) { Alert.alert('Depuración', 'Hoy todavía no hay jornada.'); return }
    Alert.alert(titulo, mensaje, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí, hacerlo', style: destructivo ? 'destructive' : 'default', onPress: async () => {
        setOcupado(true)
        try { await accion(); onCambio() } catch (e: any) { Alert.alert('Error', e.message ?? String(e)) }
        finally { setOcupado(false) }
      } },
    ])
  }

  const simular = (p: Punto | null) => { simularUbicacion(p); refrescar((n) => n + 1); onCambio() }
  const casaAlAzar = () => {
    if (casas.length === 0) { Alert.alert('Depuración', 'No hay casas con ubicación en el mapa.'); return }
    const c = casas[Math.floor(Math.random() * casas.length)]
    simular(c.punto)
    Alert.alert('Ubicación simulada', `Ahora estás "en la casa" de ${c.nombre}.`)
  }

  const Boton = ({ icono, texto, sub, onPress, color = Palette.navy }: { icono: keyof typeof Ionicons.glyphMap; texto: string; sub: string; onPress: () => void; color?: string }) => (
    <Pressable style={({ pressed }) => [styles.boton, pressed && { opacity: 0.8 }]} onPress={onPress} disabled={ocupado}>
      <Ionicons name={icono} size={20} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.botonTexto, { color }]}>{texto}</Text>
        <Text style={styles.botonSub}>{sub}</Text>
      </View>
    </Pressable>
  )

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="bug-outline" size={20} color={Palette.navy} />
          <Text style={styles.titulo}>Depuración del día</Text>
          {ocupado && <ActivityIndicator size="small" color={Palette.navy} />}
          <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={Palette.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.aviso}>
            Solo para probar. Estos botones cambian la ruta de HOY de verdad en la base de datos. Jornada de hoy: {jornada ? textoEstadoJornada(jornada.estado) : 'sin crear'}.
          </Text>

          <Boton icono="reload-circle-outline" color={Palette.orange} texto="Reiniciar ruta de hoy"
            sub="Todas las paradas vuelven a Pendiente y la jornada a 'En preparación'. No borra paradas, ventas ni pagos."
            onPress={() => hacer('Reiniciar ruta de hoy', 'Las visitas de hoy quedarán pendientes y la ruta como no iniciada, para probarla de nuevo.', () => reiniciarJornadaHoy(jornada!.id))} />

          <Boton icono="list-outline" texto="Ir a organizar ruta" sub="Abre la pantalla para ordenar la ruta y comenzarla (si la jornada está en preparación)."
            onPress={() => { onClose(); router.push('/organizar-ruta' as any) }} />

          <Text style={styles.seccion}>Jornada</Text>
          <Boton icono="refresh" texto="Volver a 'En preparación'" sub="Como si la ruta no se hubiera iniciado. Se puede volver a editar e iniciar."
            onPress={() => hacer('Volver a preparación', 'La jornada de hoy quedará como no iniciada.', () => reiniciarJornada(jornada!.id))} />
          <Boton icono="play" texto="Iniciar ruta ahora" sub="Pone la jornada en curso sin pasar por Gestionar ruta."
            onPress={() => hacer('Iniciar ruta', 'La jornada de hoy quedará en curso.', () => cambiarEstadoJornada(jornada!.id, 'en_curso'))} />
          <Boton icono="stop" texto="Finalizar ruta" sub="Cierra la jornada de hoy."
            onPress={() => hacer('Finalizar ruta', 'La jornada de hoy quedará finalizada.', () => cambiarEstadoJornada(jornada!.id, 'finalizada'))} />

          <Text style={styles.seccion}>Paradas</Text>
          <Boton icono="arrow-undo-outline" texto="Reiniciar visitas" sub="Todas las paradas vuelven a 'Pendiente' (borra Estaba / No estaba y la hora)."
            onPress={() => hacer('Reiniciar visitas', 'Todas las paradas de hoy quedarán pendientes.', () => reiniciarVisitas(jornada!.id))} />
          <Boton icono="trash-outline" color={Palette.orange} texto="Vaciar la ruta de hoy" sub="Quita todos los clientes asignados hoy a todos los caseros."
            onPress={() => hacer('Vaciar la ruta de hoy', 'Se quitarán todas las paradas de hoy. No se puede deshacer.', () => vaciarRuta(jornada!.id), true)} />

          <Text style={styles.seccion}>Ubicación (solo en este teléfono)</Text>
          <Text style={styles.estadoUbic}>Ahora: {hayUbicacionSimulada() ? 'ubicación simulada' : 'GPS real del teléfono'}</Text>
          <Boton icono="business-outline" texto="Simular que estoy en el centro de Molina" sub="Para probar la ruta sugerida desde el computador."
            onPress={() => simular({ latitud: CENTRO_INICIAL.latitud, longitud: CENTRO_INICIAL.longitud })} />
          <Boton icono="home-outline" texto="Simular que estoy en una casa al azar" sub="Elige una casa de la ruta con ubicación."
            onPress={casaAlAzar} />
          <Boton icono="locate" texto="Volver al GPS real" sub="Deja de simular."
            onPress={() => simular(null)} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderBottomWidth: 1, borderBottomColor: Palette.border },
  titulo: { flex: 1, fontSize: 18, fontWeight: '700', color: Palette.text },
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  aviso: { fontSize: 13, color: Palette.amber, backgroundColor: Palette.amberSoft, borderRadius: 12, padding: 10 },
  seccion: { fontSize: 12, fontWeight: '800', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10 },
  estadoUbic: { fontSize: 13, color: Palette.text },
  boton: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 14, padding: 12 },
  botonTexto: { fontSize: 15, fontWeight: '800' },
  botonSub: { fontSize: 12, color: Palette.textMuted, marginTop: 2 },
})

export default DepuracionDia
