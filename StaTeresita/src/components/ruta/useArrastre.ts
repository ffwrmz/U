// Arrastrar y soltar filas de una lista para cambiar su orden (Organizar ruta).
// Usa solo PanResponder/Animated de React Native, así funciona en el teléfono y en la web sin librerías extra.
// Uso: cada fila llama a setAltura(id, alto) en onLayout, la manilla recibe handlers(id) y la fila usa estiloDe(id).
import { createContext, createElement, ReactNode, useContext, useRef, useState } from 'react'
import { Animated, GestureResponderHandlers, PanResponder, PanResponderInstance, Platform, Vibration, View } from 'react-native'

// Celda de FlatList que dibuja encima la fila que se está arrastrando. Tiene que ser un componente fijo
// (definido aquí, fuera del render): si se creara en cada render, la lista volvería a montar las filas
// al empezar a arrastrar y el gesto se cortaría.
const ArrastreContexto = createContext<string | null>(null)
export const ProveedorArrastre = ({ id, children }: { id: string | null; children: ReactNode }) =>
  createElement(ArrastreContexto.Provider, { value: id }, children)
export const CeldaArrastrable = ({ item, style, ...props }: any) => {
  const arrastrando = useContext(ArrastreContexto)
  const encima = item?.id != null && item.id === arrastrando
  return createElement(View, { ...props, style: [style, { zIndex: encima ? 999 : 0, elevation: encima ? 8 : 0 }] })
}

// Tiempo que hay que mantener presionada la manilla para empezar a mover (ms)
const ESPERA = 250

export const useArrastre = (
  ids: string[],
  onSoltar: (desde: number, hacia: number) => void,
  separacion = 10, // espacio entre filas (gap de la lista)
) => {
  const idsRef = useRef(ids)
  idsRef.current = ids
  const onSoltarRef = useRef(onSoltar)
  onSoltarRef.current = onSoltar
  const alturas = useRef<Record<string, number>>({})
  const dy = useRef(new Animated.Value(0)).current
  const actual = useRef<{ id: string; desde: number; hacia: number } | null>(null)
  const pendiente = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const [estado, setEstado] = useState<{ id: string; desde: number; hacia: number } | null>(null)
  const responders = useRef<Record<string, PanResponderInstance>>({})

  const alto = (id: string) => (alturas.current[id] ?? 80) + separacion

  // A qué posición llegaría la fila si se suelta con este desplazamiento
  const calcularDestino = (desde: number, desplazamiento: number) => {
    const lista = idsRef.current
    let hacia = desde
    if (desplazamiento > 0) {
      let acumulado = 0
      for (let i = desde + 1; i < lista.length; i++) {
        const h = alto(lista[i])
        if (desplazamiento > acumulado + h / 2) { hacia = i; acumulado += h } else break
      }
    } else if (desplazamiento < 0) {
      let acumulado = 0
      for (let i = desde - 1; i >= 0; i--) {
        const h = alto(lista[i])
        if (-desplazamiento > acumulado + h / 2) { hacia = i; acumulado += h } else break
      }
    }
    return hacia
  }

  // Empieza a mover la fila (después de mantener presionado)
  const activar = (id: string) => {
    const desde = idsRef.current.indexOf(id)
    if (desde < 0) return
    actual.current = { id, desde, hacia: desde }
    setEstado({ id, desde, hacia: desde })
    if (Platform.OS !== 'web') Vibration.vibrate(15) // aviso corto: ya se puede mover
  }

  const terminar = () => {
    if (pendiente.current) { clearTimeout(pendiente.current.timer); pendiente.current = null }
    const a = actual.current
    actual.current = null
    setEstado(null)
    dy.setValue(0)
    if (a && a.hacia !== a.desde) onSoltarRef.current(a.desde, a.hacia)
  }

  // Un PanResponder fijo por fila (si se recreara en cada render se perdería el gesto a mitad de camino)
  const handlers = (id: string): GestureResponderHandlers => {
    if (!responders.current[id]) {
      responders.current[id] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false, // que la lista no "robe" el gesto para hacer scroll
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => {
          dy.setValue(0)
          // Mantener presionado ESPERA ms activa el movimiento
          pendiente.current = { id, timer: setTimeout(() => { pendiente.current = null; activar(id) }, ESPERA) }
        },
        onPanResponderMove: (_e, g) => {
          // Si mueve el dedo antes de la espera, igual se activa (ya tiene agarrada la manilla)
          if (!actual.current && pendiente.current && Math.abs(g.dy) > 8) {
            clearTimeout(pendiente.current.timer)
            pendiente.current = null
            activar(id)
          }
          const a = actual.current
          if (!a) return
          dy.setValue(g.dy)
          const hacia = calcularDestino(a.desde, g.dy)
          if (hacia !== a.hacia) {
            actual.current = { ...a, hacia }
            setEstado({ ...a, hacia })
          }
        },
        onPanResponderRelease: terminar,
        onPanResponderTerminate: terminar,
      })
    }
    return responders.current[id].panHandlers
  }

  // Estilo de cada fila: la que se arrastra sigue al dedo; las demás se corren para hacerle espacio
  const estiloDe = (id: string) => {
    if (!estado) return null
    if (id === estado.id) return { transform: [{ translateY: dy }], zIndex: 999, elevation: 8 }
    const i = ids.indexOf(id)
    const hueco = alto(estado.id)
    if (estado.desde < i && i <= estado.hacia) return { transform: [{ translateY: -hueco }] }
    if (estado.hacia <= i && i < estado.desde) return { transform: [{ translateY: hueco }] }
    return null
  }

  return {
    handlers,
    estiloDe,
    setAltura: (id: string, h: number) => { alturas.current[id] = h },
    arrastrandoId: estado?.id ?? null,
    arrastrando: !!estado,
  }
}
