-- =====================================================================
-- Santa Teresita: modo sin conexión
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Requiere 20261123140000_asegurar_direccion.sql (asegurar_direccion).
--  * ejecutar_accion_offline: la app sube cada venta / pago / cliente guardado sin señal con un id propio.
--    Si la misma acción llega dos veces (se cortó la señal justo al subirla), la segunda no hace nada.
--  * registrar_cliente: crea el cliente (con el id que trae la app) y su dirección en una sola operación.
-- =====================================================================

create table if not exists public.acciones_offline (
  id uuid primary key,                      -- id generado en el teléfono
  usuario_id uuid not null default auth.uid() references auth.users(id),
  tipo text not null,
  resultado jsonb,
  creado_en timestamptz not null default now()
);
alter table public.acciones_offline enable row level security;
drop policy if exists ao_propias on public.acciones_offline;
create policy ao_propias on public.acciones_offline for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Cliente nuevo + dirección (crea comuna / sector / pasaje si faltan, vía asegurar_direccion).
-- Respeta los permisos de siempre para crear clientes (corre con los permisos de quien la llama).
create or replace function public.registrar_cliente(
  p_id uuid, p_nombre text, p_rut text, p_telefono text,
  p_comuna text, p_sector text, p_pasaje text,
  p_numero text default null, p_referencia text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_texto_direccion text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare v_dir uuid; v_existe uuid;
begin
  select id, direccion_id into v_existe, v_dir from clientes where id = p_id;
  if v_existe is not null then
    return jsonb_build_object('cliente_id', p_id, 'direccion_id', v_dir); -- ya estaba (reintento)
  end if;
  v_dir := asegurar_direccion(p_comuna, p_sector, p_pasaje, p_numero, p_referencia, p_lat, p_lng);
  insert into clientes (id, nombre, rut, telefono, direccion_id, direccion, creado_por)
  values (p_id, btrim(p_nombre), btrim(p_rut), p_telefono, v_dir, p_texto_direccion, auth.uid());
  return jsonb_build_object('cliente_id', p_id, 'direccion_id', v_dir);
end $$;
revoke all on function public.registrar_cliente(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text) from public, anon;
grant execute on function public.registrar_cliente(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text) to authenticated;

-- Ejecuta una acción guardada sin conexión UNA sola vez (por su id). Devuelve lo mismo que la función original.
create or replace function public.ejecutar_accion_offline(p_id uuid, p_tipo text, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v jsonb; a jsonb := coalesce(p_args, '{}'::jsonb);
begin
  select resultado into v from acciones_offline where id = p_id;
  if found then return v; end if;

  if p_tipo = 'registrar_pago' then
    v := to_jsonb(registrar_pago((a->>'p_monto')::numeric, a->>'p_metodo', (a->>'p_cliente_id')::uuid, (a->>'p_venta_id')::uuid));
  elsif p_tipo = 'registrar_venta' then
    v := to_jsonb(registrar_venta((a->>'p_cliente')::uuid, (a->>'p_ubicacion')::uuid, coalesce(a->'p_items', '[]'::jsonb),
                                  coalesce((a->>'p_contado')::boolean, false), coalesce((a->>'p_pie')::numeric, 0),
                                  coalesce(a->>'p_metodo', 'efectivo'), a->>'p_nota'));
  elsif p_tipo = 'registrar_cliente' then
    v := registrar_cliente((a->>'p_id')::uuid, a->>'p_nombre', a->>'p_rut', a->>'p_telefono',
                           a->>'p_comuna', a->>'p_sector', a->>'p_pasaje', a->>'p_numero', a->>'p_referencia',
                           (a->>'p_lat')::double precision, (a->>'p_lng')::double precision, a->>'p_texto_direccion');
  else
    raise exception 'Acción no soportada: %', p_tipo using errcode = '22023';
  end if;

  insert into acciones_offline (id, tipo, resultado) values (p_id, p_tipo, v);
  return v;
end $$;
revoke all on function public.ejecutar_accion_offline(uuid, text, jsonb) from public, anon;
grant execute on function public.ejecutar_accion_offline(uuid, text, jsonb) to authenticated;
