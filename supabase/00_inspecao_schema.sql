-- ============================================================================
-- INSPEÇÃO DO SCHEMA EXISTENTE (somente leitura — não altera nada)
-- Rodar no Supabase: Dashboard → SQL Editor → colar → Run.
-- Devolve UM valor JSON. Copie o resultado inteiro e cole na conversa.
-- ============================================================================
with
schemas_app as (
  select nspname from pg_namespace
  where nspname not in ('pg_catalog','information_schema','pg_toast','auth','storage',
                        'realtime','supabase_functions','extensions','graphql',
                        'graphql_public','pgsodium','pgsodium_masks','vault','net',
                        'supabase_migrations','cron','pgbouncer','_realtime','_analytics')
    and nspname not like 'pg_temp%' and nspname not like 'pg_toast_temp%'
),
tabelas as (
  select c.table_schema, c.table_name,
         json_agg(json_build_object(
           'col', c.column_name, 'tipo', c.data_type, 'null', c.is_nullable,
           'default', c.column_default) order by c.ordinal_position) as colunas
  from information_schema.columns c
  join schemas_app s on s.nspname = c.table_schema
  group by c.table_schema, c.table_name
),
objetos as (
  select n.nspname as schema, cl.relname as nome,
         case cl.relkind when 'r' then 'tabela' when 'v' then 'view'
                         when 'm' then 'matview' when 'p' then 'tabela_part' end as tipo,
         cl.relrowsecurity as rls,
         cl.reltuples::bigint as linhas_aprox
  from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
  join schemas_app s on s.nspname = n.nspname
  where cl.relkind in ('r','v','m','p')
),
restricoes as (
  select n.nspname as schema, cl.relname as tabela, con.conname as nome,
         pg_get_constraintdef(con.oid) as def
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join schemas_app s on s.nspname = n.nspname
),
gatilhos as (
  select event_object_schema as schema, event_object_table as tabela,
         trigger_name as nome, action_timing || ' ' || event_manipulation as quando,
         action_statement as acao
  from information_schema.triggers t
  join schemas_app s on s.nspname = t.event_object_schema
),
funcoes as (
  select n.nspname as schema, p.proname as nome,
         pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join schemas_app s on s.nspname = n.nspname
),
politicas as (
  select schemaname as schema, tablename as tabela, policyname as nome,
         roles::text as papeis, cmd, qual as using_expr, with_check
  from pg_policies p
  join schemas_app s on s.nspname = p.schemaname
),
enums as (
  select n.nspname as schema, t.typname as nome,
         json_agg(e.enumlabel order by e.enumsortorder) as valores
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  join schemas_app s on s.nspname = n.nspname
  group by n.nspname, t.typname
)
select json_build_object(
  'versao_postgres', current_setting('server_version'),
  'extensoes',   (select json_agg(extname || ' ' || extversion) from pg_extension),
  'objetos',     (select json_agg(o order by o.schema, o.nome) from objetos o),
  'colunas',     (select json_agg(t order by t.table_schema, t.table_name) from tabelas t),
  'restricoes',  (select json_agg(r order by r.schema, r.tabela) from restricoes r),
  'gatilhos',    (select json_agg(g) from gatilhos g),
  'funcoes',     (select json_agg(f order by f.schema, f.nome) from funcoes f),
  'politicas',   (select json_agg(p) from politicas p),
  'enums',       (select json_agg(e) from enums e),
  -- true = o CRM já usa migrations do Supabase CLI
  'usa_migrations_cli', to_regclass('supabase_migrations.schema_migrations') is not null
) as schema_atual;
