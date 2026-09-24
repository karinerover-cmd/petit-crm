# Fase 9 — Despesas variáveis e margem de contribuição real

O preço de venda continua no markup 3× (Fase 8). Esta fase só calcula quanto sobra de verdade depois das despesas que só existem NA VENDA.

## Arquivos
- `20260921120000_fase9_despesas_variaveis_margem.sql`: 3 tabelas (`despesas_variaveis_config`, `embalagem_envio_kit`, `venda_margem`), 2 colunas novas em `venda_itens` (`custo_unitario_no_momento`, `custo_origem`), 2 gatilhos e 5 funções `gestao_*`. Rollback: `99_rollback_fase9.sql`.

## Regra de ouro
O valor **registrado** na venda (colunas `taxa_pagamento`, `comissao_canal`, `comissao_plataforma`, `frete_cobrado`/`frete_pago` de `vendas`, vindas do CRM/Bagy) sempre vence. `despesas_variaveis_config` só estima o que faltar (a regra mais específica ganha: canal+forma > canal > forma > geral).

## Fórmula
```
receita_produtos = Σ subtotal dos itens (sem itens: vendas.valor)
custo_produtos   = Σ quantidade × custo_unitario_no_momento
despesas         = taxa_pagamento + comissao_canal + comissao_plataforma + frete_absorvido + embalagem_envio + perda_extravio
margem_real      = receita_produtos − custo_produtos − despesas
margem_pct       = margem_real ÷ receita_produtos
```

## Custo travado
`custo_unitario_no_momento` é preenchido por gatilho no INSERT de `venda_itens`, com o custo do **lote mais recente aprovado/ajustado, fabricado até a data da venda**. Depois, mudar a fórmula ou o custo de matéria-prima não reescreve vendas já registradas. **Só vendas novas ganham custo travado** — não há preenchimento retroativo das vendas antigas (decisão da Karine).

## Embalagem de envio
Nunca digitada à mão: vem do kit de `materiais_embalagem_envio` (Fase 6) por canal (`embalagem_envio_kit`). Kit padrão (canal nulo): caixa de envio + papel de seda + adesivo + plástico bolha + plástico de envio. A Feira tem kit próprio: só sacola. Se algum item do kit ainda não tem custo cadastrado, cai no valor médio (semente: R$ 218,30/mês ÷ ~26,4 vendas/mês ≈ R$ 8,27/venda), até o cadastro real estar completo.

## Margem trava
`venda_margem` é gravada uma vez pelo gatilho, no momento da venda. Mudar `despesas_variaveis_config` depois **não** reescreve margens já calculadas — só vendas novas usam a configuração atualizada.

## Sementes (editáveis, tela de configuração)
- Taxas de cartão por canal/forma, comissões dos canais de consignação e da Bagy: estimadas a partir do histórico real.
- Perda/extravio: 2% (padrão definido pela Karine).
- Embalagem de envio (fallback): R$ 8,27/venda.
