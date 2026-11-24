import { reiniciarJornada, vaciarRuta } from '@/lib/rutas'
import { Alert } from 'react-native'

// Depuración del día (solo gerente, para pruebas): deja el día como si nunca se hubieran asignado
// clientes ni iniciado la ruta. Quita todas las paradas de hoy y vuelve la jornada a "En preparación".
// No toca clientes, ventas ni pagos. Pide confirmación antes.
export const reiniciarDia = (jornadaId: string | null | undefined, onHecho: () => void) => {
  if (!jornadaId) { onHecho(); return } // si hoy aún no hay jornada, ya está "limpio"
  Alert.alert(
    'Depuración del día',
    'Se quitarán todos los clientes asignados hoy y la ruta volverá a como estaba antes de iniciarla. Las ventas y pagos registrados no se borran.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reiniciar el día', style: 'destructive', onPress: async () => {
        try {
          // Primero vuelve la jornada a preparación (una ruta en curso no deja quitar clientes) y después borra
          await reiniciarJornada(jornadaId)
          await vaciarRuta(jornadaId)
          Alert.alert('Listo', 'El día quedó como nuevo.')
        } catch (e: any) {
          Alert.alert('Error', e.message ?? String(e))
        } finally {
          onHecho()
        }
      } },
    ],
  )
}
