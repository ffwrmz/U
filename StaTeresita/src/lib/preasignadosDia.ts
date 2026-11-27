// Lista común de preasignados del día para el desplegable de cada trabajador (Asignar clientes).
// - Es la misma lista para todos los trabajadores (a mano, listas fijas y "de ayer").
// - Los que ya están en la ruta de alguien no aparecen en ninguna copia.
// - Los ocultos con la X solo se ocultan en la copia de ESE trabajador.
// - Primero los que eran para ese trabajador, después el resto, en su orden.
export interface PreBasico { cliente_id: string; vendedor_id: string | null; orden: number }

export const preasignadosPara = <T extends PreBasico>(
  lista: T[], caseroId: string, asignados: Set<string>, ocultos: Record<string, string[]>,
): T[] => {
  const mios = new Set(ocultos[caseroId] ?? [])
  return lista
    .filter((p) => !asignados.has(p.cliente_id) && !mios.has(p.cliente_id))
    .sort((a, b) => Number(b.vendedor_id === caseroId) - Number(a.vendedor_id === caseroId) || a.orden - b.orden)
}
