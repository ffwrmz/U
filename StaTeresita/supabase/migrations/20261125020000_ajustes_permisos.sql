-- =====================================================================
-- Santa Teresita: Ajustes y permisos por trabajador (ventas, cobros, clientes, descuentos y tipo de venta),
-- descuento sobre el total de la compra, lista del equipo para WhatsApp y sin correo en perfiles
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Requiere las migraciones anteriores (sobre todo 20261124200000 y 20261123160000).
-- Con los valores por defecto (10% y todo permitido) la app funciona igual que antes y las pruebas siguen pasando.
-- Después: select * from pruebas.todas();  (las nuevas D-01..D-05 también deberían salir PASA)
-- =====================================================================

-- 1) Ajustes generales (una sola fila)
create table if not exists public.ajustes (
  id boolean primary key default true check (id),
  descuento_max_casero numeric not null default 10 check (descuento_max_casero between 0 and 100),
  actualizado_en timestamptz default now()
);
insert into public.ajustes (id) values (true) on conflict (id) do nothing;
alter table public.ajustes enable row level security;
drop policy if exists ajustes_leer on public.ajustes;
create policy ajustes_leer on public.ajustes for select to authenticated using (true);
drop policy if exists ajustes_dueno on public.ajustes;
create policy ajustes_dueno on public.ajustes for update to authenticated using (public.es_dueno()) with check (public.es_dueno());

-- 2) Permisos de cada trabajador (los edita el gerente; la política perfiles_dueno_modificar ya lo permite)
alter table public.perfiles add column if not exists puede_vender boolean not null default true;
alter table public.perfiles add column if not exists puede_cobrar boolean not null default true;
alter table public.perfiles add column if not exists puede_crear_clientes boolean not null default true;
alter table public.perfiles add column if not exists descuento_max numeric check (descuento_max between 0 and 100); -- null = el general
alter table public.perfiles add column if not exists descuento_max_monto numeric check (descuento_max_monto >= 0); -- tope en $ (null = sin tope)
alter table public.perfiles add column if not exists puede_descontar boolean not null default true;
alter table public.perfiles add column if not exists tipo_venta text not null default 'ambas' check (tipo_venta in ('ambas', 'contado', 'credito'));

-- El correo ya no se guarda en perfiles (se entra con RUT; el correo interno queda solo en la cuenta de acceso)
alter table public.perfiles drop column if exists email;

-- Descuento sobre el total de la compra (queda registrado en la venta)
alter table public.ventas_pedidos add column if not exists descuento_tipo text not null default 'ninguno';
alter table public.ventas_pedidos add column if not exists descuento_valor numeric not null default 0;
alter table public.ventas_pedidos add column if not exists descuento_monto numeric not null default 0;
-- Solicitudes de descuento sobre el total: sin producto, con el total de la compra para que el gerente lo vea
alter table public.solicitudes_descuento alter column producto_id drop not null;
alter table public.solicitudes_descuento add column if not exists total_compra numeric;

-- Descuento máximo sin aprobación para un trabajador: el suyo, o el general (10% si no hay ajustes)
create or replace function public.limite_descuento(p_usuario uuid default auth.uid())
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select descuento_max from perfiles where id = p_usuario),
                  (select descuento_max_casero from ajustes where id),
                  10);
$$;
grant execute on function public.limite_descuento(uuid) to authenticated;
create or replace function public.limite_descuento_monto(p_usuario uuid default auth.uid())
returns numeric language sql stable security definer set search_path = public as $$
  select descuento_max_monto from perfiles where id = p_usuario;
$$;
grant execute on function public.limite_descuento_monto(uuid) to authenticated;

-- 3) Equipo (para escribirse por WhatsApp): solo nombre, rol y teléfono de los trabajadores activos
create or replace function public.listar_equipo()
returns table (id uuid, nombre text, rol text, telefono text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre::text, p.rol::text, p.telefono::text from perfiles p
   where coalesce(p.activo, true) and p.rol in ('dueno', 'vendedor')
     and get_rol_usuario() in ('dueno', 'vendedor')
   order by p.nombre;
$$;
revoke all on function public.listar_equipo() from public, anon;
grant execute on function public.listar_equipo() to authenticated;

-- 4) Ventas: límite y permisos de Ajustes, tipo de venta permitido y descuento sobre el total
drop function if exists public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text);
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
  p_solicitud uuid default null           -- solicitud de descuento aprobada (si supera el límite)
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
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
  if v_user is null then raise exception 'Sesión no válida'; end if;
  -- Solo trabajadores activos (un casero desactivado por el gerente ya no puede vender)
  select rol into v_rol from public.perfiles where id = v_user and coalesce(activo, true);
  if v_rol is null or v_rol not in ('dueno','vendedor') then raise exception 'No tienes permiso para vender'; end if;
  -- Permiso del trabajador (Ajustes) y descuento máximo sin aprobación (el del trabajador o el general)
  if v_rol = 'vendedor' and not coalesce((select puede_vender from public.perfiles where id = v_user), true) then
    raise exception 'No tienes permiso para vender';
  end if;
  v_limite := public.limite_descuento(v_user);
  v_limite_monto := public.limite_descuento_monto(v_user);
  select coalesce(puede_descontar, true), coalesce(tipo_venta, 'ambas') into v_puede_desc, v_tipo_venta
    from public.perfiles where id = v_user;
  -- Tipo de venta permitido (con pie cuenta como crédito)
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
  if v_propio is not null and p_ubicacion <> v_propio then
    raise exception 'Solo puedes vender con el stock de tu furgón asignado';
  end if;
  if v_propio is null and v_rol = 'vendedor' then
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

    if v_rol <> 'dueno' and v_valor > 0 and not v_puede_desc and nullif(v_item->>'solicitud_id','') is null then
      raise exception 'No tienes permiso para hacer descuentos';
    end if;
    -- Descuento mayor al límite (Ajustes; 10% por defecto) solo con solicitud aprobada (el dueño no necesita)
    v_pct := case when v_prod.precio_venta > 0 then (v_prod.precio_venta - v_final) / v_prod.precio_venta * 100 else 0 end;
    if v_rol <> 'dueno' and v_pct > v_limite + 0.0001 then
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
  if v_desc > 0 and v_rol <> 'dueno'
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
                                     descuento_tipo, descuento_valor, descuento_monto)
  values (p_cliente, v_user, v_total, v_total, 'pendiente', p_nota, v_dtipo, v_dvalor, v_desc)
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
    insert into public.pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago)
    values (v_venta, v_user, v_pagado, v_metodo);
  end if;

  -- Valores finales fijados explícitamente (por si existe algún trigger en pagos)
  update public.ventas_pedidos
     set saldo_pendiente = v_total - v_pagado,
         estado_pago = case when v_total - v_pagado <= 0 then 'pagada' else 'pendiente' end
   where id = v_venta;

  return v_venta;
end;
$$;

revoke all on function public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text, text, numeric, uuid) from public, anon;
grant execute on function public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text, text, numeric, uuid) to authenticated;

-- 5) Pagos: se respeta "puede cobrar"
create or replace function public.registrar_pago(
  p_monto numeric,
  p_metodo text default 'efectivo',
  p_cliente_id uuid default null,
  p_venta_id uuid default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_cliente uuid;
  v_deuda numeric;
  v_resto numeric := p_monto;
  v_parte numeric;
  r record;
begin
  if coalesce(get_rol_usuario(), '') not in ('dueno', 'vendedor') then
    raise exception 'Sin permiso para registrar pagos' using errcode = '42501';
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
    insert into pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago)
    values (r.id, auth.uid(), v_parte, p_metodo);   -- el trigger descuenta el saldo
    v_resto := v_resto - v_parte;
  end loop;

  return (select coalesce(sum(saldo_pendiente), 0) from ventas_pedidos
           where cliente_id = v_cliente and estado_pago <> 'anulada');
end $$;

revoke execute on function public.registrar_pago(numeric, text, uuid, uuid) from public, anon;
grant execute on function public.registrar_pago(numeric, text, uuid, uuid) to authenticated;

-- 6) Clientes nuevos: se respeta "puede crear clientes"
create or replace function public.registrar_cliente(
  p_id uuid, p_nombre text, p_rut text, p_telefono text,
  p_comuna text, p_sector text, p_pasaje text,
  p_numero text default null, p_referencia text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_texto_direccion text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare v_dir uuid; v_existe uuid;
begin
  if get_rol_usuario() = 'vendedor' and not coalesce((select puede_crear_clientes from perfiles where id = auth.uid()), true) then
    raise exception 'No tienes permiso para registrar clientes' using errcode = '42501';
  end if;
  select id, direccion_id into v_existe, v_dir from clientes where id = p_id;
  if v_existe is not null then
    return jsonb_build_object('cliente_id', p_id, 'direccion_id', v_dir); -- ya estaba (reintento)
  end if;
  v_dir := asegurar_direccion(p_comuna, p_sector, p_pasaje, p_numero, p_referencia, p_lat, p_lng);
  insert into clientes (id, nombre, rut, telefono, direccion_id, direccion, creado_por)
  values (p_id, btrim(p_nombre), btrim(p_rut), p_telefono, v_dir, p_texto_direccion, auth.uid());
  return jsonb_build_object('cliente_id', p_id, 'direccion_id', v_dir);
end $$;
revoke all on function public.registrar_cliente(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text) from public, anon;
grant execute on function public.registrar_cliente(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text) to authenticated;

-- 7) Correcciones: al recalcular una venta se mantiene su descuento sobre el total
create or replace function public.resolver_correccion(p_id uuid, p_aprobar boolean, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s solicitudes_correccion%rowtype;
  v_pago pagos%rowtype;
  v_item venta_items%rowtype;
  v_venta ventas_pedidos%rowtype;
  v_prod_nuevo productos%rowtype;
  v_prod_viejo productos%rowtype;
  v_monto numeric;
  v_cant int;
  v_precio numeric;
  v_total numeric;
  v_pagado numeric;
  v_dir uuid;
begin
  if get_rol_usuario() is distinct from 'dueno' then
    raise exception 'Solo el gerente puede resolver solicitudes de corrección' using errcode = '42501';
  end if;

  select * into s from solicitudes_correccion where id = p_id for update;
  if not found then raise exception 'La solicitud no existe' using errcode = 'P0002'; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud ya fue resuelta' using errcode = '22023'; end if;

  if p_aprobar then
    -- ---------------- Pago ----------------
    if s.tipo = 'pago' then
      select * into v_pago from pagos where id = s.pago_id for update;
      if not found then raise exception 'El pago ya no existe' using errcode = 'P0002'; end if;
      if (s.datos_anteriores->>'monto_abonado')::numeric is distinct from v_pago.monto_abonado then
        raise exception 'El pago cambió desde que se pidió la corrección; revisa y pide de nuevo' using errcode = '22023';
      end if;
      v_monto := (s.datos_nuevos->>'monto_abonado')::numeric;
      if v_monto is null or v_monto < 0 then raise exception 'Monto nuevo inválido' using errcode = '22023'; end if;
      select * into v_venta from ventas_pedidos where id = v_pago.venta_pedido_id for update;

      if v_monto = 0 then
        delete from pagos where id = v_pago.id;
      else
        update pagos set monto_abonado = v_monto where id = v_pago.id;
      end if;

      select coalesce(sum(monto_abonado), 0) into v_pagado from pagos where venta_pedido_id = v_venta.id;
      if v_pagado > v_venta.monto_total then
        raise exception 'Con ese monto lo pagado (%) superaría el total de la compra (%)', v_pagado, v_venta.monto_total using errcode = '22023';
      end if;
      update ventas_pedidos
         set saldo_pendiente = v_venta.monto_total - v_pagado,
             estado_pago = case when estado_pago = 'anulada' then 'anulada'
                                when v_venta.monto_total - v_pagado <= 0 then 'pagada' else 'pendiente' end
       where id = v_venta.id;

    -- ---------------- Producto de una venta ----------------
    elsif s.tipo = 'venta_item' then
      select * into v_item from venta_items where id = s.venta_item_id for update;
      if not found then raise exception 'El producto de la venta ya no existe' using errcode = 'P0002'; end if;
      if (s.datos_anteriores->>'producto_id')::uuid is distinct from v_item.producto_id
         or (s.datos_anteriores->>'cantidad')::int is distinct from v_item.cantidad
         or (s.datos_anteriores->>'precio_final')::numeric is distinct from v_item.precio_final then
        raise exception 'La venta cambió desde que se pidió la corrección; revisa y pide de nuevo' using errcode = '22023';
      end if;
      select * into v_venta from ventas_pedidos where id = v_item.venta_pedido_id for update;
      if v_venta.estado_pago = 'anulada' then raise exception 'La venta está anulada' using errcode = '22023'; end if;
      select * into v_prod_viejo from productos where id = v_item.producto_id;
      select * into v_prod_nuevo from productos where id = coalesce((s.datos_nuevos->>'producto_id')::uuid, v_item.producto_id);
      if not found then raise exception 'Producto nuevo no válido' using errcode = '22023'; end if;
      v_cant := coalesce((s.datos_nuevos->>'cantidad')::int, v_item.cantidad);
      if v_cant < 0 then raise exception 'Cantidad inválida' using errcode = '22023'; end if;
      -- Precio: el indicado; si cambia el producto y no se indica, el precio de lista del producto nuevo
      v_precio := coalesce((s.datos_nuevos->>'precio_final')::numeric,
                           case when v_prod_nuevo.id = v_item.producto_id then v_item.precio_final else v_prod_nuevo.precio_venta end);
      if v_precio < 0 then raise exception 'Precio inválido' using errcode = '22023'; end if;

      -- Stock: devolver lo vendido y descontar lo nuevo en la misma ubicación de la venta
      if v_prod_viejo.controla_stock then
        insert into inventario_stock (ubicacion_id, producto_id, cantidad)
        values (v_item.ubicacion_id, v_item.producto_id, v_item.cantidad)
        on conflict (ubicacion_id, producto_id)
        do update set cantidad = inventario_stock.cantidad + excluded.cantidad, actualizado_en = now();
        insert into inventario_movimientos (producto_id, ubicacion_destino_id, cantidad, tipo, nota, usuario_id)
        values (v_item.producto_id, v_item.ubicacion_id, v_item.cantidad, 'ajuste', 'Corrección de venta ' || v_venta.id || ' (se devuelve)', auth.uid());
      end if;
      if v_cant > 0 and v_prod_nuevo.controla_stock then
        update inventario_stock set cantidad = cantidad - v_cant, actualizado_en = now()
         where ubicacion_id = v_item.ubicacion_id and producto_id = v_prod_nuevo.id and cantidad >= v_cant;
        if not found then raise exception 'Stock insuficiente de % en la ubicación de la venta', v_prod_nuevo.nombre using errcode = '22023'; end if;
        insert into inventario_movimientos (producto_id, ubicacion_origen_id, cantidad, tipo, nota, usuario_id)
        values (v_prod_nuevo.id, v_item.ubicacion_id, v_cant, 'venta', 'Corrección de venta ' || v_venta.id, auth.uid());
      end if;

      if v_cant = 0 then
        delete from venta_items where id = v_item.id;
      else
        update venta_items
           set producto_id = v_prod_nuevo.id, cantidad = v_cant, precio_final = v_precio,
               precio_lista = case when v_prod_nuevo.id = v_item.producto_id then precio_lista else v_prod_nuevo.precio_venta end,
               descuento_tipo = case when v_prod_nuevo.id = v_item.producto_id then descuento_tipo else 'ninguno' end,
               descuento_valor = case when v_prod_nuevo.id = v_item.producto_id then descuento_valor else 0 end
         where id = v_item.id;
      end if;

      -- Nuevo total y saldo (lo ya pagado se mantiene)
      select coalesce(sum(precio_final * cantidad), 0) into v_total from venta_items where venta_pedido_id = v_venta.id;
      -- El descuento sobre el total de la compra se mantiene (sin dejar el total negativo)
      if v_total > 0 then v_total := greatest(v_total - coalesce(v_venta.descuento_monto, 0), 1); end if;
      select coalesce(sum(monto_abonado), 0) into v_pagado from pagos where venta_pedido_id = v_venta.id;
      if v_total = 0 then
        update ventas_pedidos set estado_pago = 'anulada', saldo_pendiente = 0 where id = v_venta.id;
      else
        if v_pagado > v_total then
          raise exception 'Lo ya pagado (%) supera el nuevo total de la venta (%); primero corrige los pagos', v_pagado, v_total using errcode = '22023';
        end if;
        update ventas_pedidos
           set monto_total = v_total, saldo_pendiente = v_total - v_pagado,
               estado_pago = case when v_total - v_pagado <= 0 then 'pagada' else 'pendiente' end
         where id = v_venta.id;
      end if;

    -- ---------------- Datos del cliente ----------------
    elsif s.tipo = 'cliente' then
      if s.datos_nuevos ? 'telefono' then
        if not exists (select 1 from clientes where id = s.cliente_id
                        and telefono is not distinct from (s.datos_anteriores->>'telefono')) then
          raise exception 'El teléfono cambió desde que se pidió la corrección' using errcode = '22023';
        end if;
        update clientes set telefono = s.datos_nuevos->>'telefono' where id = s.cliente_id;
      end if;
      if s.datos_nuevos ? 'referencia' then
        select direccion_id into v_dir from clientes where id = s.cliente_id;
        if v_dir is null then raise exception 'El cliente no tiene dirección para guardar las indicaciones' using errcode = '22023'; end if;
        update direcciones set referencia = nullif(btrim(s.datos_nuevos->>'referencia'), '') where id = v_dir;
      end if;
    end if;
  end if;

  update solicitudes_correccion
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         revisado_por = auth.uid(), revisado_en = now(), comentario_gerente = nullif(btrim(coalesce(p_comentario, '')), '')
   where id = p_id;

  -- Registro en auditoría (si la tabla tiene otra forma, no bloquea la corrección)
  begin
    insert into auditoria_movimientos (tabla_afectada, registro_id, accion, usuario_id, datos_anteriores, datos_nuevos)
    values ('solicitudes_correccion', p_id, 'UPDATE', auth.uid(),
            jsonb_build_object('tipo', s.tipo, 'datos', s.datos_anteriores),
            jsonb_build_object('aprobada', p_aprobar, 'datos', s.datos_nuevos, 'comentario', p_comentario));
  exception when undefined_table or undefined_column or check_violation or not_null_violation then null;
  end;
end $$;

revoke all on function public.resolver_correccion(uuid, boolean, text) from public, anon;
grant execute on function public.resolver_correccion(uuid, boolean, text) to authenticated;

-- 8) Ventas guardadas sin conexión: también llevan el descuento sobre el total
create or replace function public.ejecutar_accion_offline(p_id uuid, p_tipo text, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v jsonb; a jsonb := coalesce(p_args, '{}'::jsonb);
begin
  select resultado into v from acciones_offline where id = p_id;
  if found then return v; end if;

  if p_tipo = 'registrar_pago' then
    v := to_jsonb(registrar_pago((a->>'p_monto')::numeric, a->>'p_metodo', (a->>'p_cliente_id')::uuid, (a->>'p_venta_id')::uuid));
  elsif p_tipo = 'registrar_venta' then
    v := to_jsonb(registrar_venta((a->>'p_cliente')::uuid, (a->>'p_ubicacion')::uuid, coalesce(a->'p_items', '[]'::jsonb),
                                  coalesce((a->>'p_contado')::boolean, false), coalesce((a->>'p_pie')::numeric, 0),
                                  coalesce(a->>'p_metodo', 'efectivo'), a->>'p_nota',
                                  coalesce(a->>'p_descuento_tipo', 'ninguno'), coalesce((a->>'p_descuento_valor')::numeric, 0),
                                  (a->>'p_solicitud')::uuid));
  elsif p_tipo = 'registrar_cliente' then
    v := registrar_cliente((a->>'p_id')::uuid, a->>'p_nombre', a->>'p_rut', a->>'p_telefono',
                           a->>'p_comuna', a->>'p_sector', a->>'p_pasaje', a->>'p_numero', a->>'p_referencia',
                           (a->>'p_lat')::double precision, (a->>'p_lng')::double precision, a->>'p_texto_direccion');
  else
    raise exception 'Acción no soportada: %', p_tipo using errcode = '22023';
  end if;

  insert into acciones_offline (id, tipo, resultado) values (p_id, p_tipo, v);
  return v;
end $$;
revoke all on function public.ejecutar_accion_offline(uuid, text, jsonb) from public, anon;
grant execute on function public.ejecutar_accion_offline(uuid, text, jsonb) to authenticated;

-- 9) Pruebas automatizadas D-01..D-05 (descuento sobre el total y permisos). Uso: select * from pruebas.descuentos();
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'pruebas') then
    execute $f$
create or replace function pruebas.descuentos()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $c$
declare
  g record; v_dueno uuid; v_vend uuid; v uuid; v_sol uuid; tot numeric; dm numeric; err text; ok boolean; est text;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  -- D-01: 10% sobre el total, dentro del límite
  id := 'D-01'; caso := 'Casero da 10% sobre el total de una compra de $20.000'; esperado := 'venta aceptada, total 18000, descuento 2000';
  begin
    g := pruebas._preparar_venta(); perform pruebas._como(v_vend);
    v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 2)), false, 0, 'efectivo', null, 'porcentaje', 10, null);
    select monto_total, descuento_monto into tot, dm from ventas_pedidos where ventas_pedidos.id = v;
    ok := tot = 18000 and dm = 2000;
    raise exception using errcode = 'PT000', message = ok || '|total ' || tot || ', descuento ' || dm;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- D-02: 15% sobre el total sin aprobación
  id := 'D-02'; caso := 'Casero da 15% sobre el total sin aprobación'; esperado := 'error, no se crea venta';
  begin
    g := pruebas._preparar_venta(); perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 2)), false, 0, 'efectivo', null, 'porcentaje', 15, null);
    exception when others then err := sqlerrm; end;
    ok := err is not null and not exists (select 1 from ventas_pedidos where cliente_id = g.cli);
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- D-03: 15% con solicitud aprobada
  id := 'D-03'; caso := 'Casero da 15% sobre el total con solicitud aprobada'; esperado := 'venta aceptada (17000) y solicitud usada';
  begin
    g := pruebas._preparar_venta();
    insert into solicitudes_descuento (solicitante_id, producto_id, cliente_id, tipo, valor, estado)
    values (v_vend, null, g.cli, 'porcentaje', 15, 'aprobada') returning solicitudes_descuento.id into v_sol;
    perform pruebas._como(v_vend);
    v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 2)), false, 0, 'efectivo', null, 'porcentaje', 15, v_sol);
    select monto_total into tot from ventas_pedidos where ventas_pedidos.id = v;
    select estado into est from solicitudes_descuento where solicitudes_descuento.id = v_sol;
    ok := tot = 17000 and est = 'usada';
    raise exception using errcode = 'PT000', message = ok || '|total ' || tot || ', solicitud ' || est;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- D-04: trabajador sin permiso de descuentos
  id := 'D-04'; caso := 'Casero sin permiso de descuentos da 5%'; esperado := 'error: sin permiso para descuentos';
  begin
    g := pruebas._preparar_venta();
    update perfiles set puede_descontar = false where perfiles.id = v_vend;
    perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), false, 0, 'efectivo', null, 'porcentaje', 5, null);
    exception when others then err := sqlerrm; end;
    ok := err ilike '%permiso para hacer descuentos%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- D-05: tipo de venta no permitido
  id := 'D-05'; caso := 'Casero que solo vende al contado intenta vender a crédito'; esperado := 'error: solo al contado';
  begin
    g := pruebas._preparar_venta();
    update perfiles set tipo_venta = 'contado' where perfiles.id = v_vend;
    perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), false, 0, 'efectivo', null);
    exception when others then err := sqlerrm; end;
    ok := err ilike '%solo puedes vender al contado%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $c$;
$f$;
    execute 'revoke all on function pruebas.descuentos() from public, anon, authenticated';
    execute $t$
create or replace function pruebas.todas()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language sql as $q$
  select * from pruebas.pagos()
  union all select * from pruebas.pagos_extra()
  union all select * from pruebas.ventas()
  union all select * from pruebas.rutas()
  union all select * from pruebas.correcciones()
  union all select * from pruebas.descuentos();
$q$;
$t$;
    execute 'revoke all on function pruebas.todas() from public, anon, authenticated';
  end if;
end $$;
