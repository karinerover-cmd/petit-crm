# Fase 18 — Lote de fabricação na venda (opcional)

Ao registrar uma venda, cada item de produto pode apontar para o lote de fabricação de onde saiu. Serve para rastrear: se um lote tiver problema, dá para saber a quais vendas ele foi.

## Como funciona na tela (Registrar venda)
- Ao escolher o produto, aparece o campo **Lote (opcional)** — só se o produto tiver lote com saldo.
- Já vem escolhido o **lote mais antigo que ainda tem saldo**. A última opção, "Sem lote (estoque antigo)", serve para as peças de antes de existir lote.
- Se a quantidade for maior que o saldo do lote, o app pergunta antes de marcar.
- O lote escolhido aparece no item do carrinho e no **Histórico de vendas** (`· lote 2610-CEV002-01`).
- Venda avulsa não tem lote. Vendas antigas ficam sem lote, sem problema.

## Arquivos
- `20261015210000_fase18_lote_na_venda.sql`: coluna `venda_itens.lote_fabricacao_id` (opcional; se o lote for excluído o item continua), função `gestao_lotes_disponiveis` (lotes com saldo, do mais antigo ao mais novo), e `gestao_registrar_venda` aceitando `lote_id` por item (recusa lote de outro produto). Rollback: `99_rollback_fase18.sql` (apaga as marcações de lote nas vendas).
- Tela: `fase3/camada_supabase.js` (seletor, carrinho, envio e leitura do histórico), `fase3/monta_app.js` (carrinho e histórico mostram o lote) e a cópia já montada `fase3/petit_sabo_gestao_supabase.html`.

## Saldo do lote
Saldo = unidades produzidas no lote − unidades vendidas com aquele lote marcado. É uma **estimativa**: o estoque do app é por produto, e venda sem lote marcado não abate nenhum lote. Por isso o lote mais antigo já vem escolhido. Lote sem saldo, ou produto sem estoque, não aparece.

## Ordem para ativar
1. Rodar o SQL no Supabase **primeiro**.
2. Depois usar a tela nova. (Se a tela nova abrir antes do SQL, o histórico de vendas continua funcionando e o seletor simplesmente não aparece.)

## Testado
Saldo por lote, venda com e sem lote, lote de outro produto (erro), lote esgotado some da lista — no banco, dentro de uma transação desfeita. Seletor da tela: simulado (aparece só com produto e lote com saldo, escolhe o mais antigo, desconta o que já está no carrinho, esconde em venda avulsa e se o SQL ainda não foi rodado).
