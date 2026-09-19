-- ============================================================================
-- Petit Sabó — Fase 3b: funções que o app de gestão chama para gravar no Supabase.
-- Cada função roda numa transação única (tudo ou nada). Só usuário logado pode executá-las.
-- Não altera tabelas nem dados existentes: apenas CRIA funções (rollback = 99_rollback_fase3.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
create or replace function public.gestao_canal_id(p_nome text)
returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  select id into v_id from public.canais where lower(btrim(nome)) = lower(btrim(p_nome)) and ativo limit 1;
  if v_id is null then
    raise exception 'Canal "%" não existe (ou está inativo). Cadastre em Exportar/Importar → Canais.', p_nome;
  end if;
  return v_id;
end $$;

-- Acha cliente por telefone (9 últimos dígitos) ou e-mail; senão por nome exato; senão cria (se p_criar).
create or replace function public.gestao_cliente_id(p_nome text, p_tel text, p_email text, p_criar boolean default true)
returns uuid
language plpgsql
as $$
declare
  v_nome  text := nullif(btrim(coalesce(p_nome, '')), '');
  v_tel   text := nullif(right(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), 9), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id uuid;
begin
  if v_nome is null then return null; end if;
  if v_tel is not null then
    select id into v_id from public.clientes where right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9) = v_tel limit 1;
  end if;
  if v_id is null and v_email is not null then
    select id into v_id from public.clientes where lower(email) = v_email limit 1;
  end if;
  if v_id is null then
    select id into v_id from public.clientes where lower(btrim(nome)) = lower(v_nome) limit 1;
  end if;
  if v_id is null and p_criar then
    insert into public.clientes (nome, telefone, email)
    values (v_nome, nullif(btrim(coalesce(p_tel, '')), ''), nullif(btrim(coalesce(p_email, '')), ''))
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Deixa o estoque do produto EXATAMENTE em p_qtd, registrando o movimento pela diferença.
create or replace function public.gestao_ajustar_estoque(p_sku text, p_qtd int, p_obs text default 'ajuste manual (app)', p_fab text default null)
returns int
language plpgsql
as $$
declare v_atual int; v_dif int;
begin
  select estoque_atual into v_atual from public.produtos where sku = upper(btrim(p_sku)) for update;
  if not found then raise exception 'Produto % não existe.', p_sku; end if;
  v_dif := p_qtd - v_atual;
  if v_dif > 0 then
    insert into public.movimentos_estoque (sku, tipo, quantidade, data_fabricacao, observacao)
    values (upper(btrim(p_sku)), 'reposicao', v_dif, p_fab, p_obs);          -- com p_fab, o gatilho atualiza a fabricação
  elsif v_dif < 0 then
    insert into public.movimentos_estoque (sku, tipo, quantidade, observacao)
    values (upper(btrim(p_sku)), 'ajuste', v_dif, p_obs);
  end if;
  return v_dif;
end $$;

-- ---------------------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------------------
create or replace function public.gestao_salvar_produto(p jsonb)
returns text
language plpgsql
as $$
declare
  v_sku  text := upper(btrim(p->>'sku'));
  v_qtd  int  := coalesce((p->>'qtd')::int, 0);
  v_novo boolean := coalesce((p->>'novo')::boolean, false);
begin
  if v_sku is null or v_sku = '' then raise exception 'Preencha o ID (SKU).'; end if;
  if v_novo then
    if exists (select 1 from public.produtos where sku = v_sku) then raise exception 'ID já existe.'; end if;
    insert into public.produtos (sku, nome, colecao, categoria, data_fabricacao, validade_meses, preco)
    values (v_sku, btrim(p->>'nome'), nullif(btrim(coalesce(p->>'colecao','')), ''), nullif(p->>'categoria',''),
            nullif(p->>'data_fabricacao',''), nullif(p->>'validade_meses','')::int, coalesce((p->>'preco')::numeric, 0));
    if v_qtd > 0 then
      insert into public.movimentos_estoque (sku, tipo, quantidade, observacao) values (v_sku, 'estoque_inicial', v_qtd, 'cadastro pelo app');
    end if;
  else
    update public.produtos set nome = btrim(p->>'nome'), colecao = nullif(btrim(coalesce(p->>'colecao','')), ''), categoria = nullif(p->>'categoria',''),
           data_fabricacao = nullif(p->>'data_fabricacao',''), validade_meses = nullif(p->>'validade_meses','')::int,
           preco = coalesce((p->>'preco')::numeric, 0), oculto = false
     where sku = v_sku;
    if not found then raise exception 'Produto % não existe.', v_sku; end if;
    perform public.gestao_ajustar_estoque(v_sku, v_qtd, 'edição do produto no app');
  end if;
  return v_sku;
end $$;

create or replace function public.gestao_atualizar_fabricacao(p_sku text, p_fab text, p_qtd int)
returns int
language plpgsql
as $$
declare v_dif int;
begin
  if p_fab !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' then raise exception 'Fabricação deve estar no formato MM/AAAA.'; end if;
  v_dif := public.gestao_ajustar_estoque(p_sku, p_qtd, 'reposição/atualização de fabricação (app)', p_fab);
  update public.produtos set data_fabricacao = p_fab where sku = upper(btrim(p_sku));   -- garante a fabricação mesmo sem reposição
  return v_dif;
end $$;

-- Sem vendas: apaga de vez (e o histórico de estoque dele). Com vendas: só oculta, para não perder o histórico.
create or replace function public.gestao_excluir_produto(p_sku text)
returns text
language plpgsql
as $$
declare v_sku text := upper(btrim(p_sku));
begin
  if exists (select 1 from public.venda_itens where sku = v_sku) then
    update public.produtos set oculto = true where sku = v_sku;
    return 'ocultado';
  end if;
  delete from public.movimentos_estoque where sku = v_sku;
  delete from public.produtos where sku = v_sku;
  return 'excluido';
end $$;

-- ---------------------------------------------------------------------------
-- Vendas
-- p = { data, canal, forma_pagamento, cliente_id, cliente:{nome,tel,email,salvar}, itens:[{sku,nome,preco,qtd,desconto,label}],
--       desconto_venda, obs, origem ('gestao'|'app_vendedor'), pedido_externo }
-- Devolve o id da venda, ou NULL se já existir uma venda com o mesmo pedido_externo e origem (evita importar 2x).
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
    v_sku := upper(btrim(it->>'sku'));
    select nome into v_nome from public.produtos where sku = v_sku;
    if v_nome is null then raise exception 'Produto % não existe.', v_sku; end if;
    insert into public.venda_itens (venda_id, sku, produto_nome, quantidade, preco_unitario, desconto, desconto_label)
    values (v_id, v_sku, coalesce(nullif(it->>'nome', ''), v_nome), (it->>'qtd')::int, (it->>'preco')::numeric,
            round(coalesce((it->>'desconto')::numeric, 0), 2), nullif(it->>'label', ''));
  end loop;
  return v_id;
end $$;

-- p = { id, data, canal, cliente:{nome,tel,email}, obs }   (cliente em branco = mantém o atual)
create or replace function public.gestao_editar_venda(p jsonb)
returns void
language plpgsql
as $$
declare v_cli uuid;
begin
  if not exists (select 1 from public.vendas where id = (p->>'id')::uuid) then raise exception 'Venda não encontrada.'; end if;
  v_cli := public.gestao_cliente_id(p->'cliente'->>'nome', p->'cliente'->>'tel', p->'cliente'->>'email', true);
  update public.vendas set
         data_venda = coalesce(nullif(p->>'data', '')::date, data_venda),
         canal_id   = coalesce(public.gestao_canal_id(nullif(p->>'canal', '')), canal_id),
         cliente_id = coalesce(v_cli, cliente_id),
         observacao = nullif(btrim(coalesce(p->>'obs', '')), '')
   where id = (p->>'id')::uuid;
end $$;

-- Apaga a venda e o que depende dela (o CRM faz o mesmo ao excluir uma venda). O estoque volta sozinho.
create or replace function public.gestao_excluir_venda(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.follow_up_instancias where venda_id = p_id;
  delete from public.cashback where venda_id = p_id;
  delete from public.vendas where id = p_id;
  if not found then raise exception 'Venda não encontrada.'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Clientes e canais
-- ---------------------------------------------------------------------------
create or replace function public.gestao_salvar_cliente(p_nome text, p_tel text, p_email text)
returns uuid
language plpgsql
as $$
begin
  if nullif(btrim(coalesce(p_nome, '')), '') is null then raise exception 'Preencha o nome.'; end if;
  return public.gestao_cliente_id(p_nome, p_tel, p_email, true);
end $$;

create or replace function public.gestao_excluir_cliente(p_id uuid)
returns void
language plpgsql
as $$
begin
  if exists (select 1 from public.vendas where cliente_id = p_id) or exists (select 1 from public.cashback where cliente_id = p_id)
     or exists (select 1 from public.follow_up_instancias where cliente_id = p_id) then
    raise exception 'Este cliente tem vendas, cashback ou follow-ups no CRM e não pode ser excluído.';
  end if;
  delete from public.clientes where id = p_id;
end $$;

create or replace function public.gestao_salvar_canal(p_nome text)
returns uuid
language plpgsql
as $$
declare v_id uuid; v_nome text := btrim(coalesce(p_nome, ''));
begin
  if v_nome = '' then raise exception 'Informe o nome do canal.'; end if;
  select id into v_id from public.canais where lower(btrim(nome)) = lower(v_nome) limit 1;
  if v_id is not null then update public.canais set ativo = true where id = v_id; return v_id; end if;
  insert into public.canais (nome, tipo) values (v_nome, 'outro') returning id into v_id;
  return v_id;
end $$;

create or replace function public.gestao_renomear_canal(p_antigo text, p_novo text)
returns void
language plpgsql
as $$
begin
  if btrim(coalesce(p_novo, '')) = '' then raise exception 'Informe o nome do canal.'; end if;
  if exists (select 1 from public.canais where lower(btrim(nome)) = lower(btrim(p_novo)) and lower(btrim(nome)) <> lower(btrim(p_antigo))) then
    raise exception 'Já existe um canal com esse nome.';
  end if;
  update public.canais set nome = btrim(p_novo) where lower(btrim(nome)) = lower(btrim(p_antigo));
end $$;

-- Canal sem vendas: apaga. Com vendas: só desativa (some da lista de escolha, o histórico continua).
create or replace function public.gestao_remover_canal(p_nome text)
returns text
language plpgsql
as $$
declare v_id uuid;
begin
  select id into v_id from public.canais where lower(btrim(nome)) = lower(btrim(p_nome)) limit 1;
  if v_id is null then return 'inexistente'; end if;
  if exists (select 1 from public.vendas where canal_id = v_id) then
    update public.canais set ativo = false where id = v_id;
    return 'desativado';
  end if;
  delete from public.canais where id = v_id;
  return 'excluido';
end $$;

-- ---------------------------------------------------------------------------
-- Permissões: só usuário logado (mesmo padrão das tabelas)
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'gestao\_%' loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;

-- Avisa a API do Supabase para reconhecer as funções novas imediatamente.
notify pgrst, 'reload schema';
