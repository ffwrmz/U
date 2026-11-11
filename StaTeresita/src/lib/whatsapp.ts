import { Alert, Linking } from 'react-native'

// Abre un chat de WhatsApp con el teléfono guardado (569XXXXXXXX; también acepta 9 dígitos).
export const abrirWhatsApp = async (telefono?: string | null) => {
  let numero = (telefono ?? '').replace(/\D/g, '')
  if (numero.length === 9) numero = '56' + numero // 9XXXXXXXX → 569XXXXXXXX
  if (numero.length < 11) {
    Alert.alert('WhatsApp', 'El cliente no tiene un teléfono válido.')
    return
  }
  try {
    await Linking.openURL(`whatsapp://send?phone=${numero}`)
  } catch {
    Alert.alert('WhatsApp', 'WhatsApp no está instalado en este teléfono.')
  }
}
