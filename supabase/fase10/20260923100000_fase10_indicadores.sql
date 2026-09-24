-- Versão pública: os valores do negócio (custos fixos, semente de feira, metas e ajustes de canais) ficam num
-- arquivo local, fora do repositório. A estrutura e os cálculos abaixo são os mesmos rodados no Supabase.
-- ============================================================================
-- Petit Sabó — Fase 10: indicadores financeiros (ponto de equilíbrio e meta de faturamento saudável)
-- Cria 3 tabelas, 2 views e 6 funções. Rollback = 99_rollback_fase10.sql.
--
--   custo_fixo_mensal     = Σ custos_fixos vigentes no mês + custo médio de feira do mês (média móvel de 12 meses)
--   margem_pct_real       = Σ margem_real ÷ Σ receita, SÓ das vendas com custo completo (Fase 9) — nunca a margem teórica
--                           (mês sem nenhuma venda com margem → acumulado dos últimos 12 meses → senão fica em branco)
--   ponto_equilibrio      = custo_fixo_mensal ÷ margem_pct_real
--   meta_saudavel         = custo_fixo_mensal × 3
-- Indicadores só a partir de set/2026 (antes disso não há margem real e o custo fixo era outro); meses anteriores
-- aparecem só com o faturamento.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Custos fixos com vigência por MÊS (mudar um valor fecha a linha antiga e abre outra — meses passados não mudam)
-- ---------------------------------------------------------------------------
create table public.custos_fixos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (btrim(nome) <> ''),
  valor_mensal   numeric(12,2) not null check (valor_mensal >= 0),
  vigente_desde  date not null check (extract(day from vigente_desde) = 1),      -- primeiro dia do mês
  vigente_ate    date check (vigente_ate is null or extract(day from vigente_ate) = 1),
  observacao     text,
  criado_em      timestamptz not null default now(),
  check (vigente_ate is null or vigente_ate >= vigente_desde)
);
create index custos_fixos_vigencia_idx on public.custos_fixos (vigente_desde, vigente_ate);

-- ---------------------------------------------------------------------------
-- Feiras realizadas: custo da Petit pelo RATEIO PROPORCIONAL ao faturamento de cada artesã (calculado pelo banco)
-- Ninguém vendeu (as duas com R$ 0) → custo dividido 50/50.
-- ---------------------------------------------------------------------------
create table public.feiras_realizadas (
  id                    uuid primary key default gen_random_uuid(),
  data_evento           date not null,
  nome_evento           text not null check (btrim(nome_evento) <> ''),
  custo_total_evento    numeric(12,2) not null check (custo_total_evento >= 0),
  faturamento_petit     numeric(12,2) not null default 0 check (faturamento_petit >= 0),
  faturamento_parceira  numeric(12,2) not null default 0 check (faturamento_parceira >= 0),
  custo_petit           numeric(12,2) generated always as (
                          round(case when faturamento_petit + faturamento_parceira = 0 then custo_total_evento / 2
                                     else custo_total_evento * faturamento_petit / (faturamento_petit + faturamento_parceira) end, 2)) stored,
  observacao            text,
  criado_em             timestamptz not null default now()
);
create index feiras_realizadas_data_idx on public.feiras_realizadas (data_evento);

-- ---------------------------------------------------------------------------
-- Configuração (linha única)
-- ---------------------------------------------------------------------------
create table public.config_indicadores (
  id                     smallint primary key default 1 check (id = 1),
  feira_semente_mensal   numeric(12,2) not null default 0 check (feira_semente_mensal >= 0),   -- média mensal do histórico de feiras (definida no arquivo local)
  feira_registro_inicio  date not null default '2026-09-01' check (extract(day from feira_registro_inicio) = 1),
  indicadores_inicio     date not null default '2026-09-01' check (extract(day from indicadores_inicio) = 1),
  multiplicador_meta     numeric(6,2) not null default 3 check (multiplicador_meta > 0),
  atualizado_em          timestamptz not null default now()
);
insert into public.config_indicadores (id) values (1);

do $$
declare t text;
begin
  foreach t in array array['custos_fixos', 'feiras_realizadas', 'config_indicadores'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Custo médio de feira por mês (média móvel de 12 meses, completada pela semente enquanto não há 12 meses de registro)
--   meses_reais = meses da janela (M e os 11 anteriores) a partir do início do registro de feiras
--   custo_medio = (Σ custo_petit dos meses reais + (12 − meses_reais) × semente) ÷ 12
--   Mês sem feira depois do início conta como R$ 0 (é a média real).
-- ---------------------------------------------------------------------------
create view public.feira_custo_medio_mensal with (security_invoker = true) as
with cfg as (select * from public.config_indicadores where id = 1),
meses as (
  select generate_series(
           least(coalesce((select date_trunc('month', min(data_venda))::date from public.vendas), (select feira_registro_inicio from cfg)),
                 (select feira_registro_inicio from cfg),
                 coalesce((select date_trunc('month', min(data_evento))::date from public.feiras_realizadas), (select feira_registro_inicio from cfg))),
           date_trunc('month', public.hoje_brt())::date, interval '1 month')::date as mes
)
select m.mes,
       j.meses_reais,
       12 - j.meses_reais                                                                   as meses_semente,
       j.custo_real,
       round((j.custo_real + (12 - j.meses_reais) * cfg.feira_semente_mensal) / 12, 2)     as custo_medio
  from meses m cross join cfg
  cross join lateral (
    select count(*) filter (where w.mes >= cfg.feira_registro_inicio)::int as meses_reais,
           coalesce((select sum(f.custo_petit) from public.feiras_realizadas f
                      where date_trunc('month', f.data_evento)::date between (m.mes - interval '11 months')::date and m.mes
                        and date_trunc('month', f.data_evento)::date >= cfg.feira_registro_inicio), 0) as custo_real
      from generate_series((m.mes - interval '11 months')::date, m.mes, interval '1 month') as w(mes)
  ) j;

-- ---------------------------------------------------------------------------
-- Indicadores por mês
-- ---------------------------------------------------------------------------
create view public.indicadores_financeiros_mensal with (security_invoker = true) as
with cfg as (select * from public.config_indicadores where id = 1),
base as (
  select fc.mes, fc.custo_medio as custo_feira,
         (select coalesce(sum(v.valor), 0) from public.vendas v where date_trunc('month', v.data_venda)::date = fc.mes)       as faturamento_total,
         (select count(*) from public.vendas v where date_trunc('month', v.data_venda)::date = fc.mes)::int                  as vendas,
         (select coalesce(sum(vm.receita_produtos), 0) from public.venda_margem vm join public.vendas v on v.id = vm.venda_id
           where vm.custo_completo and date_trunc('month', v.data_venda)::date = fc.mes)                                   as receita_com_margem,
         (select sum(vm.margem_real) from public.venda_margem vm join public.vendas v on v.id = vm.venda_id
           where vm.custo_completo and date_trunc('month', v.data_venda)::date = fc.mes)                                   as margem_contribuicao_total,
         (select coalesce(sum(vm.receita_produtos), 0) from public.venda_margem vm join public.vendas v on v.id = vm.venda_id
           where vm.custo_completo and date_trunc('month', v.data_venda)::date between (fc.mes - interval '11 months')::date and fc.mes) as receita_margem_12m,
         (select sum(vm.margem_real) from public.venda_margem vm join public.vendas v on v.id = vm.venda_id
           where vm.custo_completo and date_trunc('month', v.data_venda)::date between (fc.mes - interval '11 months')::date and fc.mes) as margem_12m,
         (select coalesce(sum(c.valor_mensal), 0) from public.custos_fixos c
           where c.vigente_desde <= fc.mes and (c.vigente_ate is null or c.vigente_ate >= fc.mes))                          as custo_fixo_itens
    from public.feira_custo_medio_mensal fc
),
calc as (
  select b.*, (b.mes >= cfg.indicadores_inicio) as ativo, cfg.multiplicador_meta,
         case when b.receita_com_margem > 0 then round(b.margem_contribuicao_total / b.receita_com_margem, 4) end as margem_pct_mes,
         case when b.receita_margem_12m > 0 then round(b.margem_12m / b.receita_margem_12m, 4) end               as margem_pct_12m
    from base b cross join cfg
),
fin as (
  select c.*,
         case when not c.ativo then null when c.margem_pct_mes is not null then c.margem_pct_mes else c.margem_pct_12m end                       as margem_pct_usada,
         case when not c.ativo then null when c.margem_pct_mes is not null then 'mes' when c.margem_pct_12m is not null then '12_meses' end       as margem_origem,
         case when c.ativo then round(c.custo_fixo_itens + c.custo_feira, 2) end                                                                 as custo_fixo_mensal
    from calc c
)
select f.mes, f.vendas, round(f.faturamento_total, 2) as faturamento_total,
       case when f.ativo then round(f.receita_com_margem, 2) end                                                          as receita_com_margem,
       case when f.ativo and f.faturamento_total > 0 then round(f.receita_com_margem / f.faturamento_total, 4) end         as cobertura_margem,
       case when f.ativo then round(f.margem_contribuicao_total, 2) end                                                   as margem_contribuicao_total,
       case when f.ativo then f.margem_pct_mes end                                                                        as margem_contribuicao_pct_real,
       f.margem_pct_usada, f.margem_origem,
       case when f.ativo then round(f.custo_fixo_itens, 2) end                                                            as custo_fixo_itens,
       case when f.ativo then f.custo_feira end                                                                           as custo_feira,
       f.custo_fixo_mensal,
       case when f.margem_pct_usada > 0 then round(f.custo_fixo_mensal / f.margem_pct_usada, 2) end                       as ponto_equilibrio_faturamento,
       case when f.ativo then round(f.custo_fixo_mensal * f.multiplicador_meta, 2) end                                    as meta_faturamento_saudavel,
       case when not f.ativo or f.margem_pct_usada is null or f.margem_pct_usada <= 0 then null
            when f.faturamento_total < f.custo_fixo_mensal / f.margem_pct_usada then 'abaixo_equilibrio'
            when f.faturamento_total < f.custo_fixo_mensal * f.multiplicador_meta then 'entre_equilibrio_e_meta'
            else 'acima_meta' end                                                                                         as status
  from fin f;

-- ---------------------------------------------------------------------------
-- Funções de cadastro
-- ---------------------------------------------------------------------------
-- Custo fixo. p = { id?, nome, valor_mensal, a_partir_de (qualquer data do mês), observacao? }
-- Com id: se a_partir_de for um mês DEPOIS do início da linha, fecha a linha antiga no mês anterior e cria outra
-- (os meses passados continuam com o valor antigo); se for o mesmo mês, só corrige o valor.
create or replace function public.gestao_salvar_custo_fixo(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid; v_valor numeric := nullif(p->>'valor_mensal', '')::numeric;
  v_mes date := date_trunc('month', coalesce(nullif(p->>'a_partir_de', '')::date, public.hoje_brt()))::date;
  c public.custos_fixos%rowtype; v_novo uuid; v_nome text := btrim(coalesce(p->>'nome', ''));
begin
  if v_valor is null or v_valor < 0 then raise exception 'Informe o valor mensal (zero ou mais).'; end if;
  if v_id is null then
    if v_nome = '' then raise exception 'Informe o nome do custo.'; end if;
    insert into public.custos_fixos (nome, valor_mensal, vigente_desde, observacao) values (v_nome, v_valor, v_mes, nullif(p->>'observacao', '')) returning id into v_novo;
    return v_novo;
  end if;
  select * into c from public.custos_fixos where id = v_id;
  if not found then raise exception 'Custo fixo não encontrado.'; end if;
  if v_mes < c.vigente_desde then raise exception 'A mudança não pode começar antes de % (início deste custo).', to_char(c.vigente_desde, 'MM/YYYY'); end if;
  if v_mes = c.vigente_desde then
    update public.custos_fixos set valor_mensal = v_valor, nome = coalesce(nullif(v_nome, ''), nome), observacao = coalesce(nullif(p->>'observacao', ''), observacao) where id = v_id;
    return v_id;
  end if;
  update public.custos_fixos set vigente_ate = (v_mes - interval '1 month')::date where id = v_id;
  insert into public.custos_fixos (nome, valor_mensal, vigente_desde, vigente_ate, observacao)
  values (coalesce(nullif(v_nome, ''), c.nome), v_valor, v_mes, case when c.vigente_ate is not null and c.vigente_ate >= v_mes then c.vigente_ate end,
          coalesce(nullif(p->>'observacao', ''), c.observacao))
  returning id into v_novo;
  return v_novo;
end $$;

-- Encerra um custo fixo a partir de um mês (ele deixa de contar dali em diante; os meses anteriores continuam).
create or replace function public.gestao_encerrar_custo_fixo(p_id uuid, p_a_partir_de date)
returns void
language plpgsql
as $$
declare c public.custos_fixos%rowtype; v_mes date := date_trunc('month', p_a_partir_de)::date;
begin
  select * into c from public.custos_fixos where id = p_id;
  if not found then raise exception 'Custo fixo não encontrado.'; end if;
  if v_mes <= c.vigente_desde then raise exception 'Para um custo que nunca valeu, use Excluir. Encerrar precisa ser depois de %.', to_char(c.vigente_desde, 'MM/YYYY'); end if;
  update public.custos_fixos set vigente_ate = (v_mes - interval '1 month')::date where id = p_id;
end $$;

create or replace function public.gestao_excluir_custo_fixo(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.custos_fixos where id = p_id;
  if not found then raise exception 'Custo fixo não encontrado.'; end if;
end $$;

-- Feira. p = { id?, data_evento, nome_evento, custo_total_evento, faturamento_petit, faturamento_parceira, observacao? }
create or replace function public.gestao_salvar_feira(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if nullif(p->>'data_evento', '') is null then raise exception 'Informe a data da feira.'; end if;
  if nullif(btrim(coalesce(p->>'nome_evento', '')), '') is null then raise exception 'Informe o nome da feira.'; end if;
  if coalesce(nullif(p->>'custo_total_evento', '')::numeric, -1) < 0 then raise exception 'Informe o custo total do evento.'; end if;
  if coalesce(nullif(p->>'faturamento_petit', '')::numeric, 0) < 0 or coalesce(nullif(p->>'faturamento_parceira', '')::numeric, 0) < 0 then raise exception 'Faturamento não pode ser negativo.'; end if;
  if v_id is null then
    insert into public.feiras_realizadas (data_evento, nome_evento, custo_total_evento, faturamento_petit, faturamento_parceira, observacao)
    values ((p->>'data_evento')::date, btrim(p->>'nome_evento'), (p->>'custo_total_evento')::numeric, coalesce(nullif(p->>'faturamento_petit', '')::numeric, 0),
            coalesce(nullif(p->>'faturamento_parceira', '')::numeric, 0), nullif(p->>'observacao', ''))
    returning id into v_id;
  else
    update public.feiras_realizadas set data_evento = (p->>'data_evento')::date, nome_evento = btrim(p->>'nome_evento'), custo_total_evento = (p->>'custo_total_evento')::numeric,
           faturamento_petit = coalesce(nullif(p->>'faturamento_petit', '')::numeric, 0), faturamento_parceira = coalesce(nullif(p->>'faturamento_parceira', '')::numeric, 0),
           observacao = nullif(p->>'observacao', '')
     where id = v_id;
    if not found then raise exception 'Feira não encontrada.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.gestao_excluir_feira(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.feiras_realizadas where id = p_id;
  if not found then raise exception 'Feira não encontrada.'; end if;
end $$;

-- Configuração. p = { feira_semente_mensal?, feira_registro_inicio?, indicadores_inicio?, multiplicador_meta? }
create or replace function public.gestao_salvar_config_indicadores(p jsonb)
returns void
language plpgsql
as $$
begin
  update public.config_indicadores set
    feira_semente_mensal  = coalesce(nullif(p->>'feira_semente_mensal', '')::numeric, feira_semente_mensal),
    feira_registro_inicio = coalesce(date_trunc('month', nullif(p->>'feira_registro_inicio', '')::date)::date, feira_registro_inicio),
    indicadores_inicio    = coalesce(date_trunc('month', nullif(p->>'indicadores_inicio', '')::date)::date, indicadores_inicio),
    multiplicador_meta    = coalesce(nullif(p->>'multiplicador_meta', '')::numeric, multiplicador_meta),
    atualizado_em = now()
   where id = 1;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_salvar_custo_fixo', 'gestao_encerrar_custo_fixo', 'gestao_excluir_custo_fixo',
                                                         'gestao_salvar_feira', 'gestao_excluir_feira', 'gestao_salvar_config_indicadores') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;
revoke all on public.feira_custo_medio_mensal, public.indicadores_financeiros_mensal from anon;
grant select on public.feira_custo_medio_mensal, public.indicadores_financeiros_mensal to authenticated;

-- (Semente de custos fixos, semente de feira e ajustes de canais: arquivo local, fora do repositório público.)

notify pgrst, 'reload schema';
