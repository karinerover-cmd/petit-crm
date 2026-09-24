-- ============================================================================
-- Petit Sabó — Fase 14: metas em 3 níveis e acompanhamento (mês e semana)
--
-- Estende metas_faturamento (Fase 10) com a meta Mínima e a Desafio; a Realista continua sendo a coluna "valor"
-- (a view indicadores_financeiros_mensal já a chama de meta_realista). A barra de progresso é guiada pela Realista.
--
-- Cálculo (aprovado pela Karine em 2026-09-24):
--   faturamento        = Σ vendas.valor pela data_venda — a mesma base da Fase 10
--   % de cada nível    = faturamento ÷ meta do nível
--   dias_restantes     = dias corridos que faltam no mês, contando hoje (ela vende em feira no fim de semana e online todo dia)
--   ritmo diário       = (Realista − faturamento) ÷ dias_restantes; 0 se já bateu
--   semana             = segunda a domingo; nº de semanas do mês = dias do mês ÷ 7, então a meta da semana é
--                        Realista × 7 ÷ dias do mês. Semana que cruza dois meses usa a meta diária de cada mês nos seus
--                        dias — a soma das semanas fecha exatamente a meta do mês.
--
-- Acrescenta 2 colunas e 1 regra em metas_faturamento, cria 2 views e amplia gestao_salvar_metas.
-- Não muda nenhuma meta já cadastrada. Rollback: 99_rollback_fase14.sql
-- ============================================================================
begin;

alter table public.metas_faturamento
  add column meta_minima  numeric(12,2) check (meta_minima >= 0),
  add column meta_desafio numeric(12,2) check (meta_desafio >= 0),
  add constraint metas_faturamento_ordem_niveis check (
        (meta_minima is null or meta_minima <= valor)
    and (meta_desafio is null or meta_desafio >= valor));

-- ---------------------------------------------------------------------------
-- Progresso do mês: uma linha por mês com meta
-- ---------------------------------------------------------------------------
create view public.progresso_mensal with (security_invoker = true) as
with base as (
  select mt.mes, mt.meta_minima, mt.valor as meta_realista, mt.meta_desafio,
         (mt.mes + interval '1 month' - interval '1 day')::date as fim_mes,
         public.hoje_brt() as hoje,
         coalesce((select sum(v.valor) from public.vendas v
                    where v.data_venda >= mt.mes and v.data_venda < (mt.mes + interval '1 month')), 0) as faturamento
    from public.metas_faturamento mt
),
dias as (
  select b.*, extract(day from b.fim_mes)::int as dias_mes,
         case when b.hoje > b.fim_mes then 0
              when b.hoje < b.mes then extract(day from b.fim_mes)::int
              else (b.fim_mes - b.hoje + 1) end as dias_restantes
    from base b
)
select mes, round(faturamento, 2) as faturamento,
       meta_minima, meta_realista, meta_desafio,
       case when meta_minima > 0   then round(faturamento / meta_minima, 4) end   as pct_minima,
       case when meta_realista > 0 then round(faturamento / meta_realista, 4) end as pct_realista,
       case when meta_desafio > 0  then round(faturamento / meta_desafio, 4) end  as pct_desafio,
       -- posição da Mínima e da Desafio na barra guiada pela Realista (Realista = 1,0 = 100% da barra)
       case when meta_realista > 0 and meta_minima is not null  then round(meta_minima / meta_realista, 4) end  as marco_minima,
       case when meta_realista > 0 and meta_desafio is not null then round(meta_desafio / meta_realista, 4) end as marco_desafio,
       -- até onde a barra vai: 100% da Realista, ou mais se a Desafio ou o faturamento passarem dela
       greatest(1, coalesce(case when meta_realista > 0 then meta_desafio / meta_realista end, 1),
                   coalesce(case when meta_realista > 0 then faturamento / meta_realista end, 1))::numeric(8,4) as escala_barra,
       round(greatest(meta_realista - faturamento, 0), 2) as falta_realista,
       case when meta_minima is not null then (faturamento >= meta_minima) end   as atingiu_minima,
       (faturamento >= meta_realista)                                            as atingiu_realista,
       case when meta_desafio is not null then (faturamento >= meta_desafio) end as atingiu_desafio,
       (mes = date_trunc('month', hoje)::date) as mes_corrente,
       dias_mes, dias_restantes,
       case when dias_restantes > 0 then round(greatest(meta_realista - faturamento, 0) / dias_restantes, 2) end as ritmo_diario_realista
  from dias;

-- ---------------------------------------------------------------------------
-- Progresso da semana (segunda a domingo), da 1ª semana com meta até a semana corrente
-- ---------------------------------------------------------------------------
create view public.progresso_semanal with (security_invoker = true) as
with semanas as (
  select generate_series(date_trunc('week', (select min(mes) from public.metas_faturamento)::timestamp),
                         date_trunc('week', public.hoje_brt()::timestamp), interval '1 week')::date as inicio
),
meta_por_dia as (
  select s.inicio, d::date as dia,
         mt.valor / extract(day from (date_trunc('month', d) + interval '1 month' - interval '1 day'))::numeric as meta_do_dia
    from semanas s
   cross join generate_series(s.inicio::timestamp, (s.inicio + 6)::timestamp, interval '1 day') d
    left join public.metas_faturamento mt on mt.mes = date_trunc('month', d)::date
),
agrupado as (
  select m.inicio, sum(m.meta_do_dia) as meta_semanal, bool_and(m.meta_do_dia is not null) as meta_completa,
         coalesce((select sum(v.valor) from public.vendas v where v.data_venda between m.inicio and m.inicio + 6), 0) as faturamento
    from meta_por_dia m group by m.inicio
)
select inicio as semana_inicio, inicio + 6 as semana_fim,
       round(meta_semanal, 2) as meta_semanal,
       meta_completa,                               -- falso se algum dia da semana cai num mês sem meta cadastrada
       round(faturamento, 2) as faturamento,
       case when meta_semanal > 0 then round(faturamento / meta_semanal, 4) end as pct_semana,
       round(greatest(coalesce(meta_semanal, 0) - faturamento, 0), 2) as falta_semana,
       (inicio = date_trunc('week', public.hoje_brt()::timestamp)::date) as semana_corrente
  from agrupado;

revoke all on public.progresso_mensal, public.progresso_semanal from anon;
grant select on public.progresso_mensal, public.progresso_semanal to authenticated;

-- ---------------------------------------------------------------------------
-- gestao_salvar_metas: cada mês agora aceita { mes, valor, minima?, desafio? }.
-- Valor (Realista) vazio apaga o mês inteiro. Se "minima"/"desafio" não vierem no pedido, ficam como estavam.
-- ---------------------------------------------------------------------------
create or replace function public.gestao_salvar_metas(p jsonb)
returns int
language plpgsql
as $$
declare v_ano int := nullif(p->>'ano', '')::int; it jsonb; v_mes int; v_valor numeric; v_min numeric; v_des numeric; v_n int := 0;
        v_data date; v_atual public.metas_faturamento%rowtype;
begin
  if v_ano is null or v_ano < 2020 or v_ano > 2100 then raise exception 'Informe o ano.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'metas', '[]'::jsonb)) loop
    v_mes := nullif(it->>'mes', '')::int;
    if v_mes is null or v_mes < 1 or v_mes > 12 then raise exception 'Mês inválido: %', it->>'mes'; end if;
    v_data := make_date(v_ano, v_mes, 1);
    v_valor := nullif(it->>'valor', '')::numeric;
    if v_valor is null then
      delete from public.metas_faturamento where mes = v_data;
      continue;
    end if;
    select * into v_atual from public.metas_faturamento where mes = v_data;
    v_min := case when it ? 'minima'  then nullif(it->>'minima', '')::numeric  else v_atual.meta_minima end;
    v_des := case when it ? 'desafio' then nullif(it->>'desafio', '')::numeric else v_atual.meta_desafio end;
    if v_valor < 0 or v_min < 0 or v_des < 0 then raise exception 'A meta não pode ser negativa.'; end if;
    if v_min > v_valor then raise exception '%/%: a meta mínima não pode ser maior que a realista.', v_mes, v_ano; end if;
    if v_des < v_valor then raise exception '%/%: a meta desafio não pode ser menor que a realista.', v_mes, v_ano; end if;
    insert into public.metas_faturamento (mes, valor, meta_minima, meta_desafio) values (v_data, v_valor, v_min, v_des)
    on conflict (mes) do update set valor = excluded.valor, meta_minima = excluded.meta_minima, meta_desafio = excluded.meta_desafio, atualizado_em = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.gestao_salvar_metas(jsonb) from public;
grant execute on function public.gestao_salvar_metas(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
