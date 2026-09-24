-- ============================================================================
-- Petit Sabó — Fase 11: lote de matéria-prima e rotina
-- Cria 5 tabelas, 2 views e 6 funções. NÃO altera nenhuma tabela existente (rollback = 99_rollback_fase11.sql).
--
-- Nenhuma das notas fiscais reais da Karine traz validade no XML (não existe a tag <rastro> padrão da NF-e em
-- nenhum dos fornecedores dela), então o cadastro de lote de matéria-prima é quase sempre MANUAL — a Karine confirmou
-- isso em 2026-09-24. A leitura automática fica pronta para o dia em que algum fornecedor passar a informar.
--
-- "Lote de matéria-prima" (compra) é diferente de "lote de fabricação" (Fase 8, produto pronto). Uma produção pode
-- usar mais de um lote da mesma matéria-prima (ex.: terminando um lote antigo e abrindo um novo) — por isso a
-- ligação é numa tabela própria (lote_fabricacao_materia_prima_lote), não uma coluna única.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Lote de compra de matéria-prima. quantidade é só informativa (não existe controle de estoque de matéria-prima).
-- ---------------------------------------------------------------------------
create table public.materia_prima_lotes (
  id                     uuid primary key default gen_random_uuid(),
  materia_prima_id       uuid not null references public.materias_primas (id) on delete restrict,
  nota_fiscal_item_id    uuid unique references public.nota_fiscal_itens (id) on delete set null,   -- null = cadastro manual
  quantidade             numeric(14,4) check (quantidade > 0),        -- na unidade base da matéria-prima (g/ml/un)
  data_compra            date not null default public.hoje_brt(),
  data_validade          date,                                        -- data exata (rótulo/certificado do fornecedor)
  numero_lote_fornecedor text,
  origem                 text not null default 'manual' check (origem in ('nota_fiscal', 'manual')),
  observacao             text,
  criado_por             uuid default auth.uid(),
  criado_em              timestamptz not null default now()
);
create index materia_prima_lotes_mp_idx on public.materia_prima_lotes (materia_prima_id);
create index materia_prima_lotes_validade_idx on public.materia_prima_lotes (data_validade);

-- Rastreabilidade: qual lote de matéria-prima foi usado em qual lote de fabricação (produto pronto, Fase 8).
create table public.lote_fabricacao_materia_prima_lote (
  id                    uuid primary key default gen_random_uuid(),
  lote_fabricacao_id    uuid not null references public.lotes_fabricacao (id) on delete cascade,
  materia_prima_lote_id uuid not null references public.materia_prima_lotes (id) on delete restrict,   -- não deixa apagar um lote que já foi usado numa produção
  observacao            text,
  criado_em             timestamptz not null default now(),
  unique (lote_fabricacao_id, materia_prima_lote_id)
);
create index lote_fabricacao_mp_lote_lf_idx on public.lote_fabricacao_materia_prima_lote (lote_fabricacao_id);
create index lote_fabricacao_mp_lote_mp_idx on public.lote_fabricacao_materia_prima_lote (materia_prima_lote_id);

-- ---------------------------------------------------------------------------
-- Checklist de rotina
-- ---------------------------------------------------------------------------
create table public.rotina_tarefas (
  id         uuid primary key default gen_random_uuid(),
  chave      text unique not null,
  titulo     text not null check (btrim(titulo) <> ''),
  frequencia text not null check (frequencia in ('sob_demanda', 'semanal', 'mensal')),
  ativa      boolean not null default true,
  ordem      int not null default 0
);

create table public.rotina_execucoes (
  id           uuid primary key default gen_random_uuid(),
  tarefa_id    uuid not null references public.rotina_tarefas (id) on delete cascade,
  executado_em timestamptz not null default now(),
  observacao   text,
  criado_por   uuid default auth.uid()
);
create index rotina_execucoes_tarefa_idx on public.rotina_execucoes (tarefa_id, executado_em desc);

do $$
declare t text;
begin
  foreach t in array array['materia_prima_lotes', 'lote_fabricacao_materia_prima_lote', 'rotina_tarefas', 'rotina_execucoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Alerta de vencimento de matéria-prima (mesmos limites do produto acabado: crítico ≤60 dias, próximo ≤120 dias)
-- ---------------------------------------------------------------------------
create view public.materia_prima_lotes_vencimento with (security_invoker = true) as
select l.*, mp.nome, mp.tipo, mp.categoria, mp.fornecedor_nome, mp.unidade_base, mp.ativo as materia_prima_ativa,
       (l.data_validade - public.hoje_brt())                                    as dias_para_vencer,
       case when l.data_validade is null then null
            when l.data_validade < public.hoje_brt()                    then 'VENCIDO'
            when l.data_validade - public.hoje_brt() <= 60              then 'CRÍTICO'
            when l.data_validade - public.hoje_brt() <= 120             then 'PRÓXIMO'
            else 'OK' end                                                       as status_validade
  from public.materia_prima_lotes l
  join public.materias_primas mp on mp.id = l.materia_prima_id;

-- Status do checklist: última execução, dias desde então e se está atrasada (só para semanal/mensal)
create view public.rotina_status with (security_invoker = true) as
select t.id, t.chave, t.titulo, t.frequencia, t.ordem, e.ultima_execucao, e.dias_desde,
       case when t.frequencia = 'sob_demanda' then null
            when e.ultima_execucao is null then 'nunca'
            when t.frequencia = 'semanal' and e.dias_desde > 7  then 'atrasada'
            when t.frequencia = 'mensal'  and e.dias_desde > 31 then 'atrasada'
            else 'em_dia' end                                                   as status
  from public.rotina_tarefas t
  left join lateral (
    select max(executado_em) as ultima_execucao, (public.hoje_brt() - max(executado_em)::date) as dias_desde
      from public.rotina_execucoes where tarefa_id = t.id
  ) e on true
 where t.ativa
 order by t.ordem;

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------
-- Registra um lote de matéria-prima (manual ou vindo de um item de nota). p = { id?, materia_prima_id, quantidade?,
-- data_compra?, data_validade?, numero_lote_fornecedor?, observacao?, nota_fiscal_item_id? }
create or replace function public.gestao_registrar_lote_materia_prima(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_mp uuid := nullif(p->>'materia_prima_id', '')::uuid;
begin
  if v_mp is null or not exists (select 1 from public.materias_primas where id = v_mp) then raise exception 'Escolha a matéria-prima.'; end if;
  if v_id is null then
    insert into public.materia_prima_lotes (materia_prima_id, nota_fiscal_item_id, quantidade, data_compra, data_validade, numero_lote_fornecedor, origem, observacao)
    values (v_mp, nullif(p->>'nota_fiscal_item_id', '')::uuid, nullif(p->>'quantidade', '')::numeric,
            coalesce(nullif(p->>'data_compra', '')::date, public.hoje_brt()), nullif(p->>'data_validade', '')::date,
            nullif(btrim(coalesce(p->>'numero_lote_fornecedor', '')), ''), coalesce(nullif(p->>'origem', ''), 'manual'), nullif(p->>'observacao', ''))
    returning id into v_id;
  else
    update public.materia_prima_lotes set materia_prima_id = v_mp, quantidade = nullif(p->>'quantidade', '')::numeric,
           data_compra = coalesce(nullif(p->>'data_compra', '')::date, data_compra), data_validade = nullif(p->>'data_validade', '')::date,
           numero_lote_fornecedor = nullif(btrim(coalesce(p->>'numero_lote_fornecedor', '')), ''), observacao = nullif(p->>'observacao', '')
     where id = v_id;
    if not found then raise exception 'Lote de matéria-prima não encontrado.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.gestao_excluir_lote_materia_prima(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.materia_prima_lotes where id = p_id;
  if not found then raise exception 'Lote de matéria-prima não encontrado.'; end if;
exception when restrict_violation or foreign_key_violation then   -- "on delete restrict" levanta restrict_violation (23001), não foreign_key_violation
  raise exception 'Este lote já foi usado em um lote de fabricação e não pode ser apagado — é o que garante a rastreabilidade.';
end $$;

-- Marca quais lotes de matéria-prima um lote de fabricação usou (substitui a lista inteira daquele lote de fabricação).
-- p = { lote_fabricacao_id, itens:[{ materia_prima_lote_id, observacao? }] }. Cada lote precisa ser de uma matéria-prima
-- que realmente está na fórmula usada por esse lote de fabricação (evita marcar um ingrediente que não faz parte da receita).
create or replace function public.gestao_salvar_lotes_usados(p jsonb)
returns int
language plpgsql
as $$
declare v_lf uuid := nullif(p->>'lote_fabricacao_id', '')::uuid; v_formula uuid; it jsonb; v_mp uuid; v_n int := 0;
begin
  select formula_id into v_formula from public.lotes_fabricacao where id = v_lf;
  if not found then raise exception 'Lote de fabricação não encontrado.'; end if;
  delete from public.lote_fabricacao_materia_prima_lote where lote_fabricacao_id = v_lf;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    select materia_prima_id into v_mp from public.materia_prima_lotes where id = nullif(it->>'materia_prima_lote_id', '')::uuid;
    if not found then raise exception 'Escolha um lote de matéria-prima válido em cada linha.'; end if;
    if v_formula is null or not exists (select 1 from public.formula_itens where formula_id = v_formula and materia_prima_id = v_mp) then
      raise exception 'Essa matéria-prima não faz parte da fórmula usada neste lote de fabricação.';
    end if;
    insert into public.lote_fabricacao_materia_prima_lote (lote_fabricacao_id, materia_prima_lote_id, observacao)
    values (v_lf, (it->>'materia_prima_lote_id')::uuid, nullif(it->>'observacao', ''))
    on conflict (lote_fabricacao_id, materia_prima_lote_id) do update set observacao = excluded.observacao;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Marca uma tarefa da rotina como feita agora (cada clique é um registro novo — histórico, não sobrescreve).
create or replace function public.gestao_marcar_tarefa_feita(p_tarefa_id uuid, p_observacao text default null)
returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.rotina_tarefas where id = p_tarefa_id) then raise exception 'Tarefa não encontrada.'; end if;
  insert into public.rotina_execucoes (tarefa_id, observacao) values (p_tarefa_id, p_observacao) returning id into v_id;
  return v_id;
end $$;

-- Desfaz uma execução marcada por engano.
create or replace function public.gestao_desfazer_execucao(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.rotina_execucoes where id = p_id;
  if not found then raise exception 'Execução não encontrada.'; end if;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_registrar_lote_materia_prima', 'gestao_excluir_lote_materia_prima',
                 'gestao_salvar_lotes_usados', 'gestao_marcar_tarefa_feita', 'gestao_desfazer_execucao') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;
revoke all on public.materia_prima_lotes_vencimento, public.rotina_status from anon;
grant select on public.materia_prima_lotes_vencimento, public.rotina_status to authenticated;

-- ---------------------------------------------------------------------------
-- Semente: checklist de rotina
-- ---------------------------------------------------------------------------
insert into public.rotina_tarefas (chave, titulo, frequencia, ordem) values
  ('backup',        'Fazer backup',                      'semanal',     1),
  ('planilha',      'Atualizar planilha',                'semanal',     2),
  ('vencimento',    'Revisar alertas de vencimento',      'semanal',     3),
  ('estoque_baixo', 'Conferir estoque baixo',              'semanal',     4),
  ('nota_fiscal',   'Subir nota fiscal',                  'sob_demanda', 5),
  ('lote_prod',     'Registrar lote de fabricação',       'sob_demanda', 6),
  ('aprovar_preco', 'Aprovar preço de lote',              'sob_demanda', 7),
  ('materia_prima', 'Cadastrar matéria-prima',            'sob_demanda', 8),
  ('formula',       'Registrar fórmula',                  'sob_demanda', 9),
  ('feira',         'Registrar feira',                    'sob_demanda', 10),
  ('indicador',     'Conferir indicador financeiro',      'mensal',      11)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
