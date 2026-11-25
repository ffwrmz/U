import Header from '@/components/Header'
import { Palette } from '@/constants/palette'
import { DESCUENTO_POR_DEFECTO, guardarDescuentoGeneral, guardarPermisos, leerDescuentoGeneral, Permisos, permisosDe } from '@/lib/ajustes'
import { esGerente } from '@/lib/roles'
import { supabase } from '@/lib/supabase'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

interface Casero extends Permisos { id: string; nombre: string }

const numero = (t: string) => { const n = Number(t.replace(',', '.')); return isNaN(n) ? null : n }

// Ajustes (solo gerente): descuento máximo que un casero puede dar sin pedir aprobación,
// y los permisos de cada casero (vender, cobrar, crear clientes y su propio límite de descuento).
const Ajustes = () => {
  const [cargando, setCargando] = useState(true)
  const [soyGerente, setSoyGerente] = useState(false)
  const [general, setGeneral] = useState(String(DESCUENTO_POR_DEFECTO))
  const [caseros, setCaseros] = useState<Casero[]>([])
  const [abierto, setAbierto] = useState<string | null>(null)
  const [limites, setLimites] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [faltaSql, setFaltaSql] = useState(false)

  const cargar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', user.id).single()
      setSoyGerente(esGerente(perfil?.rol))
    }
    const [g, ps, aj] = await Promise.all([
      leerDescuentoGeneral(),
      supabase.from('perfiles').select('*').eq('rol', 'vendedor').order('nombre'),
      supabase.from('ajustes').select('id').limit(1),
    ])
    setFaltaSql(!!aj.error)
    setGeneral(String(g))
    const lista = ((ps.data as any[]) || []).filter((p) => p.activo !== false).map((p) => ({ id: p.id, nombre: p.nombre, ...permisosDe(p) }))
    setCaseros(lista)
    setLimites(Object.fromEntries(lista.map((c) => [c.id, c.descuento_max == null ? '' : String(c.descuento_max)])))
    setCargando(false)
  }, [])

  useFocusEffect(useCallback(() => { cargar() }, [cargar]))

  const guardarGeneral = async () => {
    const n = numero(general)
    if (n == null || n < 0 || n > 100) { Alert.alert('Error', 'El descuento debe ser un número entre 0 y 100'); return }
    setOcupado('general')
    try { await guardarDescuentoGeneral(n); Alert.alert('Guardado', `Los caseros pueden dar hasta ${n}% sin pedir aprobación.`) }
    catch (e: any) { Alert.alert('Error', e.message ?? String(e)) }
    finally { setOcupado(null) }
  }

  const cambiar = async (c: Casero, cambios: Partial<Permisos>) => {
    setOcupado(c.id)
    setCaseros((l) => l.map((x) => (x.id === c.id ? { ...x, ...cambios } : x)))
    try { await guardarPermisos(c.id, cambios) }
    catch (e: any) { Alert.alert('Error', e.message ?? String(e)); cargar() }
    finally { setOcupado(null) }
  }

  const guardarLimite = (c: Casero) => {
    const t = (limites[c.id] ?? '').trim()
    if (t === '') { cambiar(c, { descuento_max: null }); return }
    const n = numero(t)
    if (n == null || n < 0 || n > 100) { Alert.alert('Error', 'El descuento debe ser un número entre 0 y 100'); return }
    cambiar(c, { descuento_max: n })
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <Header title="Ajustes" subtitle="Descuentos y permisos de los caseros" />
      {cargando ? <ActivityIndicator size="large" color={Palette.navy} style={{ marginTop: 40 }} /> : !soyGerente ? (
        <Text style={styles.vacio}>Solo el gerente puede cambiar los ajustes.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {faltaSql && (
            <View style={styles.aviso}>
              <Ionicons name="warning-outline" size={18} color={Palette.amber} />
              <Text style={styles.avisoText}>Falta correr en Supabase el archivo 20261125020000_ajustes_permisos.sql para guardar estos ajustes.</Text>
            </View>
          )}

          <Text style={styles.seccion}>Descuentos</Text>
          <View style={styles.card}>
            <Text style={styles.titulo}>Descuento máximo sin aprobación</Text>
            <Text style={styles.sub}>Hasta este porcentaje el casero aplica el descuento solo; si es mayor, se lo pide al gerente.</Text>
            <View style={styles.fila}>
              <View style={styles.inputPct}>
                <TextInput style={styles.input} value={general} onChangeText={setGeneral} keyboardType="decimal-pad" maxLength={5} />
                <Text style={styles.pct}>%</Text>
              </View>
              <Pressable style={[styles.boton, ocupado === 'general' && { opacity: 0.6 }]} disabled={ocupado === 'general'} onPress={guardarGeneral}>
                <Text style={styles.botonText}>Guardar</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.seccion}>Permisos de cada casero</Text>
          {caseros.length === 0 && <Text style={styles.vacio}>No hay caseros activos.</Text>}
          {caseros.map((c) => {
            const open = abierto === c.id
            const resumen = [!c.puede_vender && 'no vende', !c.puede_cobrar && 'no cobra', !c.puede_crear_clientes && 'no crea clientes',
              c.descuento_max != null && `descuento hasta ${c.descuento_max}%`].filter(Boolean).join(' · ') || 'Todo permitido'
            return (
              <View key={c.id} style={styles.card}>
                <Pressable style={styles.filaTop} onPress={() => setAbierto(open ? null : c.id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.titulo}>{c.nombre}</Text>
                    <Text style={styles.sub}>{resumen}</Text>
                  </View>
                  {ocupado === c.id && <ActivityIndicator size="small" color={Palette.navy} />}
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={Palette.navy} />
                </Pressable>
                {open && (
                  <View style={{ gap: 4 }}>
                    {([
                      ['puede_vender', 'Puede registrar ventas'],
                      ['puede_cobrar', 'Puede registrar pagos'],
                      ['puede_crear_clientes', 'Puede crear clientes nuevos'],
                    ] as const).map(([k, t]) => (
                      <View key={k} style={styles.permiso}>
                        <Text style={styles.permisoText}>{t}</Text>
                        <Switch value={c[k]} onValueChange={(v) => cambiar(c, { [k]: v })}
                          trackColor={{ false: Palette.grayPill, true: Palette.green }} thumbColor={Palette.card} />
                      </View>
                    ))}
                    <Text style={[styles.permisoText, { marginTop: 6 }]}>Descuento máximo propio (vacío = el general)</Text>
                    <View style={styles.fila}>
                      <View style={styles.inputPct}>
                        <TextInput style={styles.input} value={limites[c.id] ?? ''} onChangeText={(t) => setLimites((l) => ({ ...l, [c.id]: t }))}
                          keyboardType="decimal-pad" maxLength={5} placeholder={general} placeholderTextColor={Palette.textFaint} />
                        <Text style={styles.pct}>%</Text>
                      </View>
                      <Pressable style={styles.botonSec} onPress={() => guardarLimite(c)}>
                        <Text style={styles.botonSecText}>Guardar</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            )
          })}
          <Text style={styles.nota}>El gerente siempre tiene todos los permisos. Los cambios se aplican al tiro, también en la base de datos.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.cream },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  vacio: { textAlign: 'center', color: Palette.textMuted, marginTop: 20, fontSize: 14 },
  aviso: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: Palette.amberSoft, borderRadius: 12, padding: 12 },
  avisoText: { flex: 1, fontSize: 13, color: Palette.amber, fontWeight: '700' },
  seccion: { fontSize: 13, fontWeight: '800', color: Palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  card: { backgroundColor: Palette.card, borderRadius: 16, borderWidth: 1, borderColor: Palette.border, padding: 14, gap: 8 },
  filaTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titulo: { fontSize: 16, fontWeight: '800', color: Palette.text },
  sub: { fontSize: 13, color: Palette.textMuted },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inputPct: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: Palette.inputFill, borderRadius: 12, paddingHorizontal: 14, height: 48 },
  input: { flex: 1, fontSize: 17, fontWeight: '700', color: Palette.text },
  pct: { fontSize: 17, fontWeight: '800', color: Palette.navy },
  boton: { backgroundColor: Palette.navy, borderRadius: 12, paddingHorizontal: 18, height: 48, justifyContent: 'center' },
  botonText: { color: Palette.onNavy, fontSize: 15, fontWeight: '800' },
  botonSec: { backgroundColor: Palette.navySoft, borderRadius: 12, paddingHorizontal: 18, height: 48, justifyContent: 'center' },
  botonSecText: { color: Palette.navy, fontSize: 15, fontWeight: '800' },
  permiso: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  permisoText: { fontSize: 14, color: Palette.text, flex: 1 },
  nota: { fontSize: 12, color: Palette.textMuted, marginTop: 6 },
})

export default Ajustes
