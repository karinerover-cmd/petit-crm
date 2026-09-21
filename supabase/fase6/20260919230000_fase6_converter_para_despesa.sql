-- ============================================================================
-- Petit Sabó — Fase 6 (complemento 6): mudar uma matéria-prima ou embalagem de envio para DESPESA (ex.: material de escritório, contínua)
-- Cada item de nota ligado ao cadastro vira uma despesa (data e valor da nota) na categoria escolhida, recorrente ou pontual;
-- o cadastro é removido e a memória de classificação do fornecedor passa a apontar para despesa (próximas notas já entram assim).
-- Matéria-prima que está em fórmula não pode ser convertida (o erro diz em quais).
-- Cria 1 função; não altera tabelas. Rollback: 99_rollback_fase6_para_despesa.sql
-- p = { origem: 'materia_prima' | 'embalagem_envio', id, categoria: curso|melhoria_equipamento|sessao_foto_video|material_escritorio|outro, recorrente: true|false }
-- ============================================================================

create or replace function public.gestao_converter_para_despesa(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_origem text := p->>'origem'; v_id uuid := nullif(p->>'id', '')::uuid;
  v_cat text := coalesce(nullif(p->>'categoria', ''), 'outro'); v_rec boolean := coalesce((p->>'recorrente')::boolean, false);
  v_nome text; v_forms text; v_n int := 0; it record;
begin
  if v_cat not in ('curso', 'melhoria_equipamento', 'sessao_foto_video', 'material_escritorio', 'outro') then raise exception 'Categoria de despesa inválida: %', v_cat; end if;
  if v_origem = 'materia_prima' then
    select nome into v_nome from public.materias_primas where id = v_id;
    if not found then raise exception 'Matéria-prima não encontrada.'; end if;
    select string_agg(distinct f.nome || ' (v' || f.versao || ')', ', ') into v_forms
      from public.formula_itens fi join public.formulas f on f.id = fi.formula_id where fi.materia_prima_id = v_id;
    if v_forms is not null then raise exception '"%" é usada nas fórmulas: %. Tire-a das fórmulas antes de mudar para despesa.', v_nome, v_forms; end if;
  elsif v_origem = 'embalagem_envio' then
    select nome into v_nome from public.materiais_embalagem_envio where id = v_id;
    if not found then raise exception 'Embalagem de envio não encontrada.'; end if;
  else
    raise exception 'Origem inválida: % (use materia_prima ou embalagem_envio).', v_origem;
  end if;

  for it in select ni.id, ni.descricao, ni.custo_total, n.data_emissao
              from public.nota_fiscal_itens ni join public.notas_fiscais n on n.id = ni.nota_fiscal_id
             where (v_origem = 'materia_prima' and ni.materia_prima_id = v_id) or (v_origem = 'embalagem_envio' and ni.embalagem_envio_id = v_id) loop
    delete from public.despesas_operacionais where nota_fiscal_item_id = it.id;
    insert into public.despesas_operacionais (data, descricao, categoria, valor, recorrente, nota_fiscal_item_id)
    values (it.data_emissao, it.descricao, v_cat, it.custo_total, v_rec, it.id);
    update public.nota_fiscal_itens set destino = 'despesa_operacional', materia_prima_id = null, embalagem_envio_id = null where id = it.id;
    v_n := v_n + 1;
  end loop;

  update public.mapa_itens_fornecedor set destino = 'despesa_operacional', despesa_categoria = v_cat, recorrente = v_rec, materia_prima_id = null, embalagem_envio_id = null
   where (v_origem = 'materia_prima' and materia_prima_id = v_id) or (v_origem = 'embalagem_envio' and embalagem_envio_id = v_id);

  if v_origem = 'materia_prima' then delete from public.materias_primas where id = v_id;
  else delete from public.materiais_embalagem_envio where id = v_id; end if;
  return jsonb_build_object('nome', v_nome, 'despesas_criadas', v_n, 'categoria', v_cat, 'recorrente', v_rec);
end $$;

revoke all on function public.gestao_converter_para_despesa(jsonb) from public;
grant execute on function public.gestao_converter_para_despesa(jsonb) to authenticated;

notify pgrst, 'reload schema';
