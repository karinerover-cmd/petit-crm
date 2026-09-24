-- Remove tudo que a Fase 9 criou. ATENÇÃO: apaga as margens calculadas e as regras de despesa variável.
-- Preços de venda não são afetados (esta fase nunca mudou preço).
begin;
drop trigger if exists venda_itens_registra_margem on public.venda_itens;
drop trigger if exists venda_itens_trava_custo on public.venda_itens;
drop function if exists public.gestao_trigger_margem_venda();
drop function if exists public.gestao_travar_custo_item();
drop function if exists public.gestao_salvar_kit_embalagem_envio(jsonb);
drop function if exists public.gestao_excluir_despesa_variavel(uuid);
drop function if exists public.gestao_salvar_despesa_variavel(jsonb);
drop function if exists public.gestao_registrar_margem_venda(uuid);
drop function if exists public.gestao_calcular_margem_venda(uuid);
drop table if exists public.venda_margem;
alter table public.venda_itens drop column if exists custo_origem;
alter table public.venda_itens drop column if exists custo_unitario_no_momento;
drop table if exists public.embalagem_envio_kit;
drop table if exists public.despesas_variaveis_config;
commit;
