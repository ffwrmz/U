-- =====================================================================
-- Santa Teresita: arreglo de las pruebas automáticas cuando el casero ya tiene un furgón asignado
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. Solo cambia una función de pruebas
-- (no toca datos: dentro de cada prueba todo se deshace al terminar).
-- Después: select * from pruebas.todas();  (deberían salir 59 PASA)
-- =====================================================================
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
  update ubicaciones_inventario set responsable_id = null where tipo = 'furgon' and responsable_id = v_vend;
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
  end if;
end $do$;
