# Fase 11 — Lote de matéria-prima e rotina

## Arquivos
- `20260924100000_fase11_lotes_materia_prima_rotina.sql`: tabelas `materia_prima_lotes`, `lote_fabricacao_materia_prima_lote` (rastreabilidade), `rotina_tarefas`, `rotina_execucoes`; views `materia_prima_lotes_vencimento` e `rotina_status`; 6 funções `gestao_*`. Rollback: `99_rollback_fase11.sql`.
- `tela_materia_prima_rotina.js`: telas "🧪 Lotes de matéria-prima" e "✅ Rotina".
- Complemento em `supabase/fase8/tela_lotes.js`: ao ver o detalhe de um lote de fabricação, um bloco deixa marcar quais lotes de matéria-prima entraram naquela produção.

## Achado importante
**Nenhuma das notas fiscais reais da Karine traz validade de matéria-prima no XML** (a tag `<rastro>` da NF-e, usada por fornecedores que fazem rastreamento de lote, não aparece em nenhum fornecedor dela). Confirmado com ela em 2026-09-24: o cadastro de lote é **quase sempre manual**, olhando o rótulo/certificado do fornecedor. A leitura automática do XML não foi implementada (não teria uso real hoje); se algum fornecedor um dia passar a informar isso, é um ajuste pequeno no `nfe.js`.

## Regras
- `materia_prima_lotes.data_validade` é **data exata** (diferente do produto acabado, que só guarda mês/ano).
- `quantidade` é só informativa — não existe controle de estoque de matéria-prima.
- Alerta de vencimento com os mesmos limites do produto acabado: **VENCIDO** (≤0 dias), **CRÍTICO** (≤60), **PRÓXIMO** (≤120), **OK**.
- **Rastreabilidade:** um lote de fabricação pode usar mais de um lote da mesma matéria-prima (ex.: terminando um lote antigo e abrindo um novo). Um lote de matéria-prima que já foi usado numa produção não pode ser excluído.
- `gestao_salvar_lotes_usados` valida que a matéria-prima escolhida realmente está na fórmula daquele lote de fabricação, e é atômica: se um item da lista for inválido, nada é gravado (nem a limpeza da lista anterior).
- Checklist: 11 tarefas semeadas (a Karine revisou em 2026-09-24 e acrescentou "Fazer backup" e "Conferir estoque baixo", ambas semanais). `sob_demanda` não tem "atrasada" (só mostra a última vez); `semanal` atrasa depois de 7 dias sem execução; `mensal`, depois de 31.

## Bugs encontrados e corrigidos durante o teste (antes de qualquer coisa ir ao Supabase real)
- `on delete restrict` no Postgres levanta a exceção `restrict_violation` (SQLSTATE 23001), não `foreign_key_violation` (23503) — são exceções diferentes. A função de excluir lote capturava a errada.
- Um `id` de lote de fabricação interpolado com `JSON.stringify()` dentro de um atributo HTML já entre aspas duplas quebrava o `onclick`/`onchange` silenciosamente (o clique não fazia nada). Corrigido para aspas simples, como o resto do código.
