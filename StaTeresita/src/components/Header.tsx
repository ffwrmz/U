import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import EstadoSync from '@/components/EstadoSync'
import { Palette } from '@/constants/palette'


interface HeaderProps {
  title: string
  // Texto corto bajo el título que explica qué se hace en la pantalla (opcional)
  subtitle?: string
}

const Header = (props: HeaderProps) => {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const volver = () => {
    if (router.canGoBack()) { 
      router.back()
    }
  }

  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Pressable onPress={volver} style={styles.iconButton}>
        <Ionicons size={22} color={Palette.onNavy} name='arrow-back-outline' />
      </Pressable>

      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={styles.title}>{props.title}</Text>
        {!!props.subtitle && <Text style={styles.subtitle} numberOfLines={1}>{props.subtitle}</Text>}
        <EstadoSync />
      </View>

      {/* Cerrar sesión solo está en el inicio */}
      <View style={styles.iconButtonVacio} />
    </View>
  )
}


const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: Palette.navy,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.onNavyFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonVacio: { width: 40, height: 40 },
  subtitle: { fontSize: 12, color: Palette.onNavyMuted, marginTop: 1 },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Palette.onNavy,
  },
})

export default Header
