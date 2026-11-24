-- =====================================================================
-- Santa Teresita: DATOS DE PRUEBA para ver el resumen de días pasados en el Calendario
-- Supabase > SQL Editor > Run. Se puede correr varias veces: primero borra lo creado antes por este archivo.
-- Para borrarlo todo: supabase/seeds/borrar_datos_prueba_calendario.sql
--
-- Crea, en los últimos 5 días hábiles anteriores a hoy (que no tengan ya una ruta real):
--   * una jornada finalizada por día, con 2 a 3 trabajadores (caseros activos y el gerente);
--   * 4 a 7 clientes por trabajador con Estaba / No estaba / No se visitó;
--   * ventas a crédito (algunas con pie) y al contado, con productos y precios reales;
--   * pagos en efectivo y transferencia (solo a estas ventas de prueba, para no tocar deudas reales),
--     incluidos algunos cobros a clientes que no estaban en la ruta de ese trabajador.
-- No mueve el stock. Las ventas dicen "(prueba calendario)" en la descripción.
-- =====================================================================

create schema if not exists pruebas;
create table if not exists pruebas.datos_calendario (tabla text not null, id uuid not null, primary key (tabla, id));
-- Solo la usa este archivo (desde el SQL Editor); con RLS y sin políticas, la app no puede leerla
alter table pruebas.datos_calendario enable row level security;

do $$
declare
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_dia date;
  v_dias date[] := '{}';
  v_trab uuid[];
  v_dueno uuid;
  v_cli uuid[];
  v_ubic uuid;
  v_jor uuid;
  v_t uuid;
  v_c uuid;
  v_estado text;
  v_hora timestamptz;
  v_venta uuid;
  v_pago uuid;
  v_total numeric;
  v_monto numeric;
  v_n int;
  v_i int;
  v_k int;
  v_usados uuid[];
  r record;
  p record;
begin
  -- 0) Borrar lo creado antes por este archivo
  delete from pagos where id in (select id from pruebas.datos_calendario where tabla = 'pagos')
     or venta_pedido_id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
  delete from venta_items where venta_pedido_id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
  delete from ventas_pedidos where id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos');
  delete from jornada_vendedores where jornada_id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
  delete from ruta_paradas where jornada_id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
  delete from jornadas where id in (select id from pruebas.datos_calendario where tabla = 'jornadas');
  delete from pruebas.datos_calendario;

  -- 1) Quiénes, a quién y desde dónde
  select id into v_dueno from perfiles where rol = 'dueno' and coalesce(activo, true) order by nombre limit 1;
  select array_agg(id) into v_trab from (
    select id from perfiles where rol = 'vendedor' and coalesce(activo, true) order by (nombre ilike 'gonzalo%') desc, nombre limit 2
  ) x;
  v_trab := coalesce(v_trab, '{}') || v_dueno;
  if array_length(v_trab, 1) is null or v_dueno is null then raise exception 'No hay gerente/caseros activos'; end if;

  -- Clientes: primero los de Colbún o "(prueba)", si no alcanzan, cualquiera
  select array_agg(id) into v_cli from (
    select id from clientes
     order by (coalesce(direccion, '') ilike '%colb%n%' or nombre ilike '%(prueba)%') desc, random()
     limit 40
  ) x;
  if coalesce(array_length(v_cli, 1), 0) < 8 then raise exception 'Se necesitan al menos 8 clientes (hay %)', coalesce(array_length(v_cli, 1), 0); end if;
  select id into v_ubic from ubicaciones_inventario order by (tipo = 'furgon') desc limit 1;
  if v_ubic is null then raise exception 'No hay bodega ni furgón'; end if;
  if not exists (select 1 from productos where activo and precio_venta > 0) then raise exception 'No hay productos con precio'; end if;

  -- 2) Días: los 5 días hábiles anteriores a hoy sin una ruta real
  v_dia := v_hoy - 1;
  while coalesce(array_length(v_dias, 1), 0) < 5 and v_dia > v_hoy - 40 loop
    if extract(isodow from v_dia) < 6 and not exists (select 1 from jornadas where fecha = v_dia) then
      v_dias := v_dias || v_dia;
    end if;
    v_dia := v_dia - 1;
  end loop;

  -- El aviso "Te asignaron clientes" no se envía por estos datos de prueba
  if exists (select 1 from pg_trigger where tgname = 'ruta_paradas_notificar') then
    alter table ruta_paradas disable trigger ruta_paradas_notificar;
  end if;

  -- Del más antiguo al más nuevo (así hay ventas de prueba anteriores que cobrar)
  for v_k in reverse coalesce(array_length(v_dias, 1), 0)..1 loop
    v_dia := v_dias[v_k];
    insert into jornadas (fecha, estado, creado_por, iniciada_en, finalizada_en)
    values (v_dia, 'finalizada', v_dueno, (v_dia + time '09:00') at time zone 'America/Santiago', (v_dia + time '18:30') at time zone 'America/Santiago')
    returning id into v_jor;
    insert into pruebas.datos_calendario values ('jornadas', v_jor);
    v_usados := '{}';

    -- 2 o 3 trabajadores ese día (el gerente sale día por medio)
    foreach v_t in array v_trab loop
      continue when v_t = v_dueno and v_k % 2 = 0 and array_length(v_trab, 1) > 2;
      insert into jornada_vendedores (jornada_id, vendedor_id, estado, iniciada_en, finalizada_en)
      values (v_jor, v_t, 'finalizada', (v_dia + time '09:00') at time zone 'America/Santiago', (v_dia + time '18:00') at time zone 'America/Santiago')
      on conflict (jornada_id, vendedor_id) do nothing;

      v_n := 4 + floor(random() * 4)::int; -- 4 a 7 paradas
      v_i := 0;
      for v_c in select c from unnest(v_cli) c where not (c = any(v_usados)) order by random() limit v_n loop
        v_i := v_i + 1;
        v_usados := v_usados || v_c;
        v_estado := case when random() < 0.6 then 'visitado' when random() < 0.6 then 'no_estaba' else 'pendiente' end;
        v_hora := (v_dia + time '09:30' + (v_i * interval '50 minutes') + (random() * interval '20 minutes')) at time zone 'America/Santiago';
        insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden, estado, visitado_en)
        values (v_jor, v_t, v_c, v_i, v_estado, case when v_estado = 'pendiente' then null else v_hora end);

        continue when v_estado <> 'visitado';

        -- Venta (55% de las visitas): 1 a 3 productos reales
        if random() < 0.55 then
          insert into ventas_pedidos (cliente_id, vendedor_id, monto_total, saldo_pendiente, estado_pago, descripcion, fecha_venta, creado_en)
          values (v_c, v_t, 0, 0, 'pendiente', '(prueba calendario)', v_hora, v_hora)
          returning id into v_venta;
          insert into pruebas.datos_calendario values ('ventas_pedidos', v_venta);
          for p in select id, precio_venta from productos where activo and precio_venta > 0 order by random() limit (1 + floor(random() * 3)::int) loop
            insert into venta_items (venta_pedido_id, producto_id, ubicacion_id, cantidad, precio_lista, descuento_tipo, descuento_valor, precio_final)
            values (v_venta, p.id, v_ubic, case when random() < 0.8 then 1 else 2 end, p.precio_venta, 'ninguno', 0, p.precio_venta);
          end loop;
          select sum(precio_final * cantidad) into v_total from venta_items where venta_pedido_id = v_venta;
          update ventas_pedidos set monto_total = v_total, saldo_pendiente = v_total where id = v_venta;
          -- Al contado (20%) o con pie (40% de las de crédito); el trigger de pagos descuenta el saldo
          v_monto := case when random() < 0.2 then v_total
                          when random() < 0.4 then least(v_total, greatest(5000, round(v_total * 0.2 / 1000) * 1000))
                          else 0 end;
          if v_monto > 0 then
            insert into pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago, fecha_pago, creado_en)
            values (v_venta, v_t, v_monto, case when random() < 0.65 then 'efectivo' else 'transferencia' end, v_hora, v_hora)
            returning id into v_pago;
            insert into pruebas.datos_calendario values ('pagos', v_pago);
          end if;
        end if;

        -- Abono (60% de las visitas) a una compra de prueba anterior de ese cliente que tenga saldo
        if random() < 0.6 then
          select vp.id, vp.saldo_pendiente into r from ventas_pedidos vp
           where vp.cliente_id = v_c and vp.saldo_pendiente > 0 and vp.creado_en < v_hora
             and vp.id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos')
           order by vp.creado_en limit 1;
          if r.id is not null then
            v_monto := least(r.saldo_pendiente, (5 + floor(random() * 36)::int) * 1000);
            insert into pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago, fecha_pago, creado_en)
            values (r.id, v_t, v_monto, case when random() < 0.65 then 'efectivo' else 'transferencia' end, v_hora + interval '5 minutes', v_hora + interval '5 minutes')
            returning id into v_pago;
            insert into pruebas.datos_calendario values ('pagos', v_pago);
          end if;
        end if;
      end loop;

      -- Un cobro a un cliente que no estaba en su ruta de hoy (1 de cada 2 trabajadores)
      if random() < 0.5 then
        select vp.id, vp.saldo_pendiente into r from ventas_pedidos vp
         where vp.saldo_pendiente > 0 and vp.creado_en < (v_dia::timestamp at time zone 'America/Santiago')
           and not (vp.cliente_id = any(v_usados))
           and vp.id in (select id from pruebas.datos_calendario where tabla = 'ventas_pedidos')
         order by random() limit 1;
        if r.id is not null then
          v_hora := (v_dia + time '17:40') at time zone 'America/Santiago';
          insert into pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago, fecha_pago, creado_en)
          values (r.id, v_t, least(r.saldo_pendiente, 10000), 'efectivo', v_hora, v_hora)
          returning id into v_pago;
          insert into pruebas.datos_calendario values ('pagos', v_pago);
        end if;
      end if;
    end loop;
  end loop;

  if exists (select 1 from pg_trigger where tgname = 'ruta_paradas_notificar') then
    alter table ruta_paradas enable trigger ruta_paradas_notificar;
  end if;

  raise notice 'Listo: % días, % ventas y % pagos de prueba',
    coalesce(array_length(v_dias, 1), 0),
    (select count(*) from pruebas.datos_calendario where tabla = 'ventas_pedidos'),
    (select count(*) from pruebas.datos_calendario where tabla = 'pagos');
end $$;

-- Resumen de lo creado
select j.fecha, count(distinct rp.vendedor_id) as trabajadores, count(rp.id) as clientes,
       (select count(*) from ventas_pedidos v where v.descripcion = '(prueba calendario)' and (v.creado_en at time zone 'America/Santiago')::date = j.fecha) as ventas,
       (select count(*) from pagos pg join pruebas.datos_calendario d on d.tabla = 'pagos' and d.id = pg.id
         where (pg.creado_en at time zone 'America/Santiago')::date = j.fecha) as pagos
  from jornadas j join pruebas.datos_calendario d on d.tabla = 'jornadas' and d.id = j.id
  left join ruta_paradas rp on rp.jornada_id = j.id
 group by j.fecha order by j.fecha;
