// Paleta visual de Santa Teresita (azul marino + crema + acento naranja).
// Todas las pantallas usan estos colores (no poner colores sueltos en los estilos).

export const Palette = {
  // Marca
  navy: '#262C60',
  navyDark: '#1B2050',
  navySoft: '#EAEBF5',
  orange: '#E8590C',

  // Fondos y superficies
  cream: '#F6F3EA',
  card: '#FFFDF8', // tarjetas: blanco cálido sobre el fondo crema
  border: '#E7E3D6',
  inputFill: '#EFEDE4',

  // Texto
  text: '#1E2243',
  textMuted: '#6F6F68',
  textFaint: '#9A988E',

  // Estados
  green: '#1E7A46',
  greenSoft: '#DDF3E6',
  amber: '#9A6200',
  amberSoft: '#FDF0D2',
  yellow: '#F5C518', // puntos de clientes con deuda en el mapa (con borde oscuro)
  yellowBorder: '#7A5A00',
  grayPill: '#ECEBE5',

  // Colores de los accesos rápidos (fondo suave + ícono)
  orangeSoft: '#FDE6D8',
  orangeDark: '#A8430A', // texto naranja legible sobre fondo naranja suave
  sky: '#1F5F99',
  skySoft: '#DDEBF8',
  lilac: '#5B3FA0',
  lilacSoft: '#ECE5F8',
  teal: '#0F6E6E',
  tealSoft: '#D9F1EF',

  // Sobre fondo azul marino
  onNavy: '#FFFFFF',
  onNavyMuted: 'rgba(255,255,255,0.72)',
  onNavyFill: 'rgba(255,255,255,0.14)',
  onNavyBorder: 'rgba(255,255,255,0.20)',

  // Otros
  navyDisabled: '#8C90B5', // botón azul desactivado
  overlay: 'rgba(0,0,0,0.38)', // fondo oscuro detrás de una ventana
  shadow: '#000000',
  white: '#FFFFFF',
  ubicacion: '#2F80ED', // "tú estás aquí" en el mapa
  ubicacionHalo: 'rgba(47,128,237,0.25)',
  mapaVelo: 'rgba(255,255,255,0.92)', // aviso sobre el mapa
} as const

