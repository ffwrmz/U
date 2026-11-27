-- Buscar un id en TODA la base: dice en qué tabla y columna aparece y muestra esas filas.
-- Sirve para el id de una venta, cliente, trabajador, jornada, parada, pago, furgón, etc.
-- Supabase > SQL Editor: cambia el id de la línea 'buscar' y aprieta Run. Solo lee, no cambia nada.
-- Primero salen las filas donde es el id propio (columna id) y después donde aparece como referencia.

with buscar as (select '11111111-1111-1111-1111-111111111111'::uuid as id),  -- <<< pega aquí el id
r as (
  select c.table_name as tabla, c.column_name as columna,
    (xpath('/row/j/text()', query_to_xml(format(
       'select encode(convert_to(json_agg(t)::text, ''UTF8''), ''hex'') as j from public.%I t where %I = %L',
       c.table_name, c.column_name, (select id from buscar)), false, true, '')))[1]::text as hex
  from information_schema.columns c
  join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.data_type = 'uuid'
)
select tabla, columna, json_array_length(d) as cantidad, d as datos
from r cross join lateral (select convert_from(decode(hex, 'hex'), 'UTF8')::json as d) x
where hex is not null
order by columna <> 'id', tabla;
