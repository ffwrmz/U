-- Borra la ruta de HOY como si nunca se hubiera armado: clientes asignados, inicio y fin de ruta,
-- posiciones GPS, avisos de "Te asignaron clientes" y los clientes que se pasaron a mañana al finalizar.
-- NO borra ventas ni pagos (eso es plata real; si hay que borrarlos, se hace aparte).
-- Supabase > SQL Editor > Run.

-- 1) Lo que se va a borrar
select
  (select count(*) from ruta_paradas rp join jornadas j on j.id = rp.jornada_id
    where j.fecha = (now() at time zone 'America/Santiago')::date) as clientes_en_ruta,
  (select count(*) from jornada_vendedores jv join jornadas j on j.id = jv.jornada_id
    where j.fecha = (now() at time zone 'America/Santiago')::date) as rutas_iniciadas,
  (select count(*) from posiciones_vendedor p join jornadas j on j.id = p.jornada_id
    where j.fecha = (now() at time zone 'America/Santiago')::date) as posiciones_gps;

-- 2) Borrar
do $$
declare v_jor uuid; v_fecha date := (now() at time zone 'America/Santiago')::date;
begin
  select id into v_jor from jornadas where fecha = v_fecha;
  if v_jor is null then raise notice 'Hoy no hay ruta creada: no hay nada que borrar'; return; end if;
  perform set_config('app.depuracion', '1', true); -- permite borrar paradas aunque la ruta esté en curso

  delete from notificaciones where tipo = 'ruta_asignada' and datos->>'jornada_id' = v_jor::text;
  delete from preasignaciones where fecha = v_fecha + 1 and origen = 'pendiente_ayer';
  delete from posiciones_vendedor where jornada_id = v_jor;
  delete from jornada_vendedores where jornada_id = v_jor;
  delete from ruta_paradas where jornada_id = v_jor;
  delete from jornadas where id = v_jor;
  raise notice 'Ruta de hoy borrada';
end $$;
