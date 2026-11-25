-- =====================================================================
-- Santa Teresita: ajuste de dos pruebas automáticas (F-01 y A-04) a los datos reales
-- (cliente de prueba que ya está en la ruta, y gerente con furgón asignado).
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. Solo cambia funciones de pruebas.
-- Después: select * from pruebas.todas();  (deberían salir 59 PASA)
-- =====================================================================
do $do$ begin
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
    perform set_config('app.depuracion', '1', true); delete from ruta_paradas where cliente_id = g.cli;
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
    update ubicaciones_inventario set responsable_id = null where tipo = 'furgon' and responsable_id = v_dueno;
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
  end if;
end $do$;
