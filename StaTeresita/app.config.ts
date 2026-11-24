// Configuración de la app para los builds (EAS). Parte de app.json y agrega lo que depende de variables:
// la clave de Google Maps (GOOGLE_MAPS_API_KEY, variable secreta en EAS; nunca va en el repo).
// Ver docs/PUESTA_EN_MARCHA.md.
import type { ConfigContext, ExpoConfig } from 'expo/config'

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      ...(process.env.GOOGLE_MAPS_API_KEY ? { googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY } } : {}),
    },
  },
})
