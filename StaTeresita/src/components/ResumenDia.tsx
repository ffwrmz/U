import { Palette } from '@/constants/palette'
import { clp } from '@/lib/format'
import { listarParadas, Parada } from '@/lib/rutas'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

interface Pago { id: string; monto: number; metodo: string | null; quien: string | null; cliente_id: string | null; cliente: string | null }
interface Venta { id: string; monto: number; quien: string | null; cliente_id: string | null; cliente: string | null; items: { nombre: string; cantidad: number }[] }
interface Trabajador {
  id: string
  nombre: string
  paradas: Parada[]
  pagos: Pago[]
  ventas: Venta[]
}

const ESTADO = {
  visitado: { texto: 'Estaba', color: Palette.green, fondo: Palette.greenSoft },
  no_estaba: { texto: 'No estaba', color: Palette.orange, fondo: Palette.amberSoft },
  pendiente: { texto: 'No se visitó', color: Palette.textMuted, fondo: Palette.grayPill },
} as const

// Rango del día en hora local del teléfono (Chile), para filtrar pagos y ventas por su hora de registro
const rangoDia = (fecha: string) => {
  const [y, m, d] = fecha.split('-').map(Number)
  return { desde: new Date(y, m - 1, d).toISOString(), hasta: new Date(y, m - 1, d + 1).toISOString() }
}

const totales = (t: Pick<Trabajador, 'paradas' | 'pagos' | 'ventas'>) => {
  const productos: Record<string, number> = {}
  t.ventas.forEach((v) => v.items.forEach((i) => { productos[i.nombre] = (productos[i.nombre] || 0) + i.cantidad }))
  return {
    visitados: t.paradas.filter((p) => p.estado === 'visitado').length,
    noEstaban: t.paradas.filter((p) => p.estado === 'no_estaba').length,
    sinVisitar: t.paradas.filter((p) => p.estado === 'pendiente').length,
    pagaron: new Set(t.pagos.map((p) => p.cliente_id ?? p.id)).size,
    efectivo: t.pagos.filter((p) => p.metodo !== 'transferencia').reduce((s, p) => s + p.monto, 0),
    transferencia: t.pagos.filter((p) => p.metodo === 'transferencia').reduce((s, p) => s + p.monto, 0),
    vendido: t.ventas.reduce((s, v) => s + v.monto, 0),
    ventas: t.ventas.length,
    productos,
  }
}

// Resumen de un día que ya pasó (o de hoy): por trabajador, sus clientes con el resultado de la visita,
// quién pagó y cuánto (efectivo / transferencia) y lo que se vendió. Lee jornadas, ruta_paradas, pagos,
// ventas_pedidos y venta_items (el gerente puede leer todo).
const ResumenDia = ({ fecha }: { fecha: string }) => {
  const router = useRouter()
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([])
  const [abiertos, setAbiertos] = useState<string[]>([])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const { desde, hasta } = rangoDia(fecha)
      const { data: j } = await supabase.from('jornadas').select('id').eq('fecha', fecha).maybeSingle()
      const [paradas, pg, vs] = await Promise.all([
        j ? listarParadas((j as any).id) : Promise.resolve([] as Parada[]),
        supabase.from('pagos').select('id, monto_abonado, metodo_pago, cobrador_id, venta:ventas_pedidos ( cliente_id, cliente:clientes ( nombre ) )')
          .gte('creado_en', desde).lt('creado_en', hasta),
        supabase.from('ventas_pedidos').select('id, vendedor_id, cliente_id, monto_total, cliente:clientes ( nombre ), venta_items ( cantidad, productos ( nombre ) )')
          .gte('creado_en', desde).lt('creado_en', hasta).neq('estado_pago', 'anulada'),
      ])
      if (pg.error) throw pg.error
      if (vs.error) throw vs.error
      const pagos: Pago[] = ((pg.data as any[]) || []).map((x) => ({
        id: x.id, monto: Number(x.monto_abonado), metodo: x.metodo_pago, quien: x.cobrador_id,
        cliente_id: x.venta?.cliente_id ?? null, cliente: x.venta?.cliente?.nombre ?? null,
      }))
      const ventas: Venta[] = ((vs.data as any[]) || []).map((x) => ({
        id: x.id, monto: Number(x.monto_total), quien: x.vendedor_id, cliente_id: x.cliente_id, cliente: x.cliente?.nombre ?? null,
        items: ((x.venta_items as any[]) || []).map((i) => ({ nombre: i.productos?.nombre ?? 'Producto', cantidad: Number(i.cantidad) })),
      }))
      const ids = Array.from(new Set([...paradas.map((p) => p.vendedor_id), ...pagos.map((p) => p.quien), ...ventas.map((v) => v.quien)].filter(Boolean))) as string[]
      const { data: pe } = ids.length ? await supabase.from('perfiles').select('id, nombre').in('id', ids) : { data: [] }
      const nombres = Object.fromEntries(((pe as any[]) || []).map((p) => [p.id, p.nombre]))
      setTrabajadores(ids.map((id) => ({
        id, nombre: nombres[id] ?? 'Trabajador',
        paradas: paradas.filter((p) => p.vendedor_id === id).sort((a, b) => a.orden - b.orden),
        pagos: pagos.filter((p) => p.quien === id),
        ventas: ventas.filter((v) => v.quien === id),
      })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
      setError(null)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
    }
  }, [fecha])

  useEffect(() => { cargar() }, [cargar])

  if (cargando) return <ActivityIndicator color={Palette.navy} style={{ marginVertical: 16 }} />
  if (error) return <Text style={styles.error}>No se pudo cargar el resumen: {error}</Text>
  if (trabajadores.length === 0) return <Text style={styles.vacio}>Ese día no hubo rutas, cobros ni ventas.</Text>

  const general = totales({
    paradas: trabajadores.flatMap((t) => t.paradas), pagos: trabajadores.flatMap((t) => t.pagos), ventas: trabajadores.flatMap((t) => t.ventas),
  })
  const abrirCliente = (id: string | null) => id && router.push({ pathname: '/cliente/[id]', params: { id } } as any)

  const Cifras = ({ t }: { t: ReturnType<typeof totales> }) => (
    <View style={styles.cifras}>
      <Cifra valor={t.visitados} texto="estaban" color={Palette.green} />
      <Cifra valor={t.noEstaban} texto="no estaban" color={Palette.orange} />
      <Cifra valor={t.sinVisitar} texto="sin visitar" color={Palette.textMuted} />
      <Cifra valor={t.pagaron} texto="pagaron" color={Palette.navy} />
    </View>
  )
  const Montos = ({ t, claro }: { t: ReturnType<typeof totales>; claro?: boolean }) => (
    <View style={{ gap: 2 }}>
      <Text style={[styles.monto, claro && { color: Palette.onNavy }]}>Cobrado: {clp(t.efectivo + t.transferencia)}
        <Text style={[styles.montoSub, claro && { color: Palette.onNavyMuted }]}>  (efectivo {clp(t.efectivo)} · transferencia {clp(t.transferencia)})</Text>
      </Text>
      <Text style={[styles.monto, claro && { color: Palette.onNavy }]}>Vendido: {clp(t.vendido)}
        <Text style={[styles.montoSub, claro && { color: Palette.onNavyMuted }]}>  ({t.ventas} {t.ventas === 1 ? 'venta' : 'ventas'})</Text>
      </Text>
      {Object.keys(t.productos).length > 0 && (
        <Text style={[styles.montoSub, claro && { color: Palette.onNavyMuted }]}>
          {Object.entries(t.productos).map(([n, c]) => `${c} × ${n}`).join(' · ')}
        </Text>
      )}
    </View>
  )

  return (
    <View style={{ gap: 10 }}>
      {/* Total del día */}
      <View style={styles.general}>
        <Text style={styles.generalTitulo}>Resumen del día · {trabajadores.length} {trabajadores.length === 1 ? 'trabajador' : 'trabajadores'}</Text>
        <View style={styles.cifras}>
          <Cifra valor={general.visitados} texto="estaban" color={Palette.onNavy} />
          <Cifra valor={general.noEstaban} texto="no estaban" color={Palette.onNavy} />
          <Cifra valor={general.sinVisitar} texto="sin visitar" color={Palette.onNavy} />
          <Cifra valor={general.pagaron} texto="pagaron" color={Palette.onNavy} />
        </View>
        <Montos t={general} claro />
      </View>

      {trabajadores.map((t) => {
        const tt = totales(t)
        const abierto = abiertos.includes(t.id)
        const enRuta = new Set(t.paradas.map((p) => p.cliente_id))
        const fuera = [...t.pagos.filter((p) => !p.cliente_id || !enRuta.has(p.cliente_id)).map((p) => p.cliente_id ?? p.id),
          ...t.ventas.filter((v) => !v.cliente_id || !enRuta.has(v.cliente_id)).map((v) => v.cliente_id ?? v.id)]
        const fueraUnicos = Array.from(new Set(fuera))
        return (
          <View key={t.id} style={styles.card}>
            <Pressable style={styles.cardTop} onPress={() => setAbiertos((a) => (abierto ? a.filter((x) => x !== t.id) : [...a, t.id]))}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.nombre}>{t.nombre}{t.paradas.length ? ` · ${t.paradas.length} ${t.paradas.length === 1 ? 'cliente' : 'clientes'}` : ''}</Text>
                <Cifras t={tt} />
                <Montos t={tt} />
              </View>
              <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={20} color={Palette.navy} />
            </Pressable>

            {abierto && (
              <View style={{ gap: 6 }}>
                {t.paradas.map((p) => {
                  const e = ESTADO[p.estado] ?? ESTADO.pendiente
                  const pagado = t.pagos.filter((x) => x.cliente_id === p.cliente_id).reduce((s, x) => s + x.monto, 0)
                  const vendido = t.ventas.filter((x) => x.cliente_id === p.cliente_id).reduce((s, x) => s + x.monto, 0)
                  return (
                    <Pressable key={p.id} style={styles.fila} onPress={() => abrirCliente(p.cliente_id)}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.cliente} numberOfLines={1}>{p.cliente?.nombre ?? 'Cliente'}</Text>
                        {(pagado > 0 || vendido > 0) && (
                          <Text style={styles.detalle}>{[pagado > 0 && `Pagó ${clp(pagado)}`, vendido > 0 && `Compró ${clp(vendido)}`].filter(Boolean).join(' · ')}</Text>
                        )}
                      </View>
                      <View style={[styles.pill, { backgroundColor: e.fondo }]}><Text style={[styles.pillText, { color: e.color }]}>{e.texto}</Text></View>
                    </Pressable>
                  )
                })}
                {fueraUnicos.length > 0 && <Text style={styles.subtitulo}>Fuera de la ruta</Text>}
                {fueraUnicos.map((cid) => {
                  const ps = t.pagos.filter((x) => (x.cliente_id ?? x.id) === cid)
                  const vv = t.ventas.filter((x) => (x.cliente_id ?? x.id) === cid)
                  const nombre = ps[0]?.cliente ?? vv[0]?.cliente ?? 'Cliente'
                  const pagado = ps.reduce((s, x) => s + x.monto, 0)
                  const vendido = vv.reduce((s, x) => s + x.monto, 0)
                  return (
                    <Pressable key={cid} style={styles.fila} onPress={() => abrirCliente(ps[0]?.cliente_id ?? vv[0]?.cliente_id ?? null)}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.cliente} numberOfLines={1}>{nombre}</Text>
                        <Text style={styles.detalle}>{[pagado > 0 && `Pagó ${clp(pagado)}`, vendido > 0 && `Compró ${clp(vendido)}`].filter(Boolean).join(' · ')}</Text>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

const Cifra = ({ valor, texto, color }: { valor: number; texto: string; color: string }) => (
  <View style={styles.cifra}>
    <Text style={[styles.cifraValor, { color }]}>{valor}</Text>
    <Text style={[styles.cifraTexto, { color }]}>{texto}</Text>
  </View>
)

const styles = StyleSheet.create({
  error: { color: Palette.amber, fontSize: 13 },
  vacio: { color: Palette.textMuted, fontSize: 13 },
  general: { backgroundColor: Palette.navy, borderRadius: 16, padding: 14, gap: 10 },
  generalTitulo: { color: Palette.onNavyMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  cifras: { flexDirection: 'row', gap: 6 },
  cifra: { flex: 1, alignItems: 'center' },
  cifraValor: { fontSize: 18, fontWeight: '900' },
  cifraTexto: { fontSize: 11, fontWeight: '700' },
  monto: { fontSize: 14, fontWeight: '800', color: Palette.text },
  montoSub: { fontSize: 12, fontWeight: '600', color: Palette.textMuted },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  nombre: { fontSize: 16, fontWeight: '800', color: Palette.navy },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Palette.cream, borderRadius: 12, padding: 10 },
  cliente: { fontSize: 14, fontWeight: '700', color: Palette.text },
  detalle: { fontSize: 12, fontWeight: '700', color: Palette.green },
  subtitulo: { fontSize: 12, fontWeight: '800', color: Palette.textMuted, textTransform: 'uppercase', marginTop: 4 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '800' },
})

export default ResumenDia
