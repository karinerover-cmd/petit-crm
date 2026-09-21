-- ============================================================================
-- Petit Sabó — Fase 6 (complemento): excluir matéria-prima e embalagem de envio da lista geral
-- Só cria 2 funções novas; não altera tabelas. Rollback: 99_rollback_fase6_excluir.sql
-- Regras:
--  • matéria-prima usada em FÓRMULA não pode ser excluída (o erro diz em quais fórmulas está) — tire-a da fórmula antes;
--  • itens de nota fiscal ligados a ela NÃO somem: voltam para "pendente" (a nota e o custo dela continuam iguais);
--  • a memória de classificação do fornecedor ligada a ela é apagada junto.
-- ============================================================================

create or replace function public.gestao_excluir_materia_prima(p_id uuid)
returns jsonb
language plpgsql
as $$
declare v_nome text; v_forms text; v_itens int;
begin
  select nome into v_nome from public.materias_primas where id = p_id;
  if not found then raise exception 'Matéria-prima não encontrada.'; end if;
  select string_agg(distinct f.nome || ' (v' || f.versao || ')', ', ') into v_forms
    from public.formula_itens fi join public.formulas f on f.id = fi.formula_id
   where fi.materia_prima_id = p_id;
  if v_forms is not null then
    raise exception 'A matéria-prima "%" é usada nas fórmulas: %. Tire-a das fórmulas antes de excluir.', v_nome, v_forms;
  end if;
  update public.nota_fiscal_itens
     set destino = 'pendente', materia_prima_id = null, quantidade_base = null, custo_unitario_base = null
   where materia_prima_id = p_id;
  get diagnostics v_itens = row_count;
  delete from public.materias_primas where id = p_id;
  return jsonb_build_object('nome', v_nome, 'itens_voltaram_para_pendente', v_itens);
end $$;

create or replace function public.gestao_excluir_embalagem_envio(p_id uuid)
returns jsonb
language plpgsql
as $$
declare v_nome text; v_itens int;
begin
  select nome into v_nome from public.materiais_embalagem_envio where id = p_id;
  if not found then raise exception 'Embalagem não encontrada.'; end if;
  update public.nota_fiscal_itens
     set destino = 'pendente', embalagem_envio_id = null, quantidade_base = null, custo_unitario_base = null
   where embalagem_envio_id = p_id;
  get diagnostics v_itens = row_count;
  delete from public.materiais_embalagem_envio where id = p_id;
  return jsonb_build_object('nome', v_nome, 'itens_voltaram_para_pendente', v_itens);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('gestao_excluir_materia_prima', 'gestao_excluir_embalagem_envio') loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
  end loop;
end $$;

notify pgrst, 'reload schema';
