-- =====================================================================
-- Santa Teresita: calendario de preasignaciones
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- El gerente deja clientes asignados a un casero para un día futuro (o de hoy).
-- Al asignar la ruta del día, la app muestra primero los preasignados para esa fecha.
-- =====================================================================
create table if not exists public.preasignaciones (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  vendedor_id uuid not null references public.perfiles(id),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  orden integer not null default 0,
  nota text,
  creado_por uuid references auth.users(id) default auth.uid(),
  creado_en timestamptz default now(),
  -- Un cliente va con un solo casero por día
  constraint preasignaciones_unica unique (fecha, cliente_id)
);
create index if not exists preasignaciones_fecha_idx on public.preasignaciones (fecha, vendedor_id, orden);
create index if not exists preasignaciones_cliente_idx on public.preasignaciones (cliente_id, fecha);

alter table public.preasignaciones enable row level security;
drop policy if exists pre_leer on public.preasignaciones;
create policy pre_leer on public.preasignaciones for select to authenticated
  using (get_rol_usuario() = 'dueno' or vendedor_id = auth.uid());
drop policy if exists pre_dueno on public.preasignaciones;
create policy pre_dueno on public.preasignaciones for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');
