-- =====================================================================
-- Santa Teresita: el Calendario trabaja solo con clientes (sin casero)
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Las preasignaciones nuevas se guardan sin casero; el casero se elige al asignar la ruta del día.
-- La política pre_leer no cambia: las filas sin casero solo las ve el dueño.
-- =====================================================================
alter table public.preasignaciones alter column vendedor_id drop not null;
