-- =====================================================================
-- Santa Teresita: iniciar sesión con RUT
-- Supabase > SQL Editor > Run. Se puede correr más de una vez. No borra datos.
-- Agrega el RUT a cada trabajador (perfiles.rut, formato "12345678-9", sin puntos, K mayúscula).
-- Los trabajadores que ya existen quedan sin RUT: el gerente se lo pone en Trabajadores.
-- La función login-rut (supabase/functions/login-rut) busca el correo por el RUT y abre la sesión.
-- =====================================================================
alter table public.perfiles add column if not exists rut text;
create unique index if not exists perfiles_rut_unico on public.perfiles (rut) where rut is not null;
