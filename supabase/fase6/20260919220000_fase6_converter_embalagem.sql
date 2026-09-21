-- ============================================================================
-- Petit Sabó — Fase 6 (complemento 5): mudar a categorização entre EMBALAGEM DE ENVIO e EMBALAGEM DE PRODUTO
--   • embalagem de PRODUTO (matéria-prima categoria 'embalagem_produto'): entra no custo do produto e na precificação;
--   • embalagem de ENVIO: entra no custo fixo (não no custo do produto).
-- Cria 2 funções; não altera tabelas. Mantém custo, data, fornecedor, os itens das notas e a memória de classificação do fornecedor.
-- Se já existir cadastro de mesmo nome no destino, os dois são unidos (fica o custo da compra mais recente).
-- Rollback: 99_rollback_fase6_converter.sql (remove as funções; os cadastros já convertidos permanecem)
-- ============================================================================

create or replace function public.gestao_converter_embalagem_para_produto(p_id uuid)
returns jsonb
language plpgsql
as $$
declare
  e public.materiais_embalagem_envio%rowtype; v_mp uuid; v_cnpj text; v_forn text; v_itens int; v_uniu boolean := false; v_ub text;
begin
  select * into e from public.materiais_embalagem_envio where id = p_id;
  if not found then raise exception 'Embalagem de envio não encontrada.'; end if;
  select n.fornecedor_cnpj, coalesce(n.fornecedor_fantasia, n.fornecedor_nome) into v_cnpj, v_forn
    from public.nota_fiscal_itens ni join public.notas_fiscais n on n.id = ni.nota_fiscal_id
   where ni.embalagem_envio_id = p_id order by n.data_emissao desc, ni.criado_em desc limit 1;
  select id, unidade_base into v_mp, v_ub from public.materias_primas
   where lower(btrim(nome)) = lower(btrim(e.nome)) and coalesce(fornecedor_cnpj, '') = coalesce(v_cnpj, '');
  if v_mp is null then
    insert into public.materias_primas (nome, categoria, unidade_base, custo_unitario_atual, data_ultima_compra, fornecedor_cnpj, fornecedor_nome, cadastro_completo, observacao, ativo)
    values (e.nome, 'embalagem_produto', e.unidade_base, e.custo_unitario_atual, e.data_ultima_compra, v_cnpj, v_forn, false, e.observacao, e.ativo)
    returning id into v_mp;
  else
    v_uniu := true;
    if v_ub <> e.unidade_base then raise exception 'Já existe a matéria-prima "%" com unidade % (a embalagem usa %). Ajuste antes de converter.', e.nome, v_ub, e.unidade_base; end if;
    update public.materias_primas set custo_unitario_atual = e.custo_unitario_atual, data_ultima_compra = e.data_ultima_compra
     where id = v_mp and e.custo_unitario_atual is not null and (data_ultima_compra is null or (e.data_ultima_compra is not null and e.data_ultima_compra > data_ultima_compra));
  end if;
  update public.nota_fiscal_itens set destino = 'materia_prima', materia_prima_id = v_mp, embalagem_envio_id = null where embalagem_envio_id = p_id;
  get diagnostics v_itens = row_count;
  update public.mapa_itens_fornecedor set destino = 'materia_prima', materia_prima_id = v_mp, embalagem_envio_id = null where embalagem_envio_id = p_id;
  delete from public.materiais_embalagem_envio where id = p_id;
  return jsonb_build_object('nome', e.nome, 'materia_prima_id', v_mp, 'itens_atualizados', v_itens, 'uniu_com_existente', v_uniu);
end $$;

create or replace function public.gestao_converter_produto_para_embalagem_envio(p_id uuid)
returns jsonb
language plpgsql
as $$
declare
  m public.materias_primas%rowtype; v_emb uuid; v_forms text; v_itens int; v_uniu boolean := false; v_ub text;
begin
  select * into m from public.materias_primas where id = p_id;
  if not found then raise exception 'Matéria-prima não encontrada.'; end if;
  if m.categoria <> 'embalagem_produto' then raise exception '"%" é um ingrediente, não uma embalagem de produto.', m.nome; end if;
  select string_agg(distinct f.nome || ' (v' || f.versao || ')', ', ') into v_forms
    from public.formula_itens fi join public.formulas f on f.id = fi.formula_id where fi.materia_prima_id = p_id;
  if v_forms is not null then raise exception '"%" é usada nas fórmulas: %. Tire-a das fórmulas antes de mudar para embalagem de envio.', m.nome, v_forms; end if;
  select id, unidade_base into v_emb, v_ub from public.materiais_embalagem_envio where lower(btrim(nome)) = lower(btrim(m.nome));
  if v_emb is null then
    insert into public.materiais_embalagem_envio (nome, unidade_base, custo_unitario_atual, data_ultima_compra, observacao, ativo)
    values (m.nome, m.unidade_base, m.custo_unitario_atual, m.data_ultima_compra, m.observacao, m.ativo) returning id into v_emb;
  else
    v_uniu := true;
    if v_ub <> m.unidade_base then raise exception 'Já existe a embalagem de envio "%" com unidade % (a matéria-prima usa %). Ajuste antes de converter.', m.nome, v_ub, m.unidade_base; end if;
    update public.materiais_embalagem_envio set custo_unitario_atual = m.custo_unitario_atual, data_ultima_compra = m.data_ultima_compra
     where id = v_emb and m.custo_unitario_atual is not null and (data_ultima_compra is null or (m.data_ultima_compra is not null and m.data_ultima_compra > data_ultima_compra));
  end if;
  update public.nota_fiscal_itens set destino = 'embalagem_envio', embalagem_envio_id = v_emb, materia_prima_id = null where materia_prima_id = p_id;
  get diagnostics v_itens = row_count;
  update public.mapa_itens_fornecedor set destino = 'embalagem_envio', embalagem_envio_id = v_emb, materia_prima_id = null where materia_prima_id = p_id;
  delete from public.materias_primas where id = p_id;
  return jsonb_build_object('nome', m.nome, 'embalagem_envio_id', v_emb, 'itens_atualizados', v_itens, 'uniu_com_existente', v_uniu);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_converter_embalagem_para_produto', 'gestao_converter_produto_para_embalagem_envio') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;

notify pgrst, 'reload schema';
