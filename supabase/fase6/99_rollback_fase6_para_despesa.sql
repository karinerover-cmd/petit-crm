-- Remove a função de conversão para despesa (não desfaz conversões já feitas e não apaga dados).
drop function if exists public.gestao_converter_para_despesa(jsonb);
