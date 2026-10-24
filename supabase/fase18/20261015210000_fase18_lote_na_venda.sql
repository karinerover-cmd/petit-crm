-- ============================================================================
-- Petit Sabó — Fase 18: lote de fabricação na venda (opcional)
-- ============================================================================
-- Cada item de venda pode apontar para o lote de fabricação de onde saiu. É opcional: vendas antigas e itens sem lote continuam iguais.
-- Saldo do lote = unidades produzidas − unidades vendidas com aquele lote marcado. É uma estimativa (o estoque do app é por produto,
-- não por lote): venda sem lote marcado não abate nenhum lote.
begin;

-- 1) Item de venda aponta (opcionalmente) para o lote. Se o lote for excluído, o item continua, só perde a marcação.
alter table public.venda_itens add column if not exists lote_fabricacao_id uuid references public.lotes_fabricacao (id) on delete set null;
create index if not exists venda_itens_lote_idx on public.venda_itens (lote_fabricacao_id) where lote_fabricacao_id is not null;

-- 2) Lotes com saldo de um produto, do mais antigo para o mais novo (o primeiro é o sugerido na venda).
--    p = { sku }. Devolve [] se o produto não tem estoque ou nenhum lote com saldo.
create or replace function public.gestao_lotes_disponiveis(p jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'numero_lote', x.numero_lote, 'data_fabricacao', x.data_fabricacao, 'saldo', x.saldo)
                            order by x.data_fabricacao, x.criado_em), '[]'::jsonb)
  from (
    select l.id, l.numero_lote, l.data_fabricacao, l.criado_em,
           l.quantidade_produzida - coalesce((select sum(vi.quantidade) from public.venda_itens vi where vi.lote_fabricacao_id = l.id), 0) as saldo
      from public.lotes_fabricacao l
     where l.sku = upper(btrim(p->>'sku'))
       and coalesce((select pr.estoque_atual from public.produtos pr where pr.sku = l.sku), 0) > 0
  ) x
  where x.saldo > 0;
$$;

-- 3) Registrar venda: item de produto aceita lote_id (opcional). O lote tem que ser do mesmo produto.
create or replace function public.gestao_registrar_venda(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid; v_canal uuid; v_cli uuid; v_obs text := nullif(btrim(coalesce(p->>'obs', '')), '');
  v_orig text := coalesce(nullif(p->>'origem', ''), 'gestao');
  v_ped text := nullif(btrim(coalesce(p->>'pedido_externo', '')), '');
  it jsonb; v_sub numeric := 0; v_desc numeric := round(coalesce((p->>'desconto_venda')::numeric, 0), 2);
  v_nome text; v_sku text; v_tipo_avulso text; v_descricao_avulsa text; v_lote uuid;
begin
  if v_orig not in ('gestao', 'app_vendedor') then raise exception 'Origem inválida.'; end if;
  if v_ped is not null and exists (select 1 from public.vendas where pedido_externo = v_ped and origem = v_orig) then return null; end if;
  if jsonb_array_length(coalesce(p->'itens', '[]'::jsonb)) = 0 then raise exception 'Adicione pelo menos um produto.'; end if;
  v_canal := public.gestao_canal_id(p->>'canal');

  if nullif(p->>'cliente_id', '') is not null then
    v_cli := (p->>'cliente_id')::uuid;
  elsif nullif(btrim(coalesce(p->'cliente'->>'nome', '')), '') is not null then
    v_cli := public.gestao_cliente_id(p->'cliente'->>'nome', p->'cliente'->>'tel', p->'cliente'->>'email',
                                      coalesce((p->'cliente'->>'salvar')::boolean, false));
    if v_cli is null then   -- cliente informado mas não cadastrado: guarda o nome na observação, como o app fazia
      v_obs := concat_ws(' | ', v_obs, 'Cliente: ' || btrim(p->'cliente'->>'nome')
                          || coalesce(' ' || nullif(btrim(coalesce(p->'cliente'->>'tel', '')), ''), ''));
    end if;
  end if;

  for it in select * from jsonb_array_elements(p->'itens') loop
    v_sub := v_sub + round((it->>'preco')::numeric * (it->>'qtd')::int - round(coalesce((it->>'desconto')::numeric, 0), 2), 2);
  end loop;

  insert into public.vendas (data_venda, canal_id, cliente_id, valor, forma_pagamento, desconto_venda, origem, pedido_externo, observacao)
  values (coalesce(nullif(p->>'data', '')::date, public.hoje_brt()), v_canal, v_cli, greatest(0, round(v_sub - v_desc, 2)),
          nullif(btrim(coalesce(p->>'forma_pagamento', '')), ''), v_desc, v_orig, v_ped, v_obs)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    if coalesce((it->>'avulso')::boolean, false) then
      v_tipo_avulso := nullif(it->>'tipo_avulso', '');
      v_descricao_avulsa := nullif(btrim(coalesce(it->>'descricao_avulsa', '')), '');
      if v_tipo_avulso is null or v_tipo_avulso not in ('Refil', 'Encomenda', 'Personalizado') then
        raise exception 'Tipo da venda avulsa inválido.';
      end if;
      if v_descricao_avulsa is null then raise exception 'Descreva o item avulso.'; end if;
      insert into public.venda_itens (venda_id, sku, produto_nome, quantidade, preco_unitario, desconto, desconto_label,
                                       tipo_avulso, descricao_avulsa, custo_unitario_manual, observacao_avulsa)
      values (v_id, null, v_descricao_avulsa, (it->>'qtd')::int, (it->>'preco')::numeric,
              round(coalesce((it->>'desconto')::numeric, 0), 2), nullif(it->>'label', ''),
              v_tipo_avulso, v_descricao_avulsa, nullif(it->>'custo_unitario_manual', '')::numeric,
              nullif(btrim(coalesce(it->>'observacao_avulsa', '')), ''));
    else
      v_sku := upper(btrim(it->>'sku'));
      select nome into v_nome from public.produtos where sku = v_sku;
      if v_nome is null then raise exception 'Produto % não existe.', v_sku; end if;
      v_lote := nullif(btrim(coalesce(it->>'lote_id', '')), '')::uuid;
      if v_lote is not null and not exists (select 1 from public.lotes_fabricacao where id = v_lote and sku = v_sku) then
        raise exception 'O lote informado não é do produto %.', v_sku;
      end if;
      insert into public.venda_itens (venda_id, sku, produto_nome, quantidade, preco_unitario, desconto, desconto_label, lote_fabricacao_id)
      values (v_id, v_sku, coalesce(nullif(it->>'nome', ''), v_nome), (it->>'qtd')::int, (it->>'preco')::numeric,
              round(coalesce((it->>'desconto')::numeric, 0), 2), nullif(it->>'label', ''), v_lote);
    end if;
  end loop;
  return v_id;
end $$;

-- 4) Permissões (mesmo padrão das outras fases)
revoke all on function public.gestao_lotes_disponiveis(jsonb) from public;
grant execute on function public.gestao_lotes_disponiveis(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Conferência:
-- select public.gestao_lotes_disponiveis('{"sku":"CEV002"}'::jsonb);
