-- ============================================================================
-- Petit Sabó — Fase 6: matéria-prima e nota fiscal
-- Cria 6 tabelas novas + funções. NÃO altera nenhuma tabela existente (rollback = 99_rollback_fase6.sql).
-- Convenções do CRM: id uuid, criado_em, política "authenticated_full_access".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Matérias-primas (ingredientes e embalagens que entram no produto)
-- Custo guardado por UNIDADE BASE (g, ml ou un) da última compra; o lote de fabricação (Fase 8) usa isso.
-- ---------------------------------------------------------------------------
create table public.materias_primas (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null check (btrim(nome) <> ''),
  categoria             text not null default 'ingrediente' check (categoria in ('ingrediente', 'embalagem_produto')),
  unidade_base          text not null default 'un' check (unidade_base in ('g', 'ml', 'un')),
  custo_unitario_atual  numeric(14,6) check (custo_unitario_atual >= 0),   -- R$ por unidade base (última compra)
  data_ultima_compra    date,
  cadastro_completo     boolean not null default false,                    -- itens criados pela nota nascem incompletos e são completados aos poucos
  tipo                  text,                                              -- ex.: essência, essência cold process, base, frasco, válvula
  fornecedor_cnpj       text,                                              -- a mesma essência de fornecedores diferentes são matérias-primas diferentes
  fornecedor_nome       text,
  observacao            text,
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create unique index materias_primas_nome_uk on public.materias_primas (lower(btrim(nome)), coalesce(fornecedor_cnpj, ''));

-- Embalagem de envio (sacola, caixa de envio, fita adesiva, adesivo, papel de seda...) — alimenta a Fase 9
create table public.materiais_embalagem_envio (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null check (btrim(nome) <> ''),
  unidade_base          text not null default 'un' check (unidade_base in ('g', 'ml', 'un')),
  custo_unitario_atual  numeric(14,6) check (custo_unitario_atual >= 0),
  data_ultima_compra    date,
  ativo                 boolean not null default true,
  observacao            text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create unique index materiais_embalagem_envio_nome_uk on public.materiais_embalagem_envio (lower(btrim(nome)));

-- ---------------------------------------------------------------------------
-- Notas fiscais e itens
-- ---------------------------------------------------------------------------
create table public.notas_fiscais (
  id                  uuid primary key default gen_random_uuid(),
  chave_acesso        text unique check (chave_acesso ~ '^[0-9]{44}$'),      -- evita importar a mesma nota duas vezes
  numero              text,
  serie               text,
  data_emissao        date not null,
  fornecedor_cnpj     text,
  fornecedor_nome     text,
  fornecedor_fantasia text,
  natureza            text,
  valor_produtos      numeric(14,2) not null default 0,
  valor_frete         numeric(14,2) not null default 0,
  valor_desconto      numeric(14,2) not null default 0,
  valor_outras        numeric(14,2) not null default 0,                     -- IPI, ICMS-ST, seguro e similares: apenas demonstrativo (não entra no custo)
  valor_difal         numeric(14,2) not null default 0,                     -- DIFAL: pago ao estado, NÃO está no total da nota
  difal_rateado       boolean not null default false,                       -- true = o DIFAL foi somado ao custo dos itens
  valor_total_nota    numeric(14,2) not null default 0,
  custo_total_real    numeric(14,2) not null default 0,                     -- soma do custo real dos itens
  origem              text not null default 'xml' check (origem in ('xml', 'pdf_foto', 'manual')),
  observacao          text,
  criado_por          uuid default auth.uid(),
  criado_em           timestamptz not null default now()
);
create index notas_fiscais_data_idx on public.notas_fiscais (data_emissao);

create table public.nota_fiscal_itens (
  id                    uuid primary key default gen_random_uuid(),
  nota_fiscal_id        uuid not null references public.notas_fiscais (id) on delete cascade,
  n_item                int,
  codigo_fornecedor     text,
  descricao             text not null,
  ncm                   text,
  unidade_compra        text,
  quantidade_comprada   numeric(14,4) not null check (quantidade_comprada > 0),
  valor_unitario        numeric(14,6),
  valor_produto         numeric(14,2) not null default 0,
  valor_frete           numeric(14,2) not null default 0,
  valor_desconto        numeric(14,2) not null default 0,
  valor_outras          numeric(14,2) not null default 0,
  valor_difal           numeric(14,2) not null default 0,                   -- parte do DIFAL rateada neste item
  custo_total           numeric(14,2) not null default 0,                   -- produto + frete − desconto (+ DIFAL rateado, só se a opção estiver ligada)
  destino               text not null default 'pendente'
                        check (destino in ('materia_prima', 'embalagem_envio', 'despesa_operacional', 'pendente')),
  materia_prima_id      uuid references public.materias_primas (id),
  embalagem_envio_id    uuid references public.materiais_embalagem_envio (id),
  conteudo_por_unidade  numeric(14,4) not null default 1 check (conteudo_por_unidade > 0),   -- ex.: caixa com 6 → 6; essência de 100g → 100
  unidade_base          text check (unidade_base in ('g', 'ml', 'un')),
  quantidade_base       numeric(14,4),                                       -- quantidade_comprada × conteudo_por_unidade
  custo_unitario_base   numeric(14,6),                                       -- custo_total ÷ quantidade_base
  observacao            text,
  criado_em             timestamptz not null default now(),
  constraint itens_destino_consistente check (
       (destino = 'materia_prima'      and materia_prima_id is not null)
    or (destino = 'embalagem_envio'    and embalagem_envio_id is not null)
    or (destino in ('despesa_operacional', 'pendente'))
  )
);
create index nota_fiscal_itens_nota_idx on public.nota_fiscal_itens (nota_fiscal_id);
create index nota_fiscal_itens_mp_idx   on public.nota_fiscal_itens (materia_prima_id);

-- Despesas do negócio (curso, equipamento, sessão de foto/vídeo, escritório...). Vem de item de nota ou é lançada à mão.
create table public.despesas_operacionais (
  id                    uuid primary key default gen_random_uuid(),
  data                  date not null default public.hoje_brt(),
  descricao             text not null check (btrim(descricao) <> ''),
  categoria             text not null default 'outro'
                        check (categoria in ('curso', 'melhoria_equipamento', 'sessao_foto_video', 'material_escritorio', 'outro')),
  valor                 numeric(14,2) not null check (valor >= 0),
  recorrente            boolean not null default false,                      -- recorrente soma no custo fixo mensal; investimento pontual não
  nota_fiscal_item_id   uuid unique references public.nota_fiscal_itens (id) on delete cascade,
  observacao            text,
  criado_por            uuid default auth.uid(),
  criado_em             timestamptz not null default now()
);
create index despesas_operacionais_data_idx on public.despesas_operacionais (data);

-- Memória de classificação: o que já foi confirmado para cada (fornecedor, código do produto).
-- Na próxima nota do mesmo fornecedor o item é reconhecido sozinho.
create table public.mapa_itens_fornecedor (
  id                    uuid primary key default gen_random_uuid(),
  fornecedor_cnpj       text not null,
  codigo_fornecedor     text not null,
  destino               text not null check (destino in ('materia_prima', 'embalagem_envio', 'despesa_operacional')),
  materia_prima_id      uuid references public.materias_primas (id) on delete cascade,
  embalagem_envio_id    uuid references public.materiais_embalagem_envio (id) on delete cascade,
  despesa_categoria     text,
  recorrente            boolean not null default false,
  conteudo_por_unidade  numeric(14,4) not null default 1,
  unidade_base          text,
  atualizado_em         timestamptz not null default now(),
  unique (fornecedor_cnpj, codigo_fornecedor)
);

create trigger materias_primas_atualizado_em       before update on public.materias_primas          for each row execute function public.gestao_set_atualizado_em();
create trigger materiais_embalagem_atualizado_em   before update on public.materiais_embalagem_envio for each row execute function public.gestao_set_atualizado_em();
create trigger mapa_itens_atualizado_em            before update on public.mapa_itens_fornecedor     for each row execute function public.gestao_set_atualizado_em();

-- Segurança (mesmo padrão do CRM): usuário logado tem acesso; visitante sem login não vê nada
do $$
declare t text;
begin
  foreach t in array array['materias_primas', 'materiais_embalagem_envio', 'notas_fiscais', 'nota_fiscal_itens', 'despesas_operacionais', 'mapa_itens_fornecedor'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------

-- Aplica o destino escolhido a UM item de nota (cria/atualiza matéria-prima, embalagem ou despesa; lembra a escolha).
-- p = { destino, conteudo_por_unidade, unidade_base, materia_prima:{id,nome,categoria}, embalagem:{id,nome}, despesa:{categoria,recorrente,descricao} }
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
      values (v_nome, v_cat, v_base, nullif(p->'materia_prima'->>'tipo', ''), nf.fornecedor_cnpj, coalesce(nf.fornecedor_fantasia, nf.fornecedor_nome)) returning id into v_mp;
    else
      select unidade_base into v_ub from public.materias_primas where id = v_mp;
      if v_ub <> v_base then raise exception 'A matéria-prima "%" já usa a unidade %, e este item veio em % — ajuste o conteúdo por unidade ou escolha outra matéria-prima.', v_nome, v_ub, v_base; end if;
    end if;
    update public.materias_primas set custo_unitario_atual = v_cub, data_ultima_compra = nf.data_emissao
     where id = v_mp and (data_ultima_compra is null or data_ultima_compra <= nf.data_emissao);   -- nota antiga não sobrescreve custo mais novo
    update public.nota_fiscal_itens set destino = 'materia_prima', materia_prima_id = v_mp, embalagem_envio_id = null,
           conteudo_por_unidade = v_cont, unidade_base = v_base, quantidade_base = v_qb, custo_unitario_base = v_cub where id = p_item;

  elsif v_dest = 'embalagem_envio' then
    v_nome := btrim(coalesce(nullif(p->'embalagem'->>'nome', ''), it.descricao));
    v_emb  := nullif(p->'embalagem'->>'id', '')::uuid;
    if v_emb is null then select id into v_emb from public.materiais_embalagem_envio where lower(btrim(nome)) = lower(v_nome); end if;
    if v_emb is null then insert into public.materiais_embalagem_envio (nome, unidade_base) values (v_nome, v_base) returning id into v_emb; end if;
    update public.materiais_embalagem_envio set custo_unitario_atual = v_cub, data_ultima_compra = nf.data_emissao
     where id = v_emb and (data_ultima_compra is null or data_ultima_compra <= nf.data_emissao);
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

-- Importa uma nota inteira (cabeçalho + itens já classificados). Tudo ou nada. Itens sem destino ficam 'pendente'.
-- p = { nota:{chave_acesso,numero,serie,data_emissao,fornecedor_cnpj,fornecedor_nome,fornecedor_fantasia,natureza,valor_produtos,valor_frete,
--               valor_desconto,valor_outras,valor_difal,difal_rateado,valor_total_nota,origem,observacao},
--       itens:[{n_item,codigo,descricao,ncm,unidade,quantidade,valor_unitario,valor_produto,valor_frete,valor_desconto,valor_outras,valor_difal,
--               destino,conteudo_por_unidade,unidade_base,materia_prima,embalagem,despesa}] }
create or replace function public.gestao_importar_nota(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  n jsonb := p->'nota'; it jsonb; v_nf uuid; v_item uuid; v_chave text := nullif(btrim(coalesce(n->>'chave_acesso', '')), '');
  v_custo numeric; v_total numeric := 0; v_pend int := 0; v_ok int := 0; v_data date;
begin
  if v_chave is not null and exists (select 1 from public.notas_fiscais where chave_acesso = v_chave) then
    raise exception 'Esta nota (nº %) já foi importada em %.', n->>'numero',
      to_char((select criado_em at time zone 'America/Sao_Paulo' from public.notas_fiscais where chave_acesso = v_chave), 'DD/MM/YYYY');
  end if;
  if jsonb_array_length(coalesce(p->'itens', '[]'::jsonb)) = 0 then raise exception 'A nota não tem itens.'; end if;
  v_data := (n->>'data_emissao')::date;

  insert into public.notas_fiscais (chave_acesso, numero, serie, data_emissao, fornecedor_cnpj, fornecedor_nome, fornecedor_fantasia, natureza,
      valor_produtos, valor_frete, valor_desconto, valor_outras, valor_difal, difal_rateado, valor_total_nota, origem, observacao)
  values (v_chave, n->>'numero', n->>'serie', v_data, nullif(n->>'fornecedor_cnpj', ''), n->>'fornecedor_nome', n->>'fornecedor_fantasia', n->>'natureza',
      coalesce((n->>'valor_produtos')::numeric, 0), coalesce((n->>'valor_frete')::numeric, 0), coalesce((n->>'valor_desconto')::numeric, 0),
      coalesce((n->>'valor_outras')::numeric, 0), coalesce((n->>'valor_difal')::numeric, 0), coalesce((n->>'difal_rateado')::boolean, false),
      coalesce((n->>'valor_total_nota')::numeric, 0), coalesce(nullif(n->>'origem', ''), 'xml'), nullif(n->>'observacao', ''))
  returning id into v_nf;

  for it in select * from jsonb_array_elements(p->'itens') loop
    v_custo := round(coalesce((it->>'valor_produto')::numeric, 0) + coalesce((it->>'valor_frete')::numeric, 0) - coalesce((it->>'valor_desconto')::numeric, 0), 2);   -- IPI/DIFAL são só demonstrativo de imposto (já estão no preço pago): não entram no custo
    insert into public.nota_fiscal_itens (nota_fiscal_id, n_item, codigo_fornecedor, descricao, ncm, unidade_compra, quantidade_comprada, valor_unitario,
        valor_produto, valor_frete, valor_desconto, valor_outras, valor_difal, custo_total)
    values (v_nf, (it->>'n_item')::int, nullif(it->>'codigo', ''), btrim(it->>'descricao'), it->>'ncm', it->>'unidade', (it->>'quantidade')::numeric,
        (it->>'valor_unitario')::numeric, coalesce((it->>'valor_produto')::numeric, 0), coalesce((it->>'valor_frete')::numeric, 0),
        coalesce((it->>'valor_desconto')::numeric, 0), coalesce((it->>'valor_outras')::numeric, 0), coalesce((it->>'valor_difal')::numeric, 0), v_custo)
    returning id into v_item;
    v_total := v_total + v_custo;
    if coalesce(it->>'destino', 'pendente') = 'pendente' then v_pend := v_pend + 1;
    else perform public.gestao_aplicar_item(v_item, it); v_ok := v_ok + 1; end if;
  end loop;

  update public.notas_fiscais set custo_total_real = round(v_total, 2) where id = v_nf;
  return jsonb_build_object('nota_id', v_nf, 'itens_classificados', v_ok, 'itens_pendentes', v_pend, 'custo_total_real', round(v_total, 2));
end $$;

-- Completa um item que ficou pendente. p = { item_id, ...(mesmo formato de gestao_aplicar_item) }
create or replace function public.gestao_classificar_item(p jsonb)
returns void
language plpgsql
as $$
begin
  perform public.gestao_aplicar_item((p->>'item_id')::uuid, p);
end $$;

-- Cadastro/edição manual de matéria-prima. p = { id?, nome, categoria, unidade_base, custo_unitario_atual?, cadastro_completo?, observacao?, ativo? }
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
  return v_id;
end $$;

-- Despesa lançada à mão (fora de nota). p = { id?, data, descricao, categoria, valor, recorrente, observacao }
create or replace function public.gestao_salvar_despesa(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if v_id is null then
    insert into public.despesas_operacionais (data, descricao, categoria, valor, recorrente, observacao)
    values (coalesce(nullif(p->>'data', '')::date, public.hoje_brt()), btrim(p->>'descricao'), coalesce(nullif(p->>'categoria', ''), 'outro'),
            (p->>'valor')::numeric, coalesce((p->>'recorrente')::boolean, false), nullif(p->>'observacao', ''))
    returning id into v_id;
  else
    update public.despesas_operacionais set data = coalesce(nullif(p->>'data', '')::date, data), descricao = coalesce(nullif(btrim(p->>'descricao'), ''), descricao),
           categoria = coalesce(nullif(p->>'categoria', ''), categoria), valor = coalesce(nullif(p->>'valor', '')::numeric, valor),
           recorrente = coalesce((p->>'recorrente')::boolean, recorrente), observacao = coalesce(p->>'observacao', observacao)
     where id = v_id;
    if not found then raise exception 'Despesa não encontrada.'; end if;
  end if;
  return v_id;
end $$;

-- Exclui uma nota e o que dela derivou (itens e despesas). O custo atual das matérias-primas NÃO volta atrás (a próxima compra atualiza).
create or replace function public.gestao_excluir_nota(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.notas_fiscais where id = p_id;
  if not found then raise exception 'Nota não encontrada.'; end if;
end $$;

-- Permissões: só usuário logado
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_aplicar_item', 'gestao_importar_nota', 'gestao_classificar_item',
                                                         'gestao_salvar_materia_prima', 'gestao_salvar_despesa', 'gestao_excluir_nota') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;

notify pgrst, 'reload schema';
