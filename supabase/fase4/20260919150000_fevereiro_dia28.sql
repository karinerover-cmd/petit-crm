-- Regra de vencimento: último dia do mês de (fabricação + validade), EXCETO fevereiro, que é sempre dia 28
-- (fevereiro varia entre 28 e 29 dias; decisão: usar 28 por padrão). Só muda quem vence em fevereiro de ano bissexto.
-- Recalcula a data_vencimento já gravada em todos os produtos. Não altera mais nada.
create or replace function public.calcular_vencimento(p_fabricacao text, p_validade_meses int)
returns date
language sql immutable
as $$
  select case
    when p_fabricacao ~ '^(0[1-9]|1[0-2])/[0-9]{4}$' and p_validade_meses > 0 then
      (select case when extract(month from u.d) = 2 then make_date(extract(year from u.d)::int, 2, 28) else u.d end
         from (select (make_date(split_part(p_fabricacao, '/', 2)::int, split_part(p_fabricacao, '/', 1)::int, 1)
                       + make_interval(months => p_validade_meses + 1) - interval '1 day')::date as d) u)
  end
$$;

-- a coluna guarda o valor calculado; precisa ser recalculada para valer a nova regra (PostgreSQL 17)
alter table public.produtos alter column data_vencimento
  set expression as (public.calcular_vencimento(data_fabricacao, validade_meses));

-- Conferência (somente leitura): deve mostrar 'ok' nas 5 linhas
select caso, esperado, obtido, case when esperado = obtido then 'ok' else 'DIFERENTE' end as resultado from (
  select '01/2026 + 6 meses'  as caso, '2026-07-31' as esperado, public.calcular_vencimento('01/2026', 6)::text  as obtido
  union all select '01/2026 + 12 meses', '2027-01-31', public.calcular_vencimento('01/2026', 12)::text
  union all select '01/2026 + 24 meses', '2028-01-31', public.calcular_vencimento('01/2026', 24)::text
  union all select '02/2026 + 24 meses (fevereiro/2028, bissexto)', '2028-02-28', public.calcular_vencimento('02/2026', 24)::text
  union all select '02/2026 + 12 meses (fevereiro/2027)', '2027-02-28', public.calcular_vencimento('02/2026', 12)::text
) t;
