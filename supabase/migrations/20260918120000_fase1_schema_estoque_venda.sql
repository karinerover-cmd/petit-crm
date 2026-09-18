-- ============================================================================
-- Petit Sabó — Fase 1: schema de produto / estoque / venda
--
-- Integra com o schema existente do CRM (inspecionado em 2026-09-18):
--   * public.clientes e public.vendas JÁ EXISTEM (ids uuid; referenciadas por
--     cashback e follow_up_instancias) → são ESTENDIDAS aqui, não recriadas.
--     Nenhuma coluna existente é renomeada ou removida.
--   * public.canais já existe → vendas continua usando canal_id.
--   * Tabelas novas seguem a convenção do CRM: id uuid (gen_random_uuid()),
--     criado_em / atualizado_em, política "authenticated_full_access".
--
-- Princípios:
--   * estoque_atual só muda via movimentos_estoque (trigger recalcula; update
--     direto na coluna é bloqueado).
--   * Cada item de venda gera automaticamente o seu movimento de saída.
--   * Datas "de hoje" usam o fuso America/Sao_Paulo (o servidor roda em UTC).
--   * Tudo roda numa transação: se qualquer comando falhar, nada é criado.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Funções utilitárias
-- ---------------------------------------------------------------------------

-- "Hoje" no horário de Brasília (evita virar o dia às 21h).
create or replace function public.hoje_brt()
returns date
language sql stable
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Vencimento a partir de fabricação "MM/AAAA" + validade em meses.
-- Regra do PRD: o mês de fabricação conta como ponto de partida e o produto
-- vence no ÚLTIMO DIA do mês (fabricação + validade).
--   ex.: 03/2026 + 12 → 31/03/2027  |  04/2026 + 6 → 31/10/2026
-- (O app e a planilha atuais vencem um mês antes — 28/02/2027 no exemplo;
--  o app passa a usar esta regra na Fase 3, a planilha na Fase 4.)
create or replace function public.calcular_vencimento(p_fabricacao text, p_validade_meses int)
returns date
language sql immutable
as $$
  select case
    when p_fabricacao ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' and p_validade_meses > 0 then
      (make_date(split_part(p_fabricacao, '/', 2)::int,
                 split_part(p_fabricacao, '/', 1)::int, 1)
       + make_interval(months => p_validade_meses + 1)
       - interval '1 day')::date
  end
$$;

-- atualizado_em automático
create or replace function public.gestao_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- clientes (EXISTENTE, do CRM) — só acrescenta o id do app local p/ a Fase 2
-- ---------------------------------------------------------------------------
alter table public.clientes
  add column legacy_app_id bigint unique;     -- id do localStorage (migração Fase 2)

-- ---------------------------------------------------------------------------
-- vendas (EXISTENTE, do CRM) — colunas atuais continuam iguais:
--   id, cliente_id, canal_id, valor (= total da venda), produtos (jsonb),
--   data_venda, data_recebimento, criado_em, bagy_pedido_id
-- ---------------------------------------------------------------------------
alter table public.vendas
  -- Venda de feira/balcão nem sempre tem cliente. Conferido no index.html do
  -- CRM: a lista já trata cliente nulo ("—") e régua/cashback só rodam nas
  -- vendas que o próprio CRM grava (sempre com cliente).
  alter column cliente_id drop not null,
  add column forma_pagamento  text,                      -- Pix, Cartão de crédito, Dinheiro...
  add column desconto_venda   numeric(10,2) not null default 0
                              check (desconto_venda >= 0), -- desconto no carrinho (além do por item)
  -- default 'crm': vendas que o CRM continuar gravando sem saber desta coluna
  -- ficam identificadas corretamente, sem precisar mexer no código do CRM.
  add column origem           text not null default 'crm'
                              check (origem in ('crm','gestao','app_vendedor','site',
                                                'importacao','migracao')),
  add column pedido_externo   text,                      -- ex.: FEIRA-20260107-01
  add column observacao       text,
  add column legacy_app_id    bigint unique,             -- id (Date.now()) do localStorage
  -- Valores financeiros já existentes na planilha "Vendas Consolidado".
  -- Opcionais aqui; só passam a ser usados de fato na Fase 9.
  add column taxa_pagamento       numeric(10,2),
  add column comissao_canal       numeric(10,2),         -- consignação (Endossa etc.)
  add column comissao_plataforma  numeric(10,2),         -- site (Bagy)
  add column frete_cobrado        numeric(10,2),
  add column frete_pago           numeric(10,2),
  add column criado_por       uuid default auth.uid();

create index if not exists vendas_data_venda_idx on public.vendas (data_venda);
create index if not exists vendas_cliente_idx    on public.vendas (cliente_id);

-- ---------------------------------------------------------------------------
-- produtos  (PK = SKU atual, ex.: BB001)
-- ---------------------------------------------------------------------------
create table public.produtos (
  sku              text primary key
                   check (sku = upper(btrim(sku)) and sku <> ''),
  nome             text not null check (btrim(nome) <> ''),
  colecao          text,
  categoria        text,                      -- Hidratante, Sabonete, Vela, ...
  data_fabricacao  text
                   check (data_fabricacao ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),  -- MM/AAAA
  validade_meses   int check (validade_meses > 0),
  data_vencimento  date generated always as
                   (public.calcular_vencimento(data_fabricacao, validade_meses)) stored,
  preco            numeric(10,2) not null default 0 check (preco >= 0),
  estoque_atual    int not null default 0,    -- mantido pelo trigger; pode ficar
                                              -- negativo (decisão: permitido, ajuste manual)
  oculto           boolean not null default false,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index produtos_colecao_idx on public.produtos (colecao);

-- ---------------------------------------------------------------------------
-- venda_itens
-- sku pode ser nulo só para histórico importado cujo produto não case com SKU;
-- produto_nome guarda o nome como estava no momento da venda.
-- ---------------------------------------------------------------------------
create table public.venda_itens (
  id              uuid primary key default gen_random_uuid(),
  venda_id        uuid not null references public.vendas (id) on delete cascade,
  sku             text references public.produtos (sku) on update cascade on delete restrict,
  produto_nome    text not null,
  quantidade      int not null check (quantidade > 0),
  preco_unitario  numeric(10,2) not null check (preco_unitario >= 0),
  desconto        numeric(10,2) not null default 0 check (desconto >= 0),  -- em R$
  desconto_label  text,                                                    -- ex.: "10%"
  subtotal        numeric(10,2) generated always as
                  (round(preco_unitario * quantidade - desconto, 2)) stored,
  criado_em       timestamptz not null default now()
);
create index venda_itens_venda_idx on public.venda_itens (venda_id);
create index venda_itens_sku_idx   on public.venda_itens (sku);

-- ---------------------------------------------------------------------------
-- movimentos_estoque  (quantidade com sinal: + entra, − sai)
-- ---------------------------------------------------------------------------
create table public.movimentos_estoque (
  id               uuid primary key default gen_random_uuid(),
  sku              text not null references public.produtos (sku) on update cascade on delete restrict,
  tipo             text not null
                   check (tipo in ('estoque_inicial','reposicao','venda','retirada',
                                   'devolucao','ajuste')),
  quantidade       int not null,
  data             date not null default public.hoje_brt(),
  data_fabricacao  text check (data_fabricacao ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
                                              -- em reposição: atualiza a fabricação do produto
  venda_item_id    uuid unique references public.venda_itens (id) on delete cascade,
  observacao       text,
  criado_por       uuid default auth.uid(),
  criado_em        timestamptz not null default now(),

  constraint movimentos_sinal_por_tipo check (
       (tipo in ('estoque_inicial','reposicao','devolucao') and quantidade > 0)
    or (tipo in ('venda','retirada')                         and quantidade < 0)
    or (tipo = 'ajuste'                                      and quantidade <> 0)
  ),
  constraint movimentos_venda_tem_item check ((tipo = 'venda') = (venda_item_id is not null))
);
create index movimentos_sku_data_idx on public.movimentos_estoque (sku, data);

-- ---------------------------------------------------------------------------
-- regras_desconto  (= aba DESCONTOS da planilha de promoções)
-- ---------------------------------------------------------------------------
create table public.regras_desconto (
  id                        uuid primary key default gen_random_uuid(),
  categoria_validade_meses  int not null check (categoria_validade_meses > 0),
  mes_inicio                int not null check (mes_inicio >= 0),
  mes_fim                   int not null,
  desconto                  numeric(5,4) not null check (desconto >= 0 and desconto <= 1),
  constraint regras_faixa_valida check (mes_fim >= mes_inicio),
  constraint regras_unica unique (categoria_validade_meses, mes_inicio)
);

-- ---------------------------------------------------------------------------
-- Triggers de estoque
-- ---------------------------------------------------------------------------

-- Bloqueia alteração direta de estoque_atual (só o recálculo pode mexer).
create or replace function public.produtos_protege_estoque()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.estoque_atual := 0;   -- estoque inicial entra como movimento 'estoque_inicial'
  elsif new.estoque_atual is distinct from old.estoque_atual
        and coalesce(current_setting('petit.recalculando_estoque', true), '') <> 'on' then
    raise exception 'estoque_atual não pode ser alterado diretamente — registre um movimento em movimentos_estoque (sku %)', new.sku;
  end if;
  return new;
end $$;

create trigger produtos_protege_estoque
  before insert or update on public.produtos
  for each row execute function public.produtos_protege_estoque();

create trigger produtos_atualizado_em
  before update on public.produtos
  for each row execute function public.gestao_set_atualizado_em();

-- Recalcula estoque_atual = soma dos movimentos do SKU (robusto: nunca "deriva").
create or replace function public.recalcular_estoque(p_sku text)
returns void
language plpgsql
as $$
begin
  perform set_config('petit.recalculando_estoque', 'on', true);
  update public.produtos p
     set estoque_atual = coalesce((select sum(m.quantidade)
                                     from public.movimentos_estoque m
                                    where m.sku = p_sku), 0)
   where p.sku = p_sku;
  perform set_config('petit.recalculando_estoque', 'off', true);
end $$;

create or replace function public.movimentos_apos_alteracao()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalcular_estoque(new.sku);
    -- Reposição com nova fabricação atualiza a fabricação do produto
    -- (mesmo comportamento do modal "Atualizar fabricação" do app).
    if tg_op = 'INSERT' and new.tipo = 'reposicao' and new.data_fabricacao is not null then
      update public.produtos set data_fabricacao = new.data_fabricacao where sku = new.sku;
    end if;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.sku is distinct from new.sku) then
    perform public.recalcular_estoque(old.sku);
  end if;
  return null;
end $$;

create trigger movimentos_recalcula_estoque
  after insert or update or delete on public.movimentos_estoque
  for each row execute function public.movimentos_apos_alteracao();

-- Cada item de venda com SKU gera/atualiza seu movimento de saída.
-- (Excluir o item — ou a venda inteira — apaga o movimento via ON DELETE
--  CASCADE e o estoque volta.)
create or replace function public.venda_itens_gera_movimento()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    delete from public.movimentos_estoque where venda_item_id = old.id;
  end if;
  if new.sku is not null then
    insert into public.movimentos_estoque (sku, tipo, quantidade, data, venda_item_id)
    select new.sku, 'venda', -new.quantidade, v.data_venda, new.id
      from public.vendas v where v.id = new.venda_id;
  end if;
  return null;
end $$;

create trigger venda_itens_movimento
  after insert or update of sku, quantidade on public.venda_itens
  for each row execute function public.venda_itens_gera_movimento();

-- ---------------------------------------------------------------------------
-- View: curva_abc  (janelas 90d e 12m, corte 80/95/100)
-- Classe pelo acumulado ANTES do item: o produto que cruza 80% ainda é A
-- (garante que o maior vendedor é sempre A). Sem venda na janela = sem linha
-- (não vira C por padrão). Faturamento = subtotal dos itens.
-- ---------------------------------------------------------------------------
create view public.curva_abc
with (security_invoker = true) as
with janelas (janela, inicio) as (
  values ('90d', public.hoje_brt() - 90),
         ('12m', (public.hoje_brt() - interval '12 months')::date)
),
faturamento as (
  select j.janela, vi.sku,
         sum(vi.subtotal)   as faturamento,
         sum(vi.quantidade) as unidades
    from janelas j
    join public.vendas v       on v.data_venda > j.inicio and v.data_venda <= public.hoje_brt()
    join public.venda_itens vi on vi.venda_id = v.id
   where vi.sku is not null
   group by j.janela, vi.sku
  having sum(vi.subtotal) > 0
),
acumulado as (
  select f.*,
         sum(f.faturamento) over tot                   as total_janela,
         sum(f.faturamento) over ord                   as acumulado,
         row_number()       over ord                   as posicao
    from faturamento f
  window tot as (partition by f.janela),
         ord as (partition by f.janela order by f.faturamento desc, f.sku
                 rows between unbounded preceding and current row)
)
select janela, sku, posicao, faturamento, unidades,
       round(faturamento / total_janela, 4) as participacao,
       round(acumulado   / total_janela, 4) as participacao_acumulada,
       case
         when (acumulado - faturamento) / total_janela < 0.80 then 'A'
         when (acumulado - faturamento) / total_janela < 0.95 then 'B'
         else 'C'
       end as classe
  from acumulado;

-- ---------------------------------------------------------------------------
-- View: tabela_produtos  (= aba "Tabela Produtos" da planilha de promoções)
-- ---------------------------------------------------------------------------
create view public.tabela_produtos
with (security_invoker = true) as
with hoje as (select public.hoje_brt() as d),
vendas_30d as (
  select vi.sku, sum(vi.quantidade) as qtd
    from public.venda_itens vi
    join public.vendas v on v.id = vi.venda_id, hoje
   where v.data_venda between hoje.d - 30 and hoje.d
     and vi.sku is not null
   group by vi.sku
),
base as (
  select p.*,
         p.data_vencimento - hoje.d as dias,
         coalesce(v30.qtd, 0)       as vendas_30d,
         -- mesma fórmula da coluna "meses restantes" da planilha
         case when p.data_vencimento >= hoje.d then
             (extract(year  from p.data_vencimento)::int - extract(year  from hoje.d)::int) * 12
           + (extract(month from p.data_vencimento)::int - extract(month from hoje.d)::int)
           - case when extract(day from p.data_vencimento) < extract(day from hoje.d) then 1 else 0 end
         end as meses_restantes,
         hoje.d as hoje
    from public.produtos p
    cross join hoje
    left join vendas_30d v30 on v30.sku = p.sku
),
com_desconto as (
  select b.*,
         (select r.desconto
            from public.regras_desconto r
           where r.categoria_validade_meses = b.validade_meses
             and b.meses_restantes between r.mes_inicio and r.mes_fim
           limit 1) as desconto_pct
    from base b
)
select
  c.sku,
  c.nome,
  c.colecao,
  c.categoria,
  c.oculto,
  c.estoque_atual,
  c.data_fabricacao,
  c.validade_meses,
  c.data_vencimento,
  c.dias                                        as dias_para_vencer,   -- negativo = vencido
  case when c.estoque_atual < 5  then 'baixo'
       when c.estoque_atual <= 10 then 'normal'
       else 'alto' end                          as status_estoque,
  case when c.data_vencimento is null then null
       when c.dias <= 0   then 'VENCIDO'
       when c.dias <= 60  then 'CRÍTICO'
       when c.dias <= 120 then 'PRÓXIMO'
       else 'OK' end                            as status_validade,
  -- Planilha: vencido cai em "WHATSHOP" por bug de texto×número;
  -- aqui vencido fica sem promoção sugerida (decisão de 2026-09-18).
  case when c.data_vencimento is null then null
       when c.dias < 0    then null
       when c.dias <= 120 then 'OUTLET'
       when c.dias <= 180 then 'PINK WEEK'
       when c.estoque_atual >= 5 then 'DESCONTO PROGRESSIVO'
       else 'WHATSHOP' end                      as promocao_sugerida,
  c.vendas_30d,
  case when c.vendas_30d >= 5 then 'BEST-SELLER'
       when c.vendas_30d >= 3 then 'MÉDIO-GIRO'
       else 'ENCALHADO' end                     as rotatividade,
  c.preco                                       as valor_sem_desconto,
  c.meses_restantes,
  c.desconto_pct,
  case when c.desconto_pct is not null
       then round(c.preco * (1 - c.desconto_pct), 2) end as valor_final,
  case when c.data_vencimento is null then null
       when c.data_vencimento < c.hoje then 'Vencido'
       when c.estoque_atual > 0 then 'Ativo'
       else 'Inativo' end                       as status,
  abc90.classe                                  as classe_abc_90d,   -- principal no app
  abc12.classe                                  as classe_abc_12m    -- contexto
from com_desconto c
left join public.curva_abc abc90 on abc90.sku = c.sku and abc90.janela = '90d'
left join public.curva_abc abc12 on abc12.sku = c.sku and abc12.janela = '12m';

-- ---------------------------------------------------------------------------
-- Segurança (RLS) — mesmo padrão do CRM: usuário logado tem acesso total,
-- anônimo não vê nada.
-- ---------------------------------------------------------------------------
alter table public.produtos           enable row level security;
alter table public.venda_itens        enable row level security;
alter table public.movimentos_estoque enable row level security;
alter table public.regras_desconto    enable row level security;

create policy authenticated_full_access on public.produtos           for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.venda_itens        for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.movimentos_estoque for all to authenticated using (true) with check (true);
create policy authenticated_full_access on public.regras_desconto    for all to authenticated using (true) with check (true);

revoke all on public.tabela_produtos, public.curva_abc from anon;

commit;
