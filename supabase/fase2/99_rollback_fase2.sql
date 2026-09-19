-- Desfaz a migração da Fase 2 (só o que ela criou). Vendas do CRM que ela apenas completou
-- (pedidos Bagy já existentes) ficam com os campos extras preenchidos — inofensivo.
begin;
delete from public.vendas where origem = 'migracao';       -- apaga itens e saídas de estoque em cascata
-- pedidos do CRM (Bagy) que a migração só completou: remove os itens anexados e limpa os campos preenchidos
delete from public.venda_itens where venda_id in (select id from public.vendas where origem <> 'migracao' and pedido_externo is not null);
update public.vendas set forma_pagamento = null, pedido_externo = null, observacao = null, taxa_pagamento = null,
       comissao_canal = null, comissao_plataforma = null, frete_cobrado = null, frete_pago = null
 where origem <> 'migracao' and pedido_externo is not null;
delete from public.movimentos_estoque where observacao like 'retroativo:%' or observacao like 'brinde — pedido %';
delete from public.produtos;                                 -- só existem os 67 da migração (Fase 1 não cria produtos)
delete from public.clientes where legacy_app_id is not null and not exists (select 1 from public.vendas v where v.cliente_id = clientes.id)
                              and not exists (select 1 from public.cashback c where c.cliente_id = clientes.id)
                              and not exists (select 1 from public.follow_up_instancias f where f.cliente_id = clientes.id);
update public.clientes set legacy_app_id = null;
delete from public.canais where nome in ('Pro Horses','Outro')
   and not exists (select 1 from public.vendas v where v.canal_id = canais.id);
commit;
