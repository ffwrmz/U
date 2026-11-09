-- =====================================================================
-- Santa Teresita: zonas (comuna > sector > pasaje / calle) y direcciones
-- Supabase > SQL Editor > Run. Se puede correr más de una vez.
-- Crea: comunas, sectores, pasajes, calles. Rehace direcciones.
-- Agrega clientes.direccion_id (un cliente -> una dirección; una dirección -> varios clientes).
-- =====================================================================

-- 0) (OPCIONAL, NO SE EJECUTA) Borrar los datos de prueba ANTES de correr el resto de este archivo.
--    Quita los "--" y córrelo aparte solo si quieres dejar todo vacío. NO se puede deshacer.
-- delete from public.pagos;
-- delete from public.venta_items;
-- delete from public.ventas_pedidos;
-- delete from public.solicitudes_descuento;
-- delete from public.direcciones;   -- antes que clientes: la tabla antigua apunta a clientes
-- delete from public.clientes;

-- 1) Catálogo de zonas (lo administra el gerente desde la pantalla "Zonas")
create table if not exists public.comunas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true,
  creado_en timestamptz default now()
);

create table if not exists public.sectores (
  id uuid primary key default gen_random_uuid(),
  comuna_id uuid not null references public.comunas(id),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz default now(),
  unique (comuna_id, nombre)
);

create table if not exists public.pasajes (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references public.sectores(id),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz default now(),
  unique (sector_id, nombre)
);

create table if not exists public.calles (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references public.sectores(id),
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz default now(),
  unique (sector_id, nombre)
);

-- 2) Rehacer direcciones. La tabla antigua (cliente_id, pais, region, ciudad, calle texto)
--    solo tenía datos de prueba: si todavía tiene esa forma, se borra y se crea de nuevo.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'direcciones' and column_name = 'cliente_id') then
    drop table public.direcciones cascade;
  end if;
end $$;

create table if not exists public.direcciones (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references public.sectores(id),
  pasaje_id uuid references public.pasajes(id),
  calle_id uuid not null references public.calles(id),
  numero text,
  referencia text,
  latitud double precision,
  longitud double precision,
  creado_en timestamptz default now(),
  -- La misma dirección no se repite: varios clientes la comparten vía clientes.direccion_id
  constraint direcciones_unica unique nulls not distinct (calle_id, pasaje_id, numero)
);

-- 3) clientes.direccion_id. clientes.direccion (texto) queda DEPRECADO: la app lo sigue
--    llenando con un texto armado para que las pantallas antiguas muestren algo.
alter table public.clientes add column if not exists direccion_id uuid;
alter table public.clientes drop constraint if exists clientes_direccion_id_fkey;
alter table public.clientes add constraint clientes_direccion_id_fkey
  foreign key (direccion_id) references public.direcciones(id);
comment on column public.clientes.direccion is 'DEPRECADO: usar direccion_id. Se llena con un texto armado desde direcciones.';

-- 4) Seguridad (RLS): todos los usuarios logueados leen.
--    El catálogo solo lo modifica el dueño.
--    Direcciones: cualquier usuario logueado puede crear (el casero también registra clientes);
--    modificar o borrar solo el dueño.
alter table public.comunas enable row level security;
alter table public.sectores enable row level security;
alter table public.pasajes enable row level security;
alter table public.calles enable row level security;
alter table public.direcciones enable row level security;

drop policy if exists comunas_leer on public.comunas;
create policy comunas_leer on public.comunas for select to authenticated using (true);
drop policy if exists comunas_dueno on public.comunas;
create policy comunas_dueno on public.comunas for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');

drop policy if exists sectores_leer on public.sectores;
create policy sectores_leer on public.sectores for select to authenticated using (true);
drop policy if exists sectores_dueno on public.sectores;
create policy sectores_dueno on public.sectores for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');

drop policy if exists pasajes_leer on public.pasajes;
create policy pasajes_leer on public.pasajes for select to authenticated using (true);
drop policy if exists pasajes_dueno on public.pasajes;
create policy pasajes_dueno on public.pasajes for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');

drop policy if exists calles_leer on public.calles;
create policy calles_leer on public.calles for select to authenticated using (true);
drop policy if exists calles_dueno on public.calles;
create policy calles_dueno on public.calles for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');

drop policy if exists direcciones_leer on public.direcciones;
create policy direcciones_leer on public.direcciones for select to authenticated using (true);
drop policy if exists direcciones_crear on public.direcciones;
create policy direcciones_crear on public.direcciones for insert to authenticated
  with check (get_rol_usuario() in ('dueno', 'vendedor'));
drop policy if exists direcciones_modificar on public.direcciones;
create policy direcciones_modificar on public.direcciones for update to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');
drop policy if exists direcciones_borrar on public.direcciones;
create policy direcciones_borrar on public.direcciones for delete to authenticated
  using (get_rol_usuario() = 'dueno');
