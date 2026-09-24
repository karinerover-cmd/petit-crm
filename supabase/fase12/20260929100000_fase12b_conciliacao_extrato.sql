-- ============================================================================
-- Petit Sabó — Fase 12b: conciliação mensal pelo extrato bancário
--
-- Rotina: a Karine baixa os extratos em PDF (C6, Nubank PJ); o script local gerar_conciliacao.js lê cada PDF,
-- confere o saldo linha a linha com o que o banco imprime e gera um SQL que só chama gestao_importar_extrato().
-- Aqui dentro do banco (onde estão as vendas "a receber" e os lançamentos) sai a proposta de pareamento, que ela
-- revisa e aprova na aba "Conciliação". O valor e a data que ficam são sempre os do banco.
--
-- Histórico até agosto/2026 continua sendo o da planilha (decisão dela): o espelho do banco vale a partir de
-- config_fluxo_caixa.extrato_espelho_desde; a primeira importação de cada conta mostra a diferença de abertura
-- (saldo do banco x saldo do sistema) com um botão para lançar o ajuste.
--
-- Cria 3 tabelas, 3 views e 3 funções; acrescenta 1 coluna em config_fluxo_caixa. Rollback: 99_rollback_fase12b.sql.
-- ============================================================================
begin;

alter table public.config_fluxo_caixa add column extrato_espelho_desde date not null default '2026-09-01';

-- ---------------------------------------------------------------------------
-- 1) Importações (um PDF de uma conta) e as linhas do extrato
-- ---------------------------------------------------------------------------
create table public.extrato_importacoes (
  id                 uuid primary key default gen_random_uuid(),
  conta_bancaria_id  uuid not null references public.contas_bancarias (id) on delete restrict,
  periodo_inicio     date not null,
  periodo_fim        date not null,
  saldo_abertura     numeric(12,2) not null,     -- saldo do banco no começo do período (antes da 1ª linha)
  saldo_final        numeric(12,2) not null,     -- saldo do banco no fim do período
  arquivo            text,
  linhas_novas       int not null default 0,
  linhas_repetidas   int not null default 0,
  importado_em       timestamptz not null default now(),
  criado_por         uuid default auth.uid(),
  constraint extrato_importacoes_periodo check (periodo_fim >= periodo_inicio)
);

create table public.extrato_linhas (
  id                 uuid primary key default gen_random_uuid(),
  importacao_id      uuid not null references public.extrato_importacoes (id) on delete cascade,
  conta_bancaria_id  uuid not null references public.contas_bancarias (id) on delete restrict,
  data               date not null,
  descricao          text not null check (btrim(descricao) <> ''),
  valor              numeric(12,2) not null check (valor <> 0),     -- + entrada / − saída, como no banco
  saldo_banco        numeric(12,2),                                  -- saldo do banco no fim do dia (só na última linha do dia)
  ref                text not null,                                  -- "impressão digital" da linha (conta, data, valor, descrição, ordem)
  status             text not null default 'pendente' check (status in ('pendente', 'conciliada', 'ignorada')),
  movimento_id       uuid references public.fluxo_caixa_movimentos (id) on delete set null,
  conciliada_em      timestamptz,
  constraint extrato_linhas_unica unique (conta_bancaria_id, ref)   -- importar o mesmo extrato duas vezes não duplica
);
create index extrato_linhas_conta_data_idx on public.extrato_linhas (conta_bancaria_id, data);
create index extrato_linhas_movimento_idx on public.extrato_linhas (movimento_id);

-- ---------------------------------------------------------------------------
-- 2) Regras de categoria: "descrição contém X" → categoria (e, opcionalmente, o custo fixo que esse pagamento quita)
-- ---------------------------------------------------------------------------
create table public.extrato_regras_categoria (
  id                 uuid primary key default gen_random_uuid(),
  padrao             text not null check (btrim(padrao) <> ''),
  sentido            text not null default 'ambos' check (sentido in ('entrada', 'saida', 'ambos')),
  conta_bancaria_id  uuid references public.contas_bancarias (id) on delete cascade,   -- nulo = qualquer conta
  categoria          text not null check (btrim(categoria) <> ''),
  custo_fixo_nome    text,                                           -- liga ao custo fixo vigente com esse nome
  prioridade         int not null default 100,                       -- menor = vale primeiro
  criado_em          timestamptz not null default now()
);

-- Regras genéricas. As regras com nomes de pessoas (sócias/parceira) ficam em 02b_regras_locais_extrato.sql, fora do GitHub.
insert into public.extrato_regras_categoria (padrao, sentido, conta_bancaria_id, categoria, custo_fixo_nome, prioridade)
select r.padrao, r.sentido, (select id from public.contas_bancarias where nome = r.conta), r.categoria, r.custo_fixo, r.prioridade
  from (values
    ('VINDI',                'saida',   null,                 'Taxa Financeira',            null,     100),
    ('YAPAY',                'saida',   null,                 'Taxa Financeira',            null,     100),
    ('YAPAY',                'entrada', null,                 'Venda Cartão (Yapay)',       null,     100),
    ('CDB',                  'ambos',   null,                 'Investimento CDB',           null,     100),
    ('PRO HORSES',           'entrada', null,                 'Venda Consignação',          null,     100),
    ('ENDOSSA',              'entrada', null,                 'Venda Consignação',          null,     100),
    ('HUBLA',                'saida',   null,                 'Curso/Conteúdo',             null,     100),
    ('MELHOR ENVIO',         'saida',   null,                 'Frete',                      null,     100),
    ('Marketplace',          'saida',   null,                 'Despesa Diversa',            null,     100),
    ('Rendimento',           'entrada', null,                 'Rendimento da conta',        null,     100)
  ) r(padrao, sentido, conta, categoria, custo_fixo, prioridade);

do $$
declare t text;
begin
  foreach t in array array['extrato_importacoes', 'extrato_linhas', 'extrato_regras_categoria'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy authenticated_full_access on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Views
-- ---------------------------------------------------------------------------
-- Proposta de pareamento para cada linha ainda não conciliada:
--   1º transferência entre as suas contas: a outra ponta em OUTRA conta, sinal oposto, mesmo valor, até 3 dias
--   2º entrada = venda "a receber" de mesmo valor, até 60 dias antes (a mais próxima)
--      saída  = lançamento ainda não conferido da mesma conta, mesmo valor, até 5 dias (dívida, custo fixo, manual)
--   3º senão, lançar como novo, com a categoria da 1ª regra que casar
-- Cada lançamento vai para uma linha só (a mais próxima na data).
create view public.extrato_conciliacao_proposta with (security_invoker = true) as
with pend as (
  select l.* from public.extrato_linhas l
   where l.status = 'pendente' or (l.status = 'conciliada' and l.movimento_id is null)
),
cand_transf as (
  select a.id as linha_id, b.id as par_id, abs(a.data - b.data) as dist
    from pend a join pend b on b.conta_bancaria_id <> a.conta_bancaria_id and b.valor = -a.valor and abs(a.data - b.data) <= 3
),
melhor_transf as (
  select * from (select c.*, row_number() over (partition by linha_id order by dist, par_id) as rl,
                        row_number() over (partition by par_id order by dist, linha_id) as rp from cand_transf c) x
   where rl = 1 and rp = 1
),
cand_mov as (
  select l.id as linha_id, m.id as movimento_id, abs(l.data - m.data_caixa) as dist
    from pend l
    join public.fluxo_caixa_movimentos m on not m.confirmado_extrato
     and not exists (select 1 from public.extrato_linhas x where x.movimento_id = m.id)
     and ((l.valor > 0 and m.origem_tipo = 'venda' and m.entrada = l.valor and m.data_caixa between l.data - 60 and l.data)
       or (l.valor < 0 and m.origem_tipo <> 'venda' and m.saida = -l.valor and m.conta_bancaria_id = l.conta_bancaria_id
           and abs(m.data_caixa - l.data) <= 5))
   where not exists (select 1 from melhor_transf t where t.linha_id = l.id)
),
melhor_mov as (
  select * from (select c.*, row_number() over (partition by linha_id order by dist, movimento_id) as rl,
                        row_number() over (partition by movimento_id order by dist, linha_id) as rm from cand_mov c) x
   where rl = 1 and rm = 1
),
regra as (
  select distinct on (l.id) l.id as linha_id, r.categoria, r.custo_fixo_nome
    from pend l
    join public.extrato_regras_categoria r
      on l.descricao ilike '%' || r.padrao || '%'
     and (r.conta_bancaria_id is null or r.conta_bancaria_id = l.conta_bancaria_id)
     and (r.sentido = 'ambos' or (r.sentido = 'entrada') = (l.valor > 0))
   order by l.id, r.prioridade, length(r.padrao) desc
)
select l.id as linha_id, l.importacao_id, l.conta_bancaria_id, c.nome as conta_nome, l.data, l.descricao, l.valor, l.saldo_banco,
       case when t.par_id is not null then 'transferencia' when mm.movimento_id is not null then 'confirmar' else 'novo' end as acao_sugerida,
       t.par_id as par_linha_id, pc.nome as par_conta_nome,
       mm.movimento_id, m.descricao as movimento_descricao, m.data_caixa as movimento_data, m.origem_tipo as movimento_origem,
       case when t.par_id is not null then 'Transferência entre contas' when mm.movimento_id is not null then m.categoria else g.categoria end as categoria_sugerida,
       cf.id as custo_fixo_id, cf.nome as custo_fixo_nome
  from pend l
  join public.contas_bancarias c on c.id = l.conta_bancaria_id
  left join melhor_transf t on t.linha_id = l.id
  left join pend p2 on p2.id = t.par_id
  left join public.contas_bancarias pc on pc.id = p2.conta_bancaria_id
  left join melhor_mov mm on mm.linha_id = l.id
  left join public.fluxo_caixa_movimentos m on m.id = mm.movimento_id
  left join regra g on g.linha_id = l.id
  left join lateral (
    select cf.id, cf.nome from public.custos_fixos cf
     where t.par_id is null and mm.movimento_id is null and g.custo_fixo_nome is not null and lower(cf.nome) = lower(g.custo_fixo_nome)
       and cf.vigente_desde <= date_trunc('month', l.data)::date
       and (cf.vigente_ate is null or cf.vigente_ate >= date_trunc('month', l.data)::date)
     order by cf.vigente_desde desc limit 1
  ) cf on true;

-- Saldo do sistema x saldo do banco, no fim de cada dia que aparece no extrato.
create view public.extrato_saldo_diario with (security_invoker = true) as
select x.*, round(x.saldo_banco - x.saldo_sistema, 2) as diferenca
  from (
    select l.conta_bancaria_id, c.nome as conta_nome, l.data, l.saldo_banco,
           coalesce((select sum(m.entrada - m.saida) from public.fluxo_caixa_movimentos m
                      where m.conta_bancaria_id = l.conta_bancaria_id and m.data_caixa <= l.data
                        and not (m.origem_tipo = 'venda' and not m.confirmado_extrato)), 0) as saldo_sistema,
           (select count(*) from public.extrato_linhas p
             where p.conta_bancaria_id = l.conta_bancaria_id and p.data = l.data
               and (p.status = 'pendente' or (p.status = 'conciliada' and p.movimento_id is null)))::int as linhas_pendentes
      from public.extrato_linhas l join public.contas_bancarias c on c.id = l.conta_bancaria_id
     where l.saldo_banco is not null
  ) x;

-- Cada importação com a diferença de abertura: saldo do banco no começo do período x saldo do sistema na véspera
-- (mais os ajustes de conciliação já lançados no 1º dia do período). Diferente de zero = falta lançar o ajuste
-- (1ª importação da conta) ou ficou um buraco entre um extrato e outro.
create view public.extrato_importacoes_resumo with (security_invoker = true) as
select x.*, round(x.saldo_abertura - x.saldo_sistema_abertura, 2) as diferenca_abertura
  from (
    select i.*, c.nome as conta_nome,
           coalesce((select sum(m.entrada - m.saida) from public.fluxo_caixa_movimentos m
                      where m.conta_bancaria_id = i.conta_bancaria_id
                        and not (m.origem_tipo = 'venda' and not m.confirmado_extrato)
                        and (m.data_caixa < i.periodo_inicio or (m.data_caixa = i.periodo_inicio and m.categoria = 'Ajuste de conciliação'))), 0) as saldo_sistema_abertura,
           (select count(*) from public.extrato_linhas l where l.importacao_id = i.id
               and (l.status = 'pendente' or (l.status = 'conciliada' and l.movimento_id is null)))::int as linhas_pendentes
      from public.extrato_importacoes i join public.contas_bancarias c on c.id = i.conta_bancaria_id
  ) x;

revoke all on public.extrato_conciliacao_proposta, public.extrato_saldo_diario, public.extrato_importacoes_resumo from anon;

-- ---------------------------------------------------------------------------
-- 4) Funções
-- ---------------------------------------------------------------------------
-- Chamada pelo SQL que o gerar_conciliacao.js gera. Linhas antes do corte do espelho não entram; linha repetida
-- (mesma ref) é ignorada — dá para rodar o mesmo arquivo de novo sem duplicar.
-- p = { conta, periodo_inicio, periodo_fim, saldo_abertura, saldo_final, arquivo?, linhas: [{data, descricao, valor, saldo_banco?, ref}] }
create or replace function public.gestao_importar_extrato(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_conta uuid; v_imp uuid; v_corte date; it jsonb; v_novas int := 0; v_rep int := 0; v_antes int := 0; v_n int;
begin
  select id into v_conta from public.contas_bancarias where nome = p->>'conta';
  if v_conta is null then raise exception 'Conta "%" não encontrada.', p->>'conta'; end if;
  if nullif(p->>'periodo_inicio', '') is null or nullif(p->>'periodo_fim', '') is null then raise exception 'Informe o período do extrato.'; end if;
  select extrato_espelho_desde into v_corte from public.config_fluxo_caixa where id = 1;
  insert into public.extrato_importacoes (conta_bancaria_id, periodo_inicio, periodo_fim, saldo_abertura, saldo_final, arquivo)
  values (v_conta, (p->>'periodo_inicio')::date, (p->>'periodo_fim')::date, (p->>'saldo_abertura')::numeric, (p->>'saldo_final')::numeric,
          nullif(p->>'arquivo', ''))
  returning id into v_imp;
  for it in select * from jsonb_array_elements(coalesce(p->'linhas', '[]'::jsonb)) loop
    if (it->>'data')::date < v_corte then v_antes := v_antes + 1; continue; end if;
    insert into public.extrato_linhas (importacao_id, conta_bancaria_id, data, descricao, valor, saldo_banco, ref)
    values (v_imp, v_conta, (it->>'data')::date, btrim(it->>'descricao'), (it->>'valor')::numeric, nullif(it->>'saldo_banco', '')::numeric, it->>'ref')
    on conflict (conta_bancaria_id, ref) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_novas := v_novas + 1; else v_rep := v_rep + 1; end if;
  end loop;
  if v_novas = 0 then                                    -- arquivo já importado antes: não deixa importação vazia
    delete from public.extrato_importacoes where id = v_imp; v_imp := null;
  else
    update public.extrato_importacoes set linhas_novas = v_novas, linhas_repetidas = v_rep where id = v_imp;
  end if;
  return jsonb_build_object('importacao_id', v_imp, 'novas', v_novas, 'repetidas', v_rep, 'antes_do_corte', v_antes);
end $$;

-- Aplica o que a Karine aprovou. p = { itens: [{ linha_id, acao: 'confirmar'|'novo'|'transferencia'|'ignorar',
--   movimento_id?, par_linha_id?, categoria?, descricao?, custo_fixo_id? }] }. Devolve quantas linhas foram conciliadas.
create or replace function public.gestao_aplicar_conciliacao(p jsonb)
returns int
language plpgsql
as $$
declare
  it jsonb; l public.extrato_linhas%rowtype; par public.extrato_linhas%rowtype; m public.fluxo_caixa_movimentos%rowtype;
  v_mov uuid; v_ponta uuid; v_cat text; v_cf uuid; v_origem text; v_n int := 0; v_acao text;
begin
  if jsonb_array_length(coalesce(p->'itens', '[]'::jsonb)) = 0 then raise exception 'Nada para aplicar.'; end if;
  for it in select * from jsonb_array_elements(p->'itens') loop
    select * into l from public.extrato_linhas where id = (it->>'linha_id')::uuid;
    if l.id is null then raise exception 'Linha do extrato não encontrada.'; end if;
    if l.status = 'ignorada' or (l.status = 'conciliada' and l.movimento_id is not null) then continue; end if;   -- já resolvida (ex.: a outra ponta de uma transferência)
    v_acao := it->>'acao';

    if v_acao = 'ignorar' then
      update public.extrato_linhas set status = 'ignorada', conciliada_em = now() where id = l.id;

    elsif v_acao = 'confirmar' then
      select * into m from public.fluxo_caixa_movimentos where id = nullif(it->>'movimento_id', '')::uuid;
      if m.id is null then raise exception 'Escolha o lançamento a confirmar para "%".', l.descricao; end if;
      if (l.valor > 0) <> (m.entrada > 0) then raise exception '"%": entrada no banco não pode confirmar uma saída do sistema (ou o contrário).', l.descricao; end if;
      if exists (select 1 from public.extrato_linhas x where x.movimento_id = m.id and x.id <> l.id) then
        raise exception 'O lançamento "%" já foi conciliado com outra linha do extrato.', m.descricao;
      end if;
      update public.fluxo_caixa_movimentos
         set confirmado_extrato = true, data_caixa = l.data, conta_bancaria_id = l.conta_bancaria_id,
             entrada = case when l.valor > 0 then l.valor else 0 end, saida = case when l.valor < 0 then -l.valor else 0 end,
             saldo_real_banco = coalesce(l.saldo_banco, saldo_real_banco)
       where id = m.id;
      update public.extrato_linhas set status = 'conciliada', movimento_id = m.id, conciliada_em = now() where id = l.id;

    elsif v_acao = 'transferencia' then
      select * into par from public.extrato_linhas where id = nullif(it->>'par_linha_id', '')::uuid;
      if par.id is null then raise exception '"%": escolha a outra ponta da transferência.', l.descricao; end if;
      if par.conta_bancaria_id = l.conta_bancaria_id or par.valor <> -l.valor then
        raise exception '"%": a outra ponta precisa ser de outra conta e ter o mesmo valor com sinal oposto.', l.descricao;
      end if;
      foreach v_ponta in array array[l.id, par.id] loop   -- um lançamento em cada conta (sai de uma, entra na outra)
        select * into par from public.extrato_linhas where id = v_ponta;
        if par.status = 'conciliada' and par.movimento_id is not null then continue; end if;
        insert into public.fluxo_caixa_movimentos (conta_bancaria_id, data_caixa, descricao, categoria, entrada, saida, confirmado_extrato, saldo_real_banco)
        values (par.conta_bancaria_id, par.data, par.descricao, 'Transferência entre contas',
                case when par.valor > 0 then par.valor else 0 end, case when par.valor < 0 then -par.valor else 0 end, true, par.saldo_banco)
        returning id into v_mov;
        update public.extrato_linhas set status = 'conciliada', movimento_id = v_mov, conciliada_em = now() where id = par.id;
      end loop;

    elsif v_acao = 'novo' then
      v_cat := nullif(btrim(coalesce(it->>'categoria', '')), '');
      if v_cat is null then raise exception 'Escolha a categoria de "%".', l.descricao; end if;
      v_cf := nullif(it->>'custo_fixo_id', '')::uuid; v_origem := 'manual';
      if v_cf is not null and l.valor < 0 and not exists (
           select 1 from public.fluxo_caixa_movimentos where origem_tipo = 'despesa_operacional' and origem_id = v_cf
              and date_trunc('month', data_caixa) = date_trunc('month', l.data)) then
        v_origem := 'despesa_operacional';                -- quita o custo fixo do mês: ele sai dos pendentes
      else
        v_cf := null;
        if v_cat ilike 'Investimento%' then v_origem := 'investimento'; end if;
      end if;
      insert into public.fluxo_caixa_movimentos (conta_bancaria_id, data_caixa, descricao, categoria, entrada, saida, origem_tipo, origem_id,
                                                  confirmado_extrato, saldo_real_banco)
      values (l.conta_bancaria_id, l.data, coalesce(nullif(btrim(coalesce(it->>'descricao', '')), ''), l.descricao), v_cat,
              case when l.valor > 0 then l.valor else 0 end, case when l.valor < 0 then -l.valor else 0 end, v_origem, v_cf, true, l.saldo_banco)
      returning id into v_mov;
      update public.extrato_linhas set status = 'conciliada', movimento_id = v_mov, conciliada_em = now() where id = l.id;

    else
      raise exception 'Ação inválida para "%".', l.descricao;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Lança o ajuste que alinha o saldo do sistema com o do banco no começo do período de uma importação.
create or replace function public.gestao_lancar_ajuste_abertura(p_importacao_id uuid)
returns uuid
language plpgsql
as $$
declare r record; v_id uuid;
begin
  select * into r from public.extrato_importacoes_resumo where id = p_importacao_id;
  if r.id is null then raise exception 'Importação não encontrada.'; end if;
  if abs(r.diferenca_abertura) < 0.01 then raise exception 'O saldo de abertura já bate com o banco — não há ajuste a lançar.'; end if;
  insert into public.fluxo_caixa_movimentos (conta_bancaria_id, data_caixa, descricao, categoria, entrada, saida, confirmado_extrato, observacao)
  values (r.conta_bancaria_id, r.periodo_inicio, 'Ajuste de abertura — alinhamento com o extrato do banco', 'Ajuste de conciliação',
          greatest(r.diferenca_abertura, 0), greatest(-r.diferenca_abertura, 0), true,
          'Saldo do banco em ' || to_char(r.periodo_inicio, 'DD/MM/YYYY') || ': ' || r.saldo_abertura || ' | sistema: ' || r.saldo_sistema_abertura)
  returning id into v_id;
  return v_id;
end $$;

commit;
