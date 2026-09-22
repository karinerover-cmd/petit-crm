-- ============================================================================
-- Petit Sabó — Fase 8: lote de fabricação e precificação
-- Cria 3 tabelas e 7 funções. NÃO altera nenhuma tabela existente (rollback = 99_rollback_fase8.sql).
--
-- Custo do lote = matéria-prima (fórmula ativa do SKU × receitas do lote) + embalagem de PRODUTO (lista por SKU × unidades) + mão de obra (horas × valor/hora).
-- Custo unitário = custo total ÷ unidades produzidas.  Preço sugerido (varejo) = custo unitário × markup (3).
-- O preço sugerido NUNCA é aplicado sozinho: só vira o preço do produto quando você aprova (ou ajusta) na tela.
-- Embalagem de ENVIO não entra aqui (é custo fixo). Estoque não é alterado pelo lote (o estoque continua único por produto).
-- Se algum ingrediente/embalagem estiver sem custo, o lote é gravado com custo_incompleto = true e NÃO gera preço sugerido.
-- O lote guarda o custo de cada item NO MOMENTO da fabricação (coluna detalhe) e a VERSÃO da fórmula usada: mudar a fórmula
-- ou o custo de uma matéria-prima depois não reescreve o custo dos lotes já registrados.
-- ============================================================================

create table public.configuracao_precificacao (
  id                        smallint primary key default 1 check (id = 1),     -- linha única
  valor_hora_mao_de_obra    numeric(10,2) not null default 14.03 check (valor_hora_mao_de_obra >= 0),   -- 1,5 × salário mínimo (R$ 1.621) ÷ 173,3 h; revisar todo ano
  markup_varejo             numeric(6,2)  not null default 3 check (markup_varejo > 0),
  atualizado_em             timestamptz not null default now()
);
insert into public.configuracao_precificacao (id) values (1);

-- Embalagem de produto por SKU: quantidade de cada item (matéria-prima categoria embalagem_produto) usada em UMA unidade
create table public.produto_embalagem (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null references public.produtos (sku) on update cascade on delete cascade,
  materia_prima_id  uuid not null references public.materias_primas (id) on delete restrict,
  quantidade        numeric(12,4) not null check (quantidade > 0),
  unique (sku, materia_prima_id)
);
create index produto_embalagem_sku_idx on public.produto_embalagem (sku);

create table public.lotes_fabricacao (
  id                        uuid primary key default gen_random_uuid(),
  sku                       text not null references public.produtos (sku) on update cascade on delete restrict,
  formula_id                uuid references public.formulas (id) on delete restrict,   -- a versão usada fica protegida: apagar a fórmula não pode reescrever o custo do lote
  formula_versao            int,
  data_fabricacao           date not null default public.hoje_brt(),
  quantidade_produzida      int not null check (quantidade_produzida > 0),
  horas_trabalhadas         numeric(8,2) not null default 0 check (horas_trabalhadas >= 0),
  receitas                  numeric(10,4),                                      -- quantidade ÷ unidades por receita da fórmula
  valor_hora                numeric(10,2) not null,
  markup                    numeric(6,2) not null,
  custo_materia_prima_total numeric(14,2),
  custo_embalagem_total     numeric(14,2),
  custo_mao_de_obra         numeric(14,2),
  custo_total               numeric(14,2),
  custo_unitario            numeric(14,4),
  preco_sugerido_varejo     numeric(14,2),
  custo_incompleto          boolean not null default false,
  itens_sem_custo           text,                                               -- nomes dos itens sem custo (quando incompleto)
  detalhe                   jsonb,                                              -- custo de cada item NO MOMENTO do lote (não muda se o custo mudar depois)
  status_aprovacao          text not null default 'pendente' check (status_aprovacao in ('pendente', 'aprovado', 'ajustado', 'descartado')),
  preco_aprovado            numeric(14,2),
  aprovado_em               timestamptz,
  observacao                text,
  criado_por                uuid default auth.uid(),
  criado_em                 timestamptz not null default now()
);
create index lotes_fabricacao_sku_idx on public.lotes_fabricacao (sku, data_fabricacao desc);

do $$
declare t text;
begin
  foreach t in array array['configuracao_precificacao', 'produto_embalagem', 'lotes_fabricacao'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Cálculo (não grava nada). p = { sku, quantidade, horas }
-- ---------------------------------------------------------------------------
create or replace function public.gestao_calcular_lote(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_sku text := upper(btrim(coalesce(p->>'sku', '')));
  v_qtd numeric := coalesce(nullif(p->>'quantidade', '')::numeric, 0);
  v_h   numeric := coalesce(nullif(p->>'horas', '')::numeric, 0);
  f public.formulas%rowtype; cfg public.configuracao_precificacao%rowtype;
  v_rec numeric; v_mp numeric := 0; v_emb numeric := 0; v_mo numeric; v_tot numeric; v_un numeric; v_sug numeric;
  v_det jsonb := '[]'::jsonb; v_sem text[] := '{}'; r record; v_sub numeric;
begin
  if v_sku = '' or not exists (select 1 from public.produtos where sku = v_sku) then raise exception 'Escolha um produto válido.'; end if;
  if v_qtd <= 0 then raise exception 'Informe a quantidade produzida (maior que zero).'; end if;
  if v_h < 0 then raise exception 'As horas trabalhadas não podem ser negativas.'; end if;
  select * into f from public.formulas where sku = v_sku and ativa;
  if not found then raise exception 'O produto % não tem fórmula ativa. Cadastre a fórmula primeiro.', v_sku; end if;
  select * into cfg from public.configuracao_precificacao where id = 1;
  v_rec := v_qtd / f.unidades_por_receita;

  for r in select mp.nome, mp.unidade_base, mp.custo_unitario_atual as custo, fi.quantidade
             from public.formula_itens fi join public.materias_primas mp on mp.id = fi.materia_prima_id
            where fi.formula_id = f.id order by fi.ordem loop
    v_sub := case when r.custo is null then null else round(r.quantidade * v_rec * r.custo, 4) end;
    if r.custo is null then v_sem := v_sem || r.nome; else v_mp := v_mp + v_sub; end if;
    v_det := v_det || jsonb_build_object('tipo', 'formula', 'nome', r.nome, 'quantidade', round(r.quantidade * v_rec, 4), 'unidade', r.unidade_base, 'custo_unitario', r.custo, 'subtotal', v_sub);
  end loop;
  for r in select mp.nome, mp.unidade_base, mp.custo_unitario_atual as custo, pe.quantidade
             from public.produto_embalagem pe join public.materias_primas mp on mp.id = pe.materia_prima_id
            where pe.sku = v_sku order by mp.nome loop
    v_sub := case when r.custo is null then null else round(r.quantidade * v_qtd * r.custo, 4) end;
    if r.custo is null then v_sem := v_sem || r.nome; else v_emb := v_emb + v_sub; end if;
    v_det := v_det || jsonb_build_object('tipo', 'embalagem', 'nome', r.nome, 'quantidade', round(r.quantidade * v_qtd, 4), 'unidade', r.unidade_base, 'custo_unitario', r.custo, 'subtotal', v_sub);
  end loop;
  v_mo  := round(v_h * cfg.valor_hora_mao_de_obra, 2);
  v_tot := round(v_mp + v_emb + v_mo, 2);
  v_un  := round(v_tot / v_qtd, 4);
  v_sug := case when cardinality(v_sem) = 0 then round(v_un * cfg.markup_varejo, 2) else null end;
  return jsonb_build_object('sku', v_sku, 'formula_id', f.id, 'formula_nome', f.nome, 'formula_versao', f.versao, 'unidades_por_receita', f.unidades_por_receita,
    'quantidade', v_qtd, 'horas', v_h, 'receitas', round(v_rec, 4), 'valor_hora', cfg.valor_hora_mao_de_obra, 'markup', cfg.markup_varejo,
    'custo_materia_prima_total', round(v_mp, 2), 'custo_embalagem_total', round(v_emb, 2), 'custo_mao_de_obra', v_mo, 'custo_total', v_tot, 'custo_unitario', v_un,
    'preco_sugerido_varejo', v_sug, 'custo_incompleto', cardinality(v_sem) > 0, 'itens_sem_custo', array_to_string(v_sem, ', '), 'detalhe', v_det,
    'preco_atual', (select preco from public.produtos where sku = v_sku));
end $$;

-- Registra o lote (calcula e grava). p = { sku, data_fabricacao?, quantidade, horas, observacao? }
create or replace function public.gestao_registrar_lote(p jsonb)
returns jsonb
language plpgsql
as $$
declare c jsonb := public.gestao_calcular_lote(p); v_id uuid;
begin
  insert into public.lotes_fabricacao (sku, formula_id, formula_versao, data_fabricacao, quantidade_produzida, horas_trabalhadas, receitas, valor_hora, markup,
      custo_materia_prima_total, custo_embalagem_total, custo_mao_de_obra, custo_total, custo_unitario, preco_sugerido_varejo, custo_incompleto, itens_sem_custo, detalhe, status_aprovacao, observacao)
  values (c->>'sku', (c->>'formula_id')::uuid, (c->>'formula_versao')::int, coalesce(nullif(p->>'data_fabricacao', '')::date, public.hoje_brt()), (c->>'quantidade')::int, (c->>'horas')::numeric,
      (c->>'receitas')::numeric, (c->>'valor_hora')::numeric, (c->>'markup')::numeric, (c->>'custo_materia_prima_total')::numeric, (c->>'custo_embalagem_total')::numeric,
      (c->>'custo_mao_de_obra')::numeric, (c->>'custo_total')::numeric, (c->>'custo_unitario')::numeric, (c->>'preco_sugerido_varejo')::numeric,
      (c->>'custo_incompleto')::boolean, nullif(c->>'itens_sem_custo', ''), c->'detalhe',
      'pendente', nullif(p->>'observacao', ''))
  returning id into v_id;
  return c || jsonb_build_object('lote_id', v_id);
end $$;

-- Aprova, ajusta ou descarta o preço sugerido. p = { lote_id, acao: 'aprovar' | 'ajustar' | 'descartar', preco? }
-- 'aprovar' usa o preço sugerido; 'ajustar' usa o preço informado. Só então o preço do produto muda.
create or replace function public.gestao_aprovar_preco_lote(p jsonb)
returns jsonb
language plpgsql
as $$
declare l public.lotes_fabricacao%rowtype; v_acao text := p->>'acao'; v_preco numeric;
begin
  select * into l from public.lotes_fabricacao where id = nullif(p->>'lote_id', '')::uuid;
  if not found then raise exception 'Lote não encontrado.'; end if;
  if v_acao = 'descartar' then
    update public.lotes_fabricacao set status_aprovacao = 'descartado', preco_aprovado = null, aprovado_em = now() where id = l.id;
    return jsonb_build_object('lote_id', l.id, 'status', 'descartado');
  end if;
  if v_acao not in ('aprovar', 'ajustar') then raise exception 'Ação inválida: % (use aprovar, ajustar ou descartar).', v_acao; end if;
  if v_acao = 'aprovar' then
    if l.custo_incompleto or l.preco_sugerido_varejo is null then raise exception 'Este lote está com custo incompleto (sem custo: %). Complete os custos e registre o lote de novo, ou informe o preço manualmente (ajustar).', l.itens_sem_custo; end if;
    v_preco := l.preco_sugerido_varejo;
  else
    v_preco := nullif(p->>'preco', '')::numeric;
    if v_preco is null or v_preco <= 0 then raise exception 'Informe o preço (maior que zero).'; end if;
  end if;
  update public.lotes_fabricacao set status_aprovacao = case when v_acao = 'aprovar' then 'aprovado' else 'ajustado' end, preco_aprovado = v_preco, aprovado_em = now() where id = l.id;
  update public.produtos set preco = v_preco where sku = l.sku;   -- ÚNICO ponto do sistema que muda o preço a partir de um lote, e só por esta ação sua
  return jsonb_build_object('lote_id', l.id, 'status', case when v_acao = 'aprovar' then 'aprovado' else 'ajustado' end, 'sku', l.sku, 'preco', v_preco);
end $$;

create or replace function public.gestao_excluir_lote(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.lotes_fabricacao where id = p_id;
  if not found then raise exception 'Lote não encontrado.'; end if;
end $$;

-- Configuração (linha única). p = { valor_hora_mao_de_obra?, markup_varejo? }
create or replace function public.gestao_salvar_config_precificacao(p jsonb)
returns void
language plpgsql
as $$
begin
  update public.configuracao_precificacao set
    valor_hora_mao_de_obra = coalesce(nullif(p->>'valor_hora_mao_de_obra', '')::numeric, valor_hora_mao_de_obra),
    markup_varejo = coalesce(nullif(p->>'markup_varejo', '')::numeric, markup_varejo), atualizado_em = now()
   where id = 1;
end $$;

-- Embalagem de produto por SKU (substitui a lista inteira). p = { sku, itens:[{ materia_prima_id, quantidade }] }
create or replace function public.gestao_salvar_embalagem_produto(p jsonb)
returns int
language plpgsql
as $$
declare v_sku text := upper(btrim(coalesce(p->>'sku', ''))); it jsonb; v_n int := 0; v_cat text;
begin
  if not exists (select 1 from public.produtos where sku = v_sku) then raise exception 'Produto % não existe.', v_sku; end if;
  delete from public.produto_embalagem where sku = v_sku;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    select categoria into v_cat from public.materias_primas where id = nullif(it->>'materia_prima_id', '')::uuid;
    if not found then raise exception 'Escolha a embalagem de cada linha.'; end if;
    if v_cat <> 'embalagem_produto' then raise exception 'Só embalagem de produto pode entrar aqui (o item escolhido é um ingrediente).'; end if;
    if coalesce(nullif(it->>'quantidade', '')::numeric, 0) <= 0 then raise exception 'A quantidade por unidade deve ser maior que zero.'; end if;
    insert into public.produto_embalagem (sku, materia_prima_id, quantidade) values (v_sku, (it->>'materia_prima_id')::uuid, (it->>'quantidade')::numeric)
    on conflict (sku, materia_prima_id) do update set quantidade = produto_embalagem.quantidade + excluded.quantidade;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Protege o custo histórico: uma versão de fórmula usada por algum lote não pode ser apagada (substitui a função da Fase 7).
create or replace function public.gestao_excluir_formula(p_id uuid)
returns void
language plpgsql
as $$
declare v_n int;
begin
  select count(*) into v_n from public.lotes_fabricacao where formula_id = p_id;
  if v_n > 0 then raise exception 'Esta versão da fórmula foi usada em % lote(s) e não pode ser apagada — o custo daqueles lotes ficaria sem origem. Crie uma versão nova em vez de apagar.', v_n; end if;
  delete from public.formulas where id = p_id;
  if not found then raise exception 'Fórmula não encontrada.'; end if;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_calcular_lote', 'gestao_registrar_lote', 'gestao_aprovar_preco_lote', 'gestao_excluir_lote',
                                                         'gestao_salvar_config_precificacao', 'gestao_salvar_embalagem_produto', 'gestao_excluir_formula') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;

notify pgrst, 'reload schema';
