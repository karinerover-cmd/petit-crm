# Fase 17 — Número de lote de fabricação

Cada produção ganha um número de lote (item de rotulagem), sugerido automaticamente e editável antes de salvar.

## Formato: `AAMM-SKU-NN`
Ex.: `2610-CEV002-01` = 1ª produção do CEV002 em outubro de 2026. O `NN` sobe a cada nova produção do mesmo SKU no mesmo mês.

## Arquivos
- `20261015200000_fase17_numero_lote.sql`: coluna `lotes_fabricacao.numero_lote` (obrigatória e única), funções `sugerir_numero_lote` e `gestao_sugerir_numero_lote`, gatilho que preenche o número se vier vazio, e `gestao_registrar_lote` que aceita `numero_lote` (opcional) e devolve o número gravado. Idempotente: pode rodar de novo; se o `numero-de-lote.sql` já foi rodado, só completa o que falta. Rollback: `99_rollback_fase17.sql` (apaga os números gravados — não use se algum já foi para rótulo).
- Tela (`fase8/tela_lotes.js`, e a cópia já montada em `fase3/petit_sabo_gestao_supabase.html`):
  - **Lote de reposição:** campo "Nº do lote" já preenchido com a sugestão; muda ao trocar produto ou data; dá para digitar outro e o ↻ sugerir volta ao automático.
  - **Produto novo:** mostra o número do 1º lote (sempre `-01`), gerado sozinho.
  - **Lista de lotes:** nova coluna "Lote".
- Número repetido é recusado com mensagem clara ("O número de lote … já existe").

## O que não mudou
- `gestao_cadastrar_produto_com_lote` continua igual: o 1º lote de um produto novo recebe o número pelo gatilho.
- A rastreabilidade das matérias-primas usadas em cada produção (Fase 11) já existe e continua na lupa 🔍 do lote.

## Testado
Sugestão no mesmo mês (`-02`) e em mês novo (`-01`), registro sem número, com número digitado (vira maiúsculo), número repetido (erro amigável) — rodado no banco dentro de uma transação desfeita.
