-- =====================================================================
-- Santa Teresita: BORRAR TODOS LOS DATOS DE PRUEBA antes de operar
-- Supabase > SQL Editor > Run.
--  1) Muestra primero cuántos clientes "(prueba)", ventas y pagos se van a borrar.
--  2) Borra los datos de prueba del Calendario (los de datos_prueba_calendario.sql).
--  3) Borra los clientes cuyo nombre dice "(prueba)" y todo lo suyo: visitas, preasignaciones, listas fijas,
--     solicitudes, pagos, productos vendidos y ventas. Las direcciones que queden sin ningún cliente también.
--     El stock de lo que se les vendió desde la app vuelve al furgón o bodega de donde salió (queda anotado
--     como devolución), porque esas ventas sí habían descontado stock.
-- No toca las funciones de prueba (pruebas.*): siguen sirviendo para revisar la app.
-- =====================================================================

-- 1) Lo que se va a borrar
select
  (select count(*) from public.clientes where nombre ilike '%(prueba)%') as clientes_prueba,
  (select count(*) from public.ventas_pedidos v join public.clientes c on c.id = v.cliente_id where c.nombre ilike '%(prueba)%') as ventas,
  (select count(*) from public.pagos p join public.ventas_pedidos v on v.id = p.venta_pedido_id join public.clientes c on c.id = v.cliente_id
    where c.nombre ilike '%(prueba)%') as pagos,
  (select count(*) from public.ventas_pedidos where descripcion = '(prueba calendario)') as ventas_calendario;

do $$
declare v_movidos int := 0;
begin
  perform set_config('app.depuracion', '1', true); -- permite quitar visitas aunque la ruta esté en curso

  -- 2) Datos de prueba del Calendario
  if to_regclass('pruebas.datos_calendario') is not null then
    delete from pagos where id in (select id from pruebas.datos_calendario where tabla = 'pagos')
       or venta_pedido_id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
    delete from venta_items where venta_pedido_id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
    delete from ventas_pedidos where id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
    delete from jornada_vendedores where jornada_id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
    delete from ruta_paradas where jornada_id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
    delete from jornadas where id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
    drop table pruebas.datos_calendario;
  end if;

  -- 3) Clientes "(prueba)"
  create temp table _cli on commit drop as select id, direccion_id from clientes where nombre ilike '%(prueba)%';
  create temp table _ven on commit drop as select id from ventas_pedidos where cliente_id in (select id from _cli);

  -- Devolver el stock de lo vendido a esos clientes a su ubicación de origen
  insert into inventario_stock (ubicacion_id, producto_id, cantidad)
  select vi.ubicacion_id, vi.producto_id, sum(vi.cantidad) from venta_items vi join productos pr on pr.id = vi.producto_id
   where vi.venta_pedido_id in (select id from _ven) and pr.controla_stock
   group by vi.ubicacion_id, vi.producto_id
  on conflict (ubicacion_id, producto_id) do update set cantidad = inventario_stock.cantidad + excluded.cantidad, actualizado_en = now();
  insert into inventario_movimientos (producto_id, ubicacion_destino_id, cantidad, tipo, nota, usuario_id)
  select vi.producto_id, vi.ubicacion_id, vi.cantidad, 'devolucion', 'Borrado de datos de prueba',
         coalesce(auth.uid(), (select id from perfiles where rol = 'dueno' and activo limit 1))
    from venta_items vi join productos pr on pr.id = vi.producto_id
   where vi.venta_pedido_id in (select id from _ven) and pr.controla_stock;
  get diagnostics v_movidos = row_count;

  delete from solicitudes_correccion where cliente_id in (select id from _cli) or venta_id in (select id from _ven);
  update venta_items set solicitud_id = null where venta_pedido_id in (select id from _ven);
  delete from solicitudes_descuento where cliente_id in (select id from _cli);
  delete from pagos where venta_pedido_id in (select id from _ven);
  delete from venta_items where venta_pedido_id in (select id from _ven);
  delete from ventas_pedidos where id in (select id from _ven);
  delete from ruta_paradas where cliente_id in (select id from _cli);
  delete from preasignaciones where cliente_id in (select id from _cli);
  delete from listas_fijas_clientes where cliente_id in (select id from _cli);
  delete from listas_fijas_omitidas where cliente_id in (select id from _cli);
  delete from clientes where id in (select id from _cli);
  -- Direcciones que quedaron sin ningún cliente
  delete from direcciones d where d.id in (select direccion_id from _cli where direccion_id is not null)
     and not exists (select 1 from clientes c where c.direccion_id = d.id);

  raise notice 'Datos de prueba borrados (% productos devueltos al stock)', v_movidos;
end $$;
