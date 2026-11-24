-- =====================================================================
-- Santa Teresita: BORRAR los datos de prueba del Calendario (los que creó datos_prueba_calendario.sql)
-- Supabase > SQL Editor > Run. Borra exactamente lo creado (guardado en pruebas.datos_calendario).
-- Los pagos de prueba eran solo a ventas de prueba, así que ninguna deuda real cambia.
-- =====================================================================
do $$
begin
  if to_regclass('pruebas.datos_calendario') is null then
    raise notice 'No hay datos de prueba del calendario';
    return;
  end if;
  -- Incluye pagos que alguien haya registrado después en la app a una venta de prueba
  delete from pagos where id in (select id from pruebas.datos_calendario where tabla = 'pagos')
     or venta_pedido_id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
  delete from venta_items where venta_pedido_id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
  delete from ventas_pedidos where id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
  delete from jornada_vendedores where jornada_id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
  delete from ruta_paradas where jornada_id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
  delete from jornadas where id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
  drop table pruebas.datos_calendario;
  raise notice 'Datos de prueba del calendario borrados';
end $$;
