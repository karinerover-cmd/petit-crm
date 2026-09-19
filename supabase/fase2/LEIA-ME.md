# Fase 2 — migração do histórico de 2026

Executada em 2026-09-18 no Supabase (SQL Editor). Conferência final: 142 produtos, 198 vendas migradas,
252 itens de venda (222 com SKU), 19 vendas do site já existentes no CRM completadas, 328 movimentos de estoque.

- `02_conferencia_fase2.sql` — conferência somente leitura (compara o banco com o esperado)
- `99_rollback_fase2.sql` — desfaz a migração
- `gerar_migracao.js` — gerador do SQL (lê as planilhas e o backup do app, que ficam fora do repositório)
- `alvo_estoque.json` — estoque final esperado por SKU
- `01_migracao_2026.sql` — **não versionado** (contém dados pessoais de clientes); gerado por `gerar_migracao.js`
