import React from 'react'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Animated, { FadeInLeft } from 'react-native-reanimated'
import Header from '@/components/Header'

const Pantalla2 = () => {
    
    return (
        <SafeAreaView style={{ padding: 16, flex: 1 }}>
            <Animated.View
                entering={FadeInLeft.duration(500)}
                style={{ flex: 1 }}>
            <Header title="Pantalla 2" />
            
            </Animated.View>
        </SafeAreaView>
    )
}

export default Pantalla2