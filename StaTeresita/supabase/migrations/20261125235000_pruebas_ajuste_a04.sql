-- =====================================================================
-- Santa Teresita: ajuste de la prueba A-04 (gerente con furgón asignado en furgon_trabajadores)
-- Supabase > SQL Editor > Run. Solo cambia una función de pruebas. Después: 66 PASA en pruebas.todas()
-- =====================================================================
do $do$ begin
  if exists (select 1 from pg_namespace where nspname = 'pruebas') then
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
    delete from furgon_trabajadores where perfil_id = v_dueno; -- el furgón del gerente ahora sale de furgon_trabajadores
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
