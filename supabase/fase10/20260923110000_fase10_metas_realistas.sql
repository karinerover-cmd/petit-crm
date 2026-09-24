-- Versão pública: os valores do negócio (custos fixos, semente de feira, metas e ajustes de canais) ficam num
-- arquivo local, fora do repositório. A estrutura e os cálculos abaixo são os mesmos rodados no Supabase.
-- ============================================================================
-- Petit Sabó — Fase 10 (complemento 1): metas de faturamento REALISTAS, mês a mês, definidas pela Karine
-- Viram a PRIMEIRA flag do painel (atingida / abaixo). A meta saudável (custo fixo × 3) e o ponto de equilíbrio continuam.
-- Cria 1 tabela e 1 função e acrescenta 3 colunas no fim da view indicadores_financeiros_mensal. Não muda nenhum dado.
-- A meta realista vale para QUALQUER mês (inclusive antes de set/2026): só compara faturamento com a meta.
-- Rollback: 99_rollback_fase10_metas.sql
-- ============================================================================

create table public.metas_faturamento (
  mes            date primary key check (extract(day from mes) = 1),      -- primeiro dia do mês
  valor          numeric(12,2) not null check (valor >= 0),
  observacao     text,
  atualizado_em  timestamptz not null default now()
);
alter table public.metas_faturamento enable row level security;
create policy authenticated_full_access on public.metas_faturamento for all to authenticated using (true) with check (true);

create or replace view public.indicadores_financeiros_mensal with (security_invoker = true) as
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
            else 'acima_meta' end                                                                                         as status,
       -- metas realistas (definidas pela Karine, mês a mês): valem para qualquer mês, não dependem de margem nem de custo fixo
       mt.valor                                                                                                           as meta_realista,
       case when mt.valor > 0 then round(f.faturamento_total / mt.valor, 4) end                                           as pct_meta_realista,
       case when mt.valor is null then null when f.faturamento_total >= mt.valor then 'atingida' else 'abaixo' end       as status_meta_realista
  from fin f left join public.metas_faturamento mt on mt.mes = f.mes;

-- Salva as metas de um ano inteiro. p = { ano, metas:[{ mes: 1..12, valor }] } — valor vazio apaga a meta daquele mês.
create or replace function public.gestao_salvar_metas(p jsonb)
returns int
language plpgsql
as $$
declare v_ano int := nullif(p->>'ano', '')::int; it jsonb; v_mes int; v_valor numeric; v_n int := 0;
begin
  if v_ano is null or v_ano < 2020 or v_ano > 2100 then raise exception 'Informe o ano.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'metas', '[]'::jsonb)) loop
    v_mes := nullif(it->>'mes', '')::int;
    if v_mes is null or v_mes < 1 or v_mes > 12 then raise exception 'Mês inválido: %', it->>'mes'; end if;
    v_valor := nullif(it->>'valor', '')::numeric;
    if v_valor is null then
      delete from public.metas_faturamento where mes = make_date(v_ano, v_mes, 1);
    else
      if v_valor < 0 then raise exception 'A meta não pode ser negativa.'; end if;
      insert into public.metas_faturamento (mes, valor) values (make_date(v_ano, v_mes, 1), v_valor)
      on conflict (mes) do update set valor = excluded.valor, atualizado_em = now();
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.gestao_salvar_metas(jsonb) from public;
grant execute on function public.gestao_salvar_metas(jsonb) to authenticated;
revoke all on public.indicadores_financeiros_mensal from anon;
grant select on public.indicadores_financeiros_mensal to authenticated;

-- (As metas de cada ano são digitadas na tela 🎯 Metas; a semente do primeiro ano fica no arquivo local.)

notify pgrst, 'reload schema';
