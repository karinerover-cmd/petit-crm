-- Desfaz o "ignorar item": itens ignorados voltam a Pendentes e as regras (CHECK) voltam ao original. Não apaga dados.
begin;
drop function if exists public.gestao_ignorar_item(uuid, boolean);
update public.nota_fiscal_itens set destino = 'pendente' where destino = 'ignorado';
alter table public.nota_fiscal_itens drop constraint if exists nota_fiscal_itens_destino_check;
alter table public.nota_fiscal_itens add constraint nota_fiscal_itens_destino_check
  check (destino in ('materia_prima', 'embalagem_envio', 'despesa_operacional', 'pendente'));
alter table public.nota_fiscal_itens drop constraint if exists itens_destino_consistente;
alter table public.nota_fiscal_itens add constraint itens_destino_consistente check (
     (destino = 'materia_prima'   and materia_prima_id is not null)
  or (destino = 'embalagem_envio' and embalagem_envio_id is not null)
  or (destino in ('despesa_operacional', 'pendente'))
);
commit;
