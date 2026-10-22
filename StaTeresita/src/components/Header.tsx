import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'


interface HeaderProps {
  title: string
}

const Header = (props: HeaderProps) => {
  const router = useRouter()

  const volver = () => {
    if (router.canGoBack()) { 
      router.back()
    }
  }

  const cerrarSesion = () => {

    router.replace('/')
    console.log('Cerrando sesión...')
  }

  return (
    <View style={styles.header}>
      <Pressable onPress={volver}>
        <Ionicons size={28} color='#be4bc2' name='arrow-back-outline' />
      </Pressable>

      <Text>{props.title}</Text>
      <Text></Text>

      <Pressable onPress={cerrarSesion}>
        <Ionicons size={28} color='#be4bc2' name='log-out-outline' />
      </Pressable>

      
    </View>
  )
}


const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0'
  }
})

export default Header