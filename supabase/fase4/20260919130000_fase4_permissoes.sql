-- Fase 4: garante que o usuário logado consegue LER as duas visões usadas pela planilha/app.
-- Só concede leitura (não altera dados). Seguro rodar mais de uma vez.
grant select on public.tabela_produtos, public.curva_abc to authenticated;
revoke all on public.tabela_produtos, public.curva_abc from anon;   -- visitante sem login continua sem acesso
notify pgrst, 'reload schema';
