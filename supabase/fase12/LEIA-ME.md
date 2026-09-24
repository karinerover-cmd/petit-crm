# Fase 12 — Fluxo de caixa

Livro-caixa por conta bancária (cada conta com o seu próprio saldo, nunca encadeia com outra), vendas "a confirmar" com a data e a conta em que o dinheiro realmente caiu, e saldo projetado do mês.

## Arquivos
- `20260928100000_fase12_fluxo_caixa.sql`: tabelas `contas_bancarias`, `fluxo_caixa_movimentos`, `config_fluxo_caixa`; views `fluxo_caixa_extrato`, `fluxo_caixa_resumo_mensal`, `saldo_caixa_projetado`, `fluxo_caixa_categorias`; 7 funções `gestao_*`; triggers em `vendas` e `divida_pagamentos` (nunca derrubam a gravação — se falharem, só avisam no log, porque o CRM também grava em `vendas`). Rollback: `99_rollback_fase12.sql`.
- `tela_fluxo_caixa.js`: tela "Fluxo de caixa" (Livro-caixa, A confirmar, Saldo projetado, Contas).
- `gerar_importacao_caixa.js`: gera `02_importacao_planilha_2026.sql` a partir das abas mensais de livro-caixa da planilha "Vendas Consolidado" (Jan–Jun/2026 = Banco Inter, Jul–Ago/2026 = Conta C6). **Não versionado** (`.gitignore`) — tem os valores reais do negócio, roda uma vez só no Supabase da Karine.

## Regra de ouro
Cada conta bancária tem o seu **próprio saldo** — nunca encadeia com outra (a Conta C6 começou do zero em jul/2026, independente do saldo final do Banco Inter em jun/2026).

## Corte (01/09/2026)
A partir dessa data, vendas e pagamentos de dívida (Fase 13) geram lançamento **sozinhos**:
- **Venda** → entrada **não confirmada** na conta principal, com `data_caixa` = data da venda. Fica em "a receber" e **não entra no saldo** até a Karine confirmar a data real, a conta e o valor que de fato caiu (já líquido de taxa/comissão).
- **Pagamento de dívida** → saída automática na conta principal, essa já entra no saldo na hora.
- Antes do corte, o histórico vem da importação da planilha (Jan–Ago/2026).

## Saldo projetado
`saldo_fim_mes + a_receber − custos_fixos_pendentes − ataque_divida_pendente`. Custos fixos (Fase 10) e ataque de dívida (Fase 13) só entram na **conta principal** (senão seriam contados duas vezes com as outras contas).

## Aluguel de consignação
Nada automático — só vira saída se a Karine lançar manualmente (confirmado inspecionando a planilha real: só quando passa pela conta do negócio).

## Segurança
Lançamento ligado a venda ou pagamento de dívida não se apaga pelo caixa — exclui-se a venda/o pagamento na tela dele (o lançamento acompanha).

## Valores do negócio
Os 141 lançamentos reais (Jan–Ago/2026) e os valores da planilha ficam só no arquivo local gerado (`02_importacao_planilha_2026.sql`) — segue a regra da Fase 10: fora do GitHub.
