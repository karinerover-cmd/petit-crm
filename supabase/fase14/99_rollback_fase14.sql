-- Desfaz a Fase 14. As metas realistas (coluna "valor") continuam; somem a Mínima, a Desafio e as views de progresso.
begin;

drop view if exists public.progresso_semanal;
drop view if exists public.progresso_mensal;

-- gestao_salvar_metas volta à versão da Fase 10 (só a meta realista)
create or replace function public.gestao_salvar_metas(p jsonb)
returns int
language plpgsql
as $$
declare v_ano int := nullif(p->>'ano', '')::int; it jsonb; v_mes int; v_valor numeric; v_n int := 0;
begin
  if v_ano is null or v_ano < 2020 or v_ano > 2100 then raise exception 'Informe o ano.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'metas', '[]'::jsonb)) loop
    v_mes := nullif(it->>'mes', '')::int;
    if v_mes is null or v_mes < 1 or v_mes > 12 then raise exception 'Mês inválido: %', it->>'mes'; end if;
    v_valor := nullif(it->>'valor', '')::numeric;
    if v_valor is null then
      delete from public.metas_faturamento where mes = make_date(v_ano, v_mes, 1);
    else
      if v_valor < 0 then raise exception 'A meta não pode ser negativa.'; end if;
      insert into public.metas_faturamento (mes, valor) values (make_date(v_ano, v_mes, 1), v_valor)
      on conflict (mes) do update set valor = excluded.valor, atualizado_em = now();
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.gestao_salvar_metas(jsonb) from public;
grant execute on function public.gestao_salvar_metas(jsonb) to authenticated;

alter table public.metas_faturamento drop constraint if exists metas_faturamento_ordem_niveis;
alter table public.metas_faturamento drop column if exists meta_desafio;
alter table public.metas_faturamento drop column if exists meta_minima;

notify pgrst, 'reload schema';
commit;
