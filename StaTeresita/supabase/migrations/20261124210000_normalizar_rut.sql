-- =====================================================================
-- Santa Teresita: RUT de trabajadores siempre en el mismo formato ("12345678-9", K mayúscula)
-- Supabase > SQL Editor > Run. Se puede correr más de una vez.
-- El inicio de sesión con RUT busca exactamente ese formato. Si el RUT se escribió a mano en la tabla
-- con puntos, sin guion o sin dígito verificador, este archivo lo arregla y desde ahora se corrige solo al guardar.
-- =====================================================================

create or replace function public._dv_rut(cuerpo text)
returns text language plpgsql immutable as $$
declare s int := 0; m int := 2; i int; r int;
begin
  for i in reverse length(cuerpo)..1 loop
    s := s + substr(cuerpo, i, 1)::int * m;
    m := case when m = 7 then 2 else m + 1 end;
  end loop;
  r := 11 - (s % 11);
  return case r when 11 then '0' when 10 then 'K' else r::text end;
end $$;

-- "12.345.678-9" / "123456789" / "12345678" (sin DV) / "12.345.678-k" → "12345678-9"
create or replace function public._normalizar_rut(t text)
returns text language plpgsql immutable as $$
declare l text; cuerpo text; dv text;
begin
  if t is null or btrim(t) = '' then return null; end if;
  if position('-' in t) > 0 then
    cuerpo := regexp_replace(split_part(t, '-', 1), '[^0-9]', '', 'g');
    dv := upper(regexp_replace(split_part(t, '-', 2), '[^0-9kK]', '', 'g'));
    if cuerpo = '' then return null; end if;
    return cuerpo || '-' || coalesce(nullif(dv, ''), _dv_rut(cuerpo));
  end if;
  l := upper(regexp_replace(t, '[^0-9kK]', '', 'g'));
  if l = '' then return null; end if;
  -- Con dígito verificador al final (K, o el último número calza con el cálculo)
  if right(l, 1) = 'K' or (length(l) >= 8 and _dv_rut(left(l, -1)) = right(l, 1)) then
    return left(l, -1) || '-' || right(l, 1);
  end if;
  -- Solo el cuerpo: se calcula el dígito
  return l || '-' || _dv_rut(l);
end $$;

-- Corregir los que ya están
update public.perfiles set rut = _normalizar_rut(rut) where rut is not null and rut is distinct from _normalizar_rut(rut);

-- Y de aquí en adelante, al guardar
create or replace function public._perfiles_normalizar_rut()
returns trigger language plpgsql as $$
begin
  new.rut := _normalizar_rut(new.rut);
  return new;
end $$;
drop trigger if exists perfiles_normalizar_rut on public.perfiles;
create trigger perfiles_normalizar_rut before insert or update of rut on public.perfiles
  for each row execute function public._perfiles_normalizar_rut();

-- Para revisar: cuántos trabajadores activos tienen RUT y cuántos no
select count(*) filter (where rut is not null) as con_rut, count(*) filter (where rut is null) as sin_rut
  from public.perfiles where coalesce(activo, true);
