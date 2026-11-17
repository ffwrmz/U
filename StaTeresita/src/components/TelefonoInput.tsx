import { Palette } from '@/constants/palette'
import { StyleProp, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native'

interface Props {
  value: string // solo los 9 dígitos que van después de +56 (ej. 912345678)
  onChangeText: (nueveDigitos: string) => void
  editable?: boolean
  style?: StyleProp<ViewStyle>
}

// Campo de celular chileno: muestra fijo "+56" y solo se escriben los 9 dígitos del celular.
const TelefonoInput = ({ value, onChangeText, editable = true, style }: Props) => (
  <View style={[styles.caja, style]}>
    <Text style={styles.prefijo}>+56</Text>
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={(t) => onChangeText(t.replace(/\D/g, '').slice(0, 9))}
      placeholder="9 1234 5678"
      placeholderTextColor={Palette.textFaint}
      keyboardType="number-pad"
      maxLength={9}
      editable={editable}
    />
  </View>
)

const styles = StyleSheet.create({
  caja: { flexDirection: 'row', alignItems: 'center', backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 14, height: 52 },
  prefijo: { fontSize: 16, fontWeight: '700', color: Palette.navy, marginRight: 8 },
  input: { flex: 1, fontSize: 16, color: Palette.text, height: '100%' },
})

export default TelefonoInput
