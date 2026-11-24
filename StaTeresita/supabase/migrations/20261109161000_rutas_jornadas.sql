-- =====================================================================
-- Santa Teresita: rutas guardadas (una jornada por día, paradas por vendedor)
-- Ya aplicada en Supabase el 2026-11-09. Crea: jornadas, ruta_paradas.
-- =====================================================================
create table if not exists public.jornadas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null unique default current_date,
  estado text not null default 'preparacion' check (estado in ('preparacion','en_curso','finalizada')),
  creado_por uuid references auth.users(id) default auth.uid(),
  creado_en timestamptz default now(),
  iniciada_en timestamptz,
  finalizada_en timestamptz
);
create table if not exists public.ruta_paradas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references public.jornadas(id) on delete cascade,
  vendedor_id uuid not null references public.perfiles(id),
  cliente_id uuid not null references public.clientes(id),
  orden integer not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente','visitado','no_estaba')),
  visitado_en timestamptz,
  nota text,
  creado_en timestamptz default now(),
  constraint ruta_paradas_unica unique (jornada_id, cliente_id)
);
create index if not exists ruta_paradas_jornada_vendedor_idx on public.ruta_paradas (jornada_id, vendedor_id, orden);
alter table public.jornadas enable row level security;
alter table public.ruta_paradas enable row level security;
create policy jornadas_leer on public.jornadas for select to authenticated using (true);
create policy jornadas_dueno on public.jornadas for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');
create policy paradas_leer on public.ruta_paradas for select to authenticated
  using (get_rol_usuario() = 'dueno' or vendedor_id = auth.uid());
create policy paradas_dueno on public.ruta_paradas for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');
create policy paradas_vendedor_marca on public.ruta_paradas for update to authenticated
  using (vendedor_id = auth.uid()) with check (vendedor_id = auth.uid());
