-- =====================================================================
-- Santa Teresita: se quitan las rutas de la semana (rutas base por día).
-- Se retomarán más adelante, después del mapa. Borra las rutas base guardadas.
-- =====================================================================
drop function if exists public.preparar_jornada_hoy();
drop function if exists public.cargar_rutas_base(uuid, boolean);
drop table if exists public.rutas_base_paradas;
drop table if exists public.rutas_base;
alter table public.jornadas drop column if exists cargada_desde_base;
