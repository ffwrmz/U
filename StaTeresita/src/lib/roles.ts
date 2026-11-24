// Roles de perfiles: 'dueno' es el gerente de la app; 'vendedor' es el casero.
export const esGerente = (rol?: string | null) => rol === 'dueno' || rol === 'gerente'
