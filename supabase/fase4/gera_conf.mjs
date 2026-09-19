import { PGlite } from '@electric-sql/pglite'; import fs from 'fs';
const d = 'C:/Users/karin/OneDrive/Documentos/petit sabo/financeiro petit/sistema petit/';
const alvo = JSON.parse(fs.readFileSync(d + 'supabase/fase2/alvo_estoque.json', 'utf8'));
const vals = Object.entries(alvo).map(([s, q]) => `('${s}',${q})`).join(',');
const conf = `-- Conferência da Fase 2 (SOMENTE LEITURA — não altera nada). Cada linha mostra o valor no banco e o esperado.
with alvo(sku, qtd) as (values ${vals})
select ordem, conferencia, no_banco, esperado, case when no_banco = esperado then 'OK' else 'DIFERENTE' end as resultado from (
  select 1 as ordem, 'produtos' as conferencia, (select count(*) from public.produtos)::numeric as no_banco, 142::numeric as esperado
  union all select 2, 'vendas migradas', (select count(*) from public.vendas where origem = 'migracao'), 198
  union all select 3, 'itens de venda', (select count(*) from public.venda_itens), 252
  union all select 4, 'itens de venda ligados a produto (SKU)', (select count(*) from public.venda_itens where sku is not null), 222
  union all select 5, 'vendas do site já existentes no CRM (completadas)', (select count(*) from public.vendas where origem <> 'migracao' and pedido_externo is not null), 19
  union all select 6, 'movimentos de estoque', (select count(*) from public.movimentos_estoque), 328
  union all select 7, 'produtos com estoque diferente do esperado', (select count(*) from alvo a left join public.produtos p on p.sku = a.sku where p.estoque_atual is distinct from a.qtd), 0
  union all select 8, 'valor das vendas migradas (R$)', (select round(coalesce(sum(valor),0),2) from public.vendas where origem = 'migracao'), __VALOR__
  union all select 9, 'vendas do CRM (Bagy) com valor alterado: veja abaixo', 0, 0
) x order by ordem;
`;
// esperado do valor: roda a migração no banco simulado
const db = new PGlite();
await db.exec(fs.readFileSync('crm_stub.sql', 'utf8').split('-- a venda que já existe no CRM')[0]);
await db.exec(`insert into canais(nome,tipo) values ('Bagy','online'),('Endossa Asa Sul','consignacao'),('Endossa Augusta','consignacao'),('Feira','fisico'),('Instagram','online'),('WhatsApp','online');`);
for (const f of ['supabase/migrations/20260918120000_fase1_schema_estoque_venda.sql', 'supabase/migrations/20260918120100_fase1_seed_regras_desconto.sql']) await db.exec(fs.readFileSync(d + f, 'utf8'));
await db.exec(`insert into clientes(nome) values ('Cliente Bagy');`);
for (const b of JSON.parse(fs.readFileSync(d + 'migracao/bagy_crm_2026.json', 'utf8')))
  await db.exec(`insert into vendas(cliente_id,canal_id,valor,data_venda,bagy_pedido_id) select (select id from clientes limit 1),(select id from canais where nome='Bagy'),${b.valor},'${b.data_venda}','${b.bagy_pedido_id}'`);
const sql = fs.readFileSync(d + 'supabase/fase2/01_migracao_2026.sql', 'utf8'); const FIM = 'end $mig$;';
await db.query(sql.slice(sql.indexOf('do $mig$'), sql.indexOf(FIM) + FIM.length));
const valor = (await db.query("select round(sum(valor),2) v from vendas where origem='migracao'")).rows[0].v;
const final = conf.replace('__VALOR__', valor).replace("  union all select 9, 'vendas do CRM (Bagy) com valor alterado: veja abaixo', 0, 0\n", '');
fs.writeFileSync(d + 'supabase/fase2/02_conferencia_fase2.sql', final);
const r = (await db.query(final.replace(/^--.*$/gm, '').trim().replace(/;\s*$/, ''))).rows;
console.table(r);
