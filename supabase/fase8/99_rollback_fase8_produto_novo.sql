-- Desfaz o complemento "produto novo": devolve gestao_calcular_lote à versão original da Fase 8 e remove as funções novas.
-- Não apaga dados: produtos, fórmulas e lotes já cadastrados por este fluxo continuam existindo.
begin;
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

drop function if exists public.gestao_cadastrar_produto_com_lote(jsonb);
drop function if exists public.gestao_simular_lote(jsonb);
drop function if exists public.gestao_custo_lote(uuid, jsonb, numeric, numeric);
commit;
