-- ============================================================================
-- Teste da Fase 1 com dados fictícios. Tudo roda numa transação e termina em
-- ROLLBACK: nada fica gravado. Se alguma checagem falhar, dá erro com a causa.
-- ============================================================================
begin;

insert into public.produtos (sku, nome, colecao, categoria, data_fabricacao, validade_meses, preco) values
  ('TST001', 'TESTE VELA',        'Teste', 'Vela',       to_char(public.hoje_brt() - interval '1 month', 'MM/YYYY'), 24, 100.00),
  ('TST002', 'TESTE SABONETE',    'Teste', 'Sabonete',   to_char(public.hoje_brt() - interval '10 months','MM/YYYY'), 12,  20.00),
  ('TST003', 'TESTE HIDRATANTE',  'Teste', 'Hidratante', to_char(public.hoje_brt() - interval '8 months', 'MM/YYYY'),  6,  40.00);

insert into public.movimentos_estoque (sku, tipo, quantidade) values
  ('TST001', 'estoque_inicial', 10),
  ('TST002', 'estoque_inicial', 8),
  ('TST003', 'estoque_inicial', 3),
  ('TST002', 'retirada', -1);

insert into public.clientes (nome, telefone) values ('Cliente Teste', '(61) 90000-0000');
insert into public.canais (nome, tipo) values ('Canal Teste', 'teste');

with v as (
  insert into public.vendas (data_venda, canal_id, forma_pagamento, cliente_id, valor, origem)
  values (public.hoje_brt(),
          (select id from public.canais where nome = 'Canal Teste'),
          'Pix',
          (select id from public.clientes where nome = 'Cliente Teste'),
          120.00, 'gestao')
  returning id
)
insert into public.venda_itens (venda_id, sku, produto_nome, quantidade, preco_unitario, desconto)
select v.id, x.sku, x.nome, x.qtd, x.preco, x.descto
  from v, (values ('TST001','TESTE VELA',1,100.00,0.00), ('TST002','TESTE SABONETE',1,20.00,0.00)) x(sku,nome,qtd,preco,descto);

do $$
declare e1 int; e2 int; e3 int;
begin
  select estoque_atual into e1 from public.produtos where sku = 'TST001';
  select estoque_atual into e2 from public.produtos where sku = 'TST002';
  select estoque_atual into e3 from public.produtos where sku = 'TST003';
  if (e1, e2, e3) is distinct from (9, 6, 3) then
    raise exception 'estoque errado: TST001=% (esperado 9), TST002=% (6), TST003=% (3)', e1, e2, e3;
  end if;

  -- estoque_atual não pode ser editado diretamente
  begin
    update public.produtos set estoque_atual = 999 where sku = 'TST001';
    raise exception 'FALHA: update direto em estoque_atual foi aceito';
  exception when raise_exception then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;

  -- mudar a quantidade do item de venda ajusta o estoque
  update public.venda_itens set quantidade = 3 where sku = 'TST001';
  select estoque_atual into e1 from public.produtos where sku = 'TST001';
  if e1 <> 7 then raise exception 'update de item: esperado 7, veio %', e1; end if;

  -- apagar a venda devolve o estoque
  delete from public.vendas
   where id in (select venda_id from public.venda_itens where sku = 'TST002');
  select estoque_atual into e1 from public.produtos where sku = 'TST001';
  select estoque_atual into e2 from public.produtos where sku = 'TST002';
  if (e1, e2) is distinct from (10, 7) then
    raise exception 'delete de venda: esperado 10/7, veio %/%', e1, e2;
  end if;

  -- reposição com nova fabricação atualiza o produto
  insert into public.movimentos_estoque (sku, tipo, quantidade, data_fabricacao)
  values ('TST003', 'reposicao', 5, to_char(public.hoje_brt(), 'MM/YYYY'));
  perform 1 from public.produtos
   where sku = 'TST003' and estoque_atual = 8 and data_fabricacao = to_char(public.hoje_brt(), 'MM/YYYY');
  if not found then raise exception 'reposição não atualizou estoque/fabricação'; end if;

  -- regra de vencimento
  if public.calcular_vencimento('03/2026', 12) <> date '2027-03-31'
     or public.calcular_vencimento('04/2026', 6) <> date '2026-10-31' then
    raise exception 'calcular_vencimento fora da regra do PRD';
  end if;

  -- produto no mês de fabricação: desconto 0% e valor final = preço cheio
  perform 1 from public.tabela_produtos
   where sku = 'TST003' and desconto_pct = 0 and valor_final = 40.00;
  if not found then raise exception 'mês de fabricação deveria ter 0%% de desconto'; end if;

  raise notice 'OK — todas as checagens passaram';
end $$;

-- Conferência visual da view (antes do rollback)
select sku, estoque_atual, data_vencimento, dias_para_vencer, status_validade,
       promocao_sugerida, meses_restantes, desconto_pct, valor_final, status
  from public.tabela_produtos where sku like 'TST%' order by sku;

rollback;
