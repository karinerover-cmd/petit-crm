-- ============================================================================
-- Petit Sabó — Fase 9: despesas variáveis e margem de contribuição real
-- Cria 3 tabelas, 1 coluna nova em venda_itens, 2 gatilhos e 4 funções. NÃO muda o preço de venda (rollback = 99_rollback_fase9.sql).
--
-- O preço continua no markup 3× (Fase 8). Esta fase só calcula quanto sobra de verdade depois das despesas
-- que só existem NA VENDA: taxa de cartão/Pix, comissão do canal ou da plataforma, frete que a Petit absorve,
-- embalagem de envio (rateada, puxada de materiais_embalagem_envio — nunca digitada à mão) e perda/extravio estimada.
--
-- Regra de ouro: o valor REGISTRADO na venda (taxa_pagamento, comissao_canal, comissao_plataforma, frete_pago/cobrado
-- em vendas) sempre vence. A configuração (despesas_variaveis_config) só estima o que faltar.
--
-- custo_unitario_no_momento trava, no momento da venda, o custo do produto (do lote mais recente aprovado/ajustado,
-- com data de fabricação até a data da venda). Depois, mudar a fórmula ou o custo de matéria-prima não reescreve
-- vendas já registradas — só vendas NOVAS ganham o custo travado (decisão: sem preenchimento retroativo).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Regras de despesa variável. A mais específica vence: canal+forma > canal > forma > geral (os dois nulos).
-- tipo: 'taxa_pagamento' | 'comissao_canal' | 'comissao_plataforma' | 'frete_absorvido' | 'perda_extravio' | 'embalagem_envio_fallback'
-- percentual é fração de vendas.valor (0.02 = 2%); valor_fixo é R$ (usado por 'embalagem_envio_fallback', por venda).
-- ---------------------------------------------------------------------------
create table public.despesas_variaveis_config (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('taxa_pagamento', 'comissao_canal', 'comissao_plataforma', 'frete_absorvido', 'perda_extravio', 'embalagem_envio_fallback')),
  canal_id      uuid references public.canais (id) on delete cascade,
  forma_pagamento text,
  gateway       text,                                     -- só informativo (Vindi, Yapay...)
  percentual    numeric(6,4) check (percentual >= 0 and percentual <= 1),
  valor_fixo    numeric(10,2) check (valor_fixo >= 0),
  ativo         boolean not null default true,
  observacao    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (percentual is not null or valor_fixo is not null)
);
create unique index despesas_variaveis_config_uk on public.despesas_variaveis_config
  (tipo, coalesce(canal_id, '00000000-0000-0000-0000-000000000000'), coalesce(lower(btrim(forma_pagamento)), ''));

-- Kit de embalagem de envio por venda. canal_id nulo = kit padrão (usado quando o canal não tem kit próprio).
-- "Feira" tem o seu próprio kit (só sacola); os demais usam o padrão (caixa/envio + papel de seda + adesivo + plástico bolha + plástico de envio).
create table public.embalagem_envio_kit (
  id                  uuid primary key default gen_random_uuid(),
  canal_id            uuid references public.canais (id) on delete cascade,
  embalagem_envio_id  uuid not null references public.materiais_embalagem_envio (id) on delete restrict,
  quantidade_por_venda numeric(10,4) not null check (quantidade_por_venda > 0)
);
create unique index embalagem_envio_kit_uk on public.embalagem_envio_kit (coalesce(canal_id, '00000000-0000-0000-0000-000000000000'), embalagem_envio_id);

-- Margem calculada e TRAVADA por venda: não recalcula sozinha se a configuração mudar depois.
create table public.venda_margem (
  venda_id                    uuid primary key references public.vendas (id) on delete cascade,
  receita_produtos            numeric(12,2) not null,
  custo_produtos              numeric(12,2),                          -- nulo = algum item sem custo travado
  custo_completo              boolean not null default true,
  itens_sem_custo             text,
  taxa_pagamento              numeric(12,2) not null default 0,
  taxa_pagamento_origem       text not null,                          -- 'registrado' | 'estimado' | 'sem_regra'
  comissao_canal              numeric(12,2) not null default 0,
  comissao_canal_origem       text not null,
  comissao_plataforma         numeric(12,2) not null default 0,
  comissao_plataforma_origem  text not null,
  frete_absorvido             numeric(12,2) not null default 0,
  frete_absorvido_origem      text not null,
  embalagem_envio             numeric(12,2) not null default 0,
  embalagem_envio_origem      text not null,                          -- 'kit' | 'kit_incompleto' | 'fallback' | 'sem_regra'
  perda_extravio              numeric(12,2) not null default 0,
  perda_extravio_origem       text not null,
  despesas_variaveis_total    numeric(12,2) not null,
  margem_real                 numeric(12,2),                          -- nulo se custo_completo = false
  margem_pct                  numeric(6,4),
  calculada_em                timestamptz not null default now()
);

-- Custo travado no momento da venda (não muda depois). NULL = sem lote aprovado até a data da venda (produto legado ou ainda sem lote).
alter table public.venda_itens add column custo_unitario_no_momento numeric(14,4);
alter table public.venda_itens add column custo_origem text check (custo_origem in ('lote'));

do $$
declare t text;
begin
  foreach t in array array['despesas_variaveis_config', 'embalagem_envio_kit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
  execute 'alter table public.venda_margem enable row level security';
  execute 'create policy authenticated_full_access on public.venda_margem for all to authenticated using (true) with check (true)';
end $$;

-- ---------------------------------------------------------------------------
-- Trava o custo do item no momento da venda (lote mais recente aprovado/ajustado, fabricado até a data da venda).
-- ---------------------------------------------------------------------------
create or replace function public.gestao_travar_custo_item()
returns trigger
language plpgsql
as $$
declare v_data date; v_custo numeric;
begin
  if new.sku is not null then
    select data_venda into v_data from public.vendas where id = new.venda_id;
    select custo_unitario into v_custo from public.lotes_fabricacao
     where sku = new.sku and status_aprovacao in ('aprovado', 'ajustado') and data_fabricacao <= coalesce(v_data, public.hoje_brt())
     order by data_fabricacao desc, aprovado_em desc limit 1;
    if v_custo is not null then new.custo_unitario_no_momento := v_custo; new.custo_origem := 'lote'; end if;
  end if;
  return new;
end $$;
create trigger venda_itens_trava_custo before insert on public.venda_itens for each row execute function public.gestao_travar_custo_item();

-- ---------------------------------------------------------------------------
-- Calcula a margem de UMA venda (não grava nada — usado para conferir e pelo gestao_registrar_margem_venda).
-- ---------------------------------------------------------------------------
create or replace function public.gestao_calcular_margem_venda(p_venda_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v public.vendas%rowtype; v_receita numeric; v_custo numeric; v_sem text[]; v_n_itens int;
  v_taxa numeric; v_taxa_o text; v_cc numeric; v_cc_o text; v_cp numeric; v_cp_o text; v_fr numeric; v_fr_o text;
  v_emb numeric; v_emb_o text; v_perda numeric; v_perda_o text; v_tot numeric; v_margem numeric; v_pct numeric;
  r record; v_tem_kit_canal boolean; v_canal_do_kit uuid; v_kit_incompleto boolean;
begin
  select * into v from public.vendas where id = p_venda_id;
  if not found then raise exception 'Venda não encontrada.'; end if;

  select coalesce(sum(subtotal), 0), count(*) into v_receita, v_n_itens from public.venda_itens where venda_id = p_venda_id;
  if v_n_itens = 0 then v_receita := v.valor; end if;

  select sum(quantidade * custo_unitario_no_momento), array_agg(sku) filter (where custo_unitario_no_momento is null)
    into v_custo, v_sem from public.venda_itens where venda_id = p_venda_id;
  if v_n_itens = 0 then v_custo := null; v_sem := null; end if;

  -- taxa de pagamento: valor registrado vence; senão, a regra mais específica (canal+forma > canal > forma > geral)
  if v.taxa_pagamento is not null then v_taxa := v.taxa_pagamento; v_taxa_o := 'registrado';
  else
    select percentual * v.valor into v_taxa from public.despesas_variaveis_config
     where tipo = 'taxa_pagamento' and ativo and (canal_id = v.canal_id or canal_id is null) and (lower(btrim(forma_pagamento)) = lower(btrim(v.forma_pagamento)) or forma_pagamento is null)
     order by (canal_id is not null)::int + (forma_pagamento is not null)::int desc limit 1;
    v_taxa := round(coalesce(v_taxa, 0), 2); v_taxa_o := case when v_taxa > 0 then 'estimado' else 'sem_regra' end;
  end if;

  if v.comissao_canal is not null then v_cc := v.comissao_canal; v_cc_o := 'registrado';
  else
    select percentual * v.valor into v_cc from public.despesas_variaveis_config
     where tipo = 'comissao_canal' and ativo and canal_id = v.canal_id limit 1;
    v_cc := round(coalesce(v_cc, 0), 2); v_cc_o := case when v_cc > 0 then 'estimado' else 'sem_regra' end;
  end if;

  if v.comissao_plataforma is not null then v_cp := v.comissao_plataforma; v_cp_o := 'registrado';
  else
    select percentual * v.valor into v_cp from public.despesas_variaveis_config
     where tipo = 'comissao_plataforma' and ativo and canal_id = v.canal_id limit 1;
    v_cp := round(coalesce(v_cp, 0), 2); v_cp_o := case when v_cp > 0 then 'estimado' else 'sem_regra' end;
  end if;

  if v.frete_pago is not null or v.frete_cobrado is not null then
    v_fr := greatest(coalesce(v.frete_pago, 0) - coalesce(v.frete_cobrado, 0), 0); v_fr_o := 'registrado';
  else
    select coalesce(valor_fixo, percentual * v.valor) into v_fr from public.despesas_variaveis_config
     where tipo = 'frete_absorvido' and ativo and (canal_id = v.canal_id or canal_id is null) order by (canal_id is not null)::int desc limit 1;
    v_fr := round(coalesce(v_fr, 0), 2); v_fr_o := case when v_fr > 0 then 'estimado' else 'sem_regra' end;
  end if;

  -- embalagem de envio: kit do canal, senão o kit padrão; se algum item do kit não tem custo, cai no valor médio (fallback)
  select exists(select 1 from public.embalagem_envio_kit where canal_id = v.canal_id) into v_tem_kit_canal;
  v_canal_do_kit := case when v_tem_kit_canal then v.canal_id else null end;
  if v_tem_kit_canal or exists (select 1 from public.embalagem_envio_kit where canal_id is null) then
    select sum(k.quantidade_por_venda * m.custo_unitario_atual), bool_or(m.custo_unitario_atual is null)
      into v_emb, v_kit_incompleto
      from public.embalagem_envio_kit k join public.materiais_embalagem_envio m on m.id = k.embalagem_envio_id
     where k.canal_id is not distinct from v_canal_do_kit;
    if coalesce(v_kit_incompleto, false) then   -- algum item do kit sem custo: usa o valor médio até completar o cadastro
      select valor_fixo into v_emb from public.despesas_variaveis_config where tipo = 'embalagem_envio_fallback' and ativo limit 1;
      v_emb := round(coalesce(v_emb, 0), 2); v_emb_o := 'kit_incompleto';
    else v_emb := round(coalesce(v_emb, 0), 2); v_emb_o := 'kit'; end if;
  else
    select valor_fixo into v_emb from public.despesas_variaveis_config where tipo = 'embalagem_envio_fallback' and ativo limit 1;
    v_emb := round(coalesce(v_emb, 0), 2); v_emb_o := case when v_emb > 0 then 'fallback' else 'sem_regra' end;
  end if;

  select percentual * v.valor into v_perda from public.despesas_variaveis_config where tipo = 'perda_extravio' and ativo and canal_id is null limit 1;
  v_perda := round(coalesce(v_perda, 0), 2); v_perda_o := case when v_perda > 0 then 'estimado' else 'sem_regra' end;

  v_tot := round(v_taxa + v_cc + v_cp + v_fr + v_emb + v_perda, 2);
  if v_custo is not null then v_margem := round(v_receita - v_custo - v_tot, 2); v_pct := case when v_receita > 0 then round(v_margem / v_receita, 4) else null end;
  end if;

  return jsonb_build_object('venda_id', p_venda_id, 'receita_produtos', round(v_receita, 2), 'custo_produtos', round(v_custo, 2),
    'custo_completo', v_custo is not null, 'itens_sem_custo', array_to_string(v_sem, ', '),
    'taxa_pagamento', v_taxa, 'taxa_pagamento_origem', v_taxa_o, 'comissao_canal', v_cc, 'comissao_canal_origem', v_cc_o,
    'comissao_plataforma', v_cp, 'comissao_plataforma_origem', v_cp_o, 'frete_absorvido', v_fr, 'frete_absorvido_origem', v_fr_o,
    'embalagem_envio', v_emb, 'embalagem_envio_origem', v_emb_o, 'perda_extravio', v_perda, 'perda_extravio_origem', v_perda_o,
    'despesas_variaveis_total', v_tot, 'margem_real', v_margem, 'margem_pct', v_pct);
end $$;

-- Calcula e grava (upsert) a margem de uma venda.
create or replace function public.gestao_registrar_margem_venda(p_venda_id uuid)
returns jsonb
language plpgsql
as $$
declare c jsonb := public.gestao_calcular_margem_venda(p_venda_id);
begin
  insert into public.venda_margem (venda_id, receita_produtos, custo_produtos, custo_completo, itens_sem_custo,
      taxa_pagamento, taxa_pagamento_origem, comissao_canal, comissao_canal_origem, comissao_plataforma, comissao_plataforma_origem,
      frete_absorvido, frete_absorvido_origem, embalagem_envio, embalagem_envio_origem, perda_extravio, perda_extravio_origem,
      despesas_variaveis_total, margem_real, margem_pct)
  values (p_venda_id, (c->>'receita_produtos')::numeric, (c->>'custo_produtos')::numeric, (c->>'custo_completo')::boolean, nullif(c->>'itens_sem_custo', ''),
      (c->>'taxa_pagamento')::numeric, c->>'taxa_pagamento_origem', (c->>'comissao_canal')::numeric, c->>'comissao_canal_origem',
      (c->>'comissao_plataforma')::numeric, c->>'comissao_plataforma_origem', (c->>'frete_absorvido')::numeric, c->>'frete_absorvido_origem',
      (c->>'embalagem_envio')::numeric, c->>'embalagem_envio_origem', (c->>'perda_extravio')::numeric, c->>'perda_extravio_origem',
      (c->>'despesas_variaveis_total')::numeric, (c->>'margem_real')::numeric, (c->>'margem_pct')::numeric)
  on conflict (venda_id) do update set receita_produtos = excluded.receita_produtos, custo_produtos = excluded.custo_produtos,
      custo_completo = excluded.custo_completo, itens_sem_custo = excluded.itens_sem_custo,
      taxa_pagamento = excluded.taxa_pagamento, taxa_pagamento_origem = excluded.taxa_pagamento_origem,
      comissao_canal = excluded.comissao_canal, comissao_canal_origem = excluded.comissao_canal_origem,
      comissao_plataforma = excluded.comissao_plataforma, comissao_plataforma_origem = excluded.comissao_plataforma_origem,
      frete_absorvido = excluded.frete_absorvido, frete_absorvido_origem = excluded.frete_absorvido_origem,
      embalagem_envio = excluded.embalagem_envio, embalagem_envio_origem = excluded.embalagem_envio_origem,
      perda_extravio = excluded.perda_extravio, perda_extravio_origem = excluded.perda_extravio_origem,
      despesas_variaveis_total = excluded.despesas_variaveis_total, margem_real = excluded.margem_real, margem_pct = excluded.margem_pct,
      calculada_em = now();
  return c;
end $$;

create or replace function public.gestao_trigger_margem_venda()
returns trigger
language plpgsql
as $$
begin
  perform public.gestao_registrar_margem_venda(new.venda_id);
  return new;
end $$;
create trigger venda_itens_registra_margem after insert on public.venda_itens for each row execute function public.gestao_trigger_margem_venda();

-- Salva uma regra de despesa variável (cadastro/edição manual). p = { id?, tipo, canal?, forma_pagamento?, gateway?, percentual?, valor_fixo?, observacao?, ativo? }
-- canal é o NOME do canal (não o id) — mais fácil de usar na tela.
create or replace function public.gestao_salvar_despesa_variavel(p jsonb)
returns uuid
language plpgsql
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_canal uuid; v_pct numeric := nullif(p->>'percentual', '')::numeric; v_fixo numeric := nullif(p->>'valor_fixo', '')::numeric;
begin
  if nullif(btrim(coalesce(p->>'canal', '')), '') is not null then
    select id into v_canal from public.canais where lower(btrim(nome)) = lower(btrim(p->>'canal'));
    if v_canal is null then raise exception 'Canal "%" não existe.', p->>'canal'; end if;
  end if;
  if v_pct is null and v_fixo is null then raise exception 'Informe o percentual ou o valor fixo.'; end if;
  if v_pct is not null and (v_pct < 0 or v_pct > 1) then raise exception 'O percentual deve estar entre 0%% e 100%%.'; end if;
  if v_id is null then
    insert into public.despesas_variaveis_config (tipo, canal_id, forma_pagamento, gateway, percentual, valor_fixo, observacao, ativo)
    values (p->>'tipo', v_canal, nullif(btrim(coalesce(p->>'forma_pagamento', '')), ''), nullif(p->>'gateway', ''), v_pct, v_fixo, nullif(p->>'observacao', ''), coalesce((p->>'ativo')::boolean, true))
    returning id into v_id;
  else
    update public.despesas_variaveis_config set canal_id = v_canal, forma_pagamento = nullif(btrim(coalesce(p->>'forma_pagamento', '')), ''),
      gateway = nullif(p->>'gateway', ''), percentual = v_pct, valor_fixo = v_fixo, observacao = nullif(p->>'observacao', ''),
      ativo = coalesce((p->>'ativo')::boolean, ativo), atualizado_em = now()
    where id = v_id;
    if not found then raise exception 'Regra não encontrada.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.gestao_excluir_despesa_variavel(p_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.despesas_variaveis_config where id = p_id;
  if not found then raise exception 'Regra não encontrada.'; end if;
end $$;

-- Kit de embalagem de envio por canal (substitui a lista inteira daquele canal). p = { canal?, itens:[{embalagem_envio_id, quantidade}] }
-- canal ausente/vazio = kit PADRÃO (usado pelos canais sem kit próprio).
create or replace function public.gestao_salvar_kit_embalagem_envio(p jsonb)
returns int
language plpgsql
as $$
declare v_canal uuid; it jsonb; v_n int := 0;
begin
  if nullif(btrim(coalesce(p->>'canal', '')), '') is not null then
    select id into v_canal from public.canais where lower(btrim(nome)) = lower(btrim(p->>'canal'));
    if v_canal is null then raise exception 'Canal "%" não existe.', p->>'canal'; end if;
  end if;
  delete from public.embalagem_envio_kit where canal_id is not distinct from v_canal;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    if coalesce(nullif(it->>'quantidade', '')::numeric, 0) <= 0 then raise exception 'A quantidade por venda deve ser maior que zero.'; end if;
    insert into public.embalagem_envio_kit (canal_id, embalagem_envio_id, quantidade_por_venda) values (v_canal, (it->>'embalagem_envio_id')::uuid, (it->>'quantidade')::numeric);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_calcular_margem_venda', 'gestao_registrar_margem_venda',
                 'gestao_salvar_despesa_variavel', 'gestao_excluir_despesa_variavel', 'gestao_salvar_kit_embalagem_envio') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Semente inicial (estimativas editáveis; o valor REGISTRADO na venda sempre vence). Fonte: mediana do histórico de vendas.
-- ---------------------------------------------------------------------------
insert into public.despesas_variaveis_config (tipo, canal_id, forma_pagamento, percentual, observacao)
select 'taxa_pagamento', c.id, 'Cartão de crédito', 0.0498, 'estimado a partir do histórico da Feira (mediana das parcelas)' from public.canais c where lower(c.nome) = 'feira'
union all select 'taxa_pagamento', c.id, 'Cartão de débito', 0.0198, 'estimado a partir do histórico da Feira' from public.canais c where lower(c.nome) = 'feira'
union all select 'taxa_pagamento', c.id, 'Cartão de crédito', 0.0274, 'estimado a partir do histórico da Bagy' from public.canais c where lower(c.nome) = 'bagy'
union all select 'comissao_canal', c.id, null, 0.20, 'estimado a partir do histórico (Pro Horses)' from public.canais c where lower(c.nome) = 'pro horses'
union all select 'comissao_canal', c.id, null, 0.1353, 'estimado a partir do histórico (Endossa Augusta)' from public.canais c where lower(c.nome) = 'endossa augusta'
union all select 'comissao_canal', c.id, null, 0.1068, 'estimado a partir do histórico (Endossa Asa Sul)' from public.canais c where lower(c.nome) = 'endossa asa sul'
union all select 'comissao_plataforma', c.id, null, 0.01, 'estimado a partir do histórico (Bagy)' from public.canais c where lower(c.nome) = 'bagy'
on conflict do nothing;

insert into public.despesas_variaveis_config (tipo, canal_id, percentual, observacao)
values ('perda_extravio', null, 0.02, 'padrão definido pela Karine em 2026-09-21')
on conflict do nothing;

insert into public.despesas_variaveis_config (tipo, canal_id, valor_fixo, observacao)
values ('embalagem_envio_fallback', null, 8.27,
  'semente: R$ 218,30/mês (sacola R$ 194,04 + papel de seda/adesivo R$ 21,76 + etiqueta frágil R$ 2,50) ÷ média de ~26,4 vendas/mês (jan–ago/2026). Usado só enquanto o kit de embalagem por venda não estiver completo com custos reais.')
on conflict do nothing;

notify pgrst, 'reload schema';
