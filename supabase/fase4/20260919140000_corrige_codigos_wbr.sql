-- Correção de cadastro (a planilha de promoções está certa; conferido com as baixas de estoque reais e com as datas informadas).
--
-- 1) CÓDIGOS: os 3 produtos Wanderlust Brasília estavam com os códigos girados no Supabase (vieram assim do app).
--      Vela        WBR001 → WBR002
--      Home Spray  WBR002 → WBR003
--      Sabonete    WBR003 → WBR001
--    Vendas e movimentos de estoque de cada produto acompanham o novo código (chave estrangeira em cascata).
--
-- 2) FABRICAÇÃO (regra: vence no último dia do mês de fabricação + validade):
--      Sabonete Wanderlust  12 meses  07/2026 → 06/2026  =>  vence 30/06/2027   (informado por você)
--      Vela Wanderlust      24 meses  08/2026 → 07/2026  =>  vence 31/07/2028   (informado por você)
--      Home Spray Wanderlust 24 meses 07/2026 → 06/2026  =>  vence 30/06/2028   (data da planilha)
--      DDM264 Mini Vela     24 meses  03/2025 → 02/2026  =>  vence 28/02/2028   (fevereiro é sempre dia 28; igual à planilha)
--    (rode ANTES o 20260919150000_fevereiro_dia28.sql, para a data sair 28/02 e não 29/02)
--
-- Tudo em um bloco só (tudo ou nada). Só executa se os códigos estiverem como esperado.
do $corrige$
begin
  if (select nome from public.produtos where sku = 'WBR001') not ilike 'VELA WANDERLUST%'
     or (select nome from public.produtos where sku = 'WBR002') not ilike 'HOME SPRAY WANDERLUST%'
     or (select nome from public.produtos where sku = 'WBR003') not ilike 'SABONETE WANDERLUST%' then
    raise exception 'Os códigos WBR001/WBR002/WBR003 não estão como esperado (ou a correção já foi feita). Nada foi alterado.';
  end if;

  -- passa por códigos provisórios para não colidir
  update public.produtos set sku = 'WBRTMP1' where sku = 'WBR001';   -- vela
  update public.produtos set sku = 'WBRTMP2' where sku = 'WBR002';   -- home spray
  update public.produtos set sku = 'WBRTMP3' where sku = 'WBR003';   -- sabonete
  update public.produtos set sku = 'WBR002'  where sku = 'WBRTMP1';  -- vela
  update public.produtos set sku = 'WBR003'  where sku = 'WBRTMP2';  -- home spray
  update public.produtos set sku = 'WBR001'  where sku = 'WBRTMP3';  -- sabonete

  update public.produtos set data_fabricacao = '06/2026' where sku = 'WBR001';   -- sabonete: vence 30/06/2027
  update public.produtos set data_fabricacao = '07/2026' where sku = 'WBR002';   -- vela:     vence 31/07/2028
  update public.produtos set data_fabricacao = '06/2026' where sku = 'WBR003';   -- home spray: vence 30/06/2028
  update public.produtos set data_fabricacao = '02/2026' where sku = 'DDM264' and data_fabricacao = '03/2025';
end
$corrige$;

-- Conferência (somente leitura)
select p.sku, p.nome, p.estoque_atual, p.data_fabricacao, p.validade_meses, p.data_vencimento,
       (select count(*) from public.venda_itens i where i.sku = p.sku) as itens_de_venda
  from public.produtos p where p.sku in ('WBR001', 'WBR002', 'WBR003', 'DDM264') order by p.sku;
