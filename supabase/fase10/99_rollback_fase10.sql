-- Remove tudo que a Fase 10 criou (os ajustes de canais do arquivo local são desfeitos no próprio arquivo local). ATENÇÃO: apaga as feiras registradas e os custos fixos.
-- Vendas, margens e preços não são afetados.
begin;
drop view if exists public.indicadores_financeiros_mensal;
drop view if exists public.feira_custo_medio_mensal;
drop function if exists public.gestao_salvar_metas(jsonb);          -- complemento de metas realistas (se tiver sido rodado)
drop table if exists public.metas_faturamento;
drop function if exists public.gestao_salvar_config_indicadores(jsonb);
drop function if exists public.gestao_excluir_feira(uuid);
drop function if exists public.gestao_salvar_feira(jsonb);
drop function if exists public.gestao_excluir_custo_fixo(uuid);
drop function if exists public.gestao_encerrar_custo_fixo(uuid, date);
drop function if exists public.gestao_salvar_custo_fixo(jsonb);
drop table if exists public.config_indicadores;
drop table if exists public.feiras_realizadas;
drop table if exists public.custos_fixos;
commit;
