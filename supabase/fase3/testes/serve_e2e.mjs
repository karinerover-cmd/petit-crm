import { PGlite } from '@electric-sql/pglite'; import fs from 'fs'; import http from 'http';
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
await db.exec(fs.readFileSync(d + 'supabase/fase3/20260919120000_fase3_funcoes_app.sql', 'utf8'));
await db.exec("grant usage on schema public to anon, authenticated; grant all on all tables in schema public to authenticated;");
await db.exec('set role authenticated');   // tudo como usuário logado (RLS e permissões valendo)

const MOCK = `
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: 'teste' } } } }), signInWithPassword: async () => ({ error: null }), signOut: async () => ({}) },
  from(t) { const st = { select: '*', order: null }; const b = {
      select(s) { st.select = s; return b; }, order(c, o) { st.order = { c, asc: !o || o.ascending !== false }; return b; },
      range(a, z) { return api({ op: 'select', table: t, select: st.select, order: st.order, from: a, to: z }); } }; return b; },
  rpc(fn, args) { return api({ op: 'rpc', fn, args }); } }) };
window.__sql = async text => (await api({ op: 'sql', text })).data;
async function api(body) { const r = await fetch('/api', { method: 'POST', body: JSON.stringify(body) }); return r.json(); }
`;
const SELECTS = {
  produtos: 'select sku,nome,colecao,categoria,data_fabricacao,validade_meses,preco::float8 as preco,estoque_atual,oculto from produtos',
  canais: 'select nome,tipo,ativo from canais',
  tabela_produtos: 'select * from tabela_produtos',
  clientes: 'select id,nome,telefone,email from clientes',
  vendas: `select v.id, v.cliente_id, v.valor::float8 as valor, v.data_venda::text as data_venda, v.forma_pagamento, v.desconto_venda::float8 as desconto_venda, v.origem, v.observacao,
      json_build_object('nome',c.nome) as canais, json_build_object('nome',cl.nome,'telefone',cl.telefone,'email',cl.email) as clientes,
      coalesce((select json_agg(json_build_object('sku',i.sku,'produto_nome',i.produto_nome,'quantidade',i.quantidade,'preco_unitario',i.preco_unitario::float8,'desconto',i.desconto::float8,'desconto_label',i.desconto_label,'subtotal',i.subtotal::float8)) from venda_itens i where i.venda_id=v.id),'[]'::json) as venda_itens
    from vendas v left join canais c on c.id=v.canal_id left join clientes cl on cl.id=v.cliente_id`
};
const ORDER = { sku: 'sku', nome: 'nome', data_venda: 'v.data_venda' };
const APP = d + 'petit_sabo_gestao_supabase.html';

http.createServer(async (q, r) => {
  try {
    if (q.method === 'GET' && q.url === '/sbmock.js') { r.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return r.end(MOCK); }
    if (q.method === 'GET') {
      let h = fs.readFileSync(APP, 'utf8');
      h = h.replace('<script>\n// ═══════════ CAMADA SUPABASE', '<script src="/sbmock.js"></script>\n<script>\n// ═══════════ CAMADA SUPABASE');
      r.setHeader('Content-Type', 'text/html; charset=utf-8'); return r.end(h);
    }
    let body = ''; for await (const c of q) body += c; const b = JSON.parse(body);
    let out;
    try {
      if (b.op === 'select') {
        const col = b.order ? (b.table === 'vendas' ? 'v.data_venda' : ORDER[b.order.c] || b.order.c) : null;
        const sql = SELECTS[b.table] + (col ? ` order by ${col} ${b.order.asc ? 'asc' : 'desc'}` : '') + ` limit ${b.to - b.from + 1} offset ${b.from}`;
        out = { data: (await db.query(sql)).rows, error: null };
      } else if (b.op === 'rpc') {
        const keys = Object.keys(b.args || {}), vals = keys.map(k => typeof b.args[k] === 'object' && b.args[k] !== null ? JSON.stringify(b.args[k]) : b.args[k]);
        const sql = `select public.${b.fn}(${keys.map((k, i) => `${k} => $${i + 1}${typeof b.args[k] === 'object' && b.args[k] !== null ? '::jsonb' : typeof b.args[k] === 'number' ? '::int' : ''}`).join(', ')}) as r`;
        const rows = (await db.query(sql, vals)).rows; out = { data: rows[0].r, error: null };
      } else if (b.op === 'sql') out = { data: (await db.query(b.text)).rows, error: null };
    } catch (e) { out = { data: null, error: { message: e.message } }; }
    r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(out));
  } catch (e) { r.statusCode = 500; r.end(String(e)); }
}).listen(8766, '127.0.0.1', () => console.log('e2e pronto em http://127.0.0.1:8766'));
