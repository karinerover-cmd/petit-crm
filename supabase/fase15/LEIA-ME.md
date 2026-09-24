# Fase 15 — Curva ABC visual, Pareto e planejamento de vendas por produto

Duas partes independentes, ambas como abas novas dentro da tela **🎯 Indicadores** (mesmo arquivo que a Fase 14 já estendeu).

## Arquivos
- `20261001100000_fase15_curva_abc_planejamento.sql`: view `curva_abc_detalhe`, tabela `estrategias_vendas_mensal`, view `progresso_planejamento_mensal`, funções `gestao_salvar_planejamento_mensal` e `gestao_excluir_item_planejamento`. Rollback: `99_rollback_fase15.sql`.
- A UI entrou direto em `fase10/tela_indicadores.js` (abas **📊 Curva ABC** e **📅 Planejamento**), mesmo padrão que a Fase 14 usou para as colunas de meta.

## Parte 1 — Curva ABC visual + Pareto
`curva_abc_detalhe` só junta a `curva_abc` (Fase 1) com o produto — **não recalcula nada**: classe (A/B/C) e o corte 80/95/100 continuam vindo prontos de lá.
- **Ordem de reposição** (`ordem_reposicao`): classe primeiro (A antes de B/C) e, dentro da mesma classe, estoque baixo primeiro. O limite de "estoque baixo" (`< 5`) é o mesmo já usado em `tabela_produtos.status_estoque` (Fase 1) — não é um número novo.
- **Importante:** o Pareto (gráfico) sempre ordena por `posicao` (faturamento decrescente — é o que faz o gráfico ter a forma clássica), **mesmo quando a tabela abaixo dele está ordenada por `ordem_reposicao`** (prioridade de reposição). São duas ordens diferentes, para propósitos diferentes.
- Filtro de janela: 90 dias ou 12 meses — a `curva_abc` já calcula as duas, aqui só se escolhe qual mostrar.

## Parte 2 — Planejamento de vendas por produto
`estrategias_vendas_mensal` é um planejamento **livre**: quantidade por produto, por mês, sem nenhuma validação forçando a soma a bater com a meta de faturamento (Fase 14) — é só um guia de estratégia.
- `progresso_planejamento_mensal` cruza o planejado com o vendido de verdade no mês (soma de `venda_itens.quantidade` pelo `sku`, período do mês — igual à base da `curva_abc`, então vendas avulsas da Fase 16, sem `sku`, também ficam de fora aqui).
- `gestao_salvar_planejamento_mensal` salva um mês inteiro de uma vez (upsert por `mes`+`sku`); quantidade vazia apaga o item.

## Compatibilidade
As duas abas mostram um aviso e não quebram a tela se o SQL desta fase ainda não tiver rodado no Supabase.
