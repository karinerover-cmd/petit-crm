-- Desfaz a Fase 12b (conciliação por extrato). Os lançamentos que a conciliação criou no livro-caixa continuam lá
-- (são lançamentos normais); só somem as linhas de extrato, as regras e as funções/telas de conciliação.
begin;

drop function if exists public.gestao_lancar_ajuste_abertura(uuid);
drop function if exists public.gestao_aplicar_conciliacao(jsonb);
drop function if exists public.gestao_importar_extrato(jsonb);

drop view if exists public.extrato_importacoes_resumo;
drop view if exists public.extrato_saldo_diario;
drop view if exists public.extrato_conciliacao_proposta;

drop table if exists public.extrato_regras_categoria;
drop table if exists public.extrato_linhas;
drop table if exists public.extrato_importacoes;

alter table public.config_fluxo_caixa drop column if exists extrato_espelho_desde;

commit;
