-- =====================================================================
-- Santa Teresita: auditoría de cambios importantes
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Cada vez que se crea, cambia o borra una venta, un producto vendido, un pago, un cliente, un trabajador,
-- un producto, un furgón (y quién va en él) o los ajustes, queda una fila en auditoria_movimientos con
-- quién lo hizo y cómo estaba antes y después. Solo el gerente puede leerla.
-- usuario_id pasa a permitir vacío: los cambios hechos desde el SQL Editor (sin sesión de la app) quedan sin usuario,
-- en vez de inventar uno.
-- Después: select * from pruebas.todas();  (deberían salir 68 PASA: las 66 de antes y AU-01, AU-02)
-- =====================================================================

alter table public.auditoria_movimientos alter column usuario_id drop not null;
create index if not exists auditoria_tabla_registro_idx on public.auditoria_movimientos (tabla_afectada, registro_id);
create index if not exists auditoria_fecha_idx on public.auditoria_movimientos (fecha);

alter table public.auditoria_movimientos enable row level security;
drop policy if exists aud_leer_dueno on public.auditoria_movimientos;
create policy aud_leer_dueno on public.auditoria_movimientos for select to authenticated using (public.es_dueno());

create or replace function public._auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  j_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  j jsonb := coalesce(j_new, j_old);
  v_usuario uuid;
  v_reg text := coalesce(nullif(j->>'id', ''), nullif(j->>'ubicacion_id', ''));
begin
  if tg_op = 'UPDATE' and j_old = j_new then return null; end if; -- no cambió nada
  -- Quién: el usuario de la app; si no hay sesión, quien figura en el registro (si existe)
  v_usuario := coalesce(auth.uid(), nullif(j->>'registrado_por', '')::uuid, nullif(j->>'vendedor_id', '')::uuid,
                        nullif(j->>'cobrador_id', '')::uuid, nullif(j->>'creado_por', '')::uuid);
  if v_usuario is not null and not exists (select 1 from auth.users where id = v_usuario) then v_usuario := null; end if;
  -- Tablas sin id uuid (ej. ajustes, que es una sola fila) quedan con un id fijo
  if v_reg is null or v_reg !~ '^[0-9a-fA-F-]{36}$' then v_reg := '00000000-0000-0000-0000-000000000000'; end if;
  insert into auditoria_movimientos (tabla_afectada, registro_id, accion, usuario_id, datos_anteriores, datos_nuevos)
  values (tg_table_name, v_reg::uuid, tg_op, v_usuario, j_old, j_new);
  return null;
end $$;
revoke all on function public._auditar() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['ventas_pedidos', 'venta_items', 'pagos', 'clientes', 'perfiles', 'productos',
                           'ubicaciones_inventario', 'furgon_trabajadores', 'ajustes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists auditar on public.%I', t);
      execute format('create trigger auditar after insert or update or delete on public.%I for each row execute function public._auditar()', t);
    end if;
  end loop;
end $$;

-- Pruebas AU-01 y AU-02
do $do$ begin
  if exists (select 1 from pg_namespace where nspname = 'pruebas') then
    execute $f$
create or replace function pruebas.auditoria()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $c$
declare g record; f record; v_vend uuid; v uuid; n int; ok boolean;
begin
  select p.id into v_vend from perfiles p where rol = 'vendedor' and activo limit 1;

  id := 'AU-01'; caso := 'Una venta queda registrada en la auditoría'; esperado := '1 fila de auditoría con el casero';
  begin
    g := pruebas._preparar_venta(); perform pruebas._como(v_vend);
    v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), false, 0, 'efectivo', null);
    select count(*) into n from auditoria_movimientos where tabla_afectada = 'ventas_pedidos' and registro_id = v and accion = 'INSERT' and usuario_id = v_vend;
    ok := n = 1;
    raise exception using errcode = 'PT000', message = ok || '|' || n || ' filas';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'AU-02'; caso := 'Un pago queda registrado en la auditoría'; esperado := '1 fila de auditoría con el casero';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    perform registrar_pago(1000, 'efectivo', null, f.va);
    select count(*) into n from auditoria_movimientos a join pagos p on p.id = a.registro_id
     where a.tabla_afectada = 'pagos' and a.accion = 'INSERT' and p.venta_pedido_id = f.va and a.usuario_id = v_vend;
    ok := n = 1;
    raise exception using errcode = 'PT000', message = ok || '|' || n || ' filas';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $c$;
$f$;
    execute 'revoke all on function pruebas.auditoria() from public, anon, authenticated';
    execute $t$
create or replace function pruebas.todas()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language sql as $q$
  select * from pruebas.pagos()
  union all select * from pruebas.pagos_extra()
  union all select * from pruebas.ventas()
  union all select * from pruebas.rutas()
  union all select * from pruebas.correcciones()
  union all select * from pruebas.descuentos()
  union all select * from pruebas.fuera_de_ruta_e_inventario()
  union all select * from pruebas.asignados()
  union all select * from pruebas.furgones()
  union all select * from pruebas.auditoria();
$q$;
$t$;
    execute 'revoke all on function pruebas.todas() from public, anon, authenticated';
  end if;
end $do$;
