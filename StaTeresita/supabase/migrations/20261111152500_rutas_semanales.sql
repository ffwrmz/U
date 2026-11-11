-- =====================================================================
-- Santa Teresita: rutas de la semana (ruta base por día de la semana y casero)
-- Ya aplicada en Supabase el 2026-11-11.
-- Crea: rutas_base, rutas_base_paradas, jornadas.cargada_desde_base,
--       funciones cargar_rutas_base(jornada, reemplazar) y preparar_jornada_hoy().
-- dia_semana: 1 = lunes ... 7 = domingo (extract(isodow)).
-- =====================================================================
create table if not exists public.rutas_base (
  id uuid primary key default gen_random_uuid(),
  dia_semana smallint not null check (dia_semana between 1 and 7),
  vendedor_id uuid not null references public.perfiles(id),
  nombre text,
  activo boolean not null default true,
  creado_en timestamptz default now(),
  actualizado_en timestamptz default now(),
  constraint rutas_base_unica unique (dia_semana, vendedor_id)
);
create table if not exists public.rutas_base_paradas (
  id uuid primary key default gen_random_uuid(),
  ruta_base_id uuid not null references public.rutas_base(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  orden integer not null default 0,
  constraint rutas_base_paradas_unica unique (ruta_base_id, cliente_id)
);
create index if not exists rutas_base_paradas_idx on public.rutas_base_paradas (ruta_base_id, orden);
alter table public.jornadas add column if not exists cargada_desde_base boolean not null default false;
alter table public.rutas_base enable row level security;
alter table public.rutas_base_paradas enable row level security;
create policy rutas_base_leer on public.rutas_base for select to authenticated
  using (get_rol_usuario() = 'dueno' or vendedor_id = auth.uid());
create policy rutas_base_dueno on public.rutas_base for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');
create policy rutas_base_paradas_leer on public.rutas_base_paradas for select to authenticated
  using (get_rol_usuario() = 'dueno' or exists (select 1 from public.rutas_base r where r.id = ruta_base_id and r.vendedor_id = auth.uid()));
create policy rutas_base_paradas_dueno on public.rutas_base_paradas for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');

create or replace function public.cargar_rutas_base(p_jornada_id uuid, p_reemplazar boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare v_fecha date; v_estado text; v_dia smallint; v_n integer;
begin
  if get_rol_usuario() is distinct from 'dueno' then raise exception 'Solo el gerente puede cargar rutas base'; end if;
  select fecha, estado into v_fecha, v_estado from jornadas where id = p_jornada_id;
  if v_fecha is null then raise exception 'Jornada no existe'; end if;
  if v_estado <> 'preparacion' then raise exception 'La jornada ya se inició; no se puede cargar la ruta base'; end if;
  v_dia := extract(isodow from v_fecha);
  if p_reemplazar then delete from ruta_paradas where jornada_id = p_jornada_id; end if;
  insert into ruta_paradas (jornada_id, vendedor_id, cliente_id, orden)
  select p_jornada_id, rb.vendedor_id, rbp.cliente_id,
         coalesce((select max(orden) from ruta_paradas x where x.jornada_id = p_jornada_id and x.vendedor_id = rb.vendedor_id), 0)
           + row_number() over (partition by rb.vendedor_id order by rbp.orden)
  from rutas_base rb
  join rutas_base_paradas rbp on rbp.ruta_base_id = rb.id
  join perfiles pf on pf.id = rb.vendedor_id and pf.activo
  where rb.dia_semana = v_dia and rb.activo
  on conflict (jornada_id, cliente_id) do nothing;
  get diagnostics v_n = row_count;
  update jornadas set cargada_desde_base = true where id = p_jornada_id;
  return v_n;
end $$;

create or replace function public.preparar_jornada_hoy()
returns public.jornadas language plpgsql security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Santiago')::date; v_j public.jornadas;
begin
  select * into v_j from jornadas where fecha = v_hoy;
  if found then return v_j; end if;
  if get_rol_usuario() is distinct from 'dueno' then return null; end if;
  insert into jornadas (fecha, estado, creado_por) values (v_hoy, 'preparacion', auth.uid()) on conflict (fecha) do nothing;
  select * into v_j from jornadas where fecha = v_hoy;
  if not v_j.cargada_desde_base then
    perform cargar_rutas_base(v_j.id, false);
    select * into v_j from jornadas where fecha = v_hoy;
  end if;
  return v_j;
end $$;

revoke all on function public.cargar_rutas_base(uuid, boolean) from public, anon;
revoke all on function public.preparar_jornada_hoy() from public, anon;
grant execute on function public.cargar_rutas_base(uuid, boolean) to authenticated;
grant execute on function public.preparar_jornada_hoy() to authenticated;
