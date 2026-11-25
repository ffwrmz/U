-- =====================================================================
-- Santa Teresita: depuración de la base (A: borrar lo que no se usa · B: arreglos sin borrar datos)
-- Supabase > SQL Editor > Run. Se puede correr más de una vez.
-- Primero muestra un CONTEO de lo que se va a borrar o revisar (tabla al final del resultado).
-- No usa "cascade": si algo inesperado depende de lo que se borra, se detiene con el mensaje de Postgres.
-- =====================================================================

-- 0) Conteo previo (para ver antes qué hay)
create temp table if not exists _depuracion_conteo (cosa text, filas bigint);
truncate _depuracion_conteo;
do $$
declare n bigint;
begin
  if to_regclass('public.rutas_base') is not null then
    execute 'select count(*) from public.rutas_base' into n; insert into _depuracion_conteo values ('rutas_base (se borra)', n);
  end if;
  if to_regclass('public.rutas_base_paradas') is not null then
    execute 'select count(*) from public.rutas_base_paradas' into n; insert into _depuracion_conteo values ('rutas_base_paradas (se borra)', n);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jornadas' and column_name = 'cargada_desde_base') then
    execute 'select count(*) from public.jornadas where cargada_desde_base' into n; insert into _depuracion_conteo values ('jornadas cargadas desde rutas base (se borra la columna)', n);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas_pedidos' and column_name = 'estado_pedido') then
    execute 'select count(*) from public.ventas_pedidos where coalesce(estado_pedido, ''preparacion'') <> ''preparacion''' into n;
    insert into _depuracion_conteo values ('ventas con estado_pedido distinto de preparacion (se borra la columna)', n);
  end if;
  select count(*) into n from public.pagos where coalesce(metodo_pago, '') not in ('efectivo', 'transferencia');
  insert into _depuracion_conteo values ('pagos con método distinto de efectivo/transferencia (revisar)', n);
  select count(*) into n from (select 1 from public.ruta_paradas group by jornada_id, cliente_id having count(*) > 1) d;
  insert into _depuracion_conteo values ('paradas repetidas (mismo día y cliente)', n);
  select count(*) into n from (select 1 from public.inventario_stock group by ubicacion_id, producto_id having count(*) > 1) d;
  insert into _depuracion_conteo values ('stock repetido (misma ubicación y producto)', n);
end $$;

-- ===================== A) Borrar lo que no se usa =====================
-- Rutas de la semana (se quitaron de la app)
drop function if exists public.preparar_jornada_hoy();
drop function if exists public.cargar_rutas_base(uuid, boolean);
drop table if exists public.rutas_base_paradas;
drop table if exists public.rutas_base;
alter table public.jornadas drop column if exists cargada_desde_base;
-- Estado del pedido (preparación / reparto / cerrado): ninguna pantalla ni función lo usa
alter table public.ventas_pedidos drop column if exists estado_pedido;

-- ===================== B) Arreglos sin borrar datos =====================
-- vendedor_id tenía dos llaves foráneas (a usuarios y a perfiles); basta la de perfiles
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'fk_vendedor_perfil' and conrelid = 'public.ventas_pedidos'::regclass) then
    alter table public.ventas_pedidos drop constraint if exists ventas_pedidos_vendedor_id_fkey;
  end if;
end $$;

-- Método de pago: solo efectivo o transferencia (si hay datos raros, queda sin validar y se avisa)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pagos_metodo_valido') then
    alter table public.pagos add constraint pagos_metodo_valido check (metodo_pago in ('efectivo', 'transferencia')) not valid;
  end if;
  begin
    alter table public.pagos validate constraint pagos_metodo_valido;
  exception when check_violation then
    raise notice 'Hay pagos con un método distinto de efectivo/transferencia: la regla aplica a los nuevos; revisa los antiguos';
  end;
end $$;

-- Índices para que las búsquedas sigan rápidas con muchos datos
create index if not exists ventas_pedidos_cliente_idx on public.ventas_pedidos (cliente_id);
create index if not exists ventas_pedidos_vendedor_fecha_idx on public.ventas_pedidos (vendedor_id, creado_en);
create index if not exists ventas_pedidos_creado_idx on public.ventas_pedidos (creado_en);
create index if not exists pagos_venta_idx on public.pagos (venta_pedido_id);
create index if not exists pagos_cobrador_fecha_idx on public.pagos (cobrador_id, creado_en);
create index if not exists pagos_creado_idx on public.pagos (creado_en);
create index if not exists venta_items_venta_idx on public.venta_items (venta_pedido_id);
create index if not exists ruta_paradas_cliente_idx on public.ruta_paradas (cliente_id);
create index if not exists posiciones_vendedor_jornada_idx on public.posiciones_vendedor (jornada_id, vendedor_id, registrada_en);
create index if not exists clientes_direccion_idx on public.clientes (direccion_id);

-- Reglas únicas que la app necesita (solo si faltan y no hay repetidos)
do $$ begin
  if not exists (select 1 from pg_index i where i.indrelid = 'public.ruta_paradas'::regclass and i.indisunique
                   and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                         where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['cliente_id', 'jornada_id']) then
    if exists (select 1 from public.ruta_paradas group by jornada_id, cliente_id having count(*) > 1) then
      raise notice 'ruta_paradas tiene clientes repetidos en un mismo día: no se agregó la regla única (revisar)';
    else
      alter table public.ruta_paradas add constraint ruta_paradas_unica unique (jornada_id, cliente_id);
    end if;
  end if;
  if not exists (select 1 from pg_index i where i.indrelid = 'public.inventario_stock'::regclass and i.indisunique
                   and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                         where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['producto_id', 'ubicacion_id']) then
    if exists (select 1 from public.inventario_stock group by ubicacion_id, producto_id having count(*) > 1) then
      raise notice 'inventario_stock tiene filas repetidas: no se agregó la regla única (revisar)';
    else
      alter table public.inventario_stock add constraint inventario_stock_unico unique (ubicacion_id, producto_id);
    end if;
  end if;
end $$;

-- Resultado: lo que había antes de depurar
select * from _depuracion_conteo;
