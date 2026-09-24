-- ============================================================================
-- Petit Sabó — Fase 12: fluxo de caixa (livro-caixa por conta bancária + saldo projetado)
--
-- Substitui as abas mensais de livro-caixa da planilha "Vendas Consolidado".
-- Cria 3 tabelas, 4 views, 7 funções e 2 triggers (em vendas e divida_pagamentos).
-- NÃO altera nenhuma coluna de tabela existente. Rollback = 99_rollback_fase12.sql.
--
-- Regras:
--   * Cada conta bancária tem o seu próprio saldo — nunca encadeia com outra conta.
--   * data_caixa = quando o dinheiro mexeu de fato (separada da data da venda).
--   * Venda (a partir de config_fluxo_caixa.vendas_geram_movimento_desde) gera uma entrada NÃO confirmada na conta
--     principal. Enquanto não confirmada, ela fica em "a receber" e NÃO entra no saldo. Ao confirmar, a Karine informa
--     a data real, a conta e o valor que de fato caiu (líquido de taxa/comissão).
--   * Pagamento de dívida (Fase 13) gera a saída na conta principal, e essa entra no saldo na hora.
--   * Custo fixo (Fase 10) só vira saída quando for lançado (botão "Lançar" no saldo projetado); até lá, é pendente.
--   * Aluguel de consignação: nada automático — só entra se passou pela conta do negócio (lançamento manual).
--   * Os triggers nunca derrubam a gravação da venda/pagamento (o CRM também grava em vendas): se algo falhar,
--     só registram um aviso no log.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1) Contas bancárias
-- ---------------------------------------------------------------------------
create table public.contas_bancarias (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null unique check (btrim(nome) <> ''),
  ativa              boolean not null default true,
  principal          boolean not null default false,   -- recebe as vendas novas e a projeção de custos fixos/dívida
  data_abertura      date not null,
  data_encerramento  date,
  observacao         text,
  criado_em          timestamptz not null default now(),
  constraint contas_bancarias_ativa_sem_encerramento check (ativa = (data_encerramento is null)),
  constraint contas_bancarias_datas check (data_encerramento is null or data_encerramento >= data_abertura),
  constraint contas_bancarias_principal_ativa check (not principal or ativa)
);
create unique index contas_bancarias_uma_principal on public.contas_bancarias (principal) where principal;

insert into public.contas_bancarias (nome, ativa, principal, data_abertura, data_encerramento, observacao) values
  ('Banco Inter', false, false, '2026-01-01', '2026-06-30', 'Conta do negócio de jan a jun/2026 (encerrada).'),
  ('Conta C6', true, true, '2026-07-01', null, 'Conta do negócio desde jul/2026 (começou do zero).'),
  ('Nubank PJ Berenice', true, false, '2026-01-01', null, 'Conta PJ compartilhada com a Berenice (parceira).');

-- ---------------------------------------------------------------------------
-- 2) Livro-caixa
-- ---------------------------------------------------------------------------
create table public.fluxo_caixa_movimentos (
  id                  uuid primary key default gen_random_uuid(),
  seq                 bigint generated always as identity,          -- desempate da ordem dentro do mesmo dia
  conta_bancaria_id   uuid not null references public.contas_bancarias (id) on delete restrict,
  data_caixa          date not null,
  descricao           text not null check (btrim(descricao) <> ''),
  categoria           text not null check (btrim(categoria) <> ''),
  entrada             numeric(12,2) not null default 0 check (entrada >= 0),
  saida               numeric(12,2) not null default 0 check (saida >= 0),
  origem_tipo         text not null default 'manual'
                      check (origem_tipo in ('venda', 'despesa_operacional', 'divida_pagamento', 'investimento', 'manual')),
  origem_id           uuid,                                          -- vendas.id / custos_fixos.id / divida_pagamentos.id
  confirmado_extrato  boolean not null default false,
  saldo_real_banco    numeric(12,2),
  observacao          text,
  criado_por          uuid default auth.uid(),
  criado_em           timestamptz not null default now(),
  constraint fluxo_caixa_entrada_ou_saida check ((entrada > 0) <> (saida > 0)),
  constraint fluxo_caixa_origem_coerente
    check ((origem_tipo in ('venda', 'despesa_operacional', 'divida_pagamento')) = (origem_id is not null))
);
create unique index fluxo_caixa_um_por_origem on public.fluxo_caixa_movimentos (origem_tipo, origem_id)
  where origem_tipo in ('venda', 'divida_pagamento');
create index fluxo_caixa_conta_data_idx on public.fluxo_caixa_movimentos (conta_bancaria_id, data_caixa, seq);
create index fluxo_caixa_origem_idx on public.fluxo_caixa_movimentos (origem_id);

-- ---------------------------------------------------------------------------
-- 3) Configuração (linha única): a partir de quando vendas e pagamentos de dívida geram lançamento sozinhos.
--    Antes disso, o histórico vem da planilha (importação local, fora do GitHub).
-- ---------------------------------------------------------------------------
create table public.config_fluxo_caixa (
  id                            smallint primary key default 1 check (id = 1),
  vendas_geram_movimento_desde  date not null default '2026-09-01',
  atualizado_em                 timestamptz not null default now()
);
insert into public.config_fluxo_caixa (id) values (1);

do $$
declare t text;
begin
  foreach t in array array['contas_bancarias', 'fluxo_caixa_movimentos', 'config_fluxo_caixa'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Views
-- ---------------------------------------------------------------------------
-- Venda ainda não confirmada = "a receber": fica fora do saldo até a Karine confirmar que o dinheiro caiu.
create view public.fluxo_caixa_extrato with (security_invoker = true) as
select x.*,
       case when x.saldo_real_banco is not null then round(x.saldo_real_banco - x.saldo_acumulado, 2) end as diferenca_extrato
  from (
    select m.*, c.nome as conta_nome,
           not (m.origem_tipo = 'venda' and not m.confirmado_extrato) as entra_no_saldo,
           sum(case when m.origem_tipo = 'venda' and not m.confirmado_extrato then 0 else m.entrada - m.saida end)
             over (partition by m.conta_bancaria_id order by m.data_caixa, m.seq
                   rows between unbounded preceding and current row) as saldo_acumulado
      from public.fluxo_caixa_movimentos m
      join public.contas_bancarias c on c.id = m.conta_bancaria_id
  ) x;

-- Resumo por conta e mês — o mesmo formato do "Resumo Anual" da planilha, para conferir mês a mês.
create view public.fluxo_caixa_resumo_mensal with (security_invoker = true) as
with base as (
  select m.conta_bancaria_id, date_trunc('month', m.data_caixa)::date as mes,
         coalesce(sum(m.entrada) filter (where not (m.origem_tipo = 'venda' and not m.confirmado_extrato)), 0) as entradas,
         coalesce(sum(m.saida), 0)                                                                            as saidas,
         coalesce(sum(m.entrada) filter (where m.origem_tipo = 'venda' and not m.confirmado_extrato), 0)       as a_receber,
         count(*)::int                                                                                        as lancamentos
    from public.fluxo_caixa_movimentos m
   group by 1, 2
)
select b.conta_bancaria_id, c.nome as conta_nome, b.mes, b.lancamentos,
       round(sum(b.entradas - b.saidas) over w - (b.entradas - b.saidas), 2) as saldo_inicial,
       round(b.entradas, 2) as entradas, round(b.saidas, 2) as saidas,
       round(b.entradas - b.saidas, 2) as resultado,
       round(sum(b.entradas - b.saidas) over w, 2) as saldo_final,
       round(b.a_receber, 2) as a_receber
  from base b join public.contas_bancarias c on c.id = b.conta_bancaria_id
window w as (partition by b.conta_bancaria_id order by b.mes rows between unbounded preceding and current row);

-- Saldo projetado: uma linha por conta ATIVA e mês (do primeiro lançamento/abertura até o mês atual).
--   saldo_projetado = saldo_fim_mes + a_receber − custos_fixos_pendentes − ataque_divida_pendente
--   Custos fixos e ataque de dívida só na conta principal (senão seriam contados duas vezes).
create view public.saldo_caixa_projetado with (security_invoker = true) as
with meses as (
  select c.id as conta_bancaria_id, c.nome as conta_nome, c.principal,
         generate_series(
           date_trunc('month', least(c.data_abertura,
             coalesce((select min(m.data_caixa) from public.fluxo_caixa_movimentos m where m.conta_bancaria_id = c.id), c.data_abertura)))::date,
           greatest(date_trunc('month', public.hoje_brt())::date,
             coalesce((select date_trunc('month', max(m.data_caixa))::date from public.fluxo_caixa_movimentos m where m.conta_bancaria_id = c.id),
                      date_trunc('month', public.hoje_brt())::date)),
           interval '1 month')::date as mes
    from public.contas_bancarias c
   where c.ativa
),
calc as (
  select ms.*,
         coalesce((select sum(m.entrada - m.saida) from public.fluxo_caixa_movimentos m
                    where m.conta_bancaria_id = ms.conta_bancaria_id and m.data_caixa < (ms.mes + interval '1 month')
                      and not (m.origem_tipo = 'venda' and not m.confirmado_extrato)), 0) as saldo_fim_mes,
         coalesce((select sum(m.entrada) from public.fluxo_caixa_movimentos m
                    where m.conta_bancaria_id = ms.conta_bancaria_id and m.data_caixa < (ms.mes + interval '1 month')
                      and m.origem_tipo = 'venda' and not m.confirmado_extrato), 0) as a_receber,
         case when ms.principal then
           coalesce((select sum(cf.valor_mensal) from public.custos_fixos cf
                      where cf.vigente_desde <= ms.mes and (cf.vigente_ate is null or cf.vigente_ate >= ms.mes)
                        and not exists (select 1 from public.fluxo_caixa_movimentos m
                                         where m.origem_tipo = 'despesa_operacional' and m.origem_id = cf.id
                                           and m.data_caixa >= ms.mes and m.data_caixa < (ms.mes + interval '1 month'))), 0)
         else 0 end as custos_fixos_pendentes,
         case when ms.principal then
           coalesce((select sum(greatest(a.diferenca, 0)) from public.divida_ataque_mensal a where a.mes = ms.mes), 0)
         else 0 end as ataque_divida_pendente
    from meses ms
)
select conta_bancaria_id, conta_nome, principal, mes,
       round(saldo_fim_mes, 2) as saldo_fim_mes, round(a_receber, 2) as a_receber,
       round(custos_fixos_pendentes, 2) as custos_fixos_pendentes, round(ataque_divida_pendente, 2) as ataque_divida_pendente,
       round(saldo_fim_mes + a_receber - custos_fixos_pendentes - ataque_divida_pendente, 2) as saldo_projetado
  from calc;

-- Sugestão de categoria: a lista base + as já usadas, das mais usadas para as menos usadas.
create view public.fluxo_caixa_categorias with (security_invoker = true) as
select categoria, sum(usos)::int as usos
  from (select categoria, count(*) as usos from public.fluxo_caixa_movimentos group by categoria
        union all
        select unnest(array['Venda Feira', 'Venda WhatsApp', 'Venda Consignação', 'Venda Site', 'Taxa Financeira', 'Frete',
                            'Dívida/Insumos', 'Aluguel Consignação', 'Investimento CDB', 'Fornecedores/Serviços',
                            'Empréstimo Recebido', 'Despesa Diversa', 'Pagamento de Dívida', 'Custo Fixo']), 0) s
 group by categoria;

revoke all on public.fluxo_caixa_extrato, public.fluxo_caixa_resumo_mensal, public.saldo_caixa_projetado,
              public.fluxo_caixa_categorias from anon;

-- ---------------------------------------------------------------------------
-- 5) Sincronização automática com vendas e pagamentos de dívida
-- ---------------------------------------------------------------------------
-- Cria/atualiza/remove o lançamento de uma venda. Lançamento já confirmado nunca é mexido (o dinheiro já foi
-- conferido); se a venda for excluída depois de confirmada, o lançamento fica como manual, com aviso na descrição.
create or replace function public.fluxo_caixa_sincronizar_venda(p_venda_id uuid)
returns void
language plpgsql
as $$
declare
  v record; m record; v_corte date; v_conta uuid; v_cat text; v_desc text;
begin
  select ve.id, ve.valor, ve.data_venda, ve.pedido_externo, ca.nome as canal_nome, ca.tipo as canal_tipo
    into v from public.vendas ve left join public.canais ca on ca.id = ve.canal_id where ve.id = p_venda_id;
  select id, confirmado_extrato into m from public.fluxo_caixa_movimentos where origem_tipo = 'venda' and origem_id = p_venda_id;

  if v.id is null then                                    -- a venda foi excluída
    if m.id is not null then
      if m.confirmado_extrato then
        update public.fluxo_caixa_movimentos set origem_tipo = 'manual', origem_id = null, descricao = descricao || ' (venda excluída)'
         where id = m.id;
      else
        delete from public.fluxo_caixa_movimentos where id = m.id;
      end if;
    end if;
    return;
  end if;
  if m.id is not null and m.confirmado_extrato then return; end if;

  select vendas_geram_movimento_desde into v_corte from public.config_fluxo_caixa where id = 1;
  if v_corte is null or v.data_venda < v_corte or coalesce(v.valor, 0) <= 0 then
    if m.id is not null then delete from public.fluxo_caixa_movimentos where id = m.id; end if;
    return;
  end if;

  v_cat := case when v.canal_tipo = 'fisico' then 'Venda Feira'
                when v.canal_tipo = 'consignacao' then 'Venda Consignação'
                when v.canal_nome ilike '%bagy%' or v.canal_nome ilike 'site%' then 'Venda Site'
                else 'Venda ' || coalesce(v.canal_nome, 'sem canal') end;
  v_desc := 'Venda ' || coalesce(v.canal_nome, 'sem canal') || coalesce(' — ' || v.pedido_externo, '')
            || ' (' || to_char(v.data_venda, 'DD/MM/YYYY') || ')';

  if m.id is null then
    select id into v_conta from public.contas_bancarias where principal;
    if v_conta is null then return; end if;
    insert into public.fluxo_caixa_movimentos (conta_bancaria_id, data_caixa, descricao, categoria, entrada, origem_tipo, origem_id)
    values (v_conta, v.data_venda, v_desc, v_cat, v.valor, 'venda', v.id);
  else
    update public.fluxo_caixa_movimentos set data_caixa = v.data_venda, entrada = v.valor, categoria = v_cat, descricao = v_desc
     where id = m.id;
  end if;
end $$;

create or replace function public.fluxo_caixa_sincronizar_divida_pagamento(p_pagamento_id uuid)
returns void
language plpgsql
as $$
declare
  p record; m record; v_corte date; v_conta uuid; v_desc text;
begin
  select dp.id, dp.valor, dp.data_pagamento, d.nome as divida_nome
    into p from public.divida_pagamentos dp join public.dividas d on d.id = dp.divida_id where dp.id = p_pagamento_id;
  select id, confirmado_extrato into m from public.fluxo_caixa_movimentos where origem_tipo = 'divida_pagamento' and origem_id = p_pagamento_id;

  if p.id is null then                                    -- o pagamento foi excluído
    if m.id is not null then
      if m.confirmado_extrato then
        update public.fluxo_caixa_movimentos set origem_tipo = 'manual', origem_id = null, descricao = descricao || ' (pagamento excluído)'
         where id = m.id;
      else
        delete from public.fluxo_caixa_movimentos where id = m.id;
      end if;
    end if;
    return;
  end if;
  if m.id is not null and m.confirmado_extrato then return; end if;

  select vendas_geram_movimento_desde into v_corte from public.config_fluxo_caixa where id = 1;
  if v_corte is null or p.data_pagamento < v_corte then
    if m.id is not null then delete from public.fluxo_caixa_movimentos where id = m.id; end if;
    return;
  end if;
  v_desc := 'Pagamento ' || p.divida_nome;

  if m.id is null then
    select id into v_conta from public.contas_bancarias where principal;
    if v_conta is null then return; end if;
    insert into public.fluxo_caixa_movimentos (conta_bancaria_id, data_caixa, descricao, categoria, saida, origem_tipo, origem_id)
    values (v_conta, p.data_pagamento, v_desc, 'Pagamento de Dívida', p.valor, 'divida_pagamento', p.id);
  else
    update public.fluxo_caixa_movimentos set data_caixa = p.data_pagamento, saida = p.valor, descricao = v_desc where id = m.id;
  end if;
end $$;

create or replace function public.fluxo_caixa_trigger_venda()
returns trigger
language plpgsql
as $$
begin
  begin
    perform public.fluxo_caixa_sincronizar_venda(case when tg_op = 'DELETE' then old.id else new.id end);
  exception when others then
    raise warning 'Fluxo de caixa: não sincronizou a venda % (%)', case when tg_op = 'DELETE' then old.id else new.id end, sqlerrm;
  end;
  return null;
end $$;

create or replace function public.fluxo_caixa_trigger_divida_pagamento()
returns trigger
language plpgsql
as $$
begin
  begin
    perform public.fluxo_caixa_sincronizar_divida_pagamento(case when tg_op = 'DELETE' then old.id else new.id end);
  exception when others then
    raise warning 'Fluxo de caixa: não sincronizou o pagamento de dívida % (%)', case when tg_op = 'DELETE' then old.id else new.id end, sqlerrm;
  end;
  return null;
end $$;

create trigger vendas_fluxo_caixa
  after insert or update of valor, data_venda, canal_id or delete on public.vendas
  for each row execute function public.fluxo_caixa_trigger_venda();
create trigger divida_pagamentos_fluxo_caixa
  after insert or update of valor, data_pagamento, divida_id or delete on public.divida_pagamentos
  for each row execute function public.fluxo_caixa_trigger_divida_pagamento();

-- ---------------------------------------------------------------------------
-- 6) Funções da tela
-- ---------------------------------------------------------------------------
-- p = { id?, nome, data_abertura, data_encerramento?, principal?, observacao? }  (encerrada = tem data de encerramento)
create or replace function public.gestao_salvar_conta_bancaria(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid; v_enc date := nullif(p->>'data_encerramento', '')::date;
  v_principal boolean := coalesce((p->>'principal')::boolean, false);
begin
  if nullif(btrim(coalesce(p->>'nome', '')), '') is null then raise exception 'Informe o nome da conta.'; end if;
  if nullif(p->>'data_abertura', '') is null then raise exception 'Informe a data de abertura da conta.'; end if;
  if v_principal and v_enc is not null then raise exception 'A conta principal não pode estar encerrada. Escolha outra conta como principal antes.'; end if;
  if v_enc is not null and v_enc < (p->>'data_abertura')::date then raise exception 'O encerramento não pode ser antes da abertura.'; end if;
  if v_id is not null and v_enc is not null and exists (select 1 from public.contas_bancarias where id = v_id and principal) then
    raise exception 'A conta principal não pode ser encerrada. Escolha outra conta como principal antes.';
  end if;
  if v_principal then update public.contas_bancarias set principal = false where principal and id is distinct from v_id; end if;
  if v_id is null then
    insert into public.contas_bancarias (nome, ativa, principal, data_abertura, data_encerramento, observacao)
    values (btrim(p->>'nome'), v_enc is null, v_principal, (p->>'data_abertura')::date, v_enc, nullif(btrim(coalesce(p->>'observacao', '')), ''))
    returning id into v_id;
  else
    update public.contas_bancarias set nome = btrim(p->>'nome'), ativa = v_enc is null,
           principal = case when v_principal then true else principal end,
           data_abertura = (p->>'data_abertura')::date, data_encerramento = v_enc, observacao = nullif(btrim(coalesce(p->>'observacao', '')), '')
     where id = v_id;
    if not found then raise exception 'Conta não encontrada.'; end if;
  end if;
  return v_id;
end $$;

-- Novo lançamento manual, ou edição de qualquer lançamento.
-- p = { id?, conta_bancaria_id, data_caixa, descricao, categoria, tipo ('entrada'|'saida'), valor, investimento?,
--       confirmado_extrato?, saldo_real_banco?, observacao? }
-- Lançamento ligado a venda/dívida/custo fixo: dá para mudar conta, data, valor, descrição, categoria e a conferência,
-- mas não a origem nem o sentido (entrada/saída).
create or replace function public.gestao_salvar_movimento_caixa(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid; v_valor numeric := nullif(p->>'valor', '')::numeric; v_tipo text := p->>'tipo';
  v_atual public.fluxo_caixa_movimentos%rowtype;
begin
  if nullif(p->>'conta_bancaria_id', '') is null or not exists (select 1 from public.contas_bancarias where id = (p->>'conta_bancaria_id')::uuid) then
    raise exception 'Escolha a conta bancária.';
  end if;
  if nullif(p->>'data_caixa', '') is null then raise exception 'Informe a data em que o dinheiro mexeu.'; end if;
  if nullif(btrim(coalesce(p->>'descricao', '')), '') is null then raise exception 'Informe a descrição.'; end if;
  if nullif(btrim(coalesce(p->>'categoria', '')), '') is null then raise exception 'Informe a categoria.'; end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;

  if v_id is null then
    if coalesce(v_tipo, '') not in ('entrada', 'saida') then raise exception 'Escolha se é entrada ou saída.'; end if;
    insert into public.fluxo_caixa_movimentos (conta_bancaria_id, data_caixa, descricao, categoria, entrada, saida, origem_tipo,
                                                confirmado_extrato, saldo_real_banco, observacao)
    values ((p->>'conta_bancaria_id')::uuid, (p->>'data_caixa')::date, btrim(p->>'descricao'), btrim(p->>'categoria'),
            case when v_tipo = 'entrada' then v_valor else 0 end, case when v_tipo = 'saida' then v_valor else 0 end,
            case when coalesce((p->>'investimento')::boolean, false) then 'investimento' else 'manual' end,
            coalesce((p->>'confirmado_extrato')::boolean, false), nullif(p->>'saldo_real_banco', '')::numeric,
            nullif(btrim(coalesce(p->>'observacao', '')), ''))
    returning id into v_id;
  else
    select * into v_atual from public.fluxo_caixa_movimentos where id = v_id;
    if v_atual.id is null then raise exception 'Lançamento não encontrado.'; end if;
    update public.fluxo_caixa_movimentos set
           conta_bancaria_id = (p->>'conta_bancaria_id')::uuid, data_caixa = (p->>'data_caixa')::date,
           descricao = btrim(p->>'descricao'), categoria = btrim(p->>'categoria'),
           entrada = case when v_atual.entrada > 0 then v_valor else 0 end, saida = case when v_atual.saida > 0 then v_valor else 0 end,
           origem_tipo = case when v_atual.origem_tipo in ('manual', 'investimento')
                              then case when coalesce((p->>'investimento')::boolean, false) then 'investimento' else 'manual' end
                              else v_atual.origem_tipo end,
           confirmado_extrato = coalesce((p->>'confirmado_extrato')::boolean, v_atual.confirmado_extrato),
           saldo_real_banco = nullif(p->>'saldo_real_banco', '')::numeric,
           observacao = nullif(btrim(coalesce(p->>'observacao', '')), '')
     where id = v_id;
  end if;
  return v_id;
end $$;

-- Confirma de uma vez vários lançamentos (ex.: acerto mensal da consignação que cobre várias vendas).
-- p = { ids: [...], data_caixa, conta_bancaria_id }  — os valores de cada lançamento ficam como estão.
create or replace function public.gestao_confirmar_movimentos_caixa(p jsonb)
returns int
language plpgsql
as $$
declare v_n int;
begin
  if jsonb_array_length(coalesce(p->'ids', '[]'::jsonb)) = 0 then raise exception 'Selecione pelo menos um lançamento.'; end if;
  if nullif(p->>'data_caixa', '') is null then raise exception 'Informe a data em que o dinheiro caiu.'; end if;
  if nullif(p->>'conta_bancaria_id', '') is null or not exists (select 1 from public.contas_bancarias where id = (p->>'conta_bancaria_id')::uuid) then
    raise exception 'Escolha a conta em que o dinheiro caiu.';
  end if;
  update public.fluxo_caixa_movimentos
     set confirmado_extrato = true, data_caixa = (p->>'data_caixa')::date, conta_bancaria_id = (p->>'conta_bancaria_id')::uuid
   where id in (select (jsonb_array_elements_text(p->'ids'))::uuid);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Lança um custo fixo do mês como saída (liga ao custo, e por isso ele sai dos pendentes).
-- p = { custo_fixo_id, mes, data_caixa?, conta_bancaria_id?, valor? }  (sem conta = principal; sem valor = valor do mês)
create or replace function public.gestao_lancar_custo_fixo(p jsonb)
returns uuid
language plpgsql
as $$
declare
  c public.custos_fixos%rowtype; v_mes date := date_trunc('month', nullif(p->>'mes', '')::date)::date;
  v_conta uuid := nullif(p->>'conta_bancaria_id', '')::uuid; v_data date; v_valor numeric; v_id uuid;
begin
  select * into c from public.custos_fixos where id = nullif(p->>'custo_fixo_id', '')::uuid;
  if c.id is null then raise exception 'Custo fixo não encontrado.'; end if;
  if v_mes is null then raise exception 'Informe o mês.'; end if;
  if not (c.vigente_desde <= v_mes and (c.vigente_ate is null or c.vigente_ate >= v_mes)) then
    raise exception 'Esse custo fixo não está vigente em %.', to_char(v_mes, 'MM/YYYY');
  end if;
  if exists (select 1 from public.fluxo_caixa_movimentos where origem_tipo = 'despesa_operacional' and origem_id = c.id
               and data_caixa >= v_mes and data_caixa < (v_mes + interval '1 month')) then
    raise exception 'O custo "%" já foi lançado em %.', c.nome, to_char(v_mes, 'MM/YYYY');
  end if;
  v_data := coalesce(nullif(p->>'data_caixa', '')::date, least(public.hoje_brt(), (v_mes + interval '1 month' - interval '1 day')::date));
  if v_data < v_mes or v_data >= (v_mes + interval '1 month') then raise exception 'A data precisa estar dentro de %.', to_char(v_mes, 'MM/YYYY'); end if;
  if v_conta is null then select id into v_conta from public.contas_bancarias where principal; end if;
  if v_conta is null then raise exception 'Nenhuma conta principal definida.'; end if;
  v_valor := coalesce(nullif(p->>'valor', '')::numeric, c.valor_mensal);
  if v_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  insert into public.fluxo_caixa_movimentos (conta_bancaria_id, data_caixa, descricao, categoria, saida, origem_tipo, origem_id)
  values (v_conta, v_data, c.nome, 'Custo Fixo', v_valor, 'despesa_operacional', c.id)
  returning id into v_id;
  return v_id;
end $$;

-- Lançamento ligado a venda ou pagamento de dívida não se apaga aqui: apaga-se a venda/o pagamento na tela dele.
create or replace function public.gestao_excluir_movimento_caixa(p_id uuid)
returns void
language plpgsql
as $$
declare v_origem text;
begin
  select origem_tipo into v_origem from public.fluxo_caixa_movimentos where id = p_id;
  if v_origem is null then raise exception 'Lançamento não encontrado.'; end if;
  if v_origem = 'venda' then raise exception 'Este lançamento é de uma venda: para tirá-lo, exclua a venda no Histórico.'; end if;
  if v_origem = 'divida_pagamento' then raise exception 'Este lançamento é de um pagamento de dívida: para tirá-lo, exclua o pagamento na tela Dívidas.'; end if;
  delete from public.fluxo_caixa_movimentos where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Vendas e pagamentos de dívida a partir do corte que já existem viram lançamentos "a confirmar"
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.vendas where data_venda >= (select vendas_geram_movimento_desde from public.config_fluxo_caixa) loop
    perform public.fluxo_caixa_sincronizar_venda(r.id);
  end loop;
  for r in select id from public.divida_pagamentos where data_pagamento >= (select vendas_geram_movimento_desde from public.config_fluxo_caixa) loop
    perform public.fluxo_caixa_sincronizar_divida_pagamento(r.id);
  end loop;
end $$;

commit;
