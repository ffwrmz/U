-- =====================================================================
-- Santa Teresita: administración de trabajadores (pantalla "Trabajadores")
-- Ya aplicada en Supabase el 2026-11-09. Va junto con la Edge Function gestionar-trabajador.
-- =====================================================================
alter table public.perfiles add column if not exists activo boolean not null default true;
alter table public.perfiles add column if not exists email text;
alter table public.perfiles add column if not exists telefono varchar;

update public.perfiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- Un trabajador desactivado pierde su rol: todas las políticas que usan get_rol_usuario() lo bloquean.
create or replace function public.get_rol_usuario()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.perfiles where id = auth.uid() and activo;
$$;

create policy perfiles_dueno_leer on public.perfiles for select to authenticated
  using (get_rol_usuario() = 'dueno');
create policy perfiles_vendedor_leer_equipo on public.perfiles for select to authenticated
  using (get_rol_usuario() = 'vendedor' and rol in ('dueno','vendedor'));
create policy perfiles_dueno_modificar on public.perfiles for update to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');
