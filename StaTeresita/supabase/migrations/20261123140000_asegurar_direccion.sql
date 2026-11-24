-- =====================================================================
-- Santa Teresita: dirección desde la ubicación del casero + ordenar su propia ruta
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- =====================================================================

-- Comparar nombres sin mayúsculas, tildes ni espacios de más ("Colbún" = "colbun ")
create or replace function public._norm(t text)
returns text language sql immutable as $$
  select regexp_replace(lower(translate(btrim(coalesce(t, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g');
$$;

-- 1) Busca o crea comuna → sector → pasaje (tabla calles) y la dirección. Devuelve el id de la dirección.
--    Si la dirección ya existe, solo completa latitud/longitud (y la referencia) cuando estaban vacías.
--    La pueden usar el gerente y los caseros activos (al registrar un cliente).
create or replace function public.asegurar_direccion(
  p_comuna text, p_sector text, p_pasaje text, p_numero text default null, p_referencia text default null,
  p_lat double precision default null, p_lng double precision default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comuna uuid; v_sector uuid; v_calle uuid; v_dir uuid;
  v_numero text := nullif(btrim(coalesce(p_numero, '')), '');
  v_ref text := nullif(btrim(coalesce(p_referencia, '')), '');
begin
  if coalesce(get_rol_usuario(), '') not in ('dueno', 'vendedor') then
    raise exception 'No tienes permiso para crear direcciones' using errcode = '42501';
  end if;
  if _norm(p_comuna) = '' or _norm(p_sector) = '' or _norm(p_pasaje) = '' then
    raise exception 'Faltan la comuna, el sector o el pasaje' using errcode = '22023';
  end if;

  select id into v_comuna from comunas where _norm(nombre) = _norm(p_comuna) order by activo desc limit 1;
  if v_comuna is null then
    insert into comunas (nombre) values (btrim(p_comuna)) returning id into v_comuna;
  else
    update comunas set activo = true where id = v_comuna and not activo;
  end if;

  select id into v_sector from sectores where comuna_id = v_comuna and _norm(nombre) = _norm(p_sector) order by activo desc limit 1;
  if v_sector is null then
    insert into sectores (comuna_id, nombre) values (v_comuna, btrim(p_sector)) returning id into v_sector;
  else
    update sectores set activo = true where id = v_sector and not activo;
  end if;

  select id into v_calle from calles where sector_id = v_sector and _norm(nombre) = _norm(p_pasaje) order by activo desc limit 1;
  if v_calle is null then
    insert into calles (sector_id, nombre) values (v_sector, btrim(p_pasaje)) returning id into v_calle;
  else
    update calles set activo = true where id = v_calle and not activo;
  end if;

  select id into v_dir from direcciones
   where calle_id = v_calle and pasaje_id is null and numero is not distinct from v_numero limit 1;
  if v_dir is null then
    insert into direcciones (sector_id, calle_id, numero, referencia, latitud, longitud)
    values (v_sector, v_calle, v_numero, v_ref, p_lat, p_lng) returning id into v_dir;
  else
    update direcciones
       set latitud = coalesce(latitud, p_lat), longitud = coalesce(longitud, p_lng),
           referencia = coalesce(referencia, v_ref)
     where id = v_dir;
  end if;
  return v_dir;
end $$;
revoke all on function public.asegurar_direccion(text, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.asegurar_direccion(text, text, text, text, text, double precision, double precision) to authenticated;

-- 2) El casero ordena su propia ruta del día (el gerente, cualquiera). Guarda el orden 1, 2, 3... de una vez.
create or replace function public.reordenar_mi_ruta(p_jornada uuid, p_orden uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_rol text := get_rol_usuario(); v_estado text; v_n int;
begin
  if coalesce(v_rol, '') not in ('dueno', 'vendedor') then
    raise exception 'No tienes permiso para ordenar la ruta' using errcode = '42501';
  end if;
  select estado into v_estado from jornadas where id = p_jornada;
  if v_estado is null then raise exception 'Jornada no existe' using errcode = 'P0002'; end if;
  if v_estado = 'finalizada' then raise exception 'La jornada de hoy ya terminó' using errcode = '22023'; end if;
  if v_rol = 'vendedor' and exists (select 1 from jornada_vendedores
       where jornada_id = p_jornada and vendedor_id = auth.uid() and estado = 'finalizada') then
    raise exception 'Tu ruta de hoy ya terminó' using errcode = '22023';
  end if;
  select count(*) into v_n from ruta_paradas
   where jornada_id = p_jornada and id = any(p_orden) and (v_rol = 'dueno' or vendedor_id = auth.uid());
  if v_n <> coalesce(array_length(p_orden, 1), 0) then
    raise exception 'Solo puedes ordenar las paradas de tu propia ruta' using errcode = '42501';
  end if;
  update ruta_paradas r set orden = o.pos
    from unnest(p_orden) with ordinality as o(id, pos)
   where r.id = o.id and r.jornada_id = p_jornada;
end $$;
revoke all on function public.reordenar_mi_ruta(uuid, uuid[]) from public, anon;
grant execute on function public.reordenar_mi_ruta(uuid, uuid[]) to authenticated;
