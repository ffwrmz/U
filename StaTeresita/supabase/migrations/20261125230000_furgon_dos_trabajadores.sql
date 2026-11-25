-- =====================================================================
-- Santa Teresita: hasta 2 trabajadores por furgón. La venta queda a nombre de quien vende y de su compañero
-- de furgón ("Gonzalo - Juan"). El gerente sigue vendiendo solo desde su furgón.
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Requiere las migraciones de hoy (hasta 20261125220000).
-- Los que van en el mismo furgón tienen UNA ruta (la del equipo): ambos la ven, la marcan, la inician y la finalizan.
-- Después: select * from pruebas.todas();  (deberían salir 67 PASA: las 59 de antes y T-01..T-08)
-- =====================================================================

-- 1) Trabajadores de cada furgón (cada trabajador en un solo furgón; máximo 2 por furgón)
create table if not exists public.furgon_trabajadores (
  ubicacion_id uuid not null references public.ubicaciones_inventario(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (ubicacion_id, perfil_id),
  constraint furgon_trabajadores_un_furgon unique (perfil_id)
);
alter table public.furgon_trabajadores enable row level security;
drop policy if exists ft_leer on public.furgon_trabajadores;
create policy ft_leer on public.furgon_trabajadores for select to authenticated using (true);
drop policy if exists ft_dueno on public.furgon_trabajadores;
create policy ft_dueno on public.furgon_trabajadores for all to authenticated using (public.es_dueno()) with check (public.es_dueno());

-- Máximo 2 por furgón
create or replace function public._furgon_max_dos()
returns trigger language plpgsql as $$
begin
  if (select count(*) from furgon_trabajadores where ubicacion_id = new.ubicacion_id and perfil_id <> new.perfil_id) >= 2 then
    raise exception 'Un furgón puede tener como máximo 2 trabajadores' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists furgon_max_dos on public.furgon_trabajadores;
create trigger furgon_max_dos before insert or update on public.furgon_trabajadores
  for each row execute function public._furgon_max_dos();

-- responsable_id del furgón = el primero asignado (compatibilidad con pantallas y funciones antiguas)
create or replace function public._furgon_sincronizar_responsable()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ub uuid := coalesce(new.ubicacion_id, old.ubicacion_id);
begin
  update ubicaciones_inventario set responsable_id = null where id = v_ub;
  update ubicaciones_inventario
     set responsable_id = (select perfil_id from furgon_trabajadores where ubicacion_id = v_ub order by creado_en, perfil_id limit 1)
   where id = v_ub;
  if tg_op = 'UPDATE' and old.ubicacion_id <> new.ubicacion_id then
    update ubicaciones_inventario set responsable_id = null where id = old.ubicacion_id;
    update ubicaciones_inventario
       set responsable_id = (select perfil_id from furgon_trabajadores where ubicacion_id = old.ubicacion_id order by creado_en, perfil_id limit 1)
     where id = old.ubicacion_id;
  end if;
  return null;
end $$;
drop trigger if exists furgon_sincronizar_responsable on public.furgon_trabajadores;
create trigger furgon_sincronizar_responsable after insert or update or delete on public.furgon_trabajadores
  for each row execute function public._furgon_sincronizar_responsable();

-- Pasar los responsables que ya existen a la tabla nueva
insert into public.furgon_trabajadores (ubicacion_id, perfil_id)
select u.id, u.responsable_id from public.ubicaciones_inventario u
 where u.tipo = 'furgon' and u.activo and u.responsable_id is not null
   and exists (select 1 from public.perfiles p where p.id = u.responsable_id)
on conflict do nothing;

-- Furgón asignado a un trabajador (el de furgon_trabajadores; si no, el antiguo responsable_id)
create or replace function public.furgon_de(p_usuario uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ft.ubicacion_id from furgon_trabajadores ft join ubicaciones_inventario u on u.id = ft.ubicacion_id
      where ft.perfil_id = p_usuario and u.tipo = 'furgon' and u.activo limit 1),
    (select id from ubicaciones_inventario where tipo = 'furgon' and activo and responsable_id = p_usuario limit 1));
$$;
grant execute on function public.furgon_de(uuid) to authenticated;

-- Gerente: dejar un furgón con 1 o 2 trabajadores (si alguno estaba en otro furgón, se cambia a este)
create or replace function public.asignar_trabajadores_furgon(p_furgon uuid, p_trabajadores uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not es_dueno() then raise exception 'Solo el gerente asigna furgones' using errcode = '42501'; end if;
  if coalesce(array_length(p_trabajadores, 1), 0) > 2 then
    raise exception 'Un furgón puede tener como máximo 2 trabajadores' using errcode = '22023';
  end if;
  if not exists (select 1 from ubicaciones_inventario where id = p_furgon and tipo = 'furgon') then
    raise exception 'El furgón no existe' using errcode = 'P0002';
  end if;
  delete from furgon_trabajadores where ubicacion_id = p_furgon;
  foreach v in array coalesce(p_trabajadores, '{}') loop
    delete from furgon_trabajadores where perfil_id = v;
    insert into furgon_trabajadores (ubicacion_id, perfil_id, creado_en) values (p_furgon, v, clock_timestamp());
  end loop;
end $$;
revoke all on function public.asignar_trabajadores_furgon(uuid, uuid[]) from public, anon;
grant execute on function public.asignar_trabajadores_furgon(uuid, uuid[]) to authenticated;

-- 2) Compañero de furgón en cada venta y cobro
alter table public.ventas_pedidos add column if not exists acompanante_id uuid references auth.users(id);
alter table public.pagos add column if not exists acompanante_id uuid references auth.users(id);

-- 3) Solicitudes de inventario: las puede hacer cualquiera de los dos del furgón
drop policy if exists si_insertar on public.solicitudes_inventario;
create policy si_insertar on public.solicitudes_inventario for insert to authenticated
  with check (solicitante_id = auth.uid() and estado = 'pendiente' and get_rol_usuario() in ('vendedor', 'dueno')
              and ubicacion_id = public.furgon_de(auth.uid()));

-- 4) Ventas: el furgón del vendedor sale de furgon_trabajadores y se guarda el compañero
create or replace function public.registrar_venta(
  p_cliente uuid,
  p_ubicacion uuid,
  p_items jsonb,
  p_contado boolean,
  p_pie numeric,
  p_metodo text,
  p_nota text,
  p_descuento_tipo text default 'ninguno', -- descuento sobre el TOTAL de la compra: 'ninguno' | 'porcentaje' | 'monto'
  p_descuento_valor numeric default 0,
  p_solicitud uuid default null,          -- solicitud de descuento aprobada (si supera el límite)
  p_vendedor uuid default null            -- solo el gerente: registrar la venta a nombre de otro trabajador
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();                        -- quien registra
  v_user uuid := coalesce(p_vendedor, auth.uid());   -- quien vendió (el gerente puede elegir a otro trabajador)
  v_actor_dueno boolean := public.es_dueno();
  v_rol_real text;
  v_acomp uuid;
  v_rol text;
  v_ub public.ubicaciones_inventario%rowtype;
  v_propio uuid;
  v_item jsonb;
  v_prod public.productos%rowtype;
  v_cant int;
  v_tipo text;
  v_valor numeric;
  v_final numeric;
  v_pct numeric;
  v_limite numeric;
  v_limite_monto numeric;
  v_puede_desc boolean;
  v_tipo_venta text;
  v_dtipo text;
  v_dvalor numeric;
  v_desc numeric := 0;
  v_sol public.solicitudes_descuento%rowtype;
  v_stock int;
  v_total numeric := 0;
  v_pagado numeric;
  v_venta uuid;
  v_metodo text := coalesce(nullif(p_metodo,''), 'efectivo');
begin
  if v_actor is null then raise exception 'Sesión no válida'; end if;
  if v_user <> v_actor and not v_actor_dueno then
    raise exception 'Solo el gerente puede registrar ventas a nombre de otro trabajador';
  end if;
  -- Solo trabajadores activos (un casero desactivado por el gerente ya no puede vender)
  select rol into v_rol from public.perfiles where id = v_user and coalesce(activo, true);
  if v_rol is null or v_rol not in ('dueno','vendedor') then
    if v_user <> v_actor then raise exception 'El trabajador elegido no está activo'; end if;
    raise exception 'No tienes permiso para vender';
  end if;
  -- Permiso del trabajador (Ajustes) y descuento máximo sin aprobación (el del trabajador o el general)
  if v_rol = 'vendedor' and not v_actor_dueno and not coalesce((select puede_vender from public.perfiles where id = v_user), true) then
    raise exception 'No tienes permiso para vender';
  end if;
  v_limite := public.limite_descuento(v_user);
  v_limite_monto := public.limite_descuento_monto(v_user);
  select coalesce(puede_descontar, true), coalesce(tipo_venta, 'ambas') into v_puede_desc, v_tipo_venta
    from public.perfiles where id = v_user;
  -- Tipo de venta permitido (con pie cuenta como crédito)
  v_rol_real := v_rol;
  if v_actor_dueno then v_rol := 'dueno_registra'; end if; -- el gerente registra: sin límites del trabajador
  if v_rol = 'vendedor' and v_tipo_venta = 'contado' and not coalesce(p_contado, false) then
    raise exception 'Solo puedes vender al contado';
  end if;
  if v_rol = 'vendedor' and v_tipo_venta = 'credito' and coalesce(p_contado, false) then
    raise exception 'Solo puedes vender a crédito';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'Cliente no encontrado';
  end if;

  select * into v_ub from public.ubicaciones_inventario where id = p_ubicacion and activo;
  if not found then raise exception 'La ubicación de venta no existe o está inactiva'; end if;

  -- Regla: quien tiene un furgón asignado solo vende desde ese furgón
  v_propio := public.furgon_de(v_user);
  -- El casero solo le vende a clientes de su ruta de hoy (o que él registró hoy). El gerente, a cualquiera.
  if v_rol_real = 'vendedor' and not v_actor_dueno and not public._cliente_permitido_casero(v_user, p_cliente) then
    raise exception 'Este cliente no está en tu ruta de hoy. Pídele al gerente que lo asigne o que registre la venta.';
  end if;

  if v_propio is not null and p_ubicacion <> v_propio then
    if v_user <> v_actor then raise exception 'La venta debe salir del furgón asignado al trabajador elegido'; end if;
    raise exception 'Solo puedes vender con el stock de tu furgón asignado';
  end if;
  if v_propio is null and v_rol_real = 'vendedor' then
    if v_user <> v_actor then raise exception 'El trabajador elegido no tiene un furgón asignado'; end if;
    raise exception 'No tienes un furgón asignado; pide al gerente que te asigne uno';
  end if;

  -- Primera pasada: validar todo y calcular el total
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.productos
     where id = (v_item->>'producto_id')::uuid and activo;
    if not found then raise exception 'Producto no válido'; end if;

    v_cant  := (v_item->>'cantidad')::int;
    v_tipo  := coalesce(v_item->>'descuento_tipo','ninguno');
    v_valor := coalesce((v_item->>'descuento_valor')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en %', v_prod.nombre; end if;
    if v_valor < 0 then raise exception 'Descuento inválido en %', v_prod.nombre; end if;

    if v_tipo = 'porcentaje' and v_valor > 0 then
      if v_valor > 100 then raise exception 'Descuento inválido en %', v_prod.nombre; end if;
      v_final := v_prod.precio_venta * (1 - v_valor/100);
    elsif v_tipo = 'monto' and v_valor > 0 then
      if v_valor > v_prod.precio_venta then raise exception 'Descuento inválido en %', v_prod.nombre; end if;
      v_final := v_prod.precio_venta - v_valor;
    else
      v_final := v_prod.precio_venta; v_valor := 0;
    end if;
    v_final := round(v_final);

    if v_rol = 'vendedor' and v_valor > 0 and not v_puede_desc and nullif(v_item->>'solicitud_id','') is null then
      raise exception 'No tienes permiso para hacer descuentos';
    end if;
    -- Descuento mayor al límite (Ajustes; 10% por defecto) solo con solicitud aprobada (el dueño no necesita)
    v_pct := case when v_prod.precio_venta > 0 then (v_prod.precio_venta - v_final) / v_prod.precio_venta * 100 else 0 end;
    if v_rol = 'vendedor' and v_pct > v_limite + 0.0001 then
      select * into v_sol from public.solicitudes_descuento
       where id = nullif(v_item->>'solicitud_id','')::uuid
         and solicitante_id = v_user and producto_id = v_prod.id
         and estado = 'aprobada' and tipo = v_tipo and valor >= v_valor;
      if not found then
        raise exception 'El descuento de % supera el % y no tiene aprobación', v_prod.nombre,
          (case when v_limite = trunc(v_limite) then trunc(v_limite)::text else v_limite::text end) || '%';
      end if;
    end if;

    if v_prod.controla_stock then
      select cantidad into v_stock from public.inventario_stock
       where ubicacion_id = p_ubicacion and producto_id = v_prod.id;
      if coalesce(v_stock,0) < v_cant then
        raise exception 'Stock insuficiente de % en %', v_prod.nombre, v_ub.nombre;
      end if;
    end if;

    v_total := v_total + v_final * v_cant;
  end loop;

  if v_total <= 0 then raise exception 'El total debe ser mayor a 0'; end if;

  -- Descuento sobre el total de la compra
  v_dtipo := coalesce(nullif(p_descuento_tipo, ''), 'ninguno');
  v_dvalor := coalesce(p_descuento_valor, 0);
  if v_dvalor < 0 then raise exception 'Descuento inválido'; end if;
  if v_dtipo = 'porcentaje' and v_dvalor > 0 then
    if v_dvalor > 100 then raise exception 'Descuento inválido'; end if;
    v_desc := round(v_total * v_dvalor / 100);
  elsif v_dtipo = 'monto' and v_dvalor > 0 then
    v_desc := round(v_dvalor);
  else
    v_dtipo := 'ninguno'; v_dvalor := 0; v_desc := 0;
  end if;
  if v_desc >= v_total then raise exception 'El descuento no puede ser igual o mayor al total'; end if;
  if v_desc > 0 and v_rol = 'vendedor'
     and not (v_puede_desc and v_desc / v_total * 100 <= v_limite + 0.0001 and (v_limite_monto is null or v_desc <= v_limite_monto)) then
    select * into v_sol from public.solicitudes_descuento
     where id = p_solicitud and solicitante_id = v_user and producto_id is null
       and estado = 'aprobada' and tipo = v_dtipo and valor >= v_dvalor
       and (cliente_id is null or cliente_id = p_cliente);
    if not found then
      if not v_puede_desc then raise exception 'No tienes permiso para hacer descuentos'; end if;
      raise exception 'El descuento supera tu límite (%) y no tiene aprobación',
        (case when v_limite = trunc(v_limite) then trunc(v_limite)::text else v_limite::text end) || '%'
          || coalesce(' o $' || trunc(v_limite_monto)::text, '');
    end if;
  end if;
  v_total := v_total - v_desc;

  v_pagado := case when p_contado then v_total else least(greatest(coalesce(p_pie,0),0), v_total) end;

  -- El otro trabajador del furgón (si van dos): la venta se muestra "Trabajador - Trabajador"
  select perfil_id into v_acomp from public.furgon_trabajadores where ubicacion_id = p_ubicacion and perfil_id <> v_user limit 1;
  insert into public.ventas_pedidos (cliente_id, vendedor_id, monto_total, saldo_pendiente, estado_pago, descripcion,
                                     descuento_tipo, descuento_valor, descuento_monto, registrado_por, acompanante_id)
  values (p_cliente, v_user, v_total, v_total, 'pendiente', p_nota, v_dtipo, v_dvalor, v_desc, v_actor, v_acomp)
  returning id into v_venta;

  -- Segunda pasada: guardar items y descontar stock
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.productos where id = (v_item->>'producto_id')::uuid;
    v_cant  := (v_item->>'cantidad')::int;
    v_tipo  := coalesce(v_item->>'descuento_tipo','ninguno');
    v_valor := coalesce((v_item->>'descuento_valor')::numeric, 0);
    if v_tipo = 'porcentaje' and v_valor > 0 then v_final := round(v_prod.precio_venta * (1 - v_valor/100));
    elsif v_tipo = 'monto' and v_valor > 0 then v_final := round(v_prod.precio_venta - v_valor);
    else v_final := v_prod.precio_venta; v_tipo := 'ninguno'; v_valor := 0; end if;

    insert into public.venta_items (venta_pedido_id, producto_id, ubicacion_id, cantidad, precio_lista,
                                    descuento_tipo, descuento_valor, precio_final, solicitud_id)
    values (v_venta, v_prod.id, p_ubicacion, v_cant, v_prod.precio_venta, v_tipo, v_valor, v_final,
            nullif(v_item->>'solicitud_id','')::uuid);

    if nullif(v_item->>'solicitud_id','') is not null then
      update public.solicitudes_descuento set estado = 'usada'
       where id = (v_item->>'solicitud_id')::uuid and estado = 'aprobada';
    end if;

    if v_prod.controla_stock then
      update public.inventario_stock set cantidad = cantidad - v_cant, actualizado_en = now()
       where ubicacion_id = p_ubicacion and producto_id = v_prod.id;
      insert into public.inventario_movimientos (producto_id, ubicacion_origen_id, cantidad, tipo, nota, usuario_id)
      values (v_prod.id, p_ubicacion, v_cant, 'venta', 'Venta ' || v_venta::text, v_user);
    end if;
  end loop;

  if v_desc > 0 and p_solicitud is not null then
    update public.solicitudes_descuento set estado = 'usada' where id = p_solicitud and estado = 'aprobada' and producto_id is null;
  end if;

  if v_pagado > 0 then
    insert into public.pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago, registrado_por)
    values (v_venta, v_user, v_pagado, v_metodo, v_actor);
  end if;

  -- Valores finales fijados explícitamente (por si existe algún trigger en pagos)
  update public.ventas_pedidos
     set saldo_pendiente = v_total - v_pagado,
         estado_pago = case when v_total - v_pagado <= 0 then 'pagada' else 'pendiente' end
   where id = v_venta;

  -- Visita del día: si el cliente no estaba en la ruta de quien vendió, queda como visitado "fuera de ruta"
  -- (solo cuando registra el gerente; un casero ya lo tenía en su ruta o es un cliente nuevo suyo)
  if v_actor_dueno or not exists (select 1 from ruta_paradas rp join jornadas j on j.id = rp.jornada_id
                                   where j.fecha = (now() at time zone 'America/Santiago')::date and rp.cliente_id = p_cliente) then
    perform public._visita_fuera_de_ruta(v_user, p_cliente);
  end if;

  return v_venta;
end;
$$;

revoke all on function public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text, text, numeric, uuid, uuid) from public, anon;
grant execute on function public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text, text, numeric, uuid, uuid) to authenticated;

-- 5) Cobros: también se guarda el compañero de furgón
create or replace function public.registrar_pago(
  p_monto numeric,
  p_metodo text default 'efectivo',
  p_cliente_id uuid default null,
  p_venta_id uuid default null,
  p_vendedor uuid default null)  -- solo el gerente: registrar el cobro a nombre de otro trabajador
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_cliente uuid;
  v_deuda numeric;
  v_resto numeric := p_monto;
  v_parte numeric;
  r record;
  v_cobrador uuid := coalesce(p_vendedor, auth.uid());
  v_acomp uuid := (select ft2.perfil_id from furgon_trabajadores ft1 join furgon_trabajadores ft2 on ft2.ubicacion_id = ft1.ubicacion_id
                    where ft1.perfil_id = coalesce(p_vendedor, auth.uid()) and ft2.perfil_id <> ft1.perfil_id limit 1);
begin
  if coalesce(get_rol_usuario(), '') not in ('dueno', 'vendedor') then
    raise exception 'Sin permiso para registrar pagos' using errcode = '42501';
  end if;
  if v_cobrador <> auth.uid() then
    if get_rol_usuario() is distinct from 'dueno' then
      raise exception 'Solo el gerente puede registrar cobros a nombre de otro trabajador' using errcode = '42501';
    end if;
    if not exists (select 1 from perfiles where id = v_cobrador and coalesce(activo, true) and rol in ('dueno', 'vendedor')) then
      raise exception 'El trabajador elegido no está activo' using errcode = '22023';
    end if;
  end if;
  if get_rol_usuario() = 'vendedor' and not coalesce((select puede_cobrar from perfiles where id = auth.uid()), true) then
    raise exception 'Sin permiso para registrar pagos' using errcode = '42501';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0' using errcode = '22023';
  end if;
  if coalesce(p_metodo, '') not in ('efectivo', 'transferencia') then
    raise exception 'Método de pago inválido' using errcode = '22023';
  end if;
  if (p_cliente_id is null) = (p_venta_id is null) then
    raise exception 'Indica el cliente o la compra (solo uno)' using errcode = '22023';
  end if;

  if p_venta_id is not null then
    select cliente_id into v_cliente from ventas_pedidos where id = p_venta_id;
    if not found then raise exception 'La compra no existe' using errcode = 'P0002'; end if;
  else
    v_cliente := p_cliente_id;
  end if;

  -- El casero solo le cobra a clientes de su ruta de hoy (o que él registró hoy). El gerente, a cualquiera.
  if get_rol_usuario() = 'vendedor' and not _cliente_permitido_casero(auth.uid(), v_cliente) then
    raise exception 'Este cliente no está en tu ruta de hoy. Pídele al gerente que lo asigne o que registre el cobro.' using errcode = '42501';
  end if;

  -- Bloquea las compras con deuda: dos cobros simultáneos no se pisan
  select coalesce(sum(saldo_pendiente), 0) into v_deuda from (
    select saldo_pendiente from ventas_pedidos
     where cliente_id = v_cliente
       and (p_venta_id is null or id = p_venta_id)
       and estado_pago <> 'anulada' and saldo_pendiente > 0
     for update) t;

  if v_deuda = 0 then raise exception 'No hay deuda pendiente' using errcode = '22023'; end if;
  if p_monto > v_deuda then
    raise exception 'El abono (%) supera la deuda (%)', p_monto, v_deuda using errcode = '22023';
  end if;

  for r in
    select id, saldo_pendiente from ventas_pedidos
     where cliente_id = v_cliente
       and (p_venta_id is null or id = p_venta_id)
       and estado_pago <> 'anulada' and saldo_pendiente > 0
     order by fecha_venta, creado_en, id
  loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, r.saldo_pendiente);
    insert into pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago, registrado_por, acompanante_id)
    values (r.id, v_cobrador, v_parte, p_metodo, auth.uid(), v_acomp);   -- el trigger descuenta el saldo
    v_resto := v_resto - v_parte;
  end loop;

  perform _visita_fuera_de_ruta(v_cobrador, v_cliente);

  return (select coalesce(sum(saldo_pendiente), 0) from ventas_pedidos
           where cliente_id = v_cliente and estado_pago <> 'anulada');
end $$;

revoke execute on function public.registrar_pago(numeric, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.registrar_pago(numeric, text, uuid, uuid, uuid) to authenticated;

-- ===== Ruta del EQUIPO del furgón: los que van en el mismo furgón tienen una sola ruta =====
-- Las paradas se guardan a nombre del trabajador principal del furgón (el primero asignado).
create or replace function public._equipo_de(p_perfil uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(ft2.perfil_id order by ft2.creado_en, ft2.perfil_id)
       from furgon_trabajadores ft1 join furgon_trabajadores ft2 on ft2.ubicacion_id = ft1.ubicacion_id
      where ft1.perfil_id = p_perfil),
    array[p_perfil]);
$$;
grant execute on function public._equipo_de(uuid) to authenticated;

create or replace function public._principal_de(p_perfil uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select (public._equipo_de(p_perfil))[1];
$$;
grant execute on function public._principal_de(uuid) to authenticated;

-- El casero ve y marca las paradas de su equipo; ve el estado de la ruta de su equipo
drop policy if exists paradas_leer on public.ruta_paradas;
create policy paradas_leer on public.ruta_paradas for select to authenticated
  using (get_rol_usuario() = 'dueno' or vendedor_id = any(public._equipo_de(auth.uid())));
drop policy if exists paradas_vendedor_marca on public.ruta_paradas;
create policy paradas_vendedor_marca on public.ruta_paradas for update to authenticated
  using (vendedor_id = any(public._equipo_de(auth.uid()))) with check (vendedor_id = any(public._equipo_de(auth.uid())));
drop policy if exists jv_leer on public.jornada_vendedores;
create policy jv_leer on public.jornada_vendedores for select to authenticated
  using (get_rol_usuario() = 'dueno' or vendedor_id = any(public._equipo_de(auth.uid())));

create or replace function public.iniciar_mi_ruta(p_jornada uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_estado text;
begin
  if coalesce(get_rol_usuario(), '') not in ('dueno', 'vendedor') then
    raise exception 'No tienes permiso para iniciar la ruta';
  end if;
  select estado into v_estado from jornadas where id = p_jornada;
  if v_estado is null then raise exception 'Jornada no existe'; end if;
  if v_estado = 'finalizada' then raise exception 'La jornada de hoy ya terminó'; end if;
  if not exists (select 1 from ruta_paradas where jornada_id = p_jornada and vendedor_id = any(_equipo_de(auth.uid()))) then
    raise exception 'No tienes clientes asignados en esta ruta';
  end if;
  -- La ruta del equipo comienza para los dos del furgón
  insert into jornada_vendedores (jornada_id, vendedor_id, estado, iniciada_en)
  select p_jornada, m, 'en_curso', now() from unnest(_equipo_de(auth.uid())) m
  on conflict (jornada_id, vendedor_id) do update set estado = 'en_curso', iniciada_en = coalesce(jornada_vendedores.iniciada_en, now());
end $$;

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
   where jornada_id = p_jornada and id = any(p_orden) and (v_rol = 'dueno' or vendedor_id = any(_equipo_de(auth.uid())));
  if v_n <> coalesce(array_length(p_orden, 1), 0) then
    raise exception 'Solo puedes ordenar las paradas de tu propia ruta' using errcode = '42501';
  end if;
  update ruta_paradas r set orden = o.pos
    from unnest(p_orden) with ordinality as o(id, pos)
   where r.id = o.id and r.jornada_id = p_jornada;
end $$;

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
  if not exists (select 1 from ruta_paradas where jornada_id = p_jornada and vendedor_id = any(_equipo_de(auth.uid()))) then
    raise exception 'No tienes clientes en esta ruta' using errcode = '22023';
  end if;

  -- Mi ruta queda finalizada (si ya lo estaba, no pasa nada)
  insert into jornada_vendedores (jornada_id, vendedor_id, estado, iniciada_en, finalizada_en)
  select p_jornada, m, 'finalizada', now(), now() from unnest(_equipo_de(auth.uid())) m
  on conflict (jornada_id, vendedor_id) do update
    set estado = 'finalizada', finalizada_en = coalesce(jornada_vendedores.finalizada_en, now());

  -- Los elegidos (solo de mi ruta y que no se visitaron) pasan a mañana con este mismo casero
  select coalesce(max(orden), 0) into v_base from preasignaciones where fecha = v_fecha + 1;
  with nuevos as (
    insert into preasignaciones (fecha, vendedor_id, cliente_id, orden, nota, origen)
    select v_fecha + 1, _principal_de(auth.uid()), rp.cliente_id, v_base + row_number() over (order by rp.orden),
           case when rp.estado = 'no_estaba' then 'De ayer (no estaba)' else 'De ayer (no se visitó)' end, 'pendiente_ayer'
      from ruta_paradas rp
     where rp.jornada_id = p_jornada and rp.vendedor_id = any(_equipo_de(auth.uid()))
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

create or replace function public._cliente_permitido_casero(p_casero uuid, p_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ruta_paradas rp join jornadas j on j.id = rp.jornada_id
                  where j.fecha = (now() at time zone 'America/Santiago')::date
                    and rp.vendedor_id = any(_equipo_de(p_casero)) and rp.cliente_id = p_cliente and not coalesce(rp.fuera_de_ruta, false))
      or exists (select 1 from clientes c where c.id = p_cliente and c.creado_por = p_casero
                  and (c.creado_en at time zone 'America/Santiago')::date = (now() at time zone 'America/Santiago')::date);
$$;

create or replace function public._visita_fuera_de_ruta(p_vendedor uuid, p_cliente uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_jor uuid;
begin
  if p_vendedor is null or p_cliente is null then return; end if;
  select id into v_jor from jornadas where fecha = (now() at time zone 'America/Santiago')::date and estado <> 'finalizada';
  if v_jor is null then return; end if;
  if exists (select 1 from ruta_paradas where jornada_id = v_jor and cliente_id = p_cliente) then return; end if;
  insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden, estado, visitado_en, fuera_de_ruta)
  values (v_jor, _principal_de(p_vendedor), p_cliente,
          coalesce((select max(orden) from ruta_paradas where jornada_id = v_jor and vendedor_id = _principal_de(p_vendedor)), 0) + 1,
          'visitado', now(), true)
  on conflict (jornada_id, cliente_id) do nothing;
end $$;

create or replace function public._notificar_ruta_asignada()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n int;
  v_cuando text;
begin
  for r in
    -- El aviso les llega a los dos del furgón
    select e.m as vendedor_id, n.jornada_id, count(*)::int as cantidad, j.fecha
      from nuevas n join jornadas j on j.id = n.jornada_id
      cross join lateral unnest(_equipo_de(n.vendedor_id)) e(m)
     where e.m is distinct from auth.uid() and not coalesce(n.fuera_de_ruta, false)
     group by e.m, n.jornada_id, j.fecha
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

-- 6) Pruebas T-01..T-08 (furgón compartido y ruta del equipo) y ajuste del furgón de prueba
do $do$ begin
  if exists (select 1 from pg_namespace where nspname = 'pruebas') then
    execute $f$
create or replace function pruebas._preparar_venta(out cli uuid, out prod uuid, out furgon uuid, out bodega uuid)
language plpgsql as $$
declare v_dueno uuid; v_vend uuid;
begin
  select id into v_dueno from perfiles where rol = 'dueno' and activo limit 1;
  select id into v_vend  from perfiles where rol = 'vendedor' and activo limit 1;
  insert into clientes (nombre, telefono, rut, creado_por)
  values ('Cliente PRUEBA automatizada', '56900000000', 'T-' || left(replace(gen_random_uuid()::text, '-', ''), 12), v_dueno)
  returning id into cli;
  insert into productos (nombre, precio_venta, controla_stock, activo)
  values ('Producto PRUEBA', 10000, true, true) returning id into prod;
  -- Cada trabajador tiene un solo furgón (un_furgon_por_responsable): si el casero ya tiene uno real,
  -- se le quita solo durante la prueba (todo se deshace al terminar el caso)
  delete from furgon_trabajadores where perfil_id = v_vend;
  update ubicaciones_inventario set responsable_id = null where tipo = 'furgon' and responsable_id = v_vend;
  insert into ubicaciones_inventario (tipo, nombre, activo, responsable_id)
  values ('furgon', 'Furgón PRUEBA', true, v_vend) returning id into furgon;
  insert into furgon_trabajadores (ubicacion_id, perfil_id) values (furgon, v_vend);
  select id into bodega from ubicaciones_inventario where tipo = 'bodega' and activo limit 1;
  insert into inventario_stock (ubicacion_id, producto_id, cantidad) values (furgon, prod, 5), (bodega, prod, 5);
  -- El cliente de prueba queda en la ruta de hoy del casero (solo puede venderle o cobrarle a clientes asignados)
  insert into jornadas (fecha, estado) values ((now() at time zone 'America/Santiago')::date, 'en_curso') on conflict (fecha) do nothing;
  insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden)
  select id, v_vend, cli, 999 from jornadas where fecha = (now() at time zone 'America/Santiago')::date;
end $$;
$f$;
    execute $f$
create or replace function pruebas.furgones()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $c$
declare g record; v_dueno uuid; v_vend uuid; v_otro uuid; v_tercero uuid; v uuid; err text; ok boolean; n int; st int; ac uuid; f2 uuid;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  id := 'T-01'; caso := 'Gerente asigna 2 trabajadores a un furgón'; esperado := '2 trabajadores en el furgón';
  begin
    g := pruebas._preparar_venta(); v_otro := pruebas._usuario_temporal('vendedor');
    perform pruebas._como(v_dueno);
    perform asignar_trabajadores_furgon(g.furgon, array[v_vend, v_otro]);
    select count(*) into n from furgon_trabajadores where ubicacion_id = g.furgon;
    ok := n = 2;
    raise exception using errcode = 'PT000', message = ok || '|' || n || ' trabajadores';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'T-02'; caso := 'Se intenta agregar un tercer trabajador al mismo furgón'; esperado := 'error: máximo 2';
  begin
    g := pruebas._preparar_venta(); v_otro := pruebas._usuario_temporal('vendedor'); v_tercero := pruebas._usuario_temporal('vendedor');
    insert into furgon_trabajadores (ubicacion_id, perfil_id) values (g.furgon, v_otro);
    err := null;
    begin insert into furgon_trabajadores (ubicacion_id, perfil_id) values (g.furgon, v_tercero); exception when others then err := sqlerrm; end;
    ok := err ilike '%como máximo 2%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'T-03'; caso := 'Un trabajador en dos furgones a la vez'; esperado := 'error: ya está en otro furgón';
  begin
    g := pruebas._preparar_venta();
    insert into ubicaciones_inventario (tipo, nombre, activo) values ('furgon', 'Furgón PRUEBA 2', true) returning ubicaciones_inventario.id into f2;
    err := null;
    begin insert into furgon_trabajadores (ubicacion_id, perfil_id) values (f2, v_vend); exception when others then err := sqlerrm; end;
    ok := err is not null;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'T-04'; caso := 'Casero de un furgón compartido vende'; esperado := 'stock del furgón 5→3, acompañante = el otro trabajador';
  begin
    g := pruebas._preparar_venta(); v_otro := pruebas._usuario_temporal('vendedor');
    insert into furgon_trabajadores (ubicacion_id, perfil_id) values (g.furgon, v_otro);
    perform pruebas._como(v_vend);
    v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 2)), true, 0, 'efectivo', null);
    select cantidad into st from inventario_stock where ubicacion_id = g.furgon and producto_id = g.prod;
    select acompanante_id into ac from ventas_pedidos where ventas_pedidos.id = v;
    ok := st = 3 and ac = v_otro;
    raise exception using errcode = 'PT000', message = ok || '|stock ' || st || ', acompañante ' || (ac = v_otro);
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
  id := 'T-05'; caso := 'El compañero de furgón ve y marca una visita de la ruta del equipo'; esperado := 've 1 visita, actualiza 1 fila';
  begin
    g := pruebas._preparar_venta(); v_otro := pruebas._usuario_temporal('vendedor');
    insert into furgon_trabajadores (ubicacion_id, perfil_id, creado_en) values (g.furgon, v_otro, clock_timestamp() + interval '1 second');
    perform pruebas._como(v_otro);
    set local role authenticated;
    select count(*) into n from ruta_paradas where cliente_id = g.cli;
    update ruta_paradas set estado = 'visitado' where cliente_id = g.cli;
    get diagnostics st = row_count;
    reset role;
    ok := n = 1 and st = 1;
    raise exception using errcode = 'PT000', message = ok || '|ve ' || n || ', actualiza ' || st;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'T-06'; caso := 'Un casero de otro equipo intenta ver y marcar esa ruta'; esperado := 've 0, actualiza 0';
  begin
    g := pruebas._preparar_venta(); v_tercero := pruebas._usuario_temporal('vendedor');
    perform pruebas._como(v_tercero);
    set local role authenticated;
    select count(*) into n from ruta_paradas where cliente_id = g.cli;
    update ruta_paradas set estado = 'visitado' where cliente_id = g.cli;
    get diagnostics st = row_count;
    reset role;
    ok := n = 0 and st = 0;
    raise exception using errcode = 'PT000', message = ok || '|ve ' || n || ', actualiza ' || st;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'T-07'; caso := 'El compañero finaliza la ruta: queda finalizada para los dos'; esperado := '2 trabajadores con la ruta finalizada';
  begin
    g := pruebas._preparar_venta(); v_otro := pruebas._usuario_temporal('vendedor');
    insert into furgon_trabajadores (ubicacion_id, perfil_id, creado_en) values (g.furgon, v_otro, clock_timestamp() + interval '1 second');
    perform pruebas._como(v_otro);
    perform finalizar_mi_ruta((select j.id from jornadas j where j.fecha = (now() at time zone 'America/Santiago')::date), '{}');
    select count(*) into n from jornada_vendedores jv join jornadas j on j.id = jv.jornada_id
     where j.fecha = (now() at time zone 'America/Santiago')::date and jv.vendedor_id in (v_vend, v_otro) and jv.estado = 'finalizada';
    ok := n = 2;
    raise exception using errcode = 'PT000', message = ok || '|' || n || ' finalizadas';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'T-08'; caso := 'El compañero le vende a un cliente de la ruta del equipo'; esperado := 'venta aceptada, acompañante = el principal';
  begin
    g := pruebas._preparar_venta(); v_otro := pruebas._usuario_temporal('vendedor');
    insert into furgon_trabajadores (ubicacion_id, perfil_id, creado_en) values (g.furgon, v_otro, clock_timestamp() + interval '1 second');
    perform pruebas._como(v_otro);
    v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), true, 0, 'efectivo', null);
    select acompanante_id into ac from ventas_pedidos where ventas_pedidos.id = v;
    ok := ac = v_vend;
    raise exception using errcode = 'PT000', message = ok || '|acompañante principal ' || (ac = v_vend);
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $c$;
$f$;
    execute 'revoke all on function pruebas.furgones() from public, anon, authenticated';
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
  union all select * from pruebas.furgones();
$q$;
$t$;
    execute 'revoke all on function pruebas.todas() from public, anon, authenticated';
  end if;
end $do$;
