# Fase 6 — Matéria-prima e nota fiscal

- `20260919160000_fase6_materia_prima_nf.sql`: 6 tabelas novas + 6 funções `gestao_*` (só usuário logado). Rollback: `99_rollback_fase6.sql`.
- `nfe.js`: leitor de NF-e (XML) e classificador de itens (matéria-prima / embalagem de envio / despesa / pendente).
- `tela_notas.js`: tela "Notas fiscais" do app (importar XML, revisar, pendentes, matérias-primas, despesas).
- Regra de custo: valor do produto + frete proporcional − desconto. IPI e DIFAL são só demonstrativo.
- Matéria-prima é identificada por nome + fornecedor (e tipo), então a mesma essência de fornecedores diferentes fica separada.
- Regenerar o app: `node supabase/fase3/monta_app.js` (ajustar o caminho `dir` no início do arquivo).
- Nenhum XML de nota nem dado pessoal é versionado.
