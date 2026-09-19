import { PGlite } from '@electric-sql/pglite'; import fs from 'fs';
const d = 'C:/Users/karin/OneDrive/Documentos/petit sabo/financeiro petit/sistema petit/';
const db = new PGlite();
await db.exec(fs.readFileSync(d + 'supabase/migrations/20260918120000_fase1_schema_estoque_venda.sql', 'utf8').replace(/create table public\.clientes[\s\S]*?create index clientes_telefone_idx[^;]*;/, '').slice(0, 0) || '');
// só a função de vencimento (a mesma que está no banco)
const sql = fs.readFileSync(d + 'supabase/migrations/20260918120000_fase1_schema_estoque_venda.sql', 'utf8');
const ini = sql.indexOf('create or replace function public.calcular_vencimento'); const fim = sql.indexOf('$$;', ini) + 3;
await db.exec(sql.slice(ini, fim));
const casos = [['01/2026', 6, '2026-07-31'], ['01/2026', 12, '2027-01-31'], ['01/2026', 24, '2028-01-31'],
  ['06/2026', 12, '2027-06-30'], ['07/2026', 24, '2028-07-31'], ['06/2026', 24, '2028-06-30'], ['02/2026', 24, '2028-02-29']];
console.log('BANCO — função calcular_vencimento:');
for (const [f, m, esp] of casos) { const r = (await db.query(`select public.calcular_vencimento('${f}', ${m})::text v`)).rows[0].v; console.log(' ', f, m + ' meses →', r, r === esp ? '✔ igual ao esperado' : '✘ esperado ' + esp); }
// APP NOVO — a função calcVencimento que está no arquivo gerado
const html = fs.readFileSync(d + 'petit_sabo_gestao_supabase.html', 'utf8');
const i2 = html.indexOf('function calcVencimento'); const f2 = html.indexOf('\n}', i2) + 2;
const calc = new Function(html.slice(i2, f2) + '; return calcVencimento;')();
console.log('\nAPP NOVO — calcVencimento:');
for (const [f, m, esp] of casos.slice(0, 3)) { const v = calc(f, m); const s = v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0'); console.log(' ', f, m + ' meses →', s, s === esp ? '✔' : '✘ esperado ' + esp); }
