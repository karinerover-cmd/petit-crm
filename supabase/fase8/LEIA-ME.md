# Fase 8 — Lote de fabricação e precificação

- `20260921100000_fase8_lotes_precificacao.sql`: tabelas `configuracao_precificacao` (R$ 14,03/h, markup 3), `produto_embalagem` (embalagem de produto por SKU) e `lotes_fabricacao`; funções `gestao_calcular_lote`, `gestao_registrar_lote`, `gestao_aprovar_preco_lote`, `gestao_excluir_lote`, `gestao_salvar_config_precificacao`, `gestao_salvar_embalagem_produto`. Rollback: `99_rollback_fase8.sql`.
- `tela_lotes.js`: tela "Lotes e preços" do app (novo lote com cálculo ao vivo, lotes e aprovação, embalagem por produto, configuração).
- Custo do lote = matéria-prima (fórmula ativa × receitas) + embalagem de produto (lista do SKU × unidades) + mão de obra (horas × valor/hora). Custo unitário = total ÷ unidades. Preço sugerido = custo unitário × markup.
- O preço sugerido nunca é aplicado sozinho: só quando o lote é aprovado ou ajustado. Custo incompleto (item sem custo) não gera sugestão.
- O lote guarda o custo de cada item no momento; mudar custos depois não altera lotes antigos. O lote não mexe no estoque.
- Embalagem de envio não entra aqui (custo fixo).

## Complemento 1 — produto novo (`20260921110000_fase8_produto_novo.sql`, rodar depois do SQL principal)
- Aba "🆕 Produto novo": nome, coleção, categoria, validade e SKU sugerido pela coleção (iniciais + próximo número, ex.: PAM004 → PAM005; coleção nova → iniciais + 001), editável.
- Fórmula: liga uma fórmula cadastrada sem produto (leva as versões junto) ou copia a fórmula de outro produto (cópia v1, a original não muda).
- O custo e o preço sugerido aparecem antes de gravar (`gestao_simular_lote`); o cálculo é o mesmo do lote de reposição (`gestao_custo_lote`).
- `gestao_cadastrar_produto_com_lote` grava tudo numa transação: produto com preço R$ 0,00, fórmula, embalagem, 1º lote pendente e, se marcado, estoque inicial. O preço só muda na aprovação.
- Rollback: `99_rollback_fase8_produto_novo.sql` (devolve o cálculo à versão original e remove as funções novas).
