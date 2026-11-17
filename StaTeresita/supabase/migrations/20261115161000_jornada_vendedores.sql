-- =====================================================================
-- Santa Teresita: cada casero puede comenzar SU ruta del día
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- La jornada (tabla jornadas) sigue siendo una por día y el gerente la puede iniciar para todos.
-- Además, cada casero tiene su propio estado del día en jornada_vendedores:
--   estado efectivo de la ruta de un casero = 'en_curso' si la jornada o su fila están en curso, etc.
-- =====================================================================
create table if not exists public.jornada_vendedores (
  jornada_id uuid not null references public.jornadas(id) on delete cascade,
  vendedor_id uuid not null references public.perfiles(id),
  estado text not null default 'preparacion' check (estado in ('preparacion', 'en_curso', 'finalizada')),
  iniciada_en timestamptz,
  finalizada_en timestamptz,
  primary key (jornada_id, vendedor_id)
);

alter table public.jornada_vendedores enable row level security;
drop policy if exists jv_leer on public.jornada_vendedores;
create policy jv_leer on public.jornada_vendedores for select to authenticated
  using (get_rol_usuario() = 'dueno' or vendedor_id = auth.uid());
drop policy if exists jv_dueno on public.jornada_vendedores;
create policy jv_dueno on public.jornada_vendedores for all to authenticated
  using (get_rol_usuario() = 'dueno') with check (get_rol_usuario() = 'dueno');

-- El casero (o el dueño, para su propia ruta) comienza su ruta de la jornada indicada.
-- Solo si la jornada no está finalizada y el usuario tiene paradas asignadas en ella.
create or replace function public.iniciar_mi_ruta(p_jornada uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_estado text;
begin
  if coalesce(get_rol_usuario(), '') not in ('dueno', 'vendedor') then
    raise exception 'No tienes permiso para iniciar la ruta';
  end if;
  select estado into v_estado from jornadas where id = p_jornada;
  if v_estado is null then raise exception 'Jornada no existe'; end if;
  if v_estado = 'finalizada' then raise exception 'La jornada de hoy ya terminó'; end if;
  if not exists (select 1 from ruta_paradas where jornada_id = p_jornada and vendedor_id = auth.uid()) then
    raise exception 'No tienes clientes asignados en esta ruta';
  end if;
  insert into jornada_vendedores (jornada_id, vendedor_id, estado, iniciada_en)
  values (p_jornada, auth.uid(), 'en_curso', now())
  on conflict (jornada_id, vendedor_id) do update set estado = 'en_curso', iniciada_en = coalesce(jornada_vendedores.iniciada_en, now());
end $$;

revoke all on function public.iniciar_mi_ruta(uuid) from public, anon;
grant execute on function public.iniciar_mi_ruta(uuid) to authenticated;
