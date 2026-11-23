-- =====================================================================
-- Santa Teresita: notificaciones dentro de la app
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Correr DESPUÉS de 20261122020000_solicitudes_correccion.sql (si no, el aviso de correcciones se omite;
-- basta con volver a correr este archivo después).
--   * Al casero: cuando le asignan clientes en su ruta, y cuando le responden una corrección.
--   * Al gerente: cuando un casero pide una corrección o un descuento.
-- Además: mi_cuenta_activa() para que la app saque al trabajador desactivado.
-- =====================================================================

create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  cuerpo text,
  datos jsonb not null default '{}'::jsonb, -- {"ruta": "/solicitudes", ...} pantalla a abrir al tocarla
  leida boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists notificaciones_usuario_idx on public.notificaciones (usuario_id, leida, creado_en desc);

-- Cada uno ve y marca como leídas solo las suyas. Se crean solo desde los triggers de abajo.
alter table public.notificaciones enable row level security;
drop policy if exists notif_leer on public.notificaciones;
create policy notif_leer on public.notificaciones for select to authenticated using (usuario_id = auth.uid());
drop policy if exists notif_marcar on public.notificaciones;
create policy notif_marcar on public.notificaciones for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
drop policy if exists notif_borrar on public.notificaciones;
create policy notif_borrar on public.notificaciones for delete to authenticated using (usuario_id = auth.uid());
revoke insert, update on public.notificaciones from anon, authenticated;
grant select, delete on public.notificaciones to authenticated;
grant update (leida) on public.notificaciones to authenticated;

-- Avisar a todos los gerentes activos (menos a quien hizo la acción)
create or replace function public._notificar_gerentes(p_tipo text, p_titulo text, p_cuerpo text, p_datos jsonb)
returns void language sql security definer set search_path = public as $$
  insert into notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
  select p.id, p_tipo, p_titulo, p_cuerpo, coalesce(p_datos, '{}'::jsonb)
    from perfiles p
   where p.rol = 'dueno' and coalesce(p.activo, true) and p.id is distinct from auth.uid();
$$;
revoke all on function public._notificar_gerentes(text, text, text, jsonb) from public, anon, authenticated;

-- (a) Clientes asignados a la ruta de un casero. Una sola notificación por casero y jornada:
--     si todavía no la lee, se le suma la cantidad (así no le llegan 10 avisos al asignar de a uno).
create or replace function public._notificar_ruta_asignada()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n int;
  v_cuando text;
begin
  for r in
    select n.vendedor_id, n.jornada_id, count(*)::int as cantidad, j.fecha
      from nuevas n join jornadas j on j.id = n.jornada_id
     where n.vendedor_id is distinct from auth.uid()
     group by n.vendedor_id, n.jornada_id, j.fecha
  loop
    v_cuando := case when r.fecha = current_date then 'hoy'
                     when r.fecha = current_date + 1 then 'mañana'
                     else 'el ' || to_char(r.fecha, 'DD-MM') end;
    update notificaciones
       set datos = datos || jsonb_build_object('cantidad', (datos->>'cantidad')::int + r.cantidad),
           creado_en = now()
     where usuario_id = r.vendedor_id and tipo = 'ruta_asignada' and not leida
       and datos->>'jornada_id' = r.jornada_id::text
    returning (datos->>'cantidad')::int into v_n;
    if found then
      update notificaciones
         set cuerpo = 'Tienes ' || v_n || case when v_n = 1 then ' cliente nuevo' else ' clientes nuevos' end || ' en tu ruta de ' || v_cuando || '.'
       where usuario_id = r.vendedor_id and tipo = 'ruta_asignada' and not leida and datos->>'jornada_id' = r.jornada_id::text;
    else
      insert into notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
      values (r.vendedor_id, 'ruta_asignada', 'Te asignaron clientes',
              'Tienes ' || r.cantidad || case when r.cantidad = 1 then ' cliente nuevo' else ' clientes nuevos' end || ' en tu ruta de ' || v_cuando || '.',
              jsonb_build_object('ruta', '/mi-ruta', 'jornada_id', r.jornada_id, 'cantidad', r.cantidad));
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists ruta_paradas_notificar on public.ruta_paradas;
create trigger ruta_paradas_notificar after insert on public.ruta_paradas
  referencing new table as nuevas for each statement execute function public._notificar_ruta_asignada();

-- (b) y (c) Solicitudes de corrección: aviso al gerente al pedirla, y al casero cuando se resuelve
create or replace function public._notificar_correccion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_casero text;
  v_cliente text;
  v_que text;
begin
  select nombre into v_cliente from clientes where id = new.cliente_id;
  v_que := case new.tipo when 'pago' then 'un pago' when 'venta_item' then 'un producto vendido' else 'los datos' end;
  if tg_op = 'INSERT' then
    select nombre into v_casero from perfiles where id = new.solicitado_por;
    perform _notificar_gerentes('correccion_nueva', 'Solicitud de corrección',
      coalesce(v_casero, 'Un casero') || ' pidió corregir ' || v_que || ' de ' || coalesce(v_cliente, 'un cliente') || '.',
      jsonb_build_object('ruta', '/solicitudes', 'solicitud_id', new.id));
  elsif new.estado <> old.estado and new.estado in ('aprobada', 'rechazada') and new.solicitado_por is distinct from auth.uid() then
    insert into notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
    values (new.solicitado_por, 'correccion_resuelta',
            case when new.estado = 'aprobada' then 'Corrección aprobada' else 'Corrección rechazada' end,
            'Tu corrección de ' || v_que || ' de ' || coalesce(v_cliente, 'un cliente') || ' fue ' || new.estado
              || coalesce('. Gerente: ' || new.comentario_gerente, '') || '.',
            jsonb_build_object('ruta', '/cliente/' || new.cliente_id, 'solicitud_id', new.id));
  end if;
  return null;
end $$;

do $$ begin
  if to_regclass('public.solicitudes_correccion') is not null then
    drop trigger if exists solicitudes_correccion_notificar on public.solicitudes_correccion;
    create trigger solicitudes_correccion_notificar after insert or update of estado on public.solicitudes_correccion
      for each row execute function public._notificar_correccion();
  else
    raise notice 'solicitudes_correccion no existe: corre primero 20261122020000_solicitudes_correccion.sql y luego este archivo de nuevo';
  end if;
end $$;

-- (d) Solicitudes de descuento: aviso al gerente
create or replace function public._notificar_descuento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_casero text; v_cliente text; v_prod text;
begin
  select nombre into v_casero from perfiles where id = new.solicitante_id;
  select nombre into v_cliente from clientes where id = new.cliente_id;
  select nombre into v_prod from productos where id = new.producto_id;
  perform _notificar_gerentes('descuento_nuevo', 'Solicitud de descuento',
    coalesce(v_casero, 'Un casero') || ' pidió un descuento en ' || coalesce(v_prod, 'un producto')
      || coalesce(' para ' || v_cliente, '') || '.',
    jsonb_build_object('ruta', '/solicitudes-descuento', 'solicitud_id', new.id));
  return null;
end $$;
do $$ begin
  if to_regclass('public.solicitudes_descuento') is not null then
    drop trigger if exists solicitudes_descuento_notificar on public.solicitudes_descuento;
    create trigger solicitudes_descuento_notificar after insert on public.solicitudes_descuento
      for each row execute function public._notificar_descuento();
  end if;
end $$;

-- ¿Mi cuenta sigue activa? (la app la consulta al abrir, al volver a primer plano y cada minuto)
create or replace function public.mi_cuenta_activa()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select activo and rol is not null from perfiles where id = auth.uid()), false);
$$;
revoke all on function public.mi_cuenta_activa() from public, anon;
grant execute on function public.mi_cuenta_activa() to authenticated;

-- Tiempo real
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notificaciones') then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;
