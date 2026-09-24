-- Remove tudo que a Fase 13 criou. ATENÇÃO: apaga as dívidas, pagamentos, ajustes e o faturamento líquido digitado.
-- Não mexe em vendas, custos fixos nem em nenhuma outra fase.
begin;
drop function if exists public.gestao_salvar_faturamento_liquido(jsonb);
drop function if exists public.gestao_excluir_ajuste_divida(uuid);
drop function if exists public.gestao_registrar_ajuste_divida(jsonb);
drop function if exists public.gestao_excluir_pagamento_divida(uuid);
drop function if exists public.gestao_registrar_pagamento_divida(jsonb);
drop function if exists public.gestao_excluir_divida(uuid);
drop function if exists public.gestao_salvar_divida(jsonb);
drop view if exists public.divida_ataque_mensal;
drop view if exists public.divida_resumo_geral;
drop view if exists public.divida_resumo;
drop table if exists public.faturamento_liquido_mensal;
drop table if exists public.divida_ajustes;
drop table if exists public.divida_pagamentos;
drop table if exists public.dividas;
commit;
