-- ============================================================================
-- Petit Sabó — Fase 6 (complemento 3): tirar itens da lista de Pendentes ("ignorar")
-- O item continua na nota (o custo da nota não muda), mas deixa de aparecer em Pendentes e não vira matéria-prima,
-- embalagem nem despesa. Dá para desfazer (volta para Pendentes).
-- Altera só duas regras (CHECK) da tabela nota_fiscal_itens para aceitar o destino 'ignorado'; nenhum dado é alterado.
-- Rollback: 99_rollback_fase6_ignorar.sql
-- ============================================================================

alter table public.nota_fiscal_itens drop constraint if exists nota_fiscal_itens_destino_check;
alter table public.nota_fiscal_itens add constraint nota_fiscal_itens_destino_check
  check (destino in ('materia_prima', 'embalagem_envio', 'despesa_operacional', 'pendente', 'ignorado'));

alter table public.nota_fiscal_itens drop constraint if exists itens_destino_consistente;
alter table public.nota_fiscal_itens add constraint itens_destino_consistente check (
     (destino = 'materia_prima'   and materia_prima_id is not null)
  or (destino = 'embalagem_envio' and embalagem_envio_id is not null)
  or (destino in ('despesa_operacional', 'pendente', 'ignorado'))
);

-- Ignora (p_ignorar = true) ou devolve para Pendentes (false) um item de nota.
create or replace function public.gestao_ignorar_item(p_id uuid, p_ignorar boolean default true)
returns void
language plpgsql
as $$
begin
  perform 1 from public.nota_fiscal_itens where id = p_id;
  if not found then raise exception 'Item de nota não encontrado.'; end if;
  delete from public.despesas_operacionais where nota_fiscal_item_id = p_id;      -- se já era despesa, a despesa some
  update public.nota_fiscal_itens
     set destino = case when coalesce(p_ignorar, true) then 'ignorado' else 'pendente' end,
         materia_prima_id = null, embalagem_envio_id = null, quantidade_base = null, custo_unitario_base = null
   where id = p_id;
end $$;

revoke all on function public.gestao_ignorar_item(uuid, boolean) from public;
grant execute on function public.gestao_ignorar_item(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
