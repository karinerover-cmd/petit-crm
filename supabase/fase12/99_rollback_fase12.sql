-- Desfaz a Fase 12 (fluxo de caixa). Não mexe em vendas, dívidas nem custos fixos — só tira os triggers que a Fase 12
-- colocou neles e apaga o livro-caixa (inclusive o histórico importado da planilha).
begin;

drop trigger if exists vendas_fluxo_caixa on public.vendas;
drop trigger if exists divida_pagamentos_fluxo_caixa on public.divida_pagamentos;

drop function if exists public.fluxo_caixa_trigger_venda();
drop function if exists public.fluxo_caixa_trigger_divida_pagamento();
drop function if exists public.fluxo_caixa_sincronizar_venda(uuid);
drop function if exists public.fluxo_caixa_sincronizar_divida_pagamento(uuid);
drop function if exists public.gestao_salvar_conta_bancaria(jsonb);
drop function if exists public.gestao_salvar_movimento_caixa(jsonb);
drop function if exists public.gestao_confirmar_movimentos_caixa(jsonb);
drop function if exists public.gestao_lancar_custo_fixo(jsonb);
drop function if exists public.gestao_excluir_movimento_caixa(uuid);

drop view if exists public.saldo_caixa_projetado;
drop view if exists public.fluxo_caixa_resumo_mensal;
drop view if exists public.fluxo_caixa_extrato;
drop view if exists public.fluxo_caixa_categorias;

drop table if exists public.fluxo_caixa_movimentos;
drop table if exists public.config_fluxo_caixa;
drop table if exists public.contas_bancarias;

commit;
