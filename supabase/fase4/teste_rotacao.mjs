import { PGlite } from '@electric-sql/pglite'; import fs from 'fs';
const d = 'C:/Users/karin/OneDrive/Documentos/petit sabo/financeiro petit/sistema petit/';
const db = new PGlite();
await db.exec(fs.readFileSync('crm_stub.sql', 'utf8').split('-- a venda que já existe no CRM')[0]);
await db.exec(`insert into canais(nome,tipo) values ('Bagy','online'),('Endossa Asa Sul','consignacao'),('Endossa Augusta','consignacao'),('Feira','fisico'),('Instagram','online'),('WhatsApp','online');`);
for (const f of ['supabase/migrations/20260918120000_fase1_schema_estoque_venda.sql', 'supabase/migrations/20260918120100_fase1_seed_regras_desconto.sql']) await db.exec(fs.readFileSync(d + f, 'utf8'));
await db.exec(`insert into clientes(nome,telefone) values ('Cliente Bagy','61999990000');`);
for (const b of JSON.parse(fs.readFileSync(d + 'migracao/bagy_crm_2026.json', 'utf8')))
  await db.exec(`insert into vendas(cliente_id,canal_id,valor,data_venda,bagy_pedido_id) select (select id from clientes limit 1),(select id from canais where nome='Bagy'),${b.valor},'${b.data_venda}','${b.bagy_pedido_id}'`);
const mig = fs.readFileSync(d + 'supabase/fase2/01_migracao_2026.sql', 'utf8'); const FIM = 'end $mig$;';
await db.query(mig.slice(mig.indexOf('do $mig$'), mig.indexOf(FIM) + FIM.length));
const q = async s => (await db.query(s)).rows;
const foto = async () => q(`select p.sku, left(p.nome,22) nome, p.estoque_atual e, (select count(*)::int from venda_itens i where i.sku=p.sku) itens, (select coalesce(sum(quantidade),0)::int from movimentos_estoque m where m.sku=p.sku) mov, p.data_fabricacao f from produtos p where p.sku in ('WBR001','WBR002','WBR003','DDM264') order by nome`);
const antes = await foto(); console.log('ANTES (ordenado por produto):'); console.table(antes);
const total = async () => (await q("select (select count(*) from venda_itens)::int i, (select count(*) from movimentos_estoque)::int m, (select sum(estoque_atual)::int from produtos) e, (select count(*) from produtos p where estoque_atual <> coalesce((select sum(quantidade) from movimentos_estoque m where m.sku=p.sku),0))::int inconsistentes"))[0];
const t0 = await total();
const sql = fs.readFileSync(d + 'supabase/fase4/20260919140000_corrige_codigos_wbr.sql', 'utf8');
const cut = sql.indexOf("$corrige$;") + "$corrige$;".length;
await db.query(sql.slice(sql.indexOf('do $corrige$'), cut));
const dep = await foto(); console.log('DEPOIS (ordenado por produto):'); console.table(dep);
const t1 = await total();
console.log('totais antes:', JSON.stringify(t0), '\ntotais depois:', JSON.stringify(t1));
const por = a => Object.fromEntries(a.map(r => [r.nome, r]));
const A = por(antes), B = por(dep);
for (const n of Object.keys(A)) { const a = A[n], b = B[n]; console.log(n.padEnd(24), a.sku, '→', b.sku, '| estoque', a.e, '→', b.e, '| itens de venda', a.itens, '→', b.itens, '| mov', a.mov, '→', b.mov, a.e === b.e && a.itens === b.itens && a.mov === b.mov ? '✔ preservado' : '✘ MUDOU'); }
try { await db.query(sql.slice(sql.indexOf('do $corrige$'), cut)); console.log('2ª execução: FALHA (rodou de novo)'); } catch (e) { console.log('2ª execução bloqueada ✔:', e.message.slice(0, 80)); }
const V = Object.fromEntries((await q("select sku, data_fabricacao f, validade_meses m, data_vencimento::text v from produtos where sku in ('WBR001','WBR002','WBR003','DDM264')")).map(r => [r.sku, r]));
const esp = { WBR001: '2027-06-30', WBR002: '2028-07-31', WBR003: '2028-06-30', DDM264: '2028-02-29' };
for (const k of Object.keys(esp)) console.log('vencimento', k, V[k].f, V[k].m + 'm →', V[k].v, V[k].v === esp[k] ? '✔' : '✘ esperado ' + esp[k]);
console.log('tabela_produtos ok:', (await q("select count(*)::int c from tabela_produtos"))[0].c);
