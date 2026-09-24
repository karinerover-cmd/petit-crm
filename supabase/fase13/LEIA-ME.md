# Fase 13 — Dívidas

Registro de dívidas, pagamentos e ajustes de saldo, sem misturar dinheiro pessoal com o do negócio, e o cálculo do quanto atacar de dívida por mês.

## Arquivos
- `20260925100000_fase13_dividas.sql`: tabelas `dividas`, `divida_pagamentos`, `divida_ajustes`, `faturamento_liquido_mensal`; views `divida_resumo`, `divida_resumo_geral`, `divida_ataque_mensal`; 7 funções `gestao_*`. Rollback: `99_rollback_fase13.sql`.
- `tela_dividas.js`: tela "Dívidas" (lista com saldo/projeção, histórico de pagamentos e ajustes, ataque mensal).

## Regra de ouro
`saldo_atual` **nunca é digitado direto**. Ele é sempre `valor_original − Σ pagamentos + Σ ajustes`:
- **Pagamento:** dinheiro que realmente saiu para abater a dívida.
- **Ajuste:** correção do saldo fora de um pagamento (juros lançados no início do mês, renegociação, erro de lançamento), sempre com um motivo registrado — a Karine pode fazer isso todo início de mês. Nunca some sem deixar rastro.

`taxa_juros_mensal` é **só informativa**: não faz o saldo crescer sozinho (calcular o juro composto certo dependeria de detalhes do contrato de cada dívida que o sistema não tem — se ela quiser essa conta automática, é um pedido à parte).

## Ataque mensal (ex.: Nubank a 65%)
- `percentual_ataque_faturamento` é um campo **na dívida**, não fixo no nome — qualquer dívida pode ter um % configurado.
- O percentual incide sobre o **faturamento líquido do mês**, que a Karine **digita ela mesma** em `faturamento_liquido_mensal` (ela já desconta o que considera obrigatório/imposto por fora — o sistema não deriva o líquido sozinho).
- `divida_ataque_mensal` só sugere: `sugestão = faturamento_líquido × percentual`, mostrando o que já foi pago naquela dívida no mês e a diferença. **Nada muda em `dividas`/`divida_pagamentos` sozinho** até ela registrar o pagamento de fato na aba Histórico.

## Projeção de quitação
Ritmo mensal = média dos pagamentos dos últimos 3 meses daquela dívida. Sem pagamento nesse período, a projeção fica em branco (não inventa número).

## Segurança
Uma dívida com pagamento ou ajuste registrado não pode ser excluída (`on delete restrict` — a função escuta `restrict_violation`, não `foreign_key_violation`, lição da Fase 11). Nesses casos, marque como inativa.

## Valores do negócio
A lista das 8 dívidas reais (nomes, valores) é número do negócio da Karine — segue a regra da Fase 10: fica só no arquivo local, fora do GitHub.
