-- =====================================================================
-- Santa Teresita: los clientes de una lista fija pueden quedar sin casero
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Si un cliente de la lista no tiene casero, ese día aparece como preasignado "sin casero"
-- y el gerente elige a quién se lo asigna.
-- =====================================================================
alter table public.listas_fijas_clientes alter column vendedor_id drop not null;
