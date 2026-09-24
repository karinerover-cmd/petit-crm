-- Desfaz o complemento de metas realistas: a view volta à versão original da Fase 10 e a tabela de metas é apagada.
-- ATENÇÃO: apaga as metas digitadas. Não mexe em vendas, feiras nem custos fixos.
begin;
drop function if exists public.gestao_salvar_metas(jsonb);
drop view if exists public.indicadores_financeiros_mensal;
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
revoke all on public.indicadores_financeiros_mensal from anon;
grant select on public.indicadores_financeiros_mensal to authenticated;
drop table if exists public.metas_faturamento;
commit;
