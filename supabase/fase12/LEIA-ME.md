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

## Fase 12b — conciliação mensal pelo extrato do banco
A partir de `config_fluxo_caixa.extrato_espelho_desde` (01/09/2026) o livro-caixa **espelha o banco**; até agosto/2026 fica o histórico da planilha (decisão da Karine).

- `20260929100000_fase12b_conciliacao_extrato.sql`: `extrato_importacoes`, `extrato_linhas` (sem duplicar: cada linha tem uma "impressão digital"), `extrato_regras_categoria`; views `extrato_conciliacao_proposta`, `extrato_saldo_diario`, `extrato_importacoes_resumo`; funções `gestao_importar_extrato`, `gestao_aplicar_conciliacao`, `gestao_lancar_ajuste_abertura`. Rollback: `99_rollback_fase12b.sql` (os lançamentos já conciliados ficam no livro-caixa).
- `pdf_texto.js` + `ler_extrato.js`: leem o PDF do extrato do Banco Inter, da Conta C6 e do Nubank PJ sem instalar nada, e **se conferem**: o saldo recalculado tem que bater com o que o banco imprime, dia a dia. PDF com senha: abrir no navegador, Ctrl+P → "Salvar como PDF" (a senha nunca vai para o chat).
- `gerar_conciliacao.js`: transforma os PDFs do mês em `conciliacoes/conciliacao_*.sql` (**não versionado** — lançamentos reais), que só chama `gestao_importar_extrato`. Recusa gerar se algum extrato não bater com o banco.

**Rotina do mês:** extratos em PDF → `gerar_conciliacao.js` → rodar o SQL no Supabase → Fluxo de caixa → aba **Conciliação**: revisar e aprovar. A proposta:
1. **Transferência entre as contas** (Nubank PJ → C6): as duas pontas viram "Transferência entre contas" — não é receita nem despesa.
2. **Entrada** do mesmo valor de uma venda "a receber" (até 60 dias antes) → confirma a venda, com a data e a conta do banco.
3. **Saída** do mesmo valor de um lançamento não conferido da mesma conta (até 5 dias) → confirma.
4. Senão, **lançamento novo** com a categoria da regra (Vindi/Yapay → Taxa Financeira; CDB → Investimento CDB; Pro Horses/Endossa → Venda Consignação; Hubla → Curso; Melhor Envio → Frete). Uma regra pode também quitar um custo fixo do mês (`custo_fixo_nome`).
   As regras que citam pessoas (sócia, parceira) ficam em `02b_regras_locais_extrato.sql`, **não versionado** — rodar depois da migration.

A primeira importação de cada conta mostra a **diferença de abertura** (saldo do banco x saldo do sistema) com um botão para lançar o ajuste no 1º dia do período. Depois de aprovado, a aba mostra o saldo do sistema x banco **dia a dia** — tudo ✓ = mês fechado.

## Valores do negócio
Os 141 lançamentos reais (Jan–Ago/2026) e os valores da planilha ficam só no arquivo local gerado (`02_importacao_planilha_2026.sql`), e os extratos convertidos ficam em `conciliacoes/` — segue a regra da Fase 10: fora do GitHub.
