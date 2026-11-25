-- =====================================================================
-- Santa Teresita: ventas y cobros fuera de ruta (el gerente puede registrarlos a nombre de otro trabajador)
-- e inventario del casero con solicitudes de cambio al gerente.
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Requiere 20261125020000_ajustes_permisos.sql.
-- Después: select * from pruebas.todas();  (las nuevas F-01..F-03 e I-01..I-05 también deberían salir PASA)
-- =====================================================================

-- 1) Quién registró cada venta y cobro (si el gerente lo hizo a nombre de otro), y visitas fuera de ruta
alter table public.ventas_pedidos add column if not exists registrado_por uuid references auth.users(id);
alter table public.pagos add column if not exists registrado_por uuid references auth.users(id);
alter table public.ruta_paradas add column if not exists fuera_de_ruta boolean not null default false;

-- Si quien vendió o cobró tiene jornada hoy y el cliente no está en la ruta de ese día, se agrega como visitado
-- (marcado "fuera de ruta"). Si ya está en la ruta, no se cambia nada. Si hoy no hay jornada, no hace nada.
create or replace function public._visita_fuera_de_ruta(p_vendedor uuid, p_cliente uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_jor uuid;
begin
  if p_vendedor is null or p_cliente is null then return; end if;
  select id into v_jor from jornadas where fecha = (now() at time zone 'America/Santiago')::date and estado <> 'finalizada';
  if v_jor is null then return; end if;
  if exists (select 1 from ruta_paradas where jornada_id = v_jor and cliente_id = p_cliente) then return; end if;
  insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden, estado, visitado_en, fuera_de_ruta)
  values (v_jor, p_vendedor, p_cliente,
          coalesce((select max(orden) from ruta_paradas where jornada_id = v_jor and vendedor_id = p_vendedor), 0) + 1,
          'visitado', now(), true)
  on conflict (jornada_id, cliente_id) do nothing;
end $$;
revoke all on function public._visita_fuera_de_ruta(uuid, uuid) from public, anon, authenticated;

-- El aviso "Te asignaron clientes" no se manda por las visitas fuera de ruta
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
     where n.vendedor_id is distinct from auth.uid() and not coalesce(n.fuera_de_ruta, false)
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

-- 2) Ventas: el gerente puede registrarlas a nombre de otro trabajador (con el furgón de ese trabajador)
drop function if exists public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text, text, numeric, uuid);
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
  perform public._visita_fuera_de_ruta(v_user, p_cliente);

  return v_venta;
end;
$$;

revoke all on function public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text, text, numeric, uuid, uuid) from public, anon;
grant execute on function public.registrar_venta(uuid, uuid, jsonb, boolean, numeric, text, text, text, numeric, uuid, uuid) to authenticated;

-- 3) Cobros: igual, a nombre de otro trabajador
drop function if exists public.registrar_pago(numeric, text, uuid, uuid);
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

-- 4) Ventas y cobros guardados sin conexión: también llevan el trabajador elegido
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
    v := to_jsonb(registrar_pago((a->>'p_monto')::numeric, a->>'p_metodo', (a->>'p_cliente_id')::uuid, (a->>'p_venta_id')::uuid,
                                 (a->>'p_vendedor')::uuid));
  elsif p_tipo = 'registrar_venta' then
    v := to_jsonb(registrar_venta((a->>'p_cliente')::uuid, (a->>'p_ubicacion')::uuid, coalesce(a->'p_items', '[]'::jsonb),
                                  coalesce((a->>'p_contado')::boolean, false), coalesce((a->>'p_pie')::numeric, 0),
                                  coalesce(a->>'p_metodo', 'efectivo'), a->>'p_nota',
                                  coalesce(a->>'p_descuento_tipo', 'ninguno'), coalesce((a->>'p_descuento_valor')::numeric, 0),
                                  (a->>'p_solicitud')::uuid, (a->>'p_vendedor')::uuid));
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

-- 6) Inventario: el casero pide cambiar el stock de su furgón y el gerente lo aprueba
create table if not exists public.solicitudes_inventario (
  id uuid primary key default gen_random_uuid(),
  solicitante_id uuid not null default auth.uid() references auth.users(id),
  ubicacion_id uuid not null references public.ubicaciones_inventario(id),
  producto_id uuid not null references public.productos(id),
  -- agregar: de bodega al furgón · devolver: del furgón a bodega · corregir: dejar el furgón con esa cantidad
  tipo text not null check (tipo in ('agregar', 'devolver', 'corregir')),
  cantidad int not null check (cantidad >= 0),
  nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  comentario_gerente text,
  resuelta_por uuid references auth.users(id),
  resuelta_en timestamptz,
  creado_en timestamptz not null default now(),
  check (tipo = 'corregir' or cantidad > 0)
);
create index if not exists solicitudes_inventario_estado_idx on public.solicitudes_inventario (estado, creado_en);
alter table public.solicitudes_inventario enable row level security;
drop policy if exists si_insertar on public.solicitudes_inventario;
create policy si_insertar on public.solicitudes_inventario for insert to authenticated
  with check (solicitante_id = auth.uid() and estado = 'pendiente' and get_rol_usuario() in ('vendedor', 'dueno')
              and exists (select 1 from ubicaciones_inventario u where u.id = ubicacion_id and u.tipo = 'furgon' and u.responsable_id = auth.uid()));
drop policy if exists si_leer on public.solicitudes_inventario;
create policy si_leer on public.solicitudes_inventario for select to authenticated
  using (get_rol_usuario() = 'dueno' or solicitante_id = auth.uid());

create or replace function public.resolver_solicitud_inventario(p_id uuid, p_aprobar boolean, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s solicitudes_inventario%rowtype; v_bodega uuid; v_actual int; v_dif int; v_nota text;
begin
  if not public.es_dueno() then raise exception 'Solo el gerente puede resolver solicitudes de inventario' using errcode = '42501'; end if;
  select * into s from solicitudes_inventario where id = p_id for update;
  if not found then raise exception 'La solicitud no existe' using errcode = 'P0002'; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud ya fue resuelta' using errcode = '22023'; end if;

  if p_aprobar then
    v_nota := 'Solicitud de inventario ' || s.id;
    select id into v_bodega from ubicaciones_inventario where tipo = 'bodega' and activo limit 1;
    if s.tipo in ('agregar', 'devolver') and v_bodega is null then raise exception 'No hay bodega activa'; end if;
    -- mover_stock valida que alcance el stock en el origen; si no alcanza, todo se deshace y sigue pendiente
    if s.tipo = 'agregar' then
      perform mover_stock(s.producto_id, v_bodega, s.ubicacion_id, s.cantidad, 'carga', v_nota);
    elsif s.tipo = 'devolver' then
      perform mover_stock(s.producto_id, s.ubicacion_id, v_bodega, s.cantidad, 'devolucion', v_nota);
    else
      select coalesce(max(cantidad), 0) into v_actual from inventario_stock where ubicacion_id = s.ubicacion_id and producto_id = s.producto_id;
      v_dif := s.cantidad - v_actual;
      if v_dif > 0 then perform mover_stock(s.producto_id, null, s.ubicacion_id, v_dif, 'ajuste', v_nota);
      elsif v_dif < 0 then perform mover_stock(s.producto_id, s.ubicacion_id, null, -v_dif, 'ajuste', v_nota);
      end if;
    end if;
  end if;

  update solicitudes_inventario
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         comentario_gerente = nullif(btrim(coalesce(p_comentario, '')), ''), resuelta_por = auth.uid(), resuelta_en = now()
   where id = p_id;
end $$;
revoke all on function public.resolver_solicitud_inventario(uuid, boolean, text) from public, anon;
grant execute on function public.resolver_solicitud_inventario(uuid, boolean, text) to authenticated;

-- Avisos: al gerente cuando un casero pide un cambio, y al casero cuando se resuelve
create or replace function public._notificar_inventario()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_casero text; v_prod text; v_que text;
begin
  select nombre into v_casero from perfiles where id = new.solicitante_id;
  select nombre into v_prod from productos where id = new.producto_id;
  v_que := case new.tipo when 'agregar' then 'agregar ' || new.cantidad when 'devolver' then 'devolver ' || new.cantidad
                         else 'dejar en ' || new.cantidad end || ' de ' || coalesce(v_prod, 'un producto');
  if tg_op = 'INSERT' then
    perform _notificar_gerentes('inventario_nuevo', 'Solicitud de inventario',
      coalesce(v_casero, 'Un casero') || ' pide ' || v_que || ' en su furgón.',
      jsonb_build_object('ruta', '/solicitudes?tab=inventario', 'solicitud_id', new.id));
  elsif new.estado <> old.estado and new.estado in ('aprobada', 'rechazada') and new.solicitante_id is distinct from auth.uid() then
    insert into notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
    values (new.solicitante_id, 'inventario_resuelto',
            case when new.estado = 'aprobada' then 'Cambio de inventario aprobado' else 'Cambio de inventario rechazado' end,
            'Tu solicitud de ' || v_que || ' fue ' || new.estado || coalesce('. Gerente: ' || new.comentario_gerente, '') || '.',
            jsonb_build_object('ruta', '/mi-inventario', 'solicitud_id', new.id));
  end if;
  return null;
end $$;
do $$ begin
  if to_regclass('public.notificaciones') is not null then
    drop trigger if exists solicitudes_inventario_notificar on public.solicitudes_inventario;
    create trigger solicitudes_inventario_notificar after insert or update of estado on public.solicitudes_inventario
      for each row execute function public._notificar_inventario();
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'solicitudes_inventario') then
    alter publication supabase_realtime add table public.solicitudes_inventario;
  end if;
end $$;

-- 7) Pruebas F-01..F-03 (a nombre de otro trabajador) e I-01..I-05 (inventario)
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'pruebas') then
    execute $f$
create or replace function pruebas.fuera_de_ruta_e_inventario()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $c$
declare
  g record; v_dueno uuid; v_vend uuid; v_otro uuid; v uuid; v_sol uuid; err text; ok boolean;
  st int; sb int; vend uuid; reg uuid; fr boolean; est text; n int;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  -- F-01
  id := 'F-01'; caso := 'Gerente registra una venta a nombre de un casero (fuera de su ruta)';
  esperado := 'stock del furgón del casero 5→4, vendedor = casero, registrado por el gerente, visita fuera de ruta';
  begin
    g := pruebas._preparar_venta();
    insert into jornadas (fecha, estado) values ((now() at time zone 'America/Santiago')::date, 'en_curso') on conflict (fecha) do nothing;
    update jornadas set estado = 'en_curso' where fecha = (now() at time zone 'America/Santiago')::date;
    perform pruebas._como(v_dueno);
    v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), false, 0, 'efectivo', null,
                         'ninguno', 0, null, v_vend);
    select cantidad into st from inventario_stock where ubicacion_id = g.furgon and producto_id = g.prod;
    select vendedor_id, registrado_por into vend, reg from ventas_pedidos where ventas_pedidos.id = v;
    select fuera_de_ruta into fr from ruta_paradas rp join jornadas j on j.id = rp.jornada_id
     where j.fecha = (now() at time zone 'America/Santiago')::date and rp.cliente_id = g.cli and rp.vendedor_id = v_vend and rp.estado = 'visitado';
    ok := st = 4 and vend = v_vend and reg = v_dueno and coalesce(fr, false);
    raise exception using errcode = 'PT000', message = ok || '|stock ' || st || ', vendedor casero ' || (vend = v_vend) || ', registra gerente ' || (reg = v_dueno) || ', fuera de ruta ' || coalesce(fr, false);
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- F-02
  id := 'F-02'; caso := 'Casero intenta registrar una venta a nombre de otro trabajador'; esperado := 'error: solo el gerente';
  begin
    g := pruebas._preparar_venta(); perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 1)), true, 0, 'efectivo', null,
                               'ninguno', 0, null, v_dueno);
    exception when others then err := sqlerrm; end;
    ok := err ilike '%solo el gerente%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- F-03
  id := 'F-03'; caso := 'Gerente intenta registrar un cobro a nombre de un trabajador desactivado'; esperado := 'error: trabajador no activo, 0 pagos';
  begin
    g := pruebas._preparar_venta();
    insert into ventas_pedidos (cliente_id, vendedor_id, monto_total, saldo_pendiente, descripcion) values (g.cli, v_vend, 10000, 10000, 'Prueba') returning ventas_pedidos.id into v;
    v_otro := pruebas._usuario_temporal('vendedor');
    update perfiles set activo = false where perfiles.id = v_otro;
    perform pruebas._como(v_dueno); err := null;
    begin perform registrar_pago(1000, 'efectivo', null, v, v_otro); exception when others then err := sqlerrm; end;
    select count(*) into n from pagos where venta_pedido_id = v;
    ok := err ilike '%no está activo%' and n = 0;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; ' || n || ' pagos';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- I-01
  id := 'I-01'; caso := 'Casero pide agregar 3 unidades a su furgón'; esperado := 'solicitud pendiente creada';
  begin
    g := pruebas._preparar_venta(); perform pruebas._como(v_vend);
    insert into solicitudes_inventario (solicitante_id, ubicacion_id, producto_id, tipo, cantidad, nota)
    values (v_vend, g.furgon, g.prod, 'agregar', 3, 'Prueba') returning solicitudes_inventario.id into v_sol;
    select estado into est from solicitudes_inventario where solicitudes_inventario.id = v_sol;
    ok := est = 'pendiente';
    raise exception using errcode = 'PT000', message = ok || '|' || est;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- I-02
  id := 'I-02'; caso := 'El casero intenta aprobar su propia solicitud de inventario'; esperado := 'error de permiso';
  begin
    g := pruebas._preparar_venta();
    insert into solicitudes_inventario (solicitante_id, ubicacion_id, producto_id, tipo, cantidad)
    values (v_vend, g.furgon, g.prod, 'agregar', 3) returning solicitudes_inventario.id into v_sol;
    perform pruebas._como(v_vend); err := null;
    begin perform resolver_solicitud_inventario(v_sol, true, null); exception when others then err := sqlerrm; end;
    ok := err ilike '%solo el gerente%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- I-03
  id := 'I-03'; caso := 'Gerente aprueba agregar 3 al furgón'; esperado := 'bodega 5→2, furgón 5→8, aprobada';
  begin
    g := pruebas._preparar_venta();
    insert into solicitudes_inventario (solicitante_id, ubicacion_id, producto_id, tipo, cantidad)
    values (v_vend, g.furgon, g.prod, 'agregar', 3) returning solicitudes_inventario.id into v_sol;
    perform pruebas._como(v_dueno);
    perform resolver_solicitud_inventario(v_sol, true, 'OK');
    select cantidad into st from inventario_stock where ubicacion_id = g.furgon and producto_id = g.prod;
    select cantidad into sb from inventario_stock where ubicacion_id = g.bodega and producto_id = g.prod;
    select estado into est from solicitudes_inventario where solicitudes_inventario.id = v_sol;
    ok := st = 8 and sb = 2 and est = 'aprobada';
    raise exception using errcode = 'PT000', message = ok || '|bodega ' || sb || ', furgón ' || st || ', ' || est;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- I-04
  id := 'I-04'; caso := 'Gerente aprueba agregar 10 con solo 5 en bodega'; esperado := 'error, nada cambia, sigue pendiente';
  begin
    g := pruebas._preparar_venta();
    insert into solicitudes_inventario (solicitante_id, ubicacion_id, producto_id, tipo, cantidad)
    values (v_vend, g.furgon, g.prod, 'agregar', 10) returning solicitudes_inventario.id into v_sol;
    perform pruebas._como(v_dueno); err := null;
    begin perform resolver_solicitud_inventario(v_sol, true, null); exception when others then err := sqlerrm; end;
    select cantidad into st from inventario_stock where ubicacion_id = g.furgon and producto_id = g.prod;
    select cantidad into sb from inventario_stock where ubicacion_id = g.bodega and producto_id = g.prod;
    select estado into est from solicitudes_inventario where solicitudes_inventario.id = v_sol;
    ok := err is not null and st = 5 and sb = 5 and est = 'pendiente';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; bodega ' || sb || ', furgón ' || st || ', ' || est;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- I-05
  id := 'I-05'; caso := 'Gerente rechaza una solicitud de inventario'; esperado := 'stock sin cambios, rechazada';
  begin
    g := pruebas._preparar_venta();
    insert into solicitudes_inventario (solicitante_id, ubicacion_id, producto_id, tipo, cantidad)
    values (v_vend, g.furgon, g.prod, 'devolver', 2) returning solicitudes_inventario.id into v_sol;
    perform pruebas._como(v_dueno);
    perform resolver_solicitud_inventario(v_sol, false, 'No');
    select cantidad into st from inventario_stock where ubicacion_id = g.furgon and producto_id = g.prod;
    select cantidad into sb from inventario_stock where ubicacion_id = g.bodega and producto_id = g.prod;
    select estado into est from solicitudes_inventario where solicitudes_inventario.id = v_sol;
    ok := st = 5 and sb = 5 and est = 'rechazada';
    raise exception using errcode = 'PT000', message = ok || '|bodega ' || sb || ', furgón ' || st || ', ' || est;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $c$;
$f$;
    execute 'revoke all on function pruebas.fuera_de_ruta_e_inventario() from public, anon, authenticated';
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
  union all select * from pruebas.fuera_de_ruta_e_inventario();
$q$;
$t$;
    execute 'revoke all on function pruebas.todas() from public, anon, authenticated';
  end if;
end $$;
