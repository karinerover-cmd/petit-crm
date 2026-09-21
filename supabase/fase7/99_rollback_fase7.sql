-- Remove tudo que a Fase 7 criou. ATENÇÃO: apaga as fórmulas já cadastradas (as matérias-primas criadas por elas permanecem).
begin;
drop function if exists public.gestao_excluir_formula(uuid);
drop function if exists public.gestao_ativar_formula(uuid);
drop function if exists public.gestao_salvar_formula(jsonb);
drop view if exists public.formulas_custo;
drop table if exists public.formula_itens;
drop table if exists public.formulas;
commit;
