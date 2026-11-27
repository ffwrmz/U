import { Palette } from '@/constants/palette'
import { fechaCorta } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

interface Sol {
  id: string; solicitante_id: string; ubicacion_id: string; producto_id: string
  tipo: 'agregar' | 'devolver' | 'corregir'; cantidad: number; nota: string | null
  estado: string; comentario_gerente: string | null; creado_en: string
}

// Gerente: solicitudes de los caseros para cambiar el inventario de su furgón. Al aprobar se mueve el stock
// (bodega ↔ furgón) con la función resolver_solicitud_inventario; si no alcanza el stock, avisa y queda pendiente.
const SolicitudesInventario = () => {
  const [lista, setLista] = useState<Sol[]>([])
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [stock, setStock] = useState<Record<string, number>>({}) // `${ubicacion}:${producto}` → cantidad
  const [bodega, setBodega] = useState<string | null>(null)
  const [verResueltas, setVerResueltas] = useState(false)
  const [comentarios, setComentarios] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    let q = supabase.from('solicitudes_inventario').select('*')
    q = verResueltas ? q.neq('estado', 'pendiente').order('resuelta_en', { ascending: false }).limit(50) : q.eq('estado', 'pendiente').order('creado_en')
    const { data, error: e } = await q
    if (e) { setError(e.message); setCargando(false); return }
    const l = (data as Sol[]) || []
    setLista(l)
    setError(null)
    const ids = (k: keyof Sol) => Array.from(new Set(l.map((x) => x[k] as string)))
    const [pe, pr, ub, st] = await Promise.all([
      ids('solicitante_id').length ? supabase.from('perfiles').select('id, nombre').in('id', ids('solicitante_id')) : Promise.resolve({ data: [] } as any),
      ids('producto_id').length ? supabase.from('productos').select('id, nombre').in('id', ids('producto_id')) : Promise.resolve({ data: [] } as any),
      supabase.from('ubicaciones_inventario').select('id, nombre, tipo'),
      ids('producto_id').length ? supabase.from('inventario_stock').select('ubicacion_id, producto_id, cantidad').in('producto_id', ids('producto_id')) : Promise.resolve({ data: [] } as any),
    ])
    const n: Record<string, string> = {}
    ;[...((pe as any).data || []), ...((pr as any).data || []), ...((ub as any).data || [])].forEach((x: any) => { n[x.id] = x.nombre })
    setNombres(n)
    setBodega((((ub as any).data || []) as any[]).find((u) => u.tipo === 'bodega')?.id ?? null)
    setStock(Object.fromEntries((((st as any).data || []) as any[]).map((x) => [`${x.ubicacion_id}:${x.producto_id}`, Number(x.cantidad)])))
    setCargando(false)
  }, [verResueltas])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))
  useEffect(() => {
    const canal = supabase.channel(`inv-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_inventario' }, () => cargar()).subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [cargar])

  const resolver = async (s: Sol, aprobar: boolean) => {
    setProcesando(s.id)
    const { error: e } = await supabase.rpc('resolver_solicitud_inventario', { p_id: s.id, p_aprobar: aprobar, p_comentario: comentarios[s.id]?.trim() || null })
    setProcesando(null)
    if (e) { Alert.alert('No se pudo resolver', e.message); return }
    cargar()
  }

  const texto = (s: Sol) => s.tipo === 'agregar' ? `Agregar ${s.cantidad} desde la bodega` : s.tipo === 'devolver' ? `Devolver ${s.cantidad} a la bodega` : `Dejar el furgón en ${s.cantidad}`

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.tabs}>
        {([false, true] as const).map((r) => (
          <Pressable key={String(r)} style={[styles.tab, verResueltas === r && styles.tabSel]} onPress={() => { setVerResueltas(r); setCargando(true) }}>
            <Text style={[styles.tabText, verResueltas === r && { color: Palette.onNavy }]}>{r ? 'Historial' : 'Pendientes'}</Text>
          </Pressable>
        ))}
      </View>
      {cargando ? <ActivityIndicator color={Palette.navy} style={{ marginTop: 20 }} /> : error ? (
        <Text style={styles.vacio}>{/solicitudes_inventario/.test(error) ? 'Falta correr en Supabase el archivo 20261125040000_fuera_de_ruta_inventario.sql.' : `No se pudo cargar: ${error}`}</Text>
      ) : lista.length === 0 ? (
        <Text style={styles.vacio}>{verResueltas ? 'Aún no hay solicitudes resueltas.' : 'No hay solicitudes de inventario pendientes.'}</Text>
      ) : lista.map((s) => (
        <View key={s.id} style={styles.card}>
          <Text style={styles.tipo}>{nombres[s.producto_id] ?? 'Producto'}</Text>
          <Text style={styles.titulo}>{texto(s)}</Text>
          <Text style={styles.sub}>Pide: {nombres[s.solicitante_id] ?? 'Casero'} · {nombres[s.ubicacion_id] ?? 'Furgón'} · {fechaCorta(s.creado_en)}</Text>
          <Text style={styles.sub}>
            Ahora: furgón {stock[`${s.ubicacion_id}:${s.producto_id}`] ?? 0}{bodega ? ` · bodega ${stock[`${bodega}:${s.producto_id}`] ?? 0}` : ''}
          </Text>
          {!!s.nota && <Text style={styles.nota}>“{s.nota}”</Text>}
          {s.estado === 'pendiente' ? (
            <>
              <TextInput style={styles.input} value={comentarios[s.id] ?? ''} onChangeText={(t) => setComentarios((c) => ({ ...c, [s.id]: t }))}
                placeholder="Comentario (opcional)" placeholderTextColor={Palette.textFaint} />
              <View style={styles.botones}>
                <Pressable style={[styles.boton, styles.rechazar]} disabled={!!procesando} onPress={() => resolver(s, false)}>
                  <Text style={[styles.botonText, { color: Palette.navy }]}>Rechazar</Text>
                </Pressable>
                <Pressable style={[styles.boton, styles.aprobar]} disabled={!!procesando} onPress={() => resolver(s, true)}>
                  {procesando === s.id ? <ActivityIndicator color={Palette.onNavy} /> : <Text style={styles.botonText}>Aprobar</Text>}
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={[styles.sub, { fontWeight: '800', color: s.estado === 'aprobada' ? Palette.green : Palette.orangeDark }]}>
              {s.estado === 'aprobada' ? 'Aprobada' : 'Rechazada'}{s.comentario_gerente ? ` · ${s.comentario_gerente}` : ''}
            </Text>
          )}
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 999, backgroundColor: Palette.tealSoft, alignItems: 'center' },
  tabSel: { backgroundColor: Palette.teal },
  tabText: { fontSize: 14, fontWeight: '800', color: Palette.teal },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 30, fontSize: 14 },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, borderLeftWidth: 4, borderLeftColor: Palette.teal, padding: 14, gap: 6 },
  tipo: { fontSize: 13, fontWeight: '800', color: Palette.teal, textTransform: 'uppercase' },
  titulo: { fontSize: 16, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  nota: { fontSize: 14, fontStyle: 'italic', color: Palette.text },
  input: { backgroundColor: Palette.inputFill, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 14, color: Palette.text },
  botones: { flexDirection: 'row', gap: 10 },
  boton: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  rechazar: { backgroundColor: Palette.navySoft },
  aprobar: { backgroundColor: Palette.green },
  botonText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
})

export default SolicitudesInventario
