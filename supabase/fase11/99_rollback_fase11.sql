-- Remove tudo que a Fase 11 criou. ATENÇÃO: apaga os lotes de matéria-prima, a rastreabilidade e o checklist de rotina.
-- Não mexe em produtos, fórmulas, lotes de fabricação, notas fiscais nem vendas.
begin;
drop function if exists public.gestao_desfazer_execucao(uuid);
drop function if exists public.gestao_marcar_tarefa_feita(uuid, text);
drop function if exists public.gestao_salvar_lotes_usados(jsonb);
drop function if exists public.gestao_excluir_lote_materia_prima(uuid);
drop function if exists public.gestao_registrar_lote_materia_prima(jsonb);
drop view if exists public.rotina_status;
drop view if exists public.materia_prima_lotes_vencimento;
drop table if exists public.rotina_execucoes;
drop table if exists public.rotina_tarefas;
drop table if exists public.lote_fabricacao_materia_prima_lote;
drop table if exists public.materia_prima_lotes;
commit;
