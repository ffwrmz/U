import { pareja } from '@/lib/furgones'
import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { clp } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Historial (gerente): ventas y pagos en una tabla tipo planilla, con filtros y totales al pie.
// Lee ventas_pedidos (con sus productos) y pagos; los nombres de los trabajadores salen de perfiles.

interface Fila {
  key: string
  ventaId: string | null
  fecha: string // ISO
  cliente: string
  trabajadorId: string | null
  acompananteId?: string | null // compañero de furgón
  tipo: 'Venta' | 'Pago'
  productos: string
  total: number | null
  descuento: number | null
  pagado: number | null
  metodo: string
  saldo: number | null
  anulada: boolean
}

type Rango = 'hoy' | '7' | 'mes' | 'todo'
const RANGOS: [Rango, string][] = [['hoy', 'Hoy'], ['7', '7 días'], ['mes', 'Este mes'], ['todo', 'Todo']]

const desdeRango = (r: Rango) => {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (r === '7') d.setDate(d.getDate() - 6)
  if (r === 'mes') d.setDate(1)
  return r === 'todo' ? null : d.toISOString()
}

// Fecha y hora de Chile
const fechaHora = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(iso).toLocaleString('es-CL')
  }
}

const COLS = [
  { k: 'fecha', t: 'Fecha', w: 104 },
  { k: 'cliente', t: 'Cliente', w: 130 },
  { k: 'trabajador', t: 'Trabajador', w: 120 },
  { k: 'tipo', t: 'Tipo', w: 56 },
  { k: 'productos', t: 'Productos', w: 170 },
  { k: 'total', t: 'Total', w: 84, num: true },
  { k: 'descuento', t: 'Desc.', w: 70, num: true },
  { k: 'pagado', t: 'Pagado', w: 80, num: true },
  { k: 'metodo', t: 'Método', w: 70 },
  { k: 'saldo', t: 'Saldo', w: 80, num: true },
] as const
const ANCHO = COLS.reduce((n, c) => n + c.w, 0)

const Historial = () => {
  const router = useRouter()
  const [filas, setFilas] = useState<Fila[]>([])
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rango, setRango] = useState<Rango>('7')
  const [tipo, setTipo] = useState<'todo' | 'Venta' | 'Pago'>('todo')
  const [trabajador, setTrabajador] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const desde = desdeRango(rango)
      let qv = supabase.from('ventas_pedidos')
        .select('*, clientes ( nombre ), venta_items ( cantidad, productos ( nombre ) )')
        .order('creado_en', { ascending: false }).limit(500)
      let qp = supabase.from('pagos')
        .select('*, venta:ventas_pedidos ( id, saldo_pendiente, clientes ( nombre ) )')
        .order('creado_en', { ascending: false }).limit(500)
      if (desde) { qv = qv.gte('creado_en', desde); qp = qp.gte('creado_en', desde) }
      let [vs, ps] = await Promise.all([qv, qp])
      // Sin la columna del descuento sobre el total (migración pendiente): se pide sin ella
      if (vs.error && /descuento_monto/.test(vs.error.message)) {
        let q2 = supabase.from('ventas_pedidos')
          .select('id, creado_en, fecha_venta, vendedor_id, monto_total, saldo_pendiente, estado_pago, descripcion, clientes ( nombre ), venta_items ( cantidad, productos ( nombre ) )')
          .order('creado_en', { ascending: false }).limit(500)
        if (desde) q2 = q2.gte('creado_en', desde)
        vs = (await q2) as any
      }
      if (vs.error) throw vs.error
      if (ps.error) throw ps.error
      const ventas: Fila[] = ((vs.data as any[]) || []).map((v) => ({
        key: 'v' + v.id, ventaId: v.id, fecha: v.creado_en ?? v.fecha_venta, cliente: v.clientes?.nombre ?? '—', trabajadorId: v.vendedor_id, acompananteId: v.acompanante_id ?? null,
        tipo: 'Venta',
        productos: ((v.venta_items as any[]) || []).map((i) => `${i.cantidad}× ${i.productos?.nombre ?? 'Producto'}`).join(', ') || v.descripcion || '',
        total: Number(v.monto_total), descuento: Number(v.descuento_monto ?? 0) || null, pagado: null, metodo: '',
        saldo: Number(v.saldo_pendiente), anulada: v.estado_pago === 'anulada',
      }))
      const pagos: Fila[] = ((ps.data as any[]) || []).map((p) => ({
        key: 'p' + p.id, ventaId: p.venta?.id ?? null, fecha: p.creado_en, cliente: p.venta?.clientes?.nombre ?? '—', trabajadorId: p.cobrador_id, acompananteId: p.acompanante_id ?? null,
        tipo: 'Pago', productos: '', total: null, descuento: null, pagado: Number(p.monto_abonado),
        metodo: p.metodo_pago === 'transferencia' ? 'Transf.' : 'Efectivo', saldo: p.venta ? Number(p.venta.saldo_pendiente) : null, anulada: false,
      }))
      const todas = [...ventas, ...pagos].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      setFilas(todas)
      const ids = Array.from(new Set(todas.flatMap((f) => [f.trabajadorId, f.acompananteId]).filter(Boolean))) as string[]
      if (ids.length) {
        const { data } = await supabase.from('perfiles').select('id, nombre').in('id', ids)
        setNombres(Object.fromEntries(((data as any[]) || []).map((x) => [x.id, x.nombre])))
      }
      setError(null)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setCargando(false)
      setRefrescando(false)
    }
  }, [rango])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const visibles = useMemo(() => filas.filter((f) =>
    (tipo === 'todo' || f.tipo === tipo) && (!trabajador || f.trabajadorId === trabajador)), [filas, tipo, trabajador])
  const trabajadores = useMemo(() => Array.from(new Set(filas.map((f) => f.trabajadorId).filter(Boolean))) as string[], [filas])

  const tot = visibles.reduce((t, f) => {
    if (f.tipo === 'Venta' && !f.anulada) { t.vendido += f.total ?? 0; t.descuento += f.descuento ?? 0; t.ventas++ }
    if (f.tipo === 'Pago') { t.cobrado += f.pagado ?? 0; if (f.metodo === 'Efectivo') t.efectivo += f.pagado ?? 0; else t.transf += f.pagado ?? 0; t.pagos++ }
    return t
  }, { vendido: 0, descuento: 0, cobrado: 0, efectivo: 0, transf: 0, ventas: 0, pagos: 0 })

  const celda = (f: Fila, k: typeof COLS[number]['k']) => {
    switch (k) {
      case 'fecha': return fechaHora(f.fecha)
      case 'cliente': return f.cliente
      case 'trabajador': return f.trabajadorId ? pareja((id) => nombres[id]?.split(' ')[0], f.trabajadorId, f.acompananteId) : '—'
      case 'tipo': return f.anulada ? 'Anul.' : f.tipo
      case 'productos': return f.productos
      case 'total': return f.total == null ? '' : clp(f.total)
      case 'descuento': return f.descuento ? clp(f.descuento) : ''
      case 'pagado': return f.pagado == null ? '' : clp(f.pagado)
      case 'metodo': return f.metodo
      case 'saldo': return f.saldo == null ? '' : clp(f.saldo)
    }
  }

  const Chip = ({ activo, texto, onPress }: { activo: boolean; texto: string; onPress: () => void }) => (
    <Pressable style={[styles.chip, activo && styles.chipActivo]} onPress={onPress}>
      <Text style={[styles.chipText, activo && { color: Palette.onNavy }]}>{texto}</Text>
    </Pressable>
  )

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Historial" subtitle="Ventas y pagos" />
      <View style={styles.filtros}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {RANGOS.map(([k, t]) => <Chip key={k} activo={rango === k} texto={t} onPress={() => { setRango(k); setCargando(true) }} />)}
          <View style={styles.sep} />
          {(['todo', 'Venta', 'Pago'] as const).map((k) => <Chip key={k} activo={tipo === k} texto={k === 'todo' ? 'Ventas y pagos' : k === 'Venta' ? 'Ventas' : 'Pagos'} onPress={() => setTipo(k)} />)}
        </ScrollView>
        {trabajadores.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip activo={!trabajador} texto="Todos" onPress={() => setTrabajador(null)} />
            {trabajadores.map((id) => <Chip key={id} activo={trabajador === id} texto={nombres[id] ?? '—'} onPress={() => setTrabajador(id)} />)}
          </ScrollView>
        )}
      </View>

      {cargando ? <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} /> : error ? (
        <Text style={styles.error}>No se pudo cargar el historial: {error}</Text>
      ) : (
        <>
          <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width: ANCHO }}>
            <FlatList
              data={visibles}
              keyExtractor={(f) => f.key}
              stickyHeaderIndices={[0]}
              refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => { setRefrescando(true); cargar() }} tintColor={Palette.navy} />}
              ListHeaderComponent={
                <View style={[styles.fila, styles.cabecera]}>
                  {COLS.map((c) => <Text key={c.k} style={[styles.celda, styles.celdaCab, { width: c.w }, 'num' in c && styles.num]}>{c.t}</Text>)}
                </View>
              }
              ListEmptyComponent={<Text style={styles.vacio}>No hay movimientos con estos filtros.</Text>}
              renderItem={({ item: f, index }) => (
                <Pressable style={[styles.fila, index % 2 === 1 && styles.filaPar, f.anulada && { opacity: 0.5 }]}
                  disabled={!f.ventaId} onPress={() => f.ventaId && router.push({ pathname: '/compra/[id]', params: { id: f.ventaId } } as any)}>
                  {COLS.map((c) => (
                    <Text key={c.k} numberOfLines={1} style={[styles.celda, { width: c.w }, 'num' in c && styles.num,
                      c.k === 'tipo' && { color: f.tipo === 'Pago' ? Palette.green : Palette.navy, fontWeight: '800' },
                      c.k === 'saldo' && (f.saldo ?? 0) > 0 && { color: Palette.orange }]}>
                      {celda(f, c.k)}
                    </Text>
                  ))}
                </Pressable>
              )}
            />
          </ScrollView>
          {/* Totales de lo que se ve */}
          <View style={styles.pie}>
            <View style={styles.pieCol}>
              <Text style={styles.pieLabel}>Vendido ({tot.ventas})</Text>
              <Text style={styles.pieValor}>{clp(tot.vendido)}</Text>
              {tot.descuento > 0 && <Text style={styles.pieSub}>Descuentos {clp(tot.descuento)}</Text>}
            </View>
            <View style={styles.pieCol}>
              <Text style={styles.pieLabel}>Cobrado ({tot.pagos})</Text>
              <Text style={[styles.pieValor, { color: Palette.green }]}>{clp(tot.cobrado)}</Text>
              <Text style={styles.pieSub}>Efectivo {clp(tot.efectivo)} · Transf. {clp(tot.transf)}</Text>
            </View>
          </View>
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  filtros: { paddingTop: 10, gap: 6 },
  chips: { paddingHorizontal: 12, gap: 6, alignItems: 'center' },
  chip: { backgroundColor: Palette.navySoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipActivo: { backgroundColor: Palette.navy },
  chipText: { fontSize: 12, fontWeight: '700', color: Palette.navy },
  sep: { width: 1, height: 20, backgroundColor: Palette.border, marginHorizontal: 4 },
  error: { color: Palette.amber, fontSize: 13, padding: 16 },
  vacio: { color: Palette.textMuted, fontSize: 13, padding: 16 },
  fila: { flexDirection: 'row', backgroundColor: Palette.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Palette.border },
  filaPar: { backgroundColor: Palette.cream },
  cabecera: { backgroundColor: Palette.navy, marginTop: 10 },
  celda: { paddingHorizontal: 6, paddingVertical: 7, fontSize: 12, color: Palette.text, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: Palette.border },
  celdaCab: { color: Palette.onNavy, fontWeight: '800', fontSize: 12 },
  num: { textAlign: 'right' },
  pie: { flexDirection: 'row', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: Palette.border, backgroundColor: Palette.card },
  pieCol: { flex: 1, gap: 2 },
  pieLabel: { fontSize: 12, fontWeight: '700', color: Palette.textMuted },
  pieValor: { fontSize: 17, fontWeight: '900', color: Palette.navy },
  pieSub: { fontSize: 11, color: Palette.textMuted },
})

export default Historial
