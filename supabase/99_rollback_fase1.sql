-- Rollback da Fase 1: remove o que a migration criou e desfaz as colunas
-- adicionadas em clientes/vendas (tabelas do CRM — elas NÃO são apagadas).
begin;
drop view  if exists public.tabela_produtos;
drop view  if exists public.curva_abc;
drop table if exists public.movimentos_estoque;
drop table if exists public.venda_itens;
drop table if exists public.regras_desconto;
drop table if exists public.produtos;

alter table public.vendas
  drop column if exists forma_pagamento,
  drop column if exists desconto_venda,
  drop column if exists origem,
  drop column if exists pedido_externo,
  drop column if exists observacao,
  drop column if exists legacy_app_id,
  drop column if exists taxa_pagamento,
  drop column if exists comissao_canal,
  drop column if exists comissao_plataforma,
  drop column if exists frete_cobrado,
  drop column if exists frete_pago,
  drop column if exists criado_por;
drop index if exists public.vendas_data_venda_idx;
drop index if exists public.vendas_cliente_idx;
-- Volta a exigir cliente. Falha (e desfaz tudo) se já existir venda sem
-- cliente — nesse caso decidir antes o que fazer com essas vendas.
alter table public.vendas alter column cliente_id set not null;

alter table public.clientes drop column if exists legacy_app_id;

drop function if exists public.venda_itens_gera_movimento();
drop function if exists public.movimentos_apos_alteracao();
drop function if exists public.recalcular_estoque(text);
drop function if exists public.produtos_protege_estoque();
drop function if exists public.gestao_set_atualizado_em();
drop function if exists public.calcular_vencimento(text, int);
drop function if exists public.hoje_brt();
commit;
