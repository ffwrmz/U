// Configuración de la app para los builds (EAS). Parte de app.json y agrega lo que depende de variables:
// la clave de Google Maps (GOOGLE_MAPS_API_KEY, variable secreta en EAS; nunca va en el repo).
// Ver docs/PUESTA_EN_MARCHA.md.
// Ojo: la clave se le pasa al plugin de react-native-maps; si el plugin no la recibe, BORRA la clave del
// AndroidManifest y la app se cierra al mostrar un mapa ("API key not found").
import type { ConfigContext, ExpoConfig } from 'expo/config'

const CLAVE_MAPS = process.env.GOOGLE_MAPS_API_KEY

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: (config.plugins ?? []).map((p) => {
    const nombre = Array.isArray(p) ? p[0] : p
    return nombre === 'react-native-maps' ? ['react-native-maps', CLAVE_MAPS ? { androidGoogleMapsApiKey: CLAVE_MAPS } : {}] : p
  }),
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      ...(CLAVE_MAPS ? { googleMaps: { apiKey: CLAVE_MAPS } } : {}),
    },
  },
})
