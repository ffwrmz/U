// RUT chileno: limpiar, validar el dígito verificador y mostrar con puntos y guion.

// Solo números y K, sin puntos ni guion: "12.345.678-k" → "12345678K"
export const limpiarRut = (t: string) => t.replace(/[^0-9kK]/g, '').toUpperCase()

export const dvDe = (cuerpo: string) => {
  let suma = 0
  let mul = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const r = 11 - (suma % 11)
  return r === 11 ? '0' : r === 10 ? 'K' : String(r)
}

export const rutValido = (t: string) => {
  const l = limpiarRut(t)
  if (l.length < 2) return false
  const cuerpo = l.slice(0, -1)
  if (!/^\d{6,8}$/.test(cuerpo)) return false
  return dvDe(cuerpo) === l.slice(-1)
}

// Forma guardada en Supabase: "12345678-9"
export const normalizarRut = (t: string) => {
  const l = limpiarRut(t)
  return l.length < 2 ? l : `${l.slice(0, -1)}-${l.slice(-1)}`
}

// Mientras se escribe: "12.345.678-9"
export const formatearRut = (t: string) => {
  const l = limpiarRut(t).slice(0, 9)
  if (l.length < 2) return l
  const cuerpo = l.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cuerpo}-${l.slice(-1)}`
}

