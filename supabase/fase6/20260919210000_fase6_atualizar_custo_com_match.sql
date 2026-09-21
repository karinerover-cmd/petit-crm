-- ============================================================================
-- Petit Sabó — Fase 6/7 (complemento 4): atualizar custo e data só quando o cadastro já existe E bate em nome, fornecedor e tamanho
-- Substitui 2 funções e cria 1 (create or replace; sem mudar tabelas):
--  • gestao_salvar_embalagem_envio (nova): cadastro/edição manual de embalagem de envio.
--  • gestao_aplicar_item: matéria-prima que já existe (mesmo nome + mesmo fornecedor) só tem custo/data atualizados se a tela mandar
--    atualizar_custo = true E o tamanho (conteúdo por unidade comprada) for igual ao da última compra. Embalagem de envio: também exige o mesmo fornecedor.
--    Cadastro novo sempre grava o custo. Nota mais antiga que a última compra nunca sobrescreve.
--  • gestao_salvar_materia_prima: aceita data_ultima_compra (opcional).
-- Rollback: rode de novo o trecho dessas funções do arquivo 20260919160000_fase6_materia_prima_nf.sql
-- ============================================================================

create or replace function public.gestao_aplicar_item(p_item uuid, p jsonb)
returns void
language plpgsql
as $$
declare
  it public.nota_fiscal_itens%rowtype; nf public.notas_fiscais%rowtype;
  v_dest text := coalesce(p->>'destino', 'pendente');
  v_cont numeric := coalesce(nullif(p->>'conteudo_por_unidade', '')::numeric, 1);
  v_base text := coalesce(nullif(p->>'unidade_base', ''), 'un');
  v_mp uuid; v_emb uuid; v_qb numeric; v_cub numeric; v_nome text; v_cat text; v_ub text;
  v_novo boolean := false; v_atu boolean; v_cont_ant numeric; v_cnpj_ant text;
begin
  select * into it from public.nota_fiscal_itens where id = p_item;
  if not found then raise exception 'Item de nota não encontrado.'; end if;
  select * into nf from public.notas_fiscais where id = it.nota_fiscal_id;
  if v_dest not in ('materia_prima', 'embalagem_envio', 'despesa_operacional', 'pendente') then raise exception 'Destino inválido: %', v_dest; end if;
  if v_dest = 'pendente' then
    update public.nota_fiscal_itens set destino = 'pendente', materia_prima_id = null, embalagem_envio_id = null where id = p_item;
    return;
  end if;
  if v_cont <= 0 then raise exception 'O conteúdo por unidade comprada deve ser maior que zero.'; end if;
  if v_base not in ('g', 'ml', 'un') then raise exception 'Unidade base inválida: % (use g, ml ou un).', v_base; end if;
  v_qb  := round(it.quantidade_comprada * v_cont, 4);
  v_cub := round(it.custo_total / v_qb, 6);

  if v_dest = 'materia_prima' then
    v_nome := btrim(coalesce(nullif(p->'materia_prima'->>'nome', ''), it.descricao));
    v_cat  := coalesce(nullif(p->'materia_prima'->>'categoria', ''), 'ingrediente');
    v_mp   := nullif(p->'materia_prima'->>'id', '')::uuid;
    if v_mp is null then select id into v_mp from public.materias_primas where lower(btrim(nome)) = lower(v_nome) and coalesce(fornecedor_cnpj, '') = coalesce(nf.fornecedor_cnpj, ''); end if;   -- mesmo nome + mesmo fornecedor
    if v_mp is null then
      insert into public.materias_primas (nome, categoria, unidade_base, tipo, fornecedor_cnpj, fornecedor_nome)
      values (v_nome, v_cat, v_base, nullif(p->'materia_prima'->>'tipo', ''), nf.fornecedor_cnpj, coalesce(nf.fornecedor_fantasia, nf.fornecedor_nome)) returning id into v_mp; v_novo := true;
    else
      select unidade_base into v_ub from public.materias_primas where id = v_mp;
      if v_ub <> v_base then raise exception 'A matéria-prima "%" já usa a unidade %, e este item veio em % — ajuste o conteúdo por unidade ou escolha outra matéria-prima.', v_nome, v_ub, v_base; end if;
    end if;
    -- Cadastro que já existia (mesmo nome + mesmo fornecedor): a tela pergunta se atualiza o custo e a data (atualizar_custo).
    -- Sem resposta = atualiza (comportamento antigo). Se o TAMANHO mudou (conteúdo por unidade diferente da última compra), nunca atualiza.
    v_atu := coalesce((p->'materia_prima'->>'atualizar_custo')::boolean, true);
    if not v_novo then
      select ni.conteudo_por_unidade into v_cont_ant from public.nota_fiscal_itens ni join public.notas_fiscais n on n.id = ni.nota_fiscal_id
       where ni.materia_prima_id = v_mp and ni.id <> p_item   -- referência de tamanho = a compra que definiu o custo atual; senão, a mais recente
       order by (n.data_emissao = (select data_ultima_compra from public.materias_primas where id = v_mp)) desc nulls last, n.data_emissao desc, ni.criado_em desc limit 1;
      if found and v_cont_ant <> v_cont then v_atu := false; end if;
    end if;
    if v_novo or v_atu then
      update public.materias_primas set custo_unitario_atual = v_cub, data_ultima_compra = nf.data_emissao
       where id = v_mp and (data_ultima_compra is null or data_ultima_compra <= nf.data_emissao);   -- nota antiga não sobrescreve custo mais novo
    end if;
    update public.nota_fiscal_itens set destino = 'materia_prima', materia_prima_id = v_mp, embalagem_envio_id = null,
           conteudo_por_unidade = v_cont, unidade_base = v_base, quantidade_base = v_qb, custo_unitario_base = v_cub where id = p_item;

  elsif v_dest = 'embalagem_envio' then
    v_nome := btrim(coalesce(nullif(p->'embalagem'->>'nome', ''), it.descricao));
    v_emb  := nullif(p->'embalagem'->>'id', '')::uuid;
    if v_emb is null then select id into v_emb from public.materiais_embalagem_envio where lower(btrim(nome)) = lower(v_nome); end if;
    if v_emb is null then insert into public.materiais_embalagem_envio (nome, unidade_base) values (v_nome, v_base) returning id into v_emb; v_novo := true; end if;
    v_atu := coalesce((p->'embalagem'->>'atualizar_custo')::boolean, true);
    if not v_novo then      -- embalagem: só atualiza se o fornecedor e o tamanho forem os mesmos da última compra
      select ni.conteudo_por_unidade, n.fornecedor_cnpj into v_cont_ant, v_cnpj_ant from public.nota_fiscal_itens ni join public.notas_fiscais n on n.id = ni.nota_fiscal_id
       where ni.embalagem_envio_id = v_emb and ni.id <> p_item
       order by (n.data_emissao = (select data_ultima_compra from public.materiais_embalagem_envio where id = v_emb)) desc nulls last, n.data_emissao desc, ni.criado_em desc limit 1;
      if found and (v_cont_ant <> v_cont or coalesce(v_cnpj_ant, '') <> coalesce(nf.fornecedor_cnpj, '')) then v_atu := false; end if;
    end if;
    if v_novo or v_atu then
      update public.materiais_embalagem_envio set custo_unitario_atual = v_cub, data_ultima_compra = nf.data_emissao
       where id = v_emb and (data_ultima_compra is null or data_ultima_compra <= nf.data_emissao);
    end if;
    update public.nota_fiscal_itens set destino = 'embalagem_envio', embalagem_envio_id = v_emb, materia_prima_id = null,
           conteudo_por_unidade = v_cont, unidade_base = v_base, quantidade_base = v_qb, custo_unitario_base = v_cub where id = p_item;

  else  -- despesa_operacional
    delete from public.despesas_operacionais where nota_fiscal_item_id = p_item;         -- reclassificar não duplica
    insert into public.despesas_operacionais (data, descricao, categoria, valor, recorrente, nota_fiscal_item_id)
    values (nf.data_emissao, coalesce(nullif(p->'despesa'->>'descricao', ''), it.descricao),
            coalesce(nullif(p->'despesa'->>'categoria', ''), 'outro'), it.custo_total,
            coalesce((p->'despesa'->>'recorrente')::boolean, false), p_item);
    update public.nota_fiscal_itens set destino = 'despesa_operacional', materia_prima_id = null, embalagem_envio_id = null,
           conteudo_por_unidade = v_cont, unidade_base = v_base, quantidade_base = v_qb, custo_unitario_base = v_cub where id = p_item;
  end if;

  if nf.fornecedor_cnpj is not null and it.codigo_fornecedor is not null then      -- lembra a escolha para as próximas notas
    insert into public.mapa_itens_fornecedor (fornecedor_cnpj, codigo_fornecedor, destino, materia_prima_id, embalagem_envio_id, despesa_categoria, recorrente, conteudo_por_unidade, unidade_base)
    values (nf.fornecedor_cnpj, it.codigo_fornecedor, v_dest, v_mp, v_emb, nullif(p->'despesa'->>'categoria', ''), coalesce((p->'despesa'->>'recorrente')::boolean, false), v_cont, v_base)
    on conflict (fornecedor_cnpj, codigo_fornecedor) do update set destino = excluded.destino, materia_prima_id = excluded.materia_prima_id,
      embalagem_envio_id = excluded.embalagem_envio_id, despesa_categoria = excluded.despesa_categoria, recorrente = excluded.recorrente,
      conteudo_por_unidade = excluded.conteudo_por_unidade, unidade_base = excluded.unidade_base;
  end if;
end $$;

create or replace function public.gestao_salvar_materia_prima(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if nullif(btrim(coalesce(p->>'nome', '')), '') is null then raise exception 'Informe o nome da matéria-prima.'; end if;
  if v_id is null then
    insert into public.materias_primas (nome, categoria, unidade_base, custo_unitario_atual, tipo, fornecedor_cnpj, fornecedor_nome, cadastro_completo, observacao, ativo)
    values (btrim(p->>'nome'), coalesce(nullif(p->>'categoria', ''), 'ingrediente'), coalesce(nullif(p->>'unidade_base', ''), 'un'),
            nullif(p->>'custo_unitario_atual', '')::numeric, nullif(p->>'tipo', ''), nullif(regexp_replace(coalesce(p->>'fornecedor_cnpj', ''), 'D', '', 'g'), ''), nullif(p->>'fornecedor_nome', ''), coalesce((p->>'cadastro_completo')::boolean, true), nullif(p->>'observacao', ''), coalesce((p->>'ativo')::boolean, true))
    returning id into v_id;
  else
    update public.materias_primas set nome = btrim(p->>'nome'), categoria = coalesce(nullif(p->>'categoria', ''), categoria),
           unidade_base = coalesce(nullif(p->>'unidade_base', ''), unidade_base),
           tipo = coalesce(p->>'tipo', tipo), fornecedor_nome = coalesce(p->>'fornecedor_nome', fornecedor_nome),
           custo_unitario_atual = coalesce(nullif(p->>'custo_unitario_atual', '')::numeric, custo_unitario_atual),
           cadastro_completo = coalesce((p->>'cadastro_completo')::boolean, cadastro_completo),
           observacao = coalesce(p->>'observacao', observacao), ativo = coalesce((p->>'ativo')::boolean, ativo)
     where id = v_id;
    if not found then raise exception 'Matéria-prima não encontrada.'; end if;
  end if;
  if nullif(p->>'data_ultima_compra', '') is not null then      -- data da compra que originou o custo (opcional)
    update public.materias_primas set data_ultima_compra = (p->>'data_ultima_compra')::date where id = v_id;
  end if;
  return v_id;
end $$;

-- Cadastro/edição manual de embalagem de envio (a lista era só leitura).
-- p = { id?, nome, unidade_base, custo_unitario_atual?, data_ultima_compra?, observacao?, ativo? }
create or replace function public.gestao_salvar_embalagem_envio(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if nullif(btrim(coalesce(p->>'nome', '')), '') is null then raise exception 'Informe o nome da embalagem.'; end if;
  if coalesce(nullif(p->>'unidade_base', ''), 'un') not in ('g', 'ml', 'un') then raise exception 'Unidade inválida (use g, ml ou un).'; end if;
  begin
    if v_id is null then
      insert into public.materiais_embalagem_envio (nome, unidade_base, custo_unitario_atual, data_ultima_compra, observacao, ativo)
      values (btrim(p->>'nome'), coalesce(nullif(p->>'unidade_base', ''), 'un'), nullif(p->>'custo_unitario_atual', '')::numeric,
              nullif(p->>'data_ultima_compra', '')::date, nullif(p->>'observacao', ''), coalesce((p->>'ativo')::boolean, true))
      returning id into v_id;
    else
      update public.materiais_embalagem_envio set nome = btrim(p->>'nome'), unidade_base = coalesce(nullif(p->>'unidade_base', ''), unidade_base),
             custo_unitario_atual = coalesce(nullif(p->>'custo_unitario_atual', '')::numeric, custo_unitario_atual),
             data_ultima_compra = coalesce(nullif(p->>'data_ultima_compra', '')::date, data_ultima_compra),
             observacao = coalesce(p->>'observacao', observacao), ativo = coalesce((p->>'ativo')::boolean, ativo)
       where id = v_id;
      if not found then raise exception 'Embalagem não encontrada.'; end if;
    end if;
  exception when unique_violation then
    raise exception 'Já existe uma embalagem com o nome "%".', btrim(p->>'nome');
  end;
  return v_id;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_aplicar_item', 'gestao_salvar_materia_prima', 'gestao_salvar_embalagem_envio') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;

notify pgrst, 'reload schema';
