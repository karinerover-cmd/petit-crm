-- ============================================================================
-- Petit Sabó — Fase 8 (complemento 1): cadastrar PRODUTO NOVO com SKU e calcular a precificação no mesmo fluxo
-- Só funções (create or replace); NÃO altera tabelas. Rode DEPOIS do 20260921100000_fase8_lotes_precificacao.sql.
--  • gestao_custo_lote (nova): o cálculo fica num lugar só — usado pelo lote de produto existente e pelo produto novo.
--  • gestao_calcular_lote: passa a usar gestao_custo_lote (mesmo resultado de antes).
--  • gestao_simular_lote (nova): calcula custo e preço sugerido de um produto que ainda NÃO existe (nada é gravado).
--  • gestao_cadastrar_produto_com_lote (nova): tudo numa transação só (se algo falhar, nada fica gravado):
--      1) cria o produto com preço R$ 0,00 — o preço só é definido quando você aprovar/ajustar o lote;
--      2) liga uma fórmula que estava sem produto OU copia a fórmula de outro produto;
--      3) salva a embalagem de produto; 4) registra o 1º lote como 'pendente'.
--    Estoque: opcionalmente lança as unidades do lote como estoque inicial (pelo mesmo caminho do cadastro de produto do app).
-- Rollback: 99_rollback_fase8_produto_novo.sql
-- ============================================================================

-- Cálculo puro (não grava nada). p_embalagem = [{ materia_prima_id, quantidade }] (quantidade por UMA unidade do produto)
create or replace function public.gestao_custo_lote(p_formula_id uuid, p_embalagem jsonb, p_qtd numeric, p_horas numeric)
returns jsonb
language plpgsql
as $$
declare
  f public.formulas%rowtype; cfg public.configuracao_precificacao%rowtype;
  v_rec numeric; v_mp numeric := 0; v_emb numeric := 0; v_mo numeric; v_tot numeric; v_un numeric; v_sug numeric;
  v_det jsonb := '[]'::jsonb; v_sem text[] := '{}'; r record; v_sub numeric;
begin
  if coalesce(p_qtd, 0) <= 0 then raise exception 'Informe a quantidade produzida (maior que zero).'; end if;
  if coalesce(p_horas, 0) < 0 then raise exception 'As horas trabalhadas não podem ser negativas.'; end if;
  select * into f from public.formulas where id = p_formula_id;
  if not found then raise exception 'Fórmula não encontrada.'; end if;
  select * into cfg from public.configuracao_precificacao where id = 1;
  v_rec := p_qtd / f.unidades_por_receita;

  for r in select mp.nome, mp.unidade_base, mp.custo_unitario_atual as custo, fi.quantidade
             from public.formula_itens fi join public.materias_primas mp on mp.id = fi.materia_prima_id
            where fi.formula_id = f.id order by fi.ordem loop
    v_sub := case when r.custo is null then null else round(r.quantidade * v_rec * r.custo, 4) end;
    if r.custo is null then v_sem := v_sem || r.nome; else v_mp := v_mp + v_sub; end if;
    v_det := v_det || jsonb_build_object('tipo', 'formula', 'nome', r.nome, 'quantidade', round(r.quantidade * v_rec, 4), 'unidade', r.unidade_base, 'custo_unitario', r.custo, 'subtotal', v_sub);
  end loop;

  for r in select mp.nome, mp.unidade_base, mp.custo_unitario_atual as custo, mp.categoria, nullif(e->>'quantidade', '')::numeric as quantidade
             from jsonb_array_elements(coalesce(p_embalagem, '[]'::jsonb)) e
             join public.materias_primas mp on mp.id = nullif(e->>'materia_prima_id', '')::uuid
            order by mp.nome loop
    if r.categoria <> 'embalagem_produto' then raise exception '"%" é um ingrediente: só embalagem de produto entra na embalagem.', r.nome; end if;
    if coalesce(r.quantidade, 0) <= 0 then raise exception 'A quantidade por unidade deve ser maior que zero ("%").', r.nome; end if;
    v_sub := case when r.custo is null then null else round(r.quantidade * p_qtd * r.custo, 4) end;
    if r.custo is null then v_sem := v_sem || r.nome; else v_emb := v_emb + v_sub; end if;
    v_det := v_det || jsonb_build_object('tipo', 'embalagem', 'nome', r.nome, 'quantidade', round(r.quantidade * p_qtd, 4), 'unidade', r.unidade_base, 'custo_unitario', r.custo, 'subtotal', v_sub);
  end loop;

  v_mo  := round(p_horas * cfg.valor_hora_mao_de_obra, 2);
  v_tot := round(v_mp + v_emb + v_mo, 2);
  v_un  := round(v_tot / p_qtd, 4);
  v_sug := case when cardinality(v_sem) = 0 then round(v_un * cfg.markup_varejo, 2) else null end;
  return jsonb_build_object('formula_id', f.id, 'formula_nome', f.nome, 'formula_versao', f.versao, 'unidades_por_receita', f.unidades_por_receita,
    'quantidade', p_qtd, 'horas', p_horas, 'receitas', round(v_rec, 4), 'valor_hora', cfg.valor_hora_mao_de_obra, 'markup', cfg.markup_varejo,
    'custo_materia_prima_total', round(v_mp, 2), 'custo_embalagem_total', round(v_emb, 2), 'custo_mao_de_obra', v_mo, 'custo_total', v_tot, 'custo_unitario', v_un,
    'preco_sugerido_varejo', v_sug, 'custo_incompleto', cardinality(v_sem) > 0, 'itens_sem_custo', array_to_string(v_sem, ', '), 'detalhe', v_det);
end $$;

-- Lote de produto EXISTENTE (mesmo resultado da versão anterior; agora usa o cálculo único). p = { sku, quantidade, horas }
create or replace function public.gestao_calcular_lote(p jsonb)
returns jsonb
language plpgsql
as $$
declare v_sku text := upper(btrim(coalesce(p->>'sku', ''))); v_fid uuid; v_emb jsonb;
begin
  if v_sku = '' or not exists (select 1 from public.produtos where sku = v_sku) then raise exception 'Escolha um produto válido.'; end if;
  select id into v_fid from public.formulas where sku = v_sku and ativa;
  if v_fid is null then raise exception 'O produto % não tem fórmula ativa. Cadastre a fórmula primeiro.', v_sku; end if;
  select coalesce(jsonb_agg(jsonb_build_object('materia_prima_id', materia_prima_id, 'quantidade', quantidade)), '[]'::jsonb) into v_emb
    from public.produto_embalagem where sku = v_sku;
  return public.gestao_custo_lote(v_fid, v_emb, coalesce(nullif(p->>'quantidade', '')::numeric, 0), coalesce(nullif(p->>'horas', '')::numeric, 0))
         || jsonb_build_object('sku', v_sku, 'preco_atual', (select preco from public.produtos where sku = v_sku));
end $$;

-- Produto NOVO (ainda não cadastrado): só calcula. p = { formula_id, embalagem:[{materia_prima_id, quantidade}], quantidade, horas }
create or replace function public.gestao_simular_lote(p jsonb)
returns jsonb
language plpgsql
as $$
begin
  if nullif(p->>'formula_id', '') is null then raise exception 'Escolha a fórmula do produto.'; end if;
  return public.gestao_custo_lote((p->>'formula_id')::uuid, coalesce(p->'embalagem', '[]'::jsonb),
           coalesce(nullif(p->>'quantidade', '')::numeric, 0), coalesce(nullif(p->>'horas', '')::numeric, 0))
         || jsonb_build_object('sku', nullif(upper(btrim(coalesce(p->>'sku', ''))), ''), 'preco_atual', null, 'produto_novo', true);
end $$;

-- Cadastra o produto novo + fórmula + embalagem + 1º lote, numa transação só.
-- p = { produto:{ sku, nome, colecao, categoria, validade_meses },
--       formula:{ modo: 'vincular' (fórmula sem produto) | 'copiar' (de outro produto), formula_id },
--       embalagem:[{ materia_prima_id, quantidade }],
--       lote:{ data_fabricacao, quantidade, horas, observacao },
--       estoque_inicial: true | false }
create or replace function public.gestao_cadastrar_produto_com_lote(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  pr jsonb := coalesce(p->'produto', '{}'::jsonb); fo jsonb := coalesce(p->'formula', '{}'::jsonb); lo jsonb := coalesce(p->'lote', '{}'::jsonb);
  v_sku text := upper(btrim(coalesce(pr->>'sku', ''))); v_nome text := btrim(coalesce(pr->>'nome', ''));
  v_modo text := coalesce(fo->>'modo', ''); f public.formulas%rowtype; v_itens jsonb; v_existe text;
  v_data date := coalesce(nullif(lo->>'data_fabricacao', '')::date, public.hoje_brt());
  v_qtd numeric := coalesce(nullif(lo->>'quantidade', '')::numeric, 0);
  v_estoque boolean := coalesce((p->>'estoque_inicial')::boolean, true);
  r jsonb;
begin
  if v_nome = '' then raise exception 'Informe o nome do produto.'; end if;
  if v_sku = '' then raise exception 'Informe o SKU do produto.'; end if;
  if v_sku !~ '^[A-Z0-9]+$' then raise exception 'O SKU deve ter só letras e números, sem espaços (ex.: PAM005).'; end if;
  select nome into v_existe from public.produtos where sku = v_sku;
  if found then raise exception 'O SKU % já existe (%). Escolha outro.', v_sku, v_existe; end if;
  if v_qtd <= 0 or v_qtd <> trunc(v_qtd) then raise exception 'Informe quantas unidades o lote produziu (número inteiro maior que zero).'; end if;
  if v_modo not in ('vincular', 'copiar') then raise exception 'Escolha a fórmula do produto.'; end if;
  select * into f from public.formulas where id = nullif(fo->>'formula_id', '')::uuid;
  if not found then raise exception 'Fórmula não encontrada.'; end if;
  if v_modo = 'vincular' and f.sku is not null then raise exception 'A fórmula "%" já pertence ao produto %. Para aproveitá-la, escolha "copiar de outro produto".', f.nome, f.sku; end if;
  if v_modo = 'vincular' and not f.ativa then raise exception 'Escolha a versão ativa da fórmula "%".', f.nome; end if;

  -- 1) produto: preço R$ 0,00 até você aprovar o preço do lote (mesmo caminho do cadastro de produto do app)
  perform public.gestao_salvar_produto(jsonb_build_object('novo', true, 'sku', v_sku, 'nome', v_nome, 'colecao', pr->>'colecao', 'categoria', pr->>'categoria',
     'data_fabricacao', to_char(v_data, 'MM/YYYY'), 'validade_meses', nullif(pr->>'validade_meses', ''), 'preco', 0,
     'qtd', case when v_estoque then v_qtd::int else 0 end));

  -- 2) fórmula
  if v_modo = 'vincular' then
    update public.formulas set sku = v_sku where sku is null and lower(btrim(nome)) = lower(btrim(f.nome));   -- leva junto as versões antigas
  else
    select coalesce(jsonb_agg(jsonb_build_object('materia_prima_id', materia_prima_id, 'quantidade', quantidade, 'unidade', unidade, 'grupo', grupo, 'observacao', observacao) order by ordem), '[]'::jsonb)
      into v_itens from public.formula_itens where formula_id = f.id;
    perform public.gestao_salvar_formula(jsonb_build_object('sku', v_sku, 'nome', v_nome, 'unidades_por_receita', f.unidades_por_receita, 'peso_total_g', f.peso_total_g,
       'origem', 'manual', 'observacao', 'copiada de ' || coalesce(f.sku, f.nome) || ' v' || f.versao, 'itens', v_itens));
  end if;

  -- 3) embalagem de produto (opcional)
  if jsonb_array_length(coalesce(p->'embalagem', '[]'::jsonb)) > 0 then
    perform public.gestao_salvar_embalagem_produto(jsonb_build_object('sku', v_sku, 'itens', p->'embalagem'));
  end if;

  -- 4) 1º lote, 'pendente': o preço do produto só muda quando você aprovar ou ajustar
  r := public.gestao_registrar_lote(jsonb_build_object('sku', v_sku, 'data_fabricacao', v_data, 'quantidade', v_qtd, 'horas', lo->'horas',
         'observacao', coalesce(nullif(btrim(coalesce(lo->>'observacao', '')), ''), 'primeiro lote (produto novo)')));
  return r || jsonb_build_object('produto_criado', true, 'estoque_inicial', case when v_estoque then v_qtd else 0 end);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_custo_lote', 'gestao_calcular_lote', 'gestao_simular_lote', 'gestao_cadastrar_produto_com_lote') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;

notify pgrst, 'reload schema';
