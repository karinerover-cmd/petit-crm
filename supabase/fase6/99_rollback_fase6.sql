-- Remove tudo que a Fase 6 criou. ATENÇÃO: apaga as notas fiscais, matérias-primas e despesas já cadastradas.
begin;
drop function if exists public.gestao_excluir_nota(uuid);
drop function if exists public.gestao_salvar_despesa(jsonb);
drop function if exists public.gestao_salvar_materia_prima(jsonb);
drop function if exists public.gestao_classificar_item(jsonb);
drop function if exists public.gestao_importar_nota(jsonb);
drop function if exists public.gestao_aplicar_item(uuid, jsonb);
drop table if exists public.mapa_itens_fornecedor;
drop table if exists public.despesas_operacionais;
drop table if exists public.nota_fiscal_itens;
drop table if exists public.notas_fiscais;
drop table if exists public.materiais_embalagem_envio;
drop table if exists public.materias_primas;
commit;
