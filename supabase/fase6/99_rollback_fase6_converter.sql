-- Remove as duas funções de conversão (não desfaz conversões já feitas e não apaga dados).
drop function if exists public.gestao_converter_produto_para_embalagem_envio(uuid);
drop function if exists public.gestao_converter_embalagem_para_produto(uuid);
