-- ============================================================================
-- Petit Sabó — Fase 15: Curva ABC visual + Pareto, e planejamento de vendas por produto
--
-- Parte 1: curva_abc_detalhe junta a curva_abc (Fase 1, corte 80/95/100 — não recalcula nada aqui) com o produto
-- e dá uma ordem de reposição: classe (A primeiro) e, dentro da classe, estoque baixo primeiro. O limite de
-- "estoque baixo" (< 5) é o mesmo já usado em tabela_produtos.status_estoque (Fase 1) — não é um número novo.
--
-- Parte 2: estrategias_vendas_mensal é um planejamento LIVRE (quantidade por produto, por mês), independente da
-- meta de faturamento (Fase 14) — não há validação forçando a soma a bater com a meta Realista.
--
-- Cria 1 tabela, 2 views e 1 função. Não muda nenhuma tabela existente. Rollback: 99_rollback_fase15.sql
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Parte 1: Curva ABC com o produto e a ordem de reposição
-- ---------------------------------------------------------------------------
create view public.curva_abc_detalhe with (security_invoker = true) as
select a.janela, a.sku, p.nome, p.colecao, p.categoria, p.oculto, p.estoque_atual,
       case when p.estoque_atual < 5 then 'baixo' when p.estoque_atual <= 10 then 'normal' else 'alto' end as status_estoque,
       a.posicao, a.faturamento, a.unidades, a.participacao, a.participacao_acumulada, a.classe,
       row_number() over (
         partition by a.janela
         order by case a.classe when 'A' then 1 when 'B' then 2 else 3 end,   -- classe primeiro (A urge mais)
                  (p.estoque_atual < 5) desc,                                  -- dentro da classe, estoque baixo primeiro
                  p.estoque_atual asc, a.faturamento desc
       ) as ordem_reposicao
  from public.curva_abc a
  join public.produtos p on p.sku = a.sku;

revoke all on public.curva_abc_detalhe from anon;
grant select on public.curva_abc_detalhe to authenticated;

-- ---------------------------------------------------------------------------
-- Parte 2: Planejamento de vendas por produto (livre, sem ligação com a meta de faturamento)
-- ---------------------------------------------------------------------------
create table public.estrategias_vendas_mensal (
  id                    uuid primary key default gen_random_uuid(),
  mes                   date not null check (extract(day from mes) = 1),
  sku                   text not null references public.produtos (sku) on update cascade on delete restrict,
  quantidade_planejada  int not null check (quantidade_planejada > 0),
  observacao            text,
  criado_por            uuid default auth.uid(),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  unique (mes, sku)
);
create index estrategias_vendas_mensal_mes_idx on public.estrategias_vendas_mensal (mes);

alter table public.estrategias_vendas_mensal enable row level security;
create policy authenticated_full_access on public.estrategias_vendas_mensal for all to authenticated using (true) with check (true);

-- Vendido = Σ quantidade dos itens de venda do produto naquele mês (só sku de catálogo — igual à curva_abc,
-- vendas avulsas da Fase 16 não têm sku e ficam de fora, como já era o caso na curva ABC).
create view public.progresso_planejamento_mensal with (security_invoker = true) as
select e.id, e.mes, e.sku, p.nome, p.colecao, p.categoria, p.estoque_atual, e.quantidade_planejada, e.observacao,
       coalesce((select sum(vi.quantidade) from public.venda_itens vi join public.vendas v on v.id = vi.venda_id
                  where vi.sku = e.sku and v.data_venda >= e.mes and v.data_venda < (e.mes + interval '1 month')), 0) as quantidade_vendida,
       round(coalesce((select sum(vi.quantidade) from public.venda_itens vi join public.vendas v on v.id = vi.venda_id
                  where vi.sku = e.sku and v.data_venda >= e.mes and v.data_venda < (e.mes + interval '1 month')), 0)
             / e.quantidade_planejada::numeric, 4) as pct_planejado,
       e.quantidade_planejada - coalesce((select sum(vi.quantidade) from public.venda_itens vi join public.vendas v on v.id = vi.venda_id
                  where vi.sku = e.sku and v.data_venda >= e.mes and v.data_venda < (e.mes + interval '1 month')), 0) as diferenca,
       (e.mes = date_trunc('month', public.hoje_brt())::date) as mes_corrente,
       (e.mes + interval '1 month' - interval '1 day' < public.hoje_brt()) as mes_fechado
  from public.estrategias_vendas_mensal e
  join public.produtos p on p.sku = e.sku;

revoke all on public.progresso_planejamento_mensal from anon;
grant select on public.progresso_planejamento_mensal to authenticated;

-- Salva o planejamento de um mês inteiro de uma vez.
-- p = { mes, itens: [{ sku, quantidade, observacao? }] } — quantidade vazia apaga o item daquele produto no mês.
create or replace function public.gestao_salvar_planejamento_mensal(p jsonb)
returns int
language plpgsql
as $$
declare v_mes date := nullif(p->>'mes', '')::date; it jsonb; v_sku text; v_qtd int; v_n int := 0;
begin
  if v_mes is null then raise exception 'Informe o mês.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    v_sku := upper(btrim(coalesce(it->>'sku', '')));
    if v_sku = '' then raise exception 'Item sem produto.'; end if;
    if not exists (select 1 from public.produtos where sku = v_sku) then raise exception 'Produto % não existe.', v_sku; end if;
    v_qtd := nullif(it->>'quantidade', '')::int;
    if v_qtd is null then
      delete from public.estrategias_vendas_mensal where mes = v_mes and sku = v_sku;
    else
      if v_qtd <= 0 then raise exception 'A quantidade planejada de % precisa ser maior que zero.', v_sku; end if;
      insert into public.estrategias_vendas_mensal (mes, sku, quantidade_planejada, observacao)
      values (v_mes, v_sku, v_qtd, nullif(btrim(coalesce(it->>'observacao', '')), ''))
      on conflict (mes, sku) do update set quantidade_planejada = excluded.quantidade_planejada,
             observacao = excluded.observacao, atualizado_em = now();
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.gestao_salvar_planejamento_mensal(jsonb) from public;
grant execute on function public.gestao_salvar_planejamento_mensal(jsonb) to authenticated;

-- Exclui um item de planejamento direto (além de "quantidade vazia" no salvar em lote).
create or replace function public.gestao_excluir_item_planejamento(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.estrategias_vendas_mensal where id = p_id;
  if not found then raise exception 'Item de planejamento não encontrado.'; end if;
end $$;
revoke all on function public.gestao_excluir_item_planejamento(uuid) from public;
grant execute on function public.gestao_excluir_item_planejamento(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
