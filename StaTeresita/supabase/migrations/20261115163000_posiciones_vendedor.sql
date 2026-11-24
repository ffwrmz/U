-- =====================================================================
-- Santa Teresita: seguimiento de los caseros (pantalla "Seguimiento" del gerente)
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Guarda la posición del casero mientras su ruta está en curso y la app está abierta
-- (cada ~30 s o 50 m; no hay seguimiento en segundo plano).
-- =====================================================================
create table if not exists public.posiciones_vendedor (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.perfiles(id),
  jornada_id uuid not null references public.jornadas(id) on delete cascade,
  latitud double precision not null check (latitud between -56.5 and -17),   -- dentro de Chile
  longitud double precision not null check (longitud between -110 and -66),
  precision_m double precision,
  registrada_en timestamptz not null default now()
);
create index if not exists posiciones_vendedor_idx on public.posiciones_vendedor (jornada_id, vendedor_id, registrada_en);

alter table public.posiciones_vendedor enable row level security;
-- Cada casero (o el dueño) solo registra su propia posición
drop policy if exists pv_insertar on public.posiciones_vendedor;
create policy pv_insertar on public.posiciones_vendedor for insert to authenticated
  with check (vendedor_id = auth.uid() and get_rol_usuario() in ('vendedor', 'dueno'));
-- El dueño ve todo; el casero solo lo suyo
drop policy if exists pv_leer on public.posiciones_vendedor;
create policy pv_leer on public.posiciones_vendedor for select to authenticated
  using (get_rol_usuario() = 'dueno' or vendedor_id = auth.uid());
-- Modificar o borrar: solo el dueño
drop policy if exists pv_dueno_modificar on public.posiciones_vendedor;
create policy pv_dueno_modificar on public.posiciones_vendedor for update to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');
drop policy if exists pv_dueno_borrar on public.posiciones_vendedor;
create policy pv_dueno_borrar on public.posiciones_vendedor for delete to authenticated
  using (get_rol_usuario() = 'dueno');
