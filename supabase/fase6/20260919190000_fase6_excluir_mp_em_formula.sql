-- ============================================================================
-- Petit Sabó — Fase 6 (complemento 2): permitir excluir matéria-prima mesmo que esteja em fórmulas
-- Substitui gestao_excluir_materia_prima(uuid) por gestao_excluir_materia_prima(uuid, boolean).
--  • p_forcar = false (padrão): se estiver em fórmula, NÃO exclui e diz em quais fórmulas está;
--  • p_forcar = true: tira o ingrediente das fórmulas (elas ficam sem ele; o custo delas passa a não incluí-lo) e exclui.
-- Itens de nota fiscal ligados a ela voltam para "pendente" (a nota e o custo dela não mudam).
-- Rollback: 99_rollback_fase6_excluir.sql (remove as duas funções de exclusão)
-- ============================================================================

drop function if exists public.gestao_excluir_materia_prima(uuid);

create or replace function public.gestao_excluir_materia_prima(p_id uuid, p_forcar boolean default false)
returns jsonb
language plpgsql
as $$
declare v_nome text; v_forms text; v_itens int; v_nforms int; v_ingr int := 0;
begin
  select nome into v_nome from public.materias_primas where id = p_id;
  if not found then raise exception 'Matéria-prima não encontrada.'; end if;
  select string_agg(distinct f.nome || ' (v' || f.versao || ')', ', '), count(distinct f.id) into v_forms, v_nforms
    from public.formula_itens fi join public.formulas f on f.id = fi.formula_id
   where fi.materia_prima_id = p_id;
  if v_forms is not null then
    if not coalesce(p_forcar, false) then
      raise exception 'A matéria-prima "%" é usada nas fórmulas: %. Confirme para removê-la das fórmulas e excluir.', v_nome, v_forms;
    end if;
    delete from public.formula_itens where materia_prima_id = p_id;
    get diagnostics v_ingr = row_count;
  end if;
  update public.nota_fiscal_itens
     set destino = 'pendente', materia_prima_id = null, quantidade_base = null, custo_unitario_base = null
   where materia_prima_id = p_id;
  get diagnostics v_itens = row_count;
  delete from public.materias_primas where id = p_id;
  return jsonb_build_object('nome', v_nome, 'itens_voltaram_para_pendente', v_itens, 'formulas_afetadas', coalesce(v_nforms, 0), 'formulas', v_forms);
end $$;

revoke all on function public.gestao_excluir_materia_prima(uuid, boolean) from public;
grant execute on function public.gestao_excluir_materia_prima(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
