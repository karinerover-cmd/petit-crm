-- Desfaz a Fase 15. Não mexe em produtos, vendas nem curva_abc.
begin;

drop function if exists public.gestao_excluir_item_planejamento(uuid);
drop function if exists public.gestao_salvar_planejamento_mensal(jsonb);
drop view if exists public.progresso_planejamento_mensal;
drop table if exists public.estrategias_vendas_mensal;
drop view if exists public.curva_abc_detalhe;

notify pgrst, 'reload schema';
commit;
