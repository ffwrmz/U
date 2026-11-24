-- =====================================================================
-- Santa Teresita: solicitudes de corrección
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- El casero pide corregir un error (monto de un pago, un producto vendido, o el teléfono / las
-- indicaciones de un cliente) y el gerente la aprueba o la rechaza con resolver_correccion().
-- =====================================================================

-- 1) Tabla
create table if not exists public.solicitudes_correccion (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('pago', 'venta_item', 'cliente')),
  pago_id uuid references public.pagos(id) on delete set null,
  venta_id uuid references public.ventas_pedidos(id) on delete set null,
  venta_item_id uuid references public.venta_items(id) on delete set null,
  cliente_id uuid references public.clientes(id) on delete set null,
  datos_anteriores jsonb not null default '{}'::jsonb,
  datos_nuevos jsonb not null default '{}'::jsonb,
  motivo text not null check (length(btrim(motivo)) > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  solicitado_por uuid not null default auth.uid() references auth.users(id),
  solicitado_en timestamptz not null default now(),
  revisado_por uuid references auth.users(id),
  revisado_en timestamptz,
  comentario_gerente text
);
create index if not exists solicitudes_correccion_estado_idx on public.solicitudes_correccion (estado, solicitado_en);

-- 2) Seguridad: el casero crea y ve las suyas; el dueño ve todas. Nadie la modifica directo (solo con la función).
alter table public.solicitudes_correccion enable row level security;
drop policy if exists sc_insertar on public.solicitudes_correccion;
create policy sc_insertar on public.solicitudes_correccion for insert to authenticated
  with check (solicitado_por = auth.uid() and estado = 'pendiente' and get_rol_usuario() in ('vendedor', 'dueno'));
drop policy if exists sc_leer on public.solicitudes_correccion;
create policy sc_leer on public.solicitudes_correccion for select to authenticated
  using (get_rol_usuario() = 'dueno' or solicitado_por = auth.uid());

-- 3) Resolver (solo el dueño activo). Si aprueba, aplica el cambio en la misma transacción.
--    pago:       datos_nuevos {"monto_abonado": n}   (0 = el pago no existió: se borra)
--    venta_item: datos_nuevos {"producto_id": uuid?, "cantidad": n?, "precio_final": n?}  (cantidad 0 = quitar el producto)
--    cliente:    datos_nuevos {"telefono": "569...", "referencia": "texto"}  (referencia = indicaciones de la casa)
--    Antes de aplicar se comprueba que los datos_anteriores sigan iguales; si cambiaron, error.
--    El saldo de la venta se recalcula desde cero: total - suma de pagos (sin depender del trigger de pagos).
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

-- 4) Tiempo real (para que el gerente vea las nuevas al tiro)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'solicitudes_correccion') then
    alter publication supabase_realtime add table public.solicitudes_correccion;
  end if;
end $$;

-- 5) Pruebas automatizadas (C-01..C-05). Uso: select * from pruebas.correcciones();
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'pruebas') then
    execute $f$
create or replace function pruebas.correcciones()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $c$
declare
  f record; g record;
  v_dueno uuid; v_vend uuid; v_pago uuid; v_sol uuid; v_venta uuid; v_item uuid;
  sa numeric; ea text; st int; tot numeric; n int; ok boolean;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  -- C-01: pago de 4.000 corregido a 3.000 (sin descuadre)
  id := 'C-01'; caso := 'Gerente aprueba corregir un pago de $4.000 a $3.000';
  esperado := 'saldo A 7000, pendiente, pago 3000, solicitud aprobada';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    perform registrar_pago(4000, 'efectivo', null, f.va);
    select p.id into v_pago from pagos p where venta_pedido_id = f.va;
    insert into solicitudes_correccion (tipo, pago_id, venta_id, cliente_id, datos_anteriores, datos_nuevos, motivo)
    values ('pago', v_pago, f.va, f.cli, '{"monto_abonado": 4000}', '{"monto_abonado": 3000}', 'Me equivoqué') returning solicitudes_correccion.id into v_sol;
    perform pruebas._como(v_dueno);
    perform resolver_correccion(v_sol, true, null);
    select saldo_pendiente, estado_pago into sa, ea from ventas_pedidos where ventas_pedidos.id = f.va;
    select monto_abonado into tot from pagos where pagos.id = v_pago;
    ok := sa = 7000 and ea = 'pendiente' and tot = 3000 and (select estado from solicitudes_correccion where solicitudes_correccion.id = v_sol) = 'aprobada';
    raise exception using errcode = 'PT000', message = ok || '|saldo ' || sa || ' ' || ea || ', pago ' || tot;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- C-02: rechazo no cambia nada
  id := 'C-02'; caso := 'Gerente rechaza la corrección de un pago';
  esperado := 'saldo A 6000, pago 4000, solicitud rechazada';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    perform registrar_pago(4000, 'efectivo', null, f.va);
    select p.id into v_pago from pagos p where venta_pedido_id = f.va;
    insert into solicitudes_correccion (tipo, pago_id, venta_id, cliente_id, datos_anteriores, datos_nuevos, motivo)
    values ('pago', v_pago, f.va, f.cli, '{"monto_abonado": 4000}', '{"monto_abonado": 1000}', 'Prueba') returning solicitudes_correccion.id into v_sol;
    perform pruebas._como(v_dueno);
    perform resolver_correccion(v_sol, false, 'No corresponde');
    select saldo_pendiente into sa from ventas_pedidos where ventas_pedidos.id = f.va;
    select monto_abonado into tot from pagos where pagos.id = v_pago;
    ok := sa = 6000 and tot = 4000 and (select estado from solicitudes_correccion where solicitudes_correccion.id = v_sol) = 'rechazada';
    raise exception using errcode = 'PT000', message = ok || '|saldo ' || sa || ', pago ' || tot;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- C-03: el vendedor no puede resolver
  id := 'C-03'; caso := 'El casero intenta aprobar su propia solicitud';
  esperado := 'error de permiso';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    perform registrar_pago(4000, 'efectivo', null, f.va);
    select p.id into v_pago from pagos p where venta_pedido_id = f.va;
    insert into solicitudes_correccion (tipo, pago_id, venta_id, cliente_id, datos_anteriores, datos_nuevos, motivo)
    values ('pago', v_pago, f.va, f.cli, '{"monto_abonado": 4000}', '{"monto_abonado": 3000}', 'Prueba') returning solicitudes_correccion.id into v_sol;
    begin
      perform resolver_correccion(v_sol, true, null);
      ok := false;
    exception when sqlstate '42501' then ok := true;
    end;
    raise exception using errcode = 'PT000', message = ok || '|' || case when ok then 'rechazado por permiso' else 'se aplicó' end;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- C-04: venta de 2 unidades corregida a 1 (stock y total correctos)
  id := 'C-04'; caso := 'Gerente aprueba corregir la cantidad vendida de 2 a 1';
  esperado := 'stock furgón 4, total 10000, saldo 10000';
  begin
    g := pruebas._preparar_venta(); perform pruebas._como(v_vend);
    v_venta := registrar_venta(g.cli, g.furgon, jsonb_build_array(jsonb_build_object('producto_id', g.prod, 'cantidad', 2)), false, 0, 'efectivo', 'Prueba');
    select vi.id into v_item from venta_items vi where venta_pedido_id = v_venta;
    insert into solicitudes_correccion (tipo, venta_id, venta_item_id, cliente_id, datos_anteriores, datos_nuevos, motivo)
    values ('venta_item', v_venta, v_item, g.cli,
            jsonb_build_object('producto_id', g.prod, 'cantidad', 2, 'precio_final', 10000), '{"cantidad": 1}', 'Era uno') returning solicitudes_correccion.id into v_sol;
    perform pruebas._como(v_dueno);
    perform resolver_correccion(v_sol, true, null);
    select cantidad into st from inventario_stock where ubicacion_id = g.furgon and producto_id = g.prod;
    select monto_total, saldo_pendiente into tot, sa from ventas_pedidos where ventas_pedidos.id = v_venta;
    ok := st = 4 and tot = 10000 and sa = 10000;
    raise exception using errcode = 'PT000', message = ok || '|stock ' || st || ', total ' || tot || ', saldo ' || sa;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- C-05: si el dato cambió entre medio, no se aplica
  id := 'C-05'; caso := 'El pago cambió después de pedir la corrección';
  esperado := 'error, pago sin cambios';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    perform registrar_pago(4000, 'efectivo', null, f.va);
    select p.id into v_pago from pagos p where venta_pedido_id = f.va;
    insert into solicitudes_correccion (tipo, pago_id, venta_id, cliente_id, datos_anteriores, datos_nuevos, motivo)
    values ('pago', v_pago, f.va, f.cli, '{"monto_abonado": 5000}', '{"monto_abonado": 3000}', 'Prueba') returning solicitudes_correccion.id into v_sol;
    perform pruebas._como(v_dueno);
    begin
      perform resolver_correccion(v_sol, true, null);
      ok := false;
    exception when sqlstate '22023' then ok := true;
    end;
    select monto_abonado into tot from pagos where pagos.id = v_pago;
    ok := ok and tot = 4000;
    raise exception using errcode = 'PT000', message = ok || '|pago ' || tot;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $c$;
$f$;
    execute 'revoke all on function pruebas.correcciones() from public, anon, authenticated';
    execute $t$
create or replace function pruebas.todas()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language sql as $q$
  select * from pruebas.pagos()
  union all select * from pruebas.pagos_extra()
  union all select * from pruebas.ventas()
  union all select * from pruebas.rutas()
  union all select * from pruebas.correcciones();
$q$;
$t$;
    execute 'revoke all on function pruebas.todas() from public, anon, authenticated';
  end if;
end $$;
