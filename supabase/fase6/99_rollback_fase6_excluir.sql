-- Remove as funções de exclusão de matéria-prima e embalagem (não apaga nenhum dado).
drop function if exists public.gestao_excluir_embalagem_envio(uuid);
drop function if exists public.gestao_excluir_materia_prima(uuid, boolean);
drop function if exists public.gestao_excluir_materia_prima(uuid);
