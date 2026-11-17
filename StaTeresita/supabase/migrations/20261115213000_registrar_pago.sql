-- DEF-01 y DEF-07: el registro de pagos pasa a la base de datos en una sola transacción.
-- Antes la app hacía insert en pagos + update en ventas_pedidos por separado; la RLS bloqueaba
-- el update para el casero y la venta nunca quedaba "pagada".

-- 1) El trigger descuenta el saldo y marca la venta como pagada al llegar a 0
create or replace function public.actualizar_saldo_venta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update ventas_pedidos
     set saldo_pendiente = saldo_pendiente - new.monto_abonado,
         estado_pago = case when saldo_pendiente - new.monto_abonado <= 0 then 'pagada' else estado_pago end
   where id = new.venta_pedido_id;
  return new;
end $$;

-- 2) registrar_pago: con p_venta_id abona a esa compra; con p_cliente_id reparte FIFO
--    (compra más antigua primero). Devuelve la deuda que le queda al cliente.
create or replace function public.registrar_pago(
  p_monto numeric,
  p_metodo text default 'efectivo',
  p_cliente_id uuid default null,
  p_venta_id uuid default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_cliente uuid;
  v_deuda numeric;
  v_resto numeric := p_monto;
  v_parte numeric;
  r record;
begin
  if coalesce(get_rol_usuario(), '') not in ('dueno', 'vendedor') then
    raise exception 'Sin permiso para registrar pagos' using errcode = '42501';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0' using errcode = '22023';
  end if;
  if coalesce(p_metodo, '') not in ('efectivo', 'transferencia') then
    raise exception 'Método de pago inválido' using errcode = '22023';
  end if;
  if (p_cliente_id is null) = (p_venta_id is null) then
    raise exception 'Indica el cliente o la compra (solo uno)' using errcode = '22023';
  end if;

  if p_venta_id is not null then
    select cliente_id into v_cliente from ventas_pedidos where id = p_venta_id;
    if not found then raise exception 'La compra no existe' using errcode = 'P0002'; end if;
  else
    v_cliente := p_cliente_id;
  end if;

  -- Bloquea las compras con deuda: dos cobros simultáneos no se pisan
  select coalesce(sum(saldo_pendiente), 0) into v_deuda from (
    select saldo_pendiente from ventas_pedidos
     where cliente_id = v_cliente
       and (p_venta_id is null or id = p_venta_id)
       and estado_pago <> 'anulada' and saldo_pendiente > 0
     for update) t;

  if v_deuda = 0 then raise exception 'No hay deuda pendiente' using errcode = '22023'; end if;
  if p_monto > v_deuda then
    raise exception 'El abono (%) supera la deuda (%)', p_monto, v_deuda using errcode = '22023';
  end if;

  for r in
    select id, saldo_pendiente from ventas_pedidos
     where cliente_id = v_cliente
       and (p_venta_id is null or id = p_venta_id)
       and estado_pago <> 'anulada' and saldo_pendiente > 0
     order by fecha_venta, creado_en, id
  loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, r.saldo_pendiente);
    insert into pagos (venta_pedido_id, cobrador_id, monto_abonado, metodo_pago)
    values (r.id, auth.uid(), v_parte, p_metodo);   -- el trigger descuenta el saldo
    v_resto := v_resto - v_parte;
  end loop;

  return (select coalesce(sum(saldo_pendiente), 0) from ventas_pedidos
           where cliente_id = v_cliente and estado_pago <> 'anulada');
end $$;

revoke execute on function public.registrar_pago(numeric, text, uuid, uuid) from public, anon;
grant execute on function public.registrar_pago(numeric, text, uuid, uuid) to authenticated;
