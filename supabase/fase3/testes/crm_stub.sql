create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
create table canais (id uuid primary key default gen_random_uuid(), nome text not null, tipo text not null, ativo boolean not null default true, criado_em timestamptz not null default now());
create table clientes (id uuid primary key default gen_random_uuid(), nome text not null, telefone text, instagram_handle text, email text, data_nascimento date, tags text[] default '{}', criado_em timestamptz not null default now());
create table leads (id uuid primary key default gen_random_uuid(), nome text not null, instagram_handle text, data_captura date not null default current_date, status text not null default 'ativo', criado_em timestamptz not null default now());
create table vendas (id uuid primary key default gen_random_uuid(), cliente_id uuid not null references clientes(id), canal_id uuid not null references canais(id), valor numeric not null, produtos jsonb, data_venda date not null default current_date, data_recebimento date, criado_em timestamptz not null default now(), bagy_pedido_id text);
create table cashback (id uuid primary key default gen_random_uuid(), venda_id uuid not null references vendas(id), cliente_id uuid not null references clientes(id), valor numeric not null, data_liberacao date not null, data_validade date not null, status text not null default 'pendente', criado_em timestamptz not null default now());
create table follow_up_regras (id uuid primary key default gen_random_uuid(), chave text not null unique, descricao text not null, tipo_gatilho text not null, offset_dias int, numero_compra int, ativo boolean not null default true, mensagem_modelo text);
create table follow_up_instancias (id uuid primary key default gen_random_uuid(), regra_id uuid not null references follow_up_regras(id), cliente_id uuid references clientes(id), venda_id uuid references vendas(id), data_prevista date not null, status text not null default 'pendente', observacao text, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), lead_id uuid references leads(id), dedupe_key text);
do $$ declare t text; begin foreach t in array array['canais','cashback','clientes','follow_up_instancias','follow_up_regras','leads','vendas'] loop
  execute format('alter table %I enable row level security', t);
  execute format('create policy authenticated_full_access on %I for all to authenticated using (true) with check (true)', t); end loop; end $$;
-- a venda que já existe no CRM
insert into canais(nome,tipo) values ('Site','online');
insert into clientes(nome) values ('Cliente CRM');
insert into vendas(cliente_id,canal_id,valor,produtos,bagy_pedido_id) select c.id,k.id,99.9,'[{"nome":"x"}]','B123' from clientes c, canais k;
insert into cashback(venda_id,cliente_id,valor,data_liberacao,data_validade) select id,cliente_id,5,current_date,current_date+30 from vendas;
