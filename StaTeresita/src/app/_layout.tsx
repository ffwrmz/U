import { Slot} from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { View } from 'react-native'

const RootLayot = () => {
  return (
    <View style={{flex:1}}>
      <Slot />
      <StatusBar style='auto' />
    </View>
  )
}

export default RootLayot