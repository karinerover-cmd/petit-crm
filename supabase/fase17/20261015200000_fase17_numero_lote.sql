-- Fase 17 — Número de lote de fabricação (AAMM-SKU-NN), sugerido automaticamente.
-- Pode rodar de novo sem problema (idempotente): se o numero-de-lote.sql já foi rodado, só completa o que falta.
-- Formato: AAMM = ano e mês da fabricação · SKU = produto · NN = ordem da produção daquele SKU no mês (ex.: 2610-CEV002-01).

-- 1) Coluna
alter table public.lotes_fabricacao add column if not exists numero_lote text;

-- 2) Sugestão do próximo número (último NN do mês para aquele SKU + 1)
create or replace function public.sugerir_numero_lote(p_sku text, p_data date default public.hoje_brt())
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_data, 'YYMM') || '-' || p_sku || '-' ||
         lpad((coalesce(max(substring(numero_lote from '-(\d+)$')::int), 0) + 1)::text, 2, '0')
  from public.lotes_fabricacao
  where sku = p_sku
    and numero_lote like to_char(p_data, 'YYMM') || '-' || p_sku || '-%';
$$;

-- 3) Lotes antigos sem número recebem o número sugerido (em ordem de fabricação, para não repetir)
do $$
declare r record;
begin
  for r in select id, sku, data_fabricacao from public.lotes_fabricacao where numero_lote is null order by data_fabricacao, criado_em loop
    update public.lotes_fabricacao set numero_lote = public.sugerir_numero_lote(r.sku, r.data_fabricacao) where id = r.id;
  end loop;
end $$;

-- 4) Obrigatório e único
alter table public.lotes_fabricacao alter column numero_lote set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lotes_fabricacao_numero_lote_unico') then
    alter table public.lotes_fabricacao add constraint lotes_fabricacao_numero_lote_unico unique (numero_lote);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lotes_fabricacao_numero_lote_nao_vazio') then
    alter table public.lotes_fabricacao add constraint lotes_fabricacao_numero_lote_nao_vazio check (btrim(numero_lote) <> '');
  end if;
end $$;

-- 5) Rede de segurança: lote gravado sem número (por qualquer caminho) ganha o sugerido
create or replace function public.lotes_fabricacao_set_numero()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.numero_lote is null or btrim(new.numero_lote) = '' then
    new.numero_lote := public.sugerir_numero_lote(new.sku, new.data_fabricacao);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lotes_fabricacao_numero on public.lotes_fabricacao;
create trigger trg_lotes_fabricacao_numero
  before insert on public.lotes_fabricacao
  for each row execute function public.lotes_fabricacao_set_numero();

-- 6) Para a tela: sugestão do número antes de gravar. p = { sku, data_fabricacao? }
create or replace function public.gestao_sugerir_numero_lote(p jsonb)
returns text
language sql
stable
as $$
  select public.sugerir_numero_lote(upper(btrim(p->>'sku')), coalesce(nullif(p->>'data_fabricacao', '')::date, public.hoje_brt()));
$$;

-- 7) Registrar lote: aceita p.numero_lote (opcional; vazio = número sugerido) e devolve o número gravado
create or replace function public.gestao_registrar_lote(p jsonb)
returns jsonb
language plpgsql
as $$
declare c jsonb := public.gestao_calcular_lote(p); v_id uuid; v_num text := upper(nullif(btrim(coalesce(p->>'numero_lote', '')), ''));
begin
  if v_num is not null and exists (select 1 from public.lotes_fabricacao where numero_lote = v_num) then
    raise exception 'O número de lote % já existe. Use outro ou deixe a sugestão.', v_num;
  end if;
  insert into public.lotes_fabricacao (sku, formula_id, formula_versao, data_fabricacao, quantidade_produzida, horas_trabalhadas, receitas, valor_hora, markup,
      custo_materia_prima_total, custo_embalagem_total, custo_mao_de_obra, custo_total, custo_unitario, preco_sugerido_varejo, custo_incompleto, itens_sem_custo, detalhe, status_aprovacao, observacao, numero_lote)
  values (c->>'sku', (c->>'formula_id')::uuid, (c->>'formula_versao')::int, coalesce(nullif(p->>'data_fabricacao', '')::date, public.hoje_brt()), (c->>'quantidade')::int, (c->>'horas')::numeric,
      (c->>'receitas')::numeric, (c->>'valor_hora')::numeric, (c->>'markup')::numeric, (c->>'custo_materia_prima_total')::numeric, (c->>'custo_embalagem_total')::numeric,
      (c->>'custo_mao_de_obra')::numeric, (c->>'custo_total')::numeric, (c->>'custo_unitario')::numeric, (c->>'preco_sugerido_varejo')::numeric,
      (c->>'custo_incompleto')::boolean, nullif(c->>'itens_sem_custo', ''), c->'detalhe',
      'pendente', nullif(p->>'observacao', ''), v_num)
  returning id, numero_lote into v_id, v_num;
  return c || jsonb_build_object('lote_id', v_id, 'numero_lote', v_num);
end $$;

-- 8) Permissões (mesmo padrão das outras fases)
revoke all on function public.sugerir_numero_lote(text, date) from public;
revoke all on function public.gestao_sugerir_numero_lote(jsonb) from public;
grant execute on function public.sugerir_numero_lote(text, date) to authenticated;
grant execute on function public.gestao_sugerir_numero_lote(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Conferência:
-- select sku, data_fabricacao, numero_lote from public.lotes_fabricacao order by data_fabricacao;
-- select public.gestao_sugerir_numero_lote('{"sku":"CEV002","data_fabricacao":"2026-10-20"}'::jsonb);   -- 2610-CEV002-02
