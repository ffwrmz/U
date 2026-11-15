// Arma los puntos del mapa (UbicacionMapa) a partir de clientes o de las paradas de una ruta.
import type { UbicacionMapa } from '@/components/mapaClientes.types'
import { ClienteRuta, lineaDireccion, lineaZona } from '@/lib/rutas'
import { Linking, Platform } from 'react-native'

const tieneCoordenadas = (c: ClienteRuta | null | undefined): c is ClienteRuta & { dir: NonNullable<ClienteRuta['dir']> } =>
  !!c?.dir && c.dir.latitud != null && c.dir.longitud != null &&
  Number.isFinite(Number(c.dir.latitud)) && Number.isFinite(Number(c.dir.longitud))

const textoCompleto = (c: ClienteRuta) => [lineaDireccion(c), lineaZona(c)].filter(Boolean).join(', ')

// Un punto por casa; si varios clientes viven en la misma dirección van juntos en el mismo marcador.
export const ubicacionesDeClientes = (clientes: ClienteRuta[], deudas: Record<string, number> = {}): UbicacionMapa[] => {
  const porDireccion: Record<string, UbicacionMapa> = {}
  clientes.filter(tieneCoordenadas).forEach((c) => {
    const key = c.dir.id ?? `${c.dir.latitud},${c.dir.longitud}`
    const u = (porDireccion[key] ??= {
      id: key, latitud: Number(c.dir.latitud), longitud: Number(c.dir.longitud), direccion: textoCompleto(c), clientes: [],
    })
    u.clientes.push({ id: c.id, nombre: c.nombre, deuda: deudas[c.id] || 0 })
  })
  return Object.values(porDireccion)
}

// Paradas de una ruta en orden, con su número de parada como etiqueta del marcador.
// Si dos paradas seguidas están en la misma casa se juntan ("3-4").
export const ubicacionesDeParadas = (
  paradas: { cliente: ClienteRuta | null; estado?: string }[],
  colores?: Partial<Record<string, string>>,
): UbicacionMapa[] => {
  const lista: UbicacionMapa[] = []
  paradas.forEach((p, i) => {
    const c = p.cliente
    if (!tieneCoordenadas(c)) return
    const key = c.dir.id ?? `${c.dir.latitud},${c.dir.longitud}`
    const anterior = lista[lista.length - 1]
    if (anterior && anterior.id === key) {
      anterior.clientes.push({ id: c.id, nombre: c.nombre, deuda: 0 })
      anterior.etiqueta = `${anterior.etiqueta?.split('-')[0]}-${i + 1}`
      return
    }
    lista.push({
      id: lista.some((x) => x.id === key) ? `${key}-${i}` : key,
      latitud: Number(c.dir.latitud), longitud: Number(c.dir.longitud), direccion: textoCompleto(c),
      clientes: [{ id: c.id, nombre: c.nombre, deuda: 0 }],
      etiqueta: String(i + 1),
      color: (p.estado && colores?.[p.estado]) || undefined,
    })
  })
  return lista
}

// Abre Google Maps (o Apple Maps / Waze según el teléfono) con indicaciones para llegar a la casa.
// Si la dirección no tiene coordenadas, busca por el texto de la dirección.
export const abrirComoLlegar = async (c: ClienteRuta) => {
  const destino = tieneCoordenadas(c)
    ? `${Number(c.dir.latitud)},${Number(c.dir.longitud)}`
    : encodeURIComponent([textoCompleto(c), 'Chile'].filter(Boolean).join(', '))
  const web = `https://www.google.com/maps/dir/?api=1&destination=${destino}`
  const nativo = Platform.OS === 'ios' ? `maps://?daddr=${destino}` : `google.navigation:q=${destino}`
  try {
    if (Platform.OS !== 'web' && (await Linking.canOpenURL(nativo))) { await Linking.openURL(nativo); return }
  } catch {}
  await Linking.openURL(web)
}
