-- Semente de regras_desconto = aba DESCONTOS de "Promoções Petit-2.xlsx" (18 linhas)
-- + 3 faixas de 0% para o mês de fabricação (meses restantes = validade), que
--   passou a existir com a regra de vencimento do PRD (decisão de 2026-09-18).
insert into public.regras_desconto (categoria_validade_meses, mes_inicio, mes_fim, desconto) values
  (24, 24, 24, 0.00),
  (24, 20, 23, 0.10), (24, 16, 19, 0.20), (24, 12, 15, 0.25),
  (24,  8, 11, 0.30), (24,  4,  7, 0.40), (24,  0,  3, 0.50),
  (12, 12, 12, 0.00),
  (12, 10, 11, 0.10), (12,  8,  9, 0.20), (12,  6,  7, 0.25),
  (12,  4,  5, 0.30), (12,  2,  3, 0.40), (12,  0,  1, 0.50),
  ( 6,  6,  6, 0.00),
  ( 6,  5,  5, 0.10), ( 6,  4,  4, 0.20), ( 6,  3,  3, 0.25),
  ( 6,  2,  2, 0.30), ( 6,  1,  1, 0.40), ( 6,  0,  0, 0.50);
