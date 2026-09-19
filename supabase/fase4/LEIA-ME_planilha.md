# Planilha de promoções conectada ao Supabase (Fase 4, opção a)

## 1. Gerar o arquivo
No app (`petit_sabo_gestao_supabase.html`) → **Exportar / Importar** → **📈 Exportar para a planilha de promoções** → **Baixar dados para a planilha**.
Sai um `supabase_para_planilha_AAAA-MM-DD.csv` com todos os produtos (inclusive os ocultos, marcados na última coluna).

## 2. Colar na planilha
1. Abra o CSV no Excel (duplo clique). Selecione tudo (Ctrl+A) e copie (Ctrl+C).
2. Na planilha `Promoções Petit`, crie uma aba chamada exatamente **Supabase** (ou limpe a que já existe: Ctrl+A, Delete).
3. Clique em A1 e cole (Ctrl+V).
Repita esses passos sempre que quiser atualizar. **Não apague as abas `Vendas` e `Estoque`** até a conferência estar validada.

## 3. Trocar as fórmulas da aba Tabela Produtos (preencha a linha 2 e arraste para baixo)
Colunas da aba Supabase: A=ID, B=Produto, C=Estoque atual, D=Vendas 30d, E=Data de vencimento, F=Categoria validade (meses), G=Valor sem desconto.

| Coluna da Tabela Produtos | Fórmula (Excel em português) |
|---|---|
| **C** Estoque atual | `=SEERRO(ÍNDICE(Supabase!$C$2:$C$1000;CORRESP(ARRUMAR($A2);Supabase!$A$2:$A$1000;0));0)` |
| **J** Vendas 30d | `=SEERRO(ÍNDICE(Supabase!$D$2:$D$1000;CORRESP(ARRUMAR($A2);Supabase!$A$2:$A$1000;0));0)` |

Com só C e J trocadas, o restante da planilha (promoção, desconto, validade) continua exatamente como está.

**Opcional (recomendado):** trocar também estes três, que hoje são digitados à mão. Assim a planilha usa a regra de vencimento do PRD e nunca mais fica desatualizada:

| Coluna | O que é | Fórmula |
|---|---|---|
| **D** | Data de vencimento | `=SEERRO(ÍNDICE(Supabase!$E$2:$E$1000;CORRESP(ARRUMAR($A2);Supabase!$A$2:$A$1000;0));"")` |
| **K** | Categoria validade (meses) | `=SEERRO(ÍNDICE(Supabase!$F$2:$F$1000;CORRESP(ARRUMAR($A2);Supabase!$A$2:$A$1000;0));"")` |
| **L** | Valor sem desconto | `=SEERRO(ÍNDICE(Supabase!$G$2:$G$1000;CORRESP(ARRUMAR($A2);Supabase!$A$2:$A$1000;0));0)` |

**Por que `ARRUMAR($A2)`:** alguns IDs na aba Estoque têm um espaço no fim (ex.: `"OI2601 "`, `"BB007 "`). Sem `ARRUMAR` (TRIM), a busca não acha o produto, o estoque vira 0 e o vencimento fica vazio (`#VALOR!`). Com `ARRUMAR` funciona mesmo com espaço sobrando.

(Se o seu Excel estiver em inglês: SEERRO=IFERROR, ÍNDICE=INDEX, CORRESP=MATCH, ARRUMAR=TRIM, e o separador é vírgula.)

## 4. Conferir
Salve a planilha e me avise: eu comparo a aba Tabela Produtos com o Supabase produto a produto.
