import React from 'react'
import { View, ViewStyle } from 'react-native'
import Animated, { FadeInLeft } from 'react-native-reanimated'

interface FadeInViewProps {
  children: React.ReactNode
  duration?: number
  style?: any
}

const FadeInView = ({ children, duration = 500, style }: FadeInViewProps) => {
  return (
    <Animated.View
      entering={FadeInLeft.duration(duration)}
      style={[{ flex: 1 }, style]} 
    >
      {children}
    </Animated.View>
  )
}

export default FadeInView