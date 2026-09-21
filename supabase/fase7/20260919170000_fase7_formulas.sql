-- ============================================================================
-- Petit Sabó — Fase 7: fórmulas (receitas) versionadas
-- Cria 2 tabelas, 1 view e 3 funções. NÃO altera nenhuma tabela existente (rollback = 99_rollback_fase7.sql).
-- Uma fórmula por SKU (ou sem SKU enquanto o produto não estiver cadastrado). Mudar a fórmula cria uma NOVA VERSÃO;
-- a versão anterior fica guardada (os lotes da Fase 8 guardam o custo da versão com que foram feitos).
-- ============================================================================

create table public.formulas (
  id                    uuid primary key default gen_random_uuid(),
  sku                   text references public.produtos (sku) on update cascade on delete restrict,   -- pode ser nulo se o produto ainda não foi cadastrado
  nome                  text not null check (btrim(nome) <> ''),
  versao                int  not null default 1 check (versao >= 1),
  ativa                 boolean not null default true,                     -- só uma versão ativa por SKU
  unidades_por_receita  numeric(10,2) not null check (unidades_por_receita > 0),   -- ex.: 9 barras por receita
  peso_total_g          numeric(12,2),                                     -- informativo (ex.: 1471,84 g de massa)
  origem                text not null default 'manual' check (origem in ('manual', 'soapcalc_pdf', 'foto')),
  observacao            text,
  criado_por            uuid default auth.uid(),
  criado_em             timestamptz not null default now()
);
-- uma única versão ativa por SKU (sem SKU: por nome)
create unique index formulas_ativa_uk on public.formulas ((coalesce(sku, lower(btrim(nome))))) where ativa;
create unique index formulas_versao_uk on public.formulas ((coalesce(sku, lower(btrim(nome)))), versao);

create table public.formula_itens (
  id                    uuid primary key default gen_random_uuid(),
  formula_id            uuid not null references public.formulas (id) on delete cascade,
  ordem                 int  not null default 0,
  materia_prima_id      uuid not null references public.materias_primas (id) on delete restrict,
  quantidade            numeric(14,4) not null check (quantidade > 0),     -- na unidade base da matéria-prima, para UMA receita inteira
  unidade               text not null check (unidade in ('g', 'ml', 'un')),
  grupo                 text,                                              -- ex.: óleo, água, soda, aditivo (só para organizar a tela)
  observacao            text
);
create index formula_itens_formula_idx on public.formula_itens (formula_id);
create index formula_itens_mp_idx      on public.formula_itens (materia_prima_id);

-- Segurança (mesmo padrão do CRM)
do $$
declare t text;
begin
  foreach t in array array['formulas', 'formula_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Custo de cada fórmula com o custo ATUAL das matérias-primas. itens_sem_custo > 0 = custo incompleto (não é o custo final).
create view public.formulas_custo with (security_invoker = true) as
select f.id as formula_id, f.sku, f.nome, f.versao, f.ativa, f.unidades_por_receita,
       round(coalesce(sum(fi.quantidade * mp.custo_unitario_atual), 0), 2)                                  as custo_receita,
       round(coalesce(sum(fi.quantidade * mp.custo_unitario_atual), 0) / f.unidades_por_receita, 4)        as custo_unitario,
       count(*)                                                                                             as itens,
       count(*) filter (where mp.custo_unitario_atual is null)                                              as itens_sem_custo
  from public.formulas f
  join public.formula_itens fi on fi.formula_id = f.id
  join public.materias_primas mp on mp.id = fi.materia_prima_id
 group by f.id;

-- ---------------------------------------------------------------------------
-- Salva uma fórmula. Se já existe fórmula ativa para o SKU, cria a próxima versão e desativa a anterior.
-- p = { sku?, nome, unidades_por_receita, peso_total_g?, origem?, observacao?,
--       itens:[{ materia_prima_id? | nome, tipo?, quantidade, unidade, grupo?, custo? }] }
-- Item sem materia_prima_id: usa a matéria-prima de mesmo nome; se não existir, CRIA como cadastro incompleto
-- (com o custo informado, se houver). Se o nome existir em mais de um fornecedor, exige escolher qual.
-- ---------------------------------------------------------------------------
create or replace function public.gestao_salvar_formula(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_sku  text := nullif(btrim(coalesce(p->>'sku', '')), '');
  v_nome text := btrim(coalesce(p->>'nome', ''));
  v_un   numeric := coalesce(nullif(p->>'unidades_por_receita', '')::numeric, 0);
  v_ver  int; v_id uuid; v_ord int := 0; v_criadas text[] := '{}';
  it jsonb; v_mp uuid; v_qtd numeric; v_u text; v_nm text; v_n int; v_ub text; v_custo numeric;
begin
  if v_nome = '' then raise exception 'Informe o nome da fórmula.'; end if;
  if v_un <= 0 then raise exception 'Informe quantas unidades saem da receita (maior que zero).'; end if;
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'A fórmula precisa de pelo menos um ingrediente.'; end if;
  if v_sku is not null and not exists (select 1 from public.produtos where sku = v_sku) then raise exception 'O SKU % não existe no cadastro de produtos.', v_sku; end if;

  select coalesce(max(versao), 0) + 1 into v_ver from public.formulas where coalesce(sku, lower(btrim(nome))) = coalesce(v_sku, lower(v_nome));
  update public.formulas set ativa = false where ativa and coalesce(sku, lower(btrim(nome))) = coalesce(v_sku, lower(v_nome));
  insert into public.formulas (sku, nome, versao, unidades_por_receita, peso_total_g, origem, observacao)
  values (v_sku, v_nome, v_ver, v_un, nullif(p->>'peso_total_g', '')::numeric, coalesce(nullif(p->>'origem', ''), 'manual'), nullif(p->>'observacao', ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    v_ord := v_ord + 1;
    v_qtd := coalesce(nullif(it->>'quantidade', '')::numeric, 0);
    v_u   := coalesce(nullif(it->>'unidade', ''), 'g');
    v_nm  := btrim(coalesce(it->>'nome', ''));
    v_custo := nullif(it->>'custo', '')::numeric;
    if v_qtd <= 0 then raise exception 'Ingrediente "%": a quantidade deve ser maior que zero.', v_nm; end if;
    if v_u not in ('g', 'ml', 'un') then raise exception 'Ingrediente "%": unidade inválida (use g, ml ou un).', v_nm; end if;
    v_mp := nullif(it->>'materia_prima_id', '')::uuid;
    if v_mp is null then
      if v_nm = '' then raise exception 'Há um ingrediente sem nome e sem matéria-prima escolhida.'; end if;
      select count(*) into v_n from public.materias_primas where lower(btrim(nome)) = lower(v_nm);
      if v_n > 1 then raise exception 'Há mais de uma matéria-prima chamada "%" (fornecedores diferentes): escolha qual usar.', v_nm; end if;
      if v_n = 1 then select id into v_mp from public.materias_primas where lower(btrim(nome)) = lower(v_nm);
      else
        insert into public.materias_primas (nome, categoria, unidade_base, tipo, custo_unitario_atual, cadastro_completo)
        values (v_nm, 'ingrediente', v_u, nullif(it->>'tipo', ''), v_custo, false) returning id into v_mp;
        v_criadas := v_criadas || v_nm;
      end if;
    end if;
    select unidade_base into v_ub from public.materias_primas where id = v_mp;
    if not found then raise exception 'Matéria-prima do ingrediente "%" não encontrada.', v_nm; end if;
    if v_ub <> v_u then raise exception 'Ingrediente "%": a matéria-prima usa % e a fórmula veio em % — ajuste a unidade.', v_nm, v_ub, v_u; end if;
    if v_custo is not null then   -- custo digitado só vale onde ainda não há custo (não sobrescreve custo vindo de nota)
      update public.materias_primas set custo_unitario_atual = v_custo where id = v_mp and custo_unitario_atual is null;
    end if;
    insert into public.formula_itens (formula_id, ordem, materia_prima_id, quantidade, unidade, grupo, observacao)
    values (v_id, v_ord, v_mp, v_qtd, v_u, nullif(it->>'grupo', ''), nullif(it->>'observacao', ''));
  end loop;
  return jsonb_build_object('formula_id', v_id, 'versao', v_ver, 'materias_primas_criadas', to_jsonb(v_criadas));
end $$;

-- Reativa uma versão antiga (desativa a que estava ativa)
create or replace function public.gestao_ativar_formula(p_id uuid)
returns void
language plpgsql
as $$
declare f public.formulas%rowtype;
begin
  select * into f from public.formulas where id = p_id;
  if not found then raise exception 'Fórmula não encontrada.'; end if;
  update public.formulas set ativa = false where ativa and coalesce(sku, lower(btrim(nome))) = coalesce(f.sku, lower(btrim(f.nome)));
  update public.formulas set ativa = true where id = p_id;
end $$;

-- Exclui uma versão (e seus itens). Na Fase 8, versões usadas por lotes ficarão protegidas.
create or replace function public.gestao_excluir_formula(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.formulas where id = p_id;
  if not found then raise exception 'Fórmula não encontrada.'; end if;
end $$;

-- Permissões: só usuário logado
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_salvar_formula', 'gestao_ativar_formula', 'gestao_excluir_formula') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;
revoke all on public.formulas_custo from anon;
grant select on public.formulas_custo to authenticated;

notify pgrst, 'reload schema';
