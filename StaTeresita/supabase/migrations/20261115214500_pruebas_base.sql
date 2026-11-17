-- Pruebas automatizadas: base (ayudantes), pagos P-01..P-12 y regresión de ventas V-01..V-13.
-- Ya está aplicado en el Supabase del proyecto; este archivo sirve para reconstruir el entorno desde cero.
-- Cada caso crea sus datos, ejecuta y DESHACE todo al terminar (no deja rastro en la base).
-- Uso:  select * from pruebas.pagos();   select * from pruebas.ventas();

create schema if not exists pruebas;
revoke all on schema pruebas from public, anon, authenticated;

-- Se "hace pasar" por un usuario (lo mismo que pasa cuando alguien inicia sesión en la app)
create or replace function pruebas._como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Usuario temporal con un rol (solo existe dentro del caso que lo crea)
create or replace function pruebas._usuario_temporal(p_rol text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email) values (v, 'authenticated', 'authenticated', 'prueba-' || v || '@prueba.local');
  insert into perfiles (id, nombre, rol, activo) values (v, 'Usuario PRUEBA ' || p_rol, p_rol, true);
  return v;
end $$;

-- Cliente de prueba con 2 compras: A (antigua, $10.000) y B (nueva, $20.000)
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
end $$;

-- Cliente, producto ($10.000) y furgón de prueba del casero con 5 unidades; bodega con 5 unidades
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
end $$;

-- ===================================================================== PAGOS P-01 .. P-12
create or replace function pruebas.pagos()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $$
declare
  f record;
  v_dueno uuid; v_vend uuid;
  r numeric; sa numeric; sb numeric; ea text; n int; err text; ok boolean;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  -- P-01
  id := 'P-01'; caso := 'Casero abona $4.000 a la compra A';
  esperado := 'saldo A 6000, sigue pendiente, 1 pago, deuda cliente 26000';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    r := registrar_pago(4000, 'efectivo', null, f.va);
    select saldo_pendiente, estado_pago into sa, ea from ventas_pedidos where ventas_pedidos.id = f.va;
    select count(*) into n from pagos where venta_pedido_id in (f.va, f.vb);
    ok := sa = 6000 and ea = 'pendiente' and n = 1 and r = 26000;
    raise exception using errcode = 'PT000', message = ok || '|saldo A ' || sa || ', ' || ea || ', ' || n || ' pago, deuda ' || r;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-02
  id := 'P-02'; caso := 'Casero paga exacto la compra A (DEF-07)';
  esperado := 'saldo A 0 y estado pagada';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    r := registrar_pago(10000, 'efectivo', null, f.va);
    select saldo_pendiente, estado_pago into sa, ea from ventas_pedidos where ventas_pedidos.id = f.va;
    ok := sa = 0 and ea = 'pagada';
    raise exception using errcode = 'PT000', message = ok || '|saldo A ' || sa || ', ' || ea;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-03
  id := 'P-03'; caso := 'Abono de $15.000 al cliente se reparte FIFO';
  esperado := 'A 0 pagada, B 15000, 2 pagos';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    r := registrar_pago(15000, 'efectivo', f.cli, null);
    select saldo_pendiente, estado_pago into sa, ea from ventas_pedidos where ventas_pedidos.id = f.va;
    select saldo_pendiente into sb from ventas_pedidos where ventas_pedidos.id = f.vb;
    select count(*) into n from pagos where venta_pedido_id in (f.va, f.vb);
    ok := sa = 0 and ea = 'pagada' and sb = 15000 and n = 2;
    raise exception using errcode = 'PT000', message = ok || '|A ' || sa || ' ' || ea || ', B ' || sb || ', ' || n || ' pagos';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-04
  id := 'P-04'; caso := 'Abono mayor que la deuda ($30.001)';
  esperado := 'error y saldos sin cambios, 0 pagos';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    err := null;
    begin r := registrar_pago(30001, 'efectivo', f.cli, null); exception when others then err := sqlerrm; end;
    select saldo_pendiente into sa from ventas_pedidos where ventas_pedidos.id = f.va;
    select saldo_pendiente into sb from ventas_pedidos where ventas_pedidos.id = f.vb;
    select count(*) into n from pagos where venta_pedido_id in (f.va, f.vb);
    ok := err is not null and sa = 10000 and sb = 20000 and n = 0;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; A ' || sa || ', B ' || sb || ', ' || n || ' pagos';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-05 .. P-07 entradas inválidas
  for caso, esperado, err in
    select * from (values
      ('Monto 0', 'error: monto mayor a 0', '0|efectivo'),
      ('Monto negativo (-500)', 'error: monto mayor a 0', '-500|efectivo'),
      ('Método de pago inválido (cheque)', 'error: método inválido', '1000|cheque')) t
  loop
    id := 'P-0' || (case caso when 'Monto 0' then 5 when 'Monto negativo (-500)' then 6 else 7 end);
    begin
      f := pruebas._preparar(); perform pruebas._como(v_vend);
      declare e2 text := null;
      begin
        begin r := registrar_pago(split_part(err, '|', 1)::numeric, split_part(err, '|', 2), null, f.va);
        exception when others then e2 := sqlerrm; end;
        select count(*) into n from pagos where venta_pedido_id = f.va;
        ok := e2 is not null and n = 0;
        raise exception using errcode = 'PT000', message = ok || '|' || coalesce(e2, 'sin error') || '; ' || n || ' pagos';
      end;
    exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
              when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
    end;
    resultado := case when ok then 'PASA' else 'FALLA' end; return next;
  end loop;

  -- P-08
  id := 'P-08'; caso := 'Usuario sin rol de trabajador intenta cobrar';
  esperado := 'error: sin permiso, 0 pagos';
  begin
    f := pruebas._preparar(); perform pruebas._como(gen_random_uuid());
    err := null;
    begin r := registrar_pago(1000, 'efectivo', null, f.va); exception when others then err := sqlerrm; end;
    select count(*) into n from pagos where venta_pedido_id = f.va;
    ok := err ilike '%permiso%' and n = 0;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; ' || n || ' pagos';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-09
  id := 'P-09'; caso := 'Casero desactivado intenta cobrar';
  esperado := 'error: sin permiso';
  begin
    f := pruebas._preparar(); update perfiles set activo = false where perfiles.id = v_vend;
    perform pruebas._como(v_vend);
    err := null;
    begin r := registrar_pago(1000, 'efectivo', null, f.va); exception when others then err := sqlerrm; end;
    ok := err ilike '%permiso%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-10
  id := 'P-10'; caso := 'Pago a una compra anulada';
  esperado := 'error: no hay deuda pendiente';
  begin
    f := pruebas._preparar(); update ventas_pedidos set estado_pago = 'anulada' where ventas_pedidos.id = f.va;
    perform pruebas._como(v_vend);
    err := null;
    begin r := registrar_pago(1000, 'efectivo', null, f.va); exception when others then err := sqlerrm; end;
    ok := err ilike '%no hay deuda%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-11
  id := 'P-11'; caso := 'Dueño paga por transferencia; queda registrado quién y cómo';
  esperado := 'cobrador = dueño, método transferencia';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_dueno);
    r := registrar_pago(2000, 'transferencia', null, f.vb);
    select count(*) into n from pagos where venta_pedido_id = f.vb and cobrador_id = v_dueno and metodo_pago = 'transferencia';
    ok := n = 1;
    raise exception using errcode = 'PT000', message = ok || '|' || n || ' pago con cobrador dueño y transferencia';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-12
  id := 'P-12'; caso := 'Varios abonos seguidos: total - pagos = saldo (0 descuadres)';
  esperado := 'diferencia 0 en ambas compras';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    r := registrar_pago(3000, 'efectivo', f.cli, null);
    r := registrar_pago(9000, 'transferencia', f.cli, null);
    r := registrar_pago(500, 'efectivo', null, f.vb);
    select count(*) into n from ventas_pedidos v
     where v.id in (f.va, f.vb)
       and v.monto_total - (select coalesce(sum(monto_abonado), 0) from pagos p where p.venta_pedido_id = v.id) <> v.saldo_pendiente;
    ok := n = 0 and r = 17500;
    raise exception using errcode = 'PT000', message = ok || '|' || n || ' descuadres, deuda final ' || r;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $$;

-- ===================================================================== VENTAS V-01 .. V-13 (regresión Incremento 1)
create or replace function pruebas.ventas()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $$
declare
  f record; v_dueno uuid; v_vend uuid; v uuid; x uuid;
  n int; st int; st2 int; sa numeric; ea text; err text; ok boolean;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  -- V-01
  id := 'V-01'; caso := 'Casero vende 2 unidades a crédito desde su furgón';
  esperado := 'stock 5→3, deuda 20000 pendiente, 1 ítem, 1 movimiento';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend);
    v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 2)), false, 0, 'efectivo', 'prueba');
    select cantidad into st from inventario_stock where ubicacion_id = f.furgon and producto_id = f.prod;
    select saldo_pendiente, estado_pago into sa, ea from ventas_pedidos where ventas_pedidos.id = v;
    select count(*) into n from venta_items where venta_pedido_id = v;
    select count(*) into st2 from inventario_movimientos where producto_id = f.prod and tipo = 'venta';
    ok := st = 3 and sa = 20000 and ea = 'pendiente' and n = 1 and st2 = 1;
    raise exception using errcode = 'PT000', message = ok || '|stock ' || st || ', deuda ' || sa || ' ' || ea || ', ' || n || ' ítem, ' || st2 || ' movimiento';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-02
  id := 'V-02'; caso := 'Venta de 2 unidades con pie de $5.000';
  esperado := '1 pago de 5000, deuda 15000';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend);
    v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 2)), false, 5000, 'efectivo', null);
    select saldo_pendiente into sa from ventas_pedidos where ventas_pedidos.id = v;
    select count(*) into n from pagos where venta_pedido_id = v and monto_abonado = 5000;
    ok := sa = 15000 and n = 1;
    raise exception using errcode = 'PT000', message = ok || '|' || n || ' pago de 5000, deuda ' || sa;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-03
  id := 'V-03'; caso := 'Venta al contado';
  esperado := 'deuda 0 y estado pagada';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend);
    v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 1)), true, 0, 'transferencia', null);
    select saldo_pendiente, estado_pago into sa, ea from ventas_pedidos where ventas_pedidos.id = v;
    ok := sa = 0 and ea = 'pagada';
    raise exception using errcode = 'PT000', message = ok || '|deuda ' || sa || ', ' || ea;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-04
  id := 'V-04'; caso := 'Stock insuficiente: pide 6 con 5 en el furgón (AC-03 ERR)';
  esperado := 'error, stock sigue en 5, no se crea venta';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 6)), false, 0, 'efectivo', null);
    exception when others then err := sqlerrm; end;
    select cantidad into st from inventario_stock where ubicacion_id = f.furgon and producto_id = f.prod;
    select count(*) into n from ventas_pedidos where cliente_id = f.cli;
    ok := err ilike '%stock insuficiente%' and st = 5 and n = 0;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; stock ' || st || ', ' || n || ' ventas';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-05
  id := 'V-05'; caso := 'Casero aplica descuento de 10% (límite permitido)';
  esperado := 'venta aceptada, precio final 9000';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend);
    v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 1, 'descuento_tipo', 'porcentaje', 'descuento_valor', 10)), false, 0, 'efectivo', null);
    select precio_final into sa from venta_items where venta_pedido_id = v;
    ok := sa = 9000;
    raise exception using errcode = 'PT000', message = ok || '|precio final ' || sa;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-06
  id := 'V-06'; caso := 'Casero aplica 15% sin aprobación del gerente';
  esperado := 'error, no se crea venta, stock intacto';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 1, 'descuento_tipo', 'porcentaje', 'descuento_valor', 15)), false, 0, 'efectivo', null);
    exception when others then err := sqlerrm; end;
    select count(*) into n from ventas_pedidos where cliente_id = f.cli;
    select cantidad into st from inventario_stock where ubicacion_id = f.furgon and producto_id = f.prod;
    ok := err ilike '%supera el 10%' and n = 0 and st = 5;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; ' || n || ' ventas, stock ' || st;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-07
  id := 'V-07'; caso := 'Casero aplica 15% con solicitud aprobada';
  esperado := 'venta aceptada (8500) y la solicitud queda usada';
  begin
    f := pruebas._preparar_venta();
    insert into solicitudes_descuento (solicitante_id, producto_id, cliente_id, tipo, valor, estado, resuelto_por, resuelto_en)
    values (v_vend, f.prod, f.cli, 'porcentaje', 15, 'aprobada', v_dueno, now()) returning solicitudes_descuento.id into x;
    perform pruebas._como(v_vend);
    v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 1, 'descuento_tipo', 'porcentaje', 'descuento_valor', 15, 'solicitud_id', x)), false, 0, 'efectivo', null);
    select precio_final into sa from venta_items where venta_pedido_id = v;
    select estado into ea from solicitudes_descuento where solicitudes_descuento.id = x;
    ok := sa = 8500 and ea = 'usada';
    raise exception using errcode = 'PT000', message = ok || '|precio final ' || sa || ', solicitud ' || ea;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-08
  id := 'V-08'; caso := 'Casero intenta vender con stock de la bodega';
  esperado := 'error: solo su furgón; stock de bodega intacto';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(f.cli, f.bodega, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 1)), false, 0, 'efectivo', null);
    exception when others then err := sqlerrm; end;
    select cantidad into st from inventario_stock where ubicacion_id = f.bodega and producto_id = f.prod;
    ok := err ilike '%furgón asignado%' and st = 5;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; stock bodega ' || st;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-09
  id := 'V-09'; caso := 'Usuario con rol cliente intenta vender';
  esperado := 'error: sin permiso';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(pruebas._usuario_temporal('cliente')); err := null;
    begin v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 1)), false, 0, 'efectivo', null);
    exception when others then err := sqlerrm; end;
    ok := err ilike '%permiso%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-10
  id := 'V-10'; caso := 'Venta con cantidad 0';
  esperado := 'error: cantidad inválida';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 0)), false, 0, 'efectivo', null);
    exception when others then err := sqlerrm; end;
    ok := err ilike '%cantidad inválida%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-11
  id := 'V-11'; caso := 'Casero intenta mover stock de bodega a furgón';
  esperado := 'error: solo el dueño mueve stock';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_vend); err := null;
    begin perform mover_stock(f.prod, f.bodega, f.furgon, 2, 'carga', null);
    exception when others then err := sqlerrm; end;
    select cantidad into st from inventario_stock where ubicacion_id = f.bodega and producto_id = f.prod;
    ok := err ilike '%solo el dueño%' and st = 5;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; stock bodega ' || st;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-12
  id := 'V-12'; caso := 'Dueño traspasa 3 de bodega a furgón; luego intenta traspasar 3 más';
  esperado := 'bodega 2, furgón 8; el segundo traspaso da error y no cambia nada';
  begin
    f := pruebas._preparar_venta(); perform pruebas._como(v_dueno); err := null;
    perform mover_stock(f.prod, f.bodega, f.furgon, 3, 'carga', null);
    begin perform mover_stock(f.prod, f.bodega, f.furgon, 3, 'carga', null);
    exception when others then err := sqlerrm; end;
    select cantidad into st from inventario_stock where ubicacion_id = f.bodega and producto_id = f.prod;
    select cantidad into st2 from inventario_stock where ubicacion_id = f.furgon and producto_id = f.prod;
    ok := st = 2 and st2 = 8 and err ilike '%stock insuficiente%';
    raise exception using errcode = 'PT000', message = ok || '|bodega ' || st || ', furgón ' || st2 || '; 2º: ' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- V-13
  id := 'V-13'; caso := 'Casero desactivado por el gerente intenta vender';
  esperado := 'error: sin permiso, no se crea venta';
  begin
    f := pruebas._preparar_venta(); update perfiles set activo = false where perfiles.id = v_vend;
    perform pruebas._como(v_vend); err := null;
    begin v := registrar_venta(f.cli, f.furgon, jsonb_build_array(jsonb_build_object('producto_id', f.prod, 'cantidad', 1)), false, 0, 'efectivo', null);
    exception when others then err := sqlerrm; end;
    select count(*) into n from ventas_pedidos where cliente_id = f.cli;
    ok := err ilike '%permiso%' and n = 0;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; ' || n || ' ventas';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $$;

revoke all on all functions in schema pruebas from public, anon, authenticated;
