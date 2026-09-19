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
const antes = Object.fromEntries((await q('select sku, data_vencimento::text v from produtos')).map(r => [r.sku, r.v]));
// 1) ordem sugerida: primeiro a regra de fevereiro, depois a correção dos códigos
const fev = fs.readFileSync(d + 'supabase/fase4/20260919150000_fevereiro_dia28.sql', 'utf8');
const corte = fev.indexOf('-- Conferência');
await db.exec(fev.slice(0, corte));
const conf = (await q(fev.slice(corte).split('\n').filter(l => !l.startsWith('--')).join('\n').trim().replace(/;\s*$/, '')));
conf.forEach(r => console.log(' ', r.caso.padEnd(48), r.esperado, r.obtido, r.resultado));
const depois = Object.fromEntries((await q('select sku, data_vencimento::text v from produtos')).map(r => [r.sku, r.v]));
const mudou = Object.keys(antes).filter(k => antes[k] !== depois[k]);
console.log('produtos cujo vencimento mudou com a regra de fevereiro:', mudou.length, mudou.map(k => k + ' ' + antes[k] + '→' + depois[k]).join(', ') || '(nenhum)');
console.log('nulos preservados:', Object.keys(antes).filter(k => antes[k] === null).every(k => depois[k] === null));
// 2) depois: a correção dos códigos e fabricações
const cor = fs.readFileSync(d + 'supabase/fase4/20260919140000_corrige_codigos_wbr.sql', 'utf8');
await db.query(cor.slice(cor.indexOf('do $corrige$'), cor.indexOf('$corrige$;', cor.indexOf('do $corrige$') + 10) + '$corrige$;'.length));
console.table(await q("select sku, left(nome,24) nome, estoque_atual e, data_fabricacao f, validade_meses m, data_vencimento::text venc from produtos where sku in ('DDM264','WBR001','WBR002','WBR003') order by sku"));
// 3) um produto novo que vence em fevereiro bissexto passa pelo gatilho normalmente
await db.exec("insert into produtos(sku,nome,data_fabricacao,validade_meses,preco) values ('FEV1','teste','02/2027',12,1),('FEV2','teste','03/2026',12,1)");
console.log('novo produto fab 02/2027 +12m →', (await q("select data_vencimento::text v from produtos where sku='FEV1'"))[0].v, '(esperado 2028-02-28) | fab 03/2026 +12m →', (await q("select data_vencimento::text v from produtos where sku='FEV2'"))[0].v, '(esperado 2027-03-31)');
console.log('view tabela_produtos:', (await q('select count(*)::int c from tabela_produtos'))[0].c, 'linhas | curva_abc:', (await q('select count(*)::int c from curva_abc'))[0].c);
// 4) a função é idempotente (rodar 2x)
await db.exec(fev.slice(0, corte)); console.log('2ª execução da regra: ok');
