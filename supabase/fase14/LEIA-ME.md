# Fase 14 — Metas em 3 níveis e acompanhamento

Estende as metas da Fase 10 com a **Mínima** e a **Desafio** e mostra o progresso do mês e da semana numa barra guiada pela **Realista**.

## Arquivos
- `20260930100000_fase14_metas_progresso.sql`: colunas `meta_minima` e `meta_desafio` em `metas_faturamento` (opcionais), regra **mínima ≤ realista ≤ desafio**, views `progresso_mensal` e `progresso_semanal`, e `gestao_salvar_metas` aceitando os 3 níveis. Rollback: `99_rollback_fase14.sql` (as metas realistas ficam).
- `progresso_metas.js`: a barra de progresso — card no topo do **Dashboard** (mês e semana corrente) e no painel de **Indicadores** (mês escolhido). Só desenha: todos os números vêm prontos das views.
- A tela de Indicadores (Fase 10, `fase10/tela_indicadores.js`) ganhou as colunas Mínima e Desafio no editor 🎯 Metas e a barra no painel.

## Regras do cálculo (aprovadas pela Karine)
- A meta **Realista** continua sendo a coluna `valor` de `metas_faturamento` (a view da Fase 10 já a chamava de `meta_realista`).
- **Faturamento** = Σ `vendas.valor` pela data da venda — a mesma base dos indicadores da Fase 10.
- **% de cada nível** = faturamento ÷ meta do nível.
- **Dias restantes** = dias corridos que faltam no mês, **contando hoje** (há venda em feira no fim de semana e online todo dia — não é "dia útil" comercial).
- **Ritmo diário** para bater a Realista = (Realista − faturamento) ÷ dias restantes; zero depois de batida.
- **Semana** = segunda a domingo. Nº de semanas do mês = dias do mês ÷ 7, então a **meta da semana = Realista × 7 ÷ dias do mês**. A semana que cruza dois meses usa a meta diária de cada mês nos seus dias — a soma das semanas fecha exatamente a meta do mês.
- **Barra:** 0 a 100% = Realista; Mínima e Desafio são marcos na mesma barra (`marco_minima`, `marco_desafio` em proporção da Realista); a barra se estende até a Desafio, ou até o faturamento se ele passar dela (`escala_barra`).

## Compatibilidade
Salvar só a meta realista (como a tela da Fase 10 fazia) não apaga a mínima nem a desafio já cadastradas. A tela esconde as colunas novas enquanto o SQL desta fase não tiver rodado.
