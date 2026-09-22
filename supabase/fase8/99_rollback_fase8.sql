-- Remove tudo que a Fase 8 criou. ATENÇÃO: apaga os lotes registrados, a lista de embalagem por produto e a configuração de precificação.
-- Os preços de produtos que você já aprovou permanecem (já estão em produtos.preco).
begin;
-- funções do complemento "produto novo" (se ele tiver sido rodado)
drop function if exists public.gestao_cadastrar_produto_com_lote(jsonb);
drop function if exists public.gestao_simular_lote(jsonb);
drop function if exists public.gestao_custo_lote(uuid, jsonb, numeric, numeric);
drop function if exists public.gestao_salvar_embalagem_produto(jsonb);
drop function if exists public.gestao_salvar_config_precificacao(jsonb);
drop function if exists public.gestao_excluir_lote(uuid);
drop function if exists public.gestao_aprovar_preco_lote(jsonb);
drop function if exists public.gestao_registrar_lote(jsonb);
drop function if exists public.gestao_calcular_lote(jsonb);
-- devolve gestao_excluir_formula à versão da Fase 7 (sem a checagem de lotes, que deixa de existir)
create or replace function public.gestao_excluir_formula(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.formulas where id = p_id;
  if not found then raise exception 'Fórmula não encontrada.'; end if;
end $$;
drop table if exists public.lotes_fabricacao;
drop table if exists public.produto_embalagem;
drop table if exists public.configuracao_precificacao;
commit;
