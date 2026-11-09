// Formato de pesos chilenos: 150000 -> "150.000"
export const formatearMiles = (valor: string | number | null | undefined) => {
  const numero = String(valor ?? 0).replace(/\D/g, '')
  return numero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export const clp = (valor: number | null | undefined) => '$' + formatearMiles(Math.round(valor ?? 0))

export const fechaCorta = (fecha?: string | null) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-CL')
}

// Teléfono chileno a solo dígitos con código de país: "+56 9 1234 5678" / "912345678" -> "56912345678".
// Devuelve null si no es un celular válido (569 + 8 dígitos).
export const normalizarTelefono = (valor: string): string | null => {
  let n = valor.replace(/\D/g, '')
  if (n.length === 9 && n.startsWith('9')) n = '56' + n
  return /^569\d{8}$/.test(n) ? n : null
}

// Teléfono guardado ("56912345678", "+56 9 1234 5678", "912345678"...) -> los 9 dígitos que van después de +56.
export const telefonoLocal = (guardado?: string | null) => {
  const n = (guardado ?? '').replace(/\D/g, '')
  if (n.length === 11 && n.startsWith('56')) return n.slice(2)
  return n.slice(-9)
}
