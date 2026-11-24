-- =====================================================================
-- Santa Teresita: cada casero finaliza SU ruta del día (en Ruta en curso)
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Los clientes que no se visitaron o no estaban pueden pasar a la ruta de mañana: quedan preasignados
-- a ese mismo casero para el día siguiente, marcados "De ayer", y el gerente los ve en Asignar clientes.
-- =====================================================================

alter table public.preasignaciones add column if not exists origen text; -- 'pendiente_ayer' = pasó del día anterior

create or replace function public.finalizar_mi_ruta(p_jornada uuid, p_pasar_a_manana uuid[] default '{}')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha date;
  v_estado text;
  v_n int := 0;
  v_base int;
begin
  if coalesce(get_rol_usuario(), '') not in ('dueno', 'vendedor') then
    raise exception 'No tienes permiso para finalizar la ruta' using errcode = '42501';
  end if;
  select fecha, estado into v_fecha, v_estado from jornadas where id = p_jornada;
  if v_fecha is null then raise exception 'Jornada no existe' using errcode = 'P0002'; end if;
  if not exists (select 1 from ruta_paradas where jornada_id = p_jornada and vendedor_id = auth.uid()) then
    raise exception 'No tienes clientes en esta ruta' using errcode = '22023';
  end if;

  -- Mi ruta queda finalizada (si ya lo estaba, no pasa nada)
  insert into jornada_vendedores (jornada_id, vendedor_id, estado, iniciada_en, finalizada_en)
  values (p_jornada, auth.uid(), 'finalizada', now(), now())
  on conflict (jornada_id, vendedor_id) do update
    set estado = 'finalizada', finalizada_en = coalesce(jornada_vendedores.finalizada_en, now());

  -- Los elegidos (solo de mi ruta y que no se visitaron) pasan a mañana con este mismo casero
  select coalesce(max(orden), 0) into v_base from preasignaciones where fecha = v_fecha + 1;
  with nuevos as (
    insert into preasignaciones (fecha, vendedor_id, cliente_id, orden, nota, origen)
    select v_fecha + 1, auth.uid(), rp.cliente_id, v_base + row_number() over (order by rp.orden),
           case when rp.estado = 'no_estaba' then 'De ayer (no estaba)' else 'De ayer (no se visitó)' end, 'pendiente_ayer'
      from ruta_paradas rp
     where rp.jornada_id = p_jornada and rp.vendedor_id = auth.uid()
       and rp.estado <> 'visitado' and rp.cliente_id = any(coalesce(p_pasar_a_manana, '{}'))
    on conflict (fecha, cliente_id) do nothing
    returning 1
  )
  select count(*) into v_n from nuevos;

  -- Si todas las rutas de ese día ya terminaron, se cierra la jornada
  if v_estado <> 'finalizada' and not exists (
    select 1 from (select distinct vendedor_id from ruta_paradas where jornada_id = p_jornada) v
     where not exists (select 1 from jornada_vendedores jv
                        where jv.jornada_id = p_jornada and jv.vendedor_id = v.vendedor_id and jv.estado = 'finalizada')
  ) then
    update jornadas set estado = 'finalizada', finalizada_en = now() where id = p_jornada;
  end if;
  return v_n;
end $$;
revoke all on function public.finalizar_mi_ruta(uuid, uuid[]) from public, anon;
grant execute on function public.finalizar_mi_ruta(uuid, uuid[]) to authenticated;
