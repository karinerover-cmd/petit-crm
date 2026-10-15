-- Rollback da Fase 17: remove o número de lote e devolve gestao_registrar_lote à versão da Fase 8.
-- ATENÇÃO: apaga os números de lote já gravados. Se algum já saiu em rótulo, NÃO rode isto.
drop trigger if exists trg_lotes_fabricacao_numero on public.lotes_fabricacao;
drop function if exists public.lotes_fabricacao_set_numero();

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

drop function if exists public.gestao_sugerir_numero_lote(jsonb);
drop function if exists public.sugerir_numero_lote(text, date);
alter table public.lotes_fabricacao drop constraint if exists lotes_fabricacao_numero_lote_unico;
alter table public.lotes_fabricacao drop constraint if exists lotes_fabricacao_numero_lote_nao_vazio;
alter table public.lotes_fabricacao drop column if exists numero_lote;

notify pgrst, 'reload schema';
