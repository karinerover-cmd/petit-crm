# Fase 16 — Venda avulsa

Registrar uma venda sem produto cadastrado (refil de casa da cliente, encomenda sob demanda, item personalizado), sem mexer em estoque e sem quebrar margem, faturamento ou curva ABC.

## Arquivos
- `20260926100000_fase16_venda_avulsa.sql`: 3 colunas novas em `venda_itens` (`tipo_avulso`, `descricao_avulsa`, `custo_unitario_manual`), `gestao_registrar_venda` aceita item avulso, `gestao_travar_custo_item` também trava custo manual. Rollback: `99_rollback_fase16.sql`.
- `20260927100000_fase16b_observacao_avulsa.sql`: coluna `observacao_avulsa` (detalhes livres — aroma escolhido, evento, etc.). Rollback: `99_rollback_fase16b.sql`.
- Sem tela nova: a UI fica dentro de `fase3/camada_supabase.js` e `fase3/monta_app.js` (é um complemento ao formulário "Registrar venda" já existente).

## O que já existia e não precisou mudar
Conferido antes de escrever qualquer código (Fase 1/9/10):
- `venda_itens.sku` já aceita nulo (histórico importado sem SKU casado).
- O trigger que gera movimento de estoque já ignora `sku` nulo — venda avulsa nunca baixa estoque.
- `curva_abc` já filtra `where sku is not null` — venda avulsa não entra na curva.
- O faturamento (Fase 10) já soma por `vendas.valor`, não por item — não depende de `sku`.

## Regras
- Item avulso não pode ter `sku`, e todo item com `tipo_avulso` preenchido tem que ter `descricao_avulsa` (nunca "avulso" sem dizer o quê é) — garantido por constraint no banco, não só na tela.
- `tipo_avulso` é lista fechada: Refil / Encomenda / Personalizado.
- `custo_unitario_manual` é opcional: se preenchido, vira o custo travado do item (`custo_origem = 'manual'`) e a margem calcula normal; se vazio, o item fica "sem custo" — mesmo tratamento que produto sem lote aprovado.
- `observacao_avulsa` é livre (aroma, evento, pedido especial) e aparece no Histórico de vendas, em itálico, abaixo do item.
