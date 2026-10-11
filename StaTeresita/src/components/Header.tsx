import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React from 'react'
import { Pressable, Text, View } from 'react-native'


interface HeaderProps {
  title: string
}

const Header = ( props : HeaderProps ) => {
    const router = useRouter()
    const volver = () => {
        router.replace('/')
    }

  return (
    <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}>
      <Pressable onPress={volver}>
        <Ionicons size={28} color='#be4bc2' name='arrow-back-outline' />
      </Pressable>
      <Text>{props.title}</Text>
      <Text></Text>
    </View>
  )
}

export default Header