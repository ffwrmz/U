-- =====================================================================
-- Santa Teresita: listas fijas del Calendario
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Una lista fija es un grupo de clientes (cada uno con su casero) que se visita según una regla:
--   días de la semana (Lunes a Viernes vienen creadas), días del mes (ej. 15 y último = quincena; 20),
-- Los clientes de las listas cuya regla calza con un día cuentan como preasignados ese día
-- (se calcula en la app; no se crean filas en preasignaciones). Para sacar a un cliente de una lista
-- solo un día se guarda una omisión.
-- =====================================================================
create table if not exists public.listas_fijas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  dias_semana int[] check (dias_semana <@ array[1,2,3,4,5,6,7]),          -- 1 = lunes ... 7 = domingo
  dias_mes int[] check (dias_mes <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]),
  ultimo_dia_mes boolean not null default false,
  color text,
  orden integer not null default 100,
  activo boolean not null default true,
  sistema boolean not null default false,  -- Lunes a Viernes: no se pueden eliminar
  creado_en timestamptz default now(),
  constraint listas_fijas_regla check (
    coalesce(array_length(dias_semana, 1), 0) > 0 or coalesce(array_length(dias_mes, 1), 0) > 0 or ultimo_dia_mes
  )
);

create table if not exists public.listas_fijas_clientes (
  lista_id uuid not null references public.listas_fijas(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  vendedor_id uuid not null references public.perfiles(id),
  orden integer not null default 0,
  primary key (lista_id, cliente_id)
);
create index if not exists listas_fijas_clientes_vendedor_idx on public.listas_fijas_clientes (vendedor_id);

-- Quitar a un cliente de una lista solo para un día
create table if not exists public.listas_fijas_omitidas (
  fecha date not null,
  lista_id uuid not null references public.listas_fijas(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  primary key (fecha, lista_id, cliente_id)
);

-- Lunes a Viernes
insert into public.listas_fijas (nombre, dias_semana, orden, sistema, color)
select v.nombre, array[v.dia], v.dia, true, '#262C60'
from (values ('Lunes', 1), ('Martes', 2), ('Miércoles', 3), ('Jueves', 4), ('Viernes', 5)) as v(nombre, dia)
where not exists (select 1 from public.listas_fijas l where l.sistema and l.dias_semana = array[v.dia]);

alter table public.listas_fijas enable row level security;
alter table public.listas_fijas_clientes enable row level security;
alter table public.listas_fijas_omitidas enable row level security;

drop policy if exists lf_leer on public.listas_fijas;
create policy lf_leer on public.listas_fijas for select to authenticated
  using (get_rol_usuario() in ('dueno', 'vendedor'));
drop policy if exists lf_dueno on public.listas_fijas;
create policy lf_dueno on public.listas_fijas for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');

drop policy if exists lfc_leer on public.listas_fijas_clientes;
create policy lfc_leer on public.listas_fijas_clientes for select to authenticated
  using (get_rol_usuario() = 'dueno' or vendedor_id = auth.uid());
drop policy if exists lfc_dueno on public.listas_fijas_clientes;
create policy lfc_dueno on public.listas_fijas_clientes for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');

drop policy if exists lfo_leer on public.listas_fijas_omitidas;
create policy lfo_leer on public.listas_fijas_omitidas for select to authenticated
  using (get_rol_usuario() in ('dueno', 'vendedor'));
drop policy if exists lfo_dueno on public.listas_fijas_omitidas;
create policy lfo_dueno on public.listas_fijas_omitidas for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');
