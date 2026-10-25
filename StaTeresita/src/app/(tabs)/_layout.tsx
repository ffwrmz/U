import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Palette } from '@/constants/palette';

export default function TabLayout() {
  return (
    <Tabs 
      screenOptions={{ 
        tabBarActiveTintColor: Palette.navy,
        headerShown: false,
        tabBarStyle: {
          elevation: 0,
          height: Platform.OS === 'ios' ? 85 : 65,
          paddingBottom : Platform.OS === 'ios' ? 25 : 10,
          paddingTop : 8,
        },
        tabBarLabelStyle: {
          paddingBottom: 4,
          fontSize: 12,
        }
      }}
    >
      <Tabs.Screen
        name="home/index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}