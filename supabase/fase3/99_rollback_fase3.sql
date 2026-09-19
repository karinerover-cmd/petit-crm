-- Remove as funções da Fase 3b. Não mexe em tabelas nem em dados.
drop function if exists public.gestao_remover_canal(text);
drop function if exists public.gestao_renomear_canal(text, text);
drop function if exists public.gestao_salvar_canal(text);
drop function if exists public.gestao_excluir_cliente(uuid);
drop function if exists public.gestao_salvar_cliente(text, text, text);
drop function if exists public.gestao_excluir_venda(uuid);
drop function if exists public.gestao_editar_venda(jsonb);
drop function if exists public.gestao_registrar_venda(jsonb);
drop function if exists public.gestao_excluir_produto(text);
drop function if exists public.gestao_atualizar_fabricacao(text, text, int);
drop function if exists public.gestao_salvar_produto(jsonb);
drop function if exists public.gestao_ajustar_estoque(text, int, text, text);
drop function if exists public.gestao_cliente_id(text, text, text, boolean);
drop function if exists public.gestao_canal_id(text);
