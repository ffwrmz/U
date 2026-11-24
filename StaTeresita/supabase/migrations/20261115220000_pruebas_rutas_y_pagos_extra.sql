-- Pruebas del Incremento 2 (rutas y jornada) y casos de pagos ligados a AC-PAG-01, RNF-INT-02 y RNF-EXA-02
-- Pegar completo en el SQL Editor de Supabase y presionar Run (una sola vez).
-- Después, para ejecutar:  select * from pruebas.todas();

create or replace function pruebas._preparar_ruta(out jor uuid, out c1 uuid, out c2 uuid, out c3 uuid)
language plpgsql as $$
declare v_dueno uuid; v_vend uuid;
begin
  select id into v_dueno from perfiles where rol = 'dueno' and activo limit 1;
  select id into v_vend  from perfiles where rol = 'vendedor' and activo limit 1;
  insert into jornadas (fecha, estado, creado_por) values (date '2099-01-01', 'preparacion', v_dueno) returning id into jor;
  insert into clientes (nombre, telefono, rut, creado_por) values
    ('Cliente PRUEBA ruta 1', '56900000000', 'T-' || left(replace(gen_random_uuid()::text, '-', ''), 12), v_dueno) returning id into c1;
  insert into clientes (nombre, telefono, rut, creado_por) values
    ('Cliente PRUEBA ruta 2', '56900000000', 'T-' || left(replace(gen_random_uuid()::text, '-', ''), 12), v_dueno) returning id into c2;
  insert into clientes (nombre, telefono, rut, creado_por) values
    ('Cliente PRUEBA ruta 3', '56900000000', 'T-' || left(replace(gen_random_uuid()::text, '-', ''), 12), v_dueno) returning id into c3;
  insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden) values
    (jor, v_vend, c1, 1), (jor, v_vend, c2, 2), (jor, v_vend, c3, 3);
end $$;

create or replace function pruebas.rutas()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $$
declare
  f record; v_dueno uuid; v_vend uuid; v_otro uuid;
  n int; n2 int; ea text; err text; ok boolean;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  -- R-01 AC-RUT-01
  id := 'R-01'; caso := 'Casero inicia su ruta con 3 clientes asignados (AC-RUT-01)';
  esperado := 'su ruta queda en_curso y ve sus 3 visitas';
  begin
    f := pruebas._preparar_ruta(); perform pruebas._como(v_vend);
    perform iniciar_mi_ruta(f.jor);
    select estado into ea from jornada_vendedores where jornada_id = f.jor and vendedor_id = v_vend;
    set local role authenticated;   -- desde aquí aplica RLS, como en la app
    select count(*) into n from ruta_paradas where jornada_id = f.jor;
    reset role;
    ok := ea = 'en_curso' and n = 3;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(ea, 'sin estado') || ', ve ' || n || ' visitas';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- R-02 AC-RUT-02
  id := 'R-02'; caso := 'Casero marca la visita 1 como visitada (AC-RUT-02)';
  esperado := '1 fila actualizada; el gerente la ve visitada';
  begin
    f := pruebas._preparar_ruta(); perform pruebas._como(v_vend);
    set local role authenticated;
    update ruta_paradas set estado = 'visitado', visitado_en = now() where jornada_id = f.jor and cliente_id = f.c1;
    get diagnostics n = row_count;
    reset role;
    perform pruebas._como(v_dueno);
    set local role authenticated;
    select estado into ea from ruta_paradas where jornada_id = f.jor and cliente_id = f.c1;
    reset role;
    ok := n = 1 and ea = 'visitado';
    raise exception using errcode = 'PT000', message = ok || '|' || n || ' fila, el gerente ve ' || coalesce(ea, 'nada');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- R-03 AC-SEC-RUT-01
  id := 'R-03'; caso := 'Otro casero (C2) intenta ver y marcar la ruta de C1 (AC-SEC-RUT-01)';
  esperado := 've 0 visitas y actualiza 0 filas';
  begin
    f := pruebas._preparar_ruta(); v_otro := pruebas._usuario_temporal('vendedor');
    perform pruebas._como(v_otro);
    set local role authenticated;
    select count(*) into n from ruta_paradas where jornada_id = f.jor;
    update ruta_paradas set estado = 'visitado' where jornada_id = f.jor;
    get diagnostics n2 = row_count;
    reset role;
    ok := n = 0 and n2 = 0;
    raise exception using errcode = 'PT000', message = ok || '|ve ' || n || ' visitas, actualiza ' || n2 || ' filas';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- R-04
  id := 'R-04'; caso := 'Casero sin clientes asignados intenta iniciar ruta';
  esperado := 'error: no tiene clientes asignados';
  begin
    f := pruebas._preparar_ruta(); v_otro := pruebas._usuario_temporal('vendedor');
    perform pruebas._como(v_otro); err := null;
    begin perform iniciar_mi_ruta(f.jor); exception when others then err := sqlerrm; end;
    ok := err ilike '%no tienes clientes asignados%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- R-05
  id := 'R-05'; caso := 'Casero intenta iniciar una jornada ya finalizada';
  esperado := 'error: la jornada ya terminó';
  begin
    f := pruebas._preparar_ruta(); update jornadas set estado = 'finalizada' where jornadas.id = f.jor;
    perform pruebas._como(v_vend); err := null;
    begin perform iniciar_mi_ruta(f.jor); exception when others then err := sqlerrm; end;
    ok := err ilike '%ya terminó%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- R-06
  id := 'R-06'; caso := 'Casero intenta asignarse un cliente en la ruta';
  esperado := 'rechazado por permisos (solo el gerente asigna)';
  begin
    f := pruebas._preparar_ruta(); delete from ruta_paradas where jornada_id = f.jor and cliente_id = f.c3;
    perform pruebas._como(v_vend); err := null;
    set local role authenticated;
    begin insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden) values (f.jor, v_vend, f.c3, 3);
    exception when others then err := sqlerrm; end;
    reset role;
    ok := err ilike '%row-level security%';
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- R-07
  id := 'R-07'; caso := 'Usuario cliente intenta leer las rutas';
  esperado := 've 0 visitas';
  begin
    f := pruebas._preparar_ruta(); v_otro := pruebas._usuario_temporal('cliente');
    perform pruebas._como(v_otro);
    set local role authenticated;
    select count(*) into n from ruta_paradas where jornada_id = f.jor;
    reset role;
    ok := n = 0;
    raise exception using errcode = 'PT000', message = ok || '|ve ' || n || ' visitas';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- R-08 AC-RUT-03
  id := 'R-08'; caso := 'Gerente quita un cliente con la ruta del casero en curso (AC-RUT-03)';
  esperado := 'rechazado: la ruta está bloqueada';
  begin
    f := pruebas._preparar_ruta(); perform pruebas._como(v_vend); perform iniciar_mi_ruta(f.jor);
    perform pruebas._como(v_dueno); err := null; n := 0;
    set local role authenticated;
    begin delete from ruta_paradas where jornada_id = f.jor and cliente_id = f.c2;
          get diagnostics n = row_count;
    exception when others then err := sqlerrm; end;
    reset role;
    ok := err is not null;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error: se borró ' || n || ' visita');
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $$;

create or replace function pruebas.pagos_extra()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language plpgsql as $$
declare
  f record; v_dueno uuid; v_vend uuid;
  r numeric; sa numeric; n int; i int; err text; ok boolean; rech int;
begin
  select p.id into v_dueno from perfiles p where rol = 'dueno' and activo limit 1;
  select p.id into v_vend  from perfiles p where rol = 'vendedor' and activo limit 1;

  -- P-13 AC-PAG-01
  id := 'P-13'; caso := 'Pago de $50.000 registrado dos veces sobre deuda de $50.000 (AC-PAG-01)';
  esperado := 'el 2º se rechaza; saldo final 0, nunca negativo; 1 pago';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    update ventas_pedidos set monto_total = 50000, saldo_pendiente = 50000 where ventas_pedidos.id = f.va;
    r := registrar_pago(50000, 'efectivo', null, f.va); err := null;
    begin r := registrar_pago(50000, 'efectivo', null, f.va); exception when others then err := sqlerrm; end;
    select saldo_pendiente into sa from ventas_pedidos where ventas_pedidos.id = f.va;
    select count(*) into n from pagos where venta_pedido_id = f.va;
    ok := err is not null and sa = 0 and n = 1;
    raise exception using errcode = 'PT000', message = ok || '|2º: ' || coalesce(err, 'aceptado') || '; saldo ' || sa || ', ' || n || ' pago';
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-14 RNF-INT-02: falla inyectada a mitad de un pago FIFO
  id := 'P-14'; caso := 'Falla inyectada al guardar la 2ª parte de un abono FIFO (RNF-INT-02)';
  esperado := 'error; no queda ningún pago ni saldo modificado';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend);
    execute format($t$create function pruebas._falla() returns trigger language plpgsql as $f$
      begin if new.venta_pedido_id = %L then raise exception 'Falla inyectada'; end if; return new; end $f$ $t$, f.vb);
    create trigger zz_falla_inyectada before insert on pagos for each row execute function pruebas._falla();
    err := null;
    begin r := registrar_pago(15000, 'efectivo', f.cli, null); exception when others then err := sqlerrm; end;
    select count(*) into n from pagos where venta_pedido_id in (f.va, f.vb);
    select saldo_pendiente into sa from ventas_pedidos where ventas_pedidos.id = f.va;
    ok := err ilike '%falla inyectada%' and n = 0 and sa = 10000;
    raise exception using errcode = 'PT000', message = ok || '|' || coalesce(err, 'sin error') || '; ' || n || ' pagos, saldo A ' || sa;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;

  -- P-15 RNF-EXA-02: 30 pagos simulados
  id := 'P-15'; caso := '30 pagos simulados: parciales, totales y repetidos (RNF-EXA-02)';
  esperado := '0 diferencias entre total - pagos y saldo; ningún saldo negativo';
  begin
    f := pruebas._preparar(); perform pruebas._como(v_vend); rech := 0;
    for i in 1..30 loop
      begin
        if i % 3 = 0 then r := registrar_pago(1500, 'transferencia', null, f.vb);   -- parcial a una compra
        elsif i % 5 = 0 then r := registrar_pago(40000, 'efectivo', f.cli, null);  -- mayor que la deuda: se rechaza
        else r := registrar_pago(700, 'efectivo', f.cli, null);                    -- parcial FIFO
        end if;
      exception when others then rech := rech + 1; end;
    end loop;
    select coalesce(sum(saldo_pendiente), 0) into sa from ventas_pedidos where cliente_id = f.cli;
    if sa > 0 then r := registrar_pago(sa, 'efectivo', f.cli, null); end if;           -- pago total final
    select count(*) into n from ventas_pedidos v where v.cliente_id = f.cli
      and (v.saldo_pendiente < 0 or v.monto_total - (select coalesce(sum(monto_abonado), 0) from pagos p where p.venta_pedido_id = v.id) <> v.saldo_pendiente);
    select count(*) into i from pagos p join ventas_pedidos v on v.id = p.venta_pedido_id where v.cliente_id = f.cli;
    ok := n = 0 and r = 0 and rech > 0;
    raise exception using errcode = 'PT000', message = ok || '|' || i || ' pagos guardados, ' || rech || ' rechazados, ' || n || ' diferencias, deuda final ' || r;
  exception when sqlstate 'PT000' then obtenido := split_part(sqlerrm, '|', 2); ok := split_part(sqlerrm, '|', 1)::boolean;
            when others then obtenido := 'ERROR: ' || sqlerrm; ok := false;
  end;
  resultado := case when ok then 'PASA' else 'FALLA' end; return next;
end $$;

-- Todas las pruebas juntas (regresión completa)
create or replace function pruebas.todas()
returns table (id text, caso text, esperado text, obtenido text, resultado text)
language sql as $$
  select * from pruebas.pagos()
  union all select * from pruebas.pagos_extra()
  union all select * from pruebas.ventas()
  union all select * from pruebas.rutas();
$$;

revoke all on all functions in schema pruebas from public, anon, authenticated;
