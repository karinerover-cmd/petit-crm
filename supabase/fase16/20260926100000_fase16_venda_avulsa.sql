-- ============================================================================
-- Petit Sabó — Fase 16: venda avulsa (refil / encomenda / personalizado)
--
-- Objetivo: registrar uma venda sem produto cadastrado (refil de casa da
-- cliente, encomenda sob demanda), sem mexer no estoque e sem quebrar
-- margem, faturamento ou curva ABC.
--
-- O que já funcionava e NÃO precisou mudar (conferido na Fase 1/9/10):
--   * venda_itens.sku já aceita nulo (histórico importado sem SKU casado).
--   * venda_itens_gera_movimento() já ignora sku nulo — nenhuma baixa de
--     estoque acontece para item avulso.
--   * curva_abc já filtra "where sku is not null" — venda avulsa não entra.
--   * Fase 10 já soma faturamento por vendas.valor (não por item) — não
--     depende de sku.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1) Campos da venda avulsa
-- ---------------------------------------------------------------------------
alter table public.venda_itens
  add column tipo_avulso            text check (tipo_avulso in ('Refil','Encomenda','Personalizado')),
  add column descricao_avulsa       text,
  add column custo_unitario_manual  numeric(14,4) check (custo_unitario_manual >= 0);

-- Item avulso não pode ter sku, e item de catálogo não pode ter tipo_avulso.
alter table public.venda_itens add constraint venda_itens_avulso_sem_sku
  check (tipo_avulso is null or sku is null);

-- Se marcou tipo_avulso, a descrição é obrigatória (não existe "avulso" sem dizer o quê é).
alter table public.venda_itens add constraint venda_itens_avulso_tem_descricao
  check (tipo_avulso is null or btrim(coalesce(descricao_avulsa, '')) <> '');

-- ---------------------------------------------------------------------------
-- 2) 'manual' passa a ser uma origem de custo válida (Fase 9 só tinha 'lote')
-- ---------------------------------------------------------------------------
alter table public.venda_itens drop constraint venda_itens_custo_origem_check;
alter table public.venda_itens add constraint venda_itens_custo_origem_check
  check (custo_origem in ('lote', 'manual'));

-- ---------------------------------------------------------------------------
-- 3) Trava também o custo manual, quando não há sku/lote (Fase 9)
-- ---------------------------------------------------------------------------
create or replace function public.gestao_travar_custo_item()
returns trigger
language plpgsql
as $$
declare v_data date; v_custo numeric;
begin
  if new.sku is not null then
    v_data := (select data_venda from public.vendas where id = new.venda_id);
    select custo_unitario into v_custo from public.lotes_fabricacao
     where sku = new.sku and status_aprovacao in ('aprovado', 'ajustado') and data_fabricacao <= coalesce(v_data, public.hoje_brt())
     order by data_fabricacao desc limit 1;
    if v_custo is not null then new.custo_unitario_no_momento := v_custo; new.custo_origem := 'lote'; end if;
  elsif new.custo_unitario_manual is not null then
    new.custo_unitario_no_momento := new.custo_unitario_manual;
    new.custo_origem := 'manual';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4) gestao_registrar_venda: aceita item avulso (sem sku) além do item de
--    catálogo. Item avulso no payload: { avulso:true, tipo_avulso,
--    descricao_avulsa, preco, qtd, desconto, label, custo_unitario_manual }.
--    Resto da função é idêntico ao da Fase 3.
-- ---------------------------------------------------------------------------
create or replace function public.gestao_registrar_venda(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid; v_canal uuid; v_cli uuid; v_obs text := nullif(btrim(coalesce(p->>'obs', '')), '');
  v_orig text := coalesce(nullif(p->>'origem', ''), 'gestao');
  v_ped text := nullif(btrim(coalesce(p->>'pedido_externo', '')), '');
  it jsonb; v_sub numeric := 0; v_desc numeric := round(coalesce((p->>'desconto_venda')::numeric, 0), 2);
  v_nome text; v_sku text; v_tipo_avulso text; v_descricao_avulsa text;
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
                                       tipo_avulso, descricao_avulsa, custo_unitario_manual)
      values (v_id, null, v_descricao_avulsa, (it->>'qtd')::int, (it->>'preco')::numeric,
              round(coalesce((it->>'desconto')::numeric, 0), 2), nullif(it->>'label', ''),
              v_tipo_avulso, v_descricao_avulsa, nullif(it->>'custo_unitario_manual', '')::numeric);
    else
      v_sku := upper(btrim(it->>'sku'));
      select nome into v_nome from public.produtos where sku = v_sku;
      if v_nome is null then raise exception 'Produto % não existe.', v_sku; end if;
      insert into public.venda_itens (venda_id, sku, produto_nome, quantidade, preco_unitario, desconto, desconto_label)
      values (v_id, v_sku, coalesce(nullif(it->>'nome', ''), v_nome), (it->>'qtd')::int, (it->>'preco')::numeric,
              round(coalesce((it->>'desconto')::numeric, 0), 2), nullif(it->>'label', ''));
    end if;
  end loop;
  return v_id;
end $$;

commit;
