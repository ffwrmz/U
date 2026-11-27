// Ruta antigua: los descuentos ahora están en Solicitudes (pestaña Descuentos)
import { Redirect } from 'expo-router'

const SolicitudesDescuento = () => <Redirect href={'/solicitudes?tab=descuentos' as any} />

export default SolicitudesDescuento
