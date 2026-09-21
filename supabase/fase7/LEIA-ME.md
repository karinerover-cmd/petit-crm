# Fase 7 — Fórmulas

- `20260919170000_fase7_formulas.sql`: tabelas `formulas` (uma ativa por SKU, com versão) e `formula_itens`, view `formulas_custo`, funções `gestao_salvar_formula`, `gestao_ativar_formula`, `gestao_excluir_formula`. Rollback: `99_rollback_fase7.sql`.
- `soapcalc.js`: lê a receita do SoapCalc (texto do PDF): óleos, soda, água e aditivos.
- `precificacao.js`: lê as abas de produto da planilha "PRECIFICAÇÃO - ATACADO E VAREJO" (ingredientes, quantidade da receita, preço ÷ peso da embalagem, rendimento).
- `tela_formulas.js`: tela "Fórmulas" do app (lista com custo, versões, editor, importação de PDF/planilha/texto).
- Mudar uma fórmula cria uma nova versão; a anterior fica guardada. Custo = soma(quantidade × custo atual da matéria-prima); mostra quantos ingredientes estão sem custo.
- Ingrediente novo vira matéria-prima com cadastro incompleto; custo digitado só vale onde a matéria-prima ainda não tem custo.
- Nenhum dado pessoal é versionado.
