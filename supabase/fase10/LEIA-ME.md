# Fase 10 — Indicadores financeiros

Ponto de equilíbrio, meta de faturamento saudável e metas realistas por mês, com a margem **real** das vendas (Fase 9) e o custo fixo configurado.

> Versão pública: os valores do negócio (custos fixos, semente de feira, metas e ajustes de canais) ficam num arquivo local, fora do repositório.

## Arquivos
- `20260923100000_fase10_indicadores.sql`: tabelas `custos_fixos` (com vigência por mês), `feiras_realizadas` (custo da Petit calculado pelo banco), `config_indicadores`; views `feira_custo_medio_mensal` e `indicadores_financeiros_mensal`; 6 funções `gestao_*`. Rollback: `99_rollback_fase10.sql`.
- `20260923110000_fase10_metas_realistas.sql`: tabela `metas_faturamento`, função `gestao_salvar_metas` e 3 colunas no fim da view (meta realista, % da meta, atingida/abaixo). Rollback: `99_rollback_fase10_metas.sql`.
- `tela_indicadores.js`: tela "Indicadores" (painel, metas com projeção a partir do ano anterior, feiras, custos fixos, configuração).

## Cálculo
```
custo_petit (feira)   = custo_total × fat_petit ÷ (fat_petit + fat_parceira)   — ninguém vendeu: 50/50
custo_feira do mês M  = (Σ custo_petit dos meses reais + (12 − meses_reais) × semente) ÷ 12
                        meses reais = meses da janela a partir do início do registro; mês sem feira conta R$ 0
faturamento_total     = Σ vendas.valor do mês
margem_pct_real       = Σ margem_real ÷ Σ receita, só das vendas com custo completo (nunca margem teórica)
                        mês sem venda com margem → acumulado de 12 meses → senão, em branco
custo_fixo_mensal     = Σ custos_fixos vigentes no mês + custo_feira
ponto_equilibrio      = custo_fixo_mensal ÷ margem_pct_real
meta_saudavel (ideal) = custo_fixo_mensal × multiplicador (3)
meta_realista         = meta definida mês a mês → atingida | abaixo (primeira flag do painel)
```
- Custos fixos com vigência: mudar um valor "a partir de" um mês não reescreve os meses anteriores.
- Despesas recorrentes lançadas pelas notas (Fase 6) **não** somam no custo fixo (evita contar duas vezes).
- Metas: a tela mostra o faturamento do ano anterior e projeta "ano anterior + X%" (só preenche; grava ao salvar).
