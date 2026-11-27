-- =====================================================================
-- Santa Teresita: el casero solo le vende y cobra a clientes asignados en su ruta de hoy
-- (o a clientes que él mismo registró hoy). El gerente puede a cualquiera, y registrar a nombre de un casero.
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Requiere 20261125040000_fuera_de_ruta_inventario.sql.
-- Después: select * from pruebas.todas();  (deberían salir 59 PASA: las 55 de antes y A-01..A-04)
-- =====================================================================

-- Fecha de registro de cada cliente (los que ya existen quedan sin fecha: no cuentan como "creados hoy")
alter table public.clientes add column if not exists creado_en timestamptz;
alter table public.clientes alter column creado_en set default now();

-- ¿Puede este casero venderle o cobrarle a este cliente? Sí, si está en su ruta de hoy (asignado por el gerente)
-- o si es un cliente que él mismo registró hoy.
create or replace function public._cliente_permitido_casero(p_casero uuid, p_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ruta_paradas rp join jornadas j on j.id = rp.jornada_id
                  where j.fecha = (now() at time zone 'America/Santiago')::date
                    and rp.vendedor_id = p_casero and rp.cliente_id = p_cliente and not coalesce(rp.fuera_de_ruta, false))
      or exists (select 1 from clientes c where c.id = p_cliente and c.creado_por = p_casero
                  and (c.creado_en at time zone 'America/Santiago')::date = (now() at time zone 'America/Santiago')::date);
$$;
revoke all on function public._cliente_permitido_casero(uuid, uuid) from public, anon, authenticated;

-- Ventas
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
  select id into v_propio from public.ubicaciones_inventario
   where tipo = 'furgon' and activo and responsable_id = v_user limit 1;
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

  insert into public.ventas_pedidos (cliente_id, vendedor_id, monto_total, saldo_pendiente, estado_pago, descripcion,
                                     descuento_tipo, descuento_valor, descuento_monto, registrado_por)
  values (p_cliente, v_user, v_total, v_total, 'pendiente', p_nota, v_dtipo, v_dvalor, v_desc, v_actor)
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

-- Cobros
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
    insert into pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago, registrado_por)
    values (r.id, v_cobrador, v_parte, p_metodo, auth.uid());   -- el trigger descuenta el saldo
    v_resto := v_resto - v_parte;
  end loop;

  perform _visita_fuera_de_ruta(v_cobrador, v_cliente);

  return (select coalesce(sum(saldo_pendiente), 0) from ventas_pedidos
           where cliente_id = v_cliente and estado_pago <> 'anulada');
end $$;

revoke execute on function public.registrar_pago(numeric, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.registrar_pago(numeric, text, uuid, uuid, uuid) to authenticated;

-- Pruebas: los clientes de prueba quedan en la ruta de hoy del casero, y casos A-01..A-04
do $do$ begin
  if exists (select 1 from pg_namespace where nspname = 'pruebas') then
    execute $f$
create or replace function pruebas._preparar(out cli uuid, out va uuid, out vb uuid)
language plpgsql as $$
declare v_dueno uuid; v_vend uuid;
begin
  select id into v_dueno from perfiles where rol = 'dueno' and activo limit 1;
  select id into v_vend  from perfiles where rol = 'vendedor' and activo limit 1;
  insert into clientes (nombre, telefono, rut, creado_por)
  values ('Cliente PRUEBA automatizada', '56900000000', 'T-' || left(replace(gen_random_uuid()::text, '-', ''), 12), v_dueno)
  returning id into cli;
  insert into ventas_pedidos (cliente_id, vendedor_id, monto_total, saldo_pendiente, fecha_venta, descripcion)
  values (cli, v_vend, 10000, 10000, now() - interval '2 days', 'Compra A (antigua)') returning id into va;
  insert into ventas_pedidos (cliente_id, vendedor_id, monto_total, saldo_pendiente, fecha_venta, descripcion)
  values (cli, v_vend, 20000, 20000, now() - interval '1 day', 'Compra B (nueva)') returning id into vb;
  -- El cliente de prueba queda en la ruta de hoy del casero (solo puede venderle o cobrarle a clientes asignados)
  insert into jornadas (fecha, estado) values ((now() at time zone 'America/Santiago')::date, 'en_curso') on conflict (fecha) do nothing;
  insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden)
  select id, v_vend, cli, 999 from jornadas where fecha = (now() at time zone 'America/Santiago')::date;
end $$;
$f$;
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
  insert into ubicaciones_inventario (tipo, nombre, activo, responsable_id)
  values ('furgon', 'Furgón PRUEBA', true, v_vend) returning id into furgon;
  select id into bodega from ubicaciones_inventario where tipo = 'bodega' and activo limit 1;
  insert into inventario_stock (ubicacion_id, producto_id, cantidad) values (furgon, prod, 5), (bodega, prod, 5);
  -- El cliente de prueba queda en la ruta de hoy del casero (solo puede venderle o cobrarle a clientes asignados)
  insert into jornadas (fecha, estado) values ((now() at time zone 'America/Santiago')::date, 'en_curso') on conflict (fecha) do nothing;
  insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden)
  select id, v_vend, cli, 999 from jornadas where fecha = (now() at time zone 'America/Santiago')::date;
end $$;
$f$;
    execute $f$
create or replace function pruebas.asignados()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $c$
declare f record; g record; v_dueno uuid; v_vend uuid; v uuid; err text; ok boolean; n int;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  id := 'A-01'; caso := 'Casero intenta venderle a un cliente que no está en su ruta de hoy'; esperado := 'error: no está en tu ruta, 0 ventas';
  begin
    g := pruebas._preparar_venta(); perform set_config('app.depuracion', '1', true); delete from ruta_paradas where cliente_id = g.cli;
    perform pruebas._como(v_vend); err := null; n := null;
    begin v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), true, 0, 'efectivo', null); exception when others then err := sqlerrm; end;
    select count(*) into n from ventas_pedidos where cliente_id = g.cli;
    raise exception using errcode = 'PT000', message = (err ilike '%no está en tu ruta%' and n = 0)::text || '|' || coalesce(err, 'sin error') || '; ' || coalesce(n, 0) || ' registros';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'A-02'; caso := 'Casero intenta cobrarle a un cliente que no está en su ruta de hoy'; esperado := 'error: no está en tu ruta, 0 pagos';
  begin
    f := pruebas._preparar(); perform set_config('app.depuracion', '1', true); delete from ruta_paradas where cliente_id = f.cli;
    perform pruebas._como(v_vend); err := null; n := null;
    begin perform registrar_pago(1000, 'efectivo', f.cli, null); exception when others then err := sqlerrm; end;
    select count(*) into n from pagos where venta_pedido_id in (f.va, f.vb);
    raise exception using errcode = 'PT000', message = (err ilike '%no está en tu ruta%' and n = 0)::text || '|' || coalesce(err, 'sin error') || '; ' || coalesce(n, 0) || ' registros';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'A-03'; caso := 'Casero le vende a un cliente que él registró hoy (no asignado)'; esperado := 'venta aceptada';
  begin
    g := pruebas._preparar_venta(); perform set_config('app.depuracion', '1', true); delete from ruta_paradas where cliente_id = g.cli;
    update clientes set creado_por = v_vend, creado_en = now() where clientes.id = g.cli;
    perform pruebas._como(v_vend); err := null; n := null;
    begin v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), true, 0, 'efectivo', null); exception when others then err := sqlerrm; end;
    select count(*) into n from ventas_pedidos where cliente_id = g.cli;
    raise exception using errcode = 'PT000', message = (err is null and n = 1)::text || '|' || coalesce(err, 'sin error') || '; ' || coalesce(n, 0) || ' registros';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  id := 'A-04'; caso := 'Gerente le vende a un cliente que no está en ninguna ruta'; esperado := 'venta aceptada';
  begin
    g := pruebas._preparar_venta(); perform set_config('app.depuracion', '1', true); delete from ruta_paradas where cliente_id = g.cli;
    perform pruebas._como(v_dueno); err := null; n := null;
    begin v := registrar_venta(g.cli, g.bodega, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), true, 0, 'efectivo', null); exception when others then err := sqlerrm; end;
    select count(*) into n from ventas_pedidos where cliente_id = g.cli;
    raise exception using errcode = 'PT000', message = (err is null and n = 1)::text || '|' || coalesce(err, 'sin error') || '; ' || coalesce(n, 0) || ' registros';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

end $c$;
$f$;
    execute 'revoke all on function pruebas.asignados() from public, anon, authenticated';
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
  union all select * from pruebas.asignados();
$q$;
$t$;
    execute 'revoke all on function pruebas.todas() from public, anon, authenticated';
  end if;
end $do$;
