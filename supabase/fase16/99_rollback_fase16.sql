begin;

-- Volta gestao_registrar_venda à versão da Fase 3 (sem suporte a item avulso).
create or replace function public.gestao_registrar_venda(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid; v_canal uuid; v_cli uuid; v_obs text := nullif(btrim(coalesce(p->>'obs', '')), '');
  v_orig text := coalesce(nullif(p->>'origem', ''), 'gestao');
  v_ped text := nullif(btrim(coalesce(p->>'pedido_externo', '')), '');
  it jsonb; v_sub numeric := 0; v_desc numeric := round(coalesce((p->>'desconto_venda')::numeric, 0), 2);
  v_nome text; v_sku text;
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
    if v_cli is null then
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
    v_sku := upper(btrim(it->>'sku'));
    select nome into v_nome from public.produtos where sku = v_sku;
    if v_nome is null then raise exception 'Produto % não existe.', v_sku; end if;
    insert into public.venda_itens (venda_id, sku, produto_nome, quantidade, preco_unitario, desconto, desconto_label)
    values (v_id, v_sku, coalesce(nullif(it->>'nome', ''), v_nome), (it->>'qtd')::int, (it->>'preco')::numeric,
            round(coalesce((it->>'desconto')::numeric, 0), 2), nullif(it->>'label', ''));
  end loop;
  return v_id;
end $$;

-- Volta o trigger de custo à versão da Fase 9 (sem custo manual).
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
  end if;
  return new;
end $$;

alter table public.venda_itens drop constraint venda_itens_custo_origem_check;
alter table public.venda_itens add constraint venda_itens_custo_origem_check
  check (custo_origem in ('lote'));

alter table public.venda_itens drop constraint if exists venda_itens_avulso_sem_sku;
alter table public.venda_itens drop constraint if exists venda_itens_avulso_tem_descricao;
alter table public.venda_itens drop column if exists tipo_avulso;
alter table public.venda_itens drop column if exists descricao_avulsa;
alter table public.venda_itens drop column if exists custo_unitario_manual;

commit;
