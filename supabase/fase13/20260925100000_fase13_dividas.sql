-- ============================================================================
-- Petit Sabó — Fase 13: dívidas
-- Cria 4 tabelas e 3 views. NÃO altera nenhuma tabela existente (rollback = 99_rollback_fase13.sql).
--
-- saldo_atual NUNCA é digitado direto: só existe pagamento (Σ desconta) e ajuste (Σ soma ou desconta, com motivo —
-- para os casos em que a Karine corrige o saldo no início do mês, por juros lançados, renegociação, erro etc.).
-- taxa_juros_mensal é só informativa: NÃO faz o saldo crescer sozinho (calcular juro composto certo depende de
-- detalhes do contrato de cada dívida que o sistema não tem).
--
-- O ataque de 65% (ou o % que for) incide sobre o FATURAMENTO LÍQUIDO do mês, que a Karine digita ela mesma
-- (já descontou o que precisa por fora) — o sistema não deriva o líquido sozinho. É só sugestão: nada muda em
-- dividas/divida_pagamentos sozinho, só quando ela registrar o pagamento de fato.
-- ============================================================================

create table public.dividas (
  id                             uuid primary key default gen_random_uuid(),
  nome                           text not null check (btrim(nome) <> ''),              -- credor (ex.: "Nubank")
  tipo                           text not null check (tipo in ('cartao', 'emprestimo', 'parcelamento', 'outro')),
  valor_original                 numeric(12,2) not null check (valor_original >= 0),
  taxa_juros_mensal              numeric(6,4),                                          -- informativo; não aplica sozinho
  data_inicio                    date not null,
  percentual_ataque_faturamento  numeric(5,4) check (percentual_ataque_faturamento between 0 and 1),  -- ex.: 0.65 só no Nubank
  ativa                          boolean not null default true,
  observacao                     text,
  criado_por                     uuid default auth.uid(),
  criado_em                      timestamptz not null default now()
);

create table public.divida_pagamentos (
  id              uuid primary key default gen_random_uuid(),
  divida_id       uuid not null references public.dividas (id) on delete restrict,
  valor           numeric(12,2) not null check (valor > 0),
  data_pagamento  date not null default public.hoje_brt(),
  origem_recurso  text not null check (origem_recurso in ('faturamento_mes', 'reserva', 'receita_extraordinaria', 'outro')),
  observacao      text,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now()
);
create index divida_pagamentos_divida_idx on public.divida_pagamentos (divida_id, data_pagamento);

-- Correção de saldo fora de um pagamento (juros lançados no início do mês, renegociação, erro de lançamento...).
-- valor positivo = a dívida aumentou; valor negativo = abatimento que não passou por divida_pagamentos.
create table public.divida_ajustes (
  id          uuid primary key default gen_random_uuid(),
  divida_id   uuid not null references public.dividas (id) on delete restrict,
  valor       numeric(12,2) not null check (valor <> 0),
  data_ajuste date not null default public.hoje_brt(),
  motivo      text not null check (btrim(motivo) <> ''),
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index divida_ajustes_divida_idx on public.divida_ajustes (divida_id, data_ajuste);

-- Faturamento líquido do mês, digitado pela Karine (já descontado o que ela considera obrigatório/imposto).
create table public.faturamento_liquido_mensal (
  mes           date primary key check (extract(day from mes) = 1),
  valor         numeric(12,2) not null check (valor >= 0),
  observacao    text,
  atualizado_em timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['dividas', 'divida_pagamentos', 'divida_ajustes', 'faturamento_liquido_mensal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Resumo por dívida: saldo, quanto já foi pago, ritmo dos últimos 3 meses e projeção de quitação nesse ritmo.
-- Sem pagamento nos últimos 3 meses, a projeção fica em branco (não inventa número).
-- ---------------------------------------------------------------------------
create view public.divida_resumo with (security_invoker = true) as
select d.*,
       coalesce(p.total_pago, 0)                                                      as total_pago,
       coalesce(a.total_ajustes, 0)                                                   as total_ajustes,
       round(d.valor_original - coalesce(p.total_pago, 0) + coalesce(a.total_ajustes, 0), 2) as saldo_atual,
       p.data_ultimo_pagamento,
       round(coalesce(p3.total_3m, 0) / 3.0, 2)                                       as ritmo_mensal,
       case when coalesce(p3.total_3m, 0) > 0 and (d.valor_original - coalesce(p.total_pago, 0) + coalesce(a.total_ajustes, 0)) > 0
            then ceil((d.valor_original - coalesce(p.total_pago, 0) + coalesce(a.total_ajustes, 0)) / (p3.total_3m / 3.0))::int end as meses_para_quitar,
       case when (d.valor_original - coalesce(p.total_pago, 0) + coalesce(a.total_ajustes, 0)) <= 0 then 'quitada' else 'em_aberto' end as status
  from public.dividas d
  left join lateral (select sum(valor) as total_pago, max(data_pagamento) as data_ultimo_pagamento from public.divida_pagamentos where divida_id = d.id) p on true
  left join lateral (select sum(valor) as total_ajustes from public.divida_ajustes where divida_id = d.id) a on true
  left join lateral (select sum(valor) as total_3m from public.divida_pagamentos where divida_id = d.id and data_pagamento > public.hoje_brt() - interval '3 months') p3 on true;

create view public.divida_resumo_geral with (security_invoker = true) as
select count(*) filter (where status = 'em_aberto')                as dividas_em_aberto,
       count(*) filter (where status = 'quitada')                  as dividas_quitadas,
       coalesce(sum(saldo_atual) filter (where status = 'em_aberto'), 0) as total_devido,
       coalesce(sum(total_pago), 0)                                as total_pago_geral
  from public.divida_resumo where ativa;

-- Sugestão de ataque por mês: faturamento líquido (digitado) × percentual configurado, por dívida que tiver o percentual.
create view public.divida_ataque_mensal with (security_invoker = true) as
select f.mes, f.valor as faturamento_liquido, d.id as divida_id, d.nome as divida_nome, d.percentual_ataque_faturamento,
       round(f.valor * d.percentual_ataque_faturamento, 2)                                              as sugestao,
       coalesce((select sum(p.valor) from public.divida_pagamentos p
                  where p.divida_id = d.id and date_trunc('month', p.data_pagamento)::date = f.mes), 0)  as pago_no_mes,
       round(f.valor * d.percentual_ataque_faturamento, 2)
         - coalesce((select sum(p.valor) from public.divida_pagamentos p
                      where p.divida_id = d.id and date_trunc('month', p.data_pagamento)::date = f.mes), 0) as diferenca
  from public.faturamento_liquido_mensal f
  cross join public.dividas d
 where d.percentual_ataque_faturamento is not null and d.ativa;

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------
create or replace function public.gestao_salvar_divida(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_pct numeric := nullif(p->>'percentual_ataque_faturamento', '')::numeric;
begin
  if nullif(btrim(coalesce(p->>'nome', '')), '') is null then raise exception 'Informe o nome (credor) da dívida.'; end if;
  if coalesce(p->>'tipo', '') not in ('cartao', 'emprestimo', 'parcelamento', 'outro') then raise exception 'Tipo de dívida inválido.'; end if;
  if coalesce(nullif(p->>'valor_original', '')::numeric, -1) < 0 then raise exception 'Informe o valor original da dívida.'; end if;
  if nullif(p->>'data_inicio', '') is null then raise exception 'Informe a data de início da dívida.'; end if;
  if v_pct is not null and (v_pct < 0 or v_pct > 1) then raise exception 'O percentual de ataque deve estar entre 0%% e 100%%.'; end if;
  if v_id is null then
    insert into public.dividas (nome, tipo, valor_original, taxa_juros_mensal, data_inicio, percentual_ataque_faturamento, observacao)
    values (btrim(p->>'nome'), p->>'tipo', (p->>'valor_original')::numeric, nullif(p->>'taxa_juros_mensal', '')::numeric,
            (p->>'data_inicio')::date, v_pct, nullif(p->>'observacao', ''))
    returning id into v_id;
  else
    update public.dividas set nome = btrim(p->>'nome'), tipo = p->>'tipo', valor_original = (p->>'valor_original')::numeric,
           taxa_juros_mensal = nullif(p->>'taxa_juros_mensal', '')::numeric, data_inicio = (p->>'data_inicio')::date,
           percentual_ataque_faturamento = v_pct, observacao = nullif(p->>'observacao', ''), ativa = coalesce((p->>'ativa')::boolean, ativa)
     where id = v_id;
    if not found then raise exception 'Dívida não encontrada.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.gestao_excluir_divida(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.dividas where id = p_id;
  if not found then raise exception 'Dívida não encontrada.'; end if;
exception when restrict_violation or foreign_key_violation then
  raise exception 'Esta dívida já tem pagamento ou ajuste registrado e não pode ser apagada. Você pode marcá-la como inativa.';
end $$;

create or replace function public.gestao_registrar_pagamento_divida(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  if nullif(p->>'divida_id', '')::uuid is null or not exists (select 1 from public.dividas where id = (p->>'divida_id')::uuid) then raise exception 'Escolha a dívida.'; end if;
  if coalesce(nullif(p->>'valor', '')::numeric, 0) <= 0 then raise exception 'Informe o valor do pagamento (maior que zero).'; end if;
  if coalesce(p->>'origem_recurso', '') not in ('faturamento_mes', 'reserva', 'receita_extraordinaria', 'outro') then raise exception 'Escolha de onde saiu o dinheiro.'; end if;
  insert into public.divida_pagamentos (divida_id, valor, data_pagamento, origem_recurso, observacao)
  values ((p->>'divida_id')::uuid, (p->>'valor')::numeric, coalesce(nullif(p->>'data_pagamento', '')::date, public.hoje_brt()), p->>'origem_recurso', nullif(p->>'observacao', ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.gestao_excluir_pagamento_divida(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.divida_pagamentos where id = p_id;
  if not found then raise exception 'Pagamento não encontrado.'; end if;
end $$;

-- Ajuste de saldo (juros lançados, renegociação, erro de lançamento...). p = { divida_id, valor, data_ajuste?, motivo }
create or replace function public.gestao_registrar_ajuste_divida(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  if nullif(p->>'divida_id', '')::uuid is null or not exists (select 1 from public.dividas where id = (p->>'divida_id')::uuid) then raise exception 'Escolha a dívida.'; end if;
  if coalesce(nullif(p->>'valor', '')::numeric, 0) = 0 then raise exception 'Informe um valor de ajuste diferente de zero (positivo se a dívida aumentou, negativo se diminuiu).'; end if;
  if nullif(btrim(coalesce(p->>'motivo', '')), '') is null then raise exception 'Informe o motivo do ajuste.'; end if;
  insert into public.divida_ajustes (divida_id, valor, data_ajuste, motivo)
  values ((p->>'divida_id')::uuid, (p->>'valor')::numeric, coalesce(nullif(p->>'data_ajuste', '')::date, public.hoje_brt()), btrim(p->>'motivo'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.gestao_excluir_ajuste_divida(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.divida_ajustes where id = p_id;
  if not found then raise exception 'Ajuste não encontrado.'; end if;
end $$;

-- Faturamento líquido do mês (upsert). p = { mes (qualquer dia do mês), valor, observacao? }
create or replace function public.gestao_salvar_faturamento_liquido(p jsonb)
returns void
language plpgsql
as $$
declare v_mes date := date_trunc('month', nullif(p->>'mes', '')::date)::date;
begin
  if v_mes is null then raise exception 'Informe o mês.'; end if;
  if coalesce(nullif(p->>'valor', '')::numeric, -1) < 0 then raise exception 'Informe o faturamento líquido do mês.'; end if;
  insert into public.faturamento_liquido_mensal (mes, valor, observacao) values (v_mes, (p->>'valor')::numeric, nullif(p->>'observacao', ''))
  on conflict (mes) do update set valor = excluded.valor, observacao = excluded.observacao, atualizado_em = now();
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_salvar_divida', 'gestao_excluir_divida', 'gestao_registrar_pagamento_divida',
                 'gestao_excluir_pagamento_divida', 'gestao_registrar_ajuste_divida', 'gestao_excluir_ajuste_divida', 'gestao_salvar_faturamento_liquido') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;
revoke all on public.divida_resumo, public.divida_resumo_geral, public.divida_ataque_mensal from anon;
grant select on public.divida_resumo, public.divida_resumo_geral, public.divida_ataque_mensal to authenticated;

notify pgrst, 'reload schema';
