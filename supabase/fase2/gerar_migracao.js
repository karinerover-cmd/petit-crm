// Gera supabase/fase2/01_migracao_2026.sql + relatorio (Node, sem dependências além de xlsx)
const X = require('xlsx'), fs = require('fs'), crypto = require('crypto');
const dir = 'C:/Users/karin/OneDrive/Documentos/petit sabo/financeiro petit/sistema petit/';
const outDir = dir + 'supabase/fase2/';
fs.mkdirSync(outDir, { recursive: true });

const app = JSON.parse(fs.readFileSync(dir + 'petit_backup_2026-09-18.json', 'utf8').replace(/^\uFEFF/, ''));
const cv = X.utils.sheet_to_json(
  X.readFile(dir + 'Petit Sabó - Vendas Consolidado 1S2026_6.xlsx').Sheets['Vendas Consolidado'],
  { header: 1, raw: false, defval: '' }).slice(1).filter(r => r[0]);

const money = s => parseFloat(String(s).replace(/[R$\s,]/g, '')) || 0;
const r2 = n => Math.round(n * 100) / 100;
const q = s => s === null || s === undefined || s === '' ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'";
const n = v => v === null || v === undefined ? 'NULL' : String(r2(v));
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['PARA', 'DE', 'DA', 'DO', 'E', 'EM', 'COM', 'A', 'O', 'DI']);
const toks = s => new Set(norm(s).split(' ').filter(t => t && !STOP.has(t))
  .map(t => t.replace(/^MAOS$/, 'MAO').replace(/S$/, '')));
const jac = (a, b) => { let i = 0; a.forEach(t => b.has(t) && i++); return i / (a.size + b.size - i || 1); };

// ---------- produtos: 67 do app + os que só existem na planilha de promoções (legado) ----------
// ESTOQUE_LEGADO: 'planilha' = usa o estoque atual da planilha p/ SKUs que o app não conhece; 'zero' = trata como esgotado
const ESTOQUE_LEGADO = process.env.ESTOQUE_LEGADO || 'planilha';
const COLECAO = { 'OUTONO INVERNO 2026': 'Outono Inverno 2026', 'BOTANICAL BLOMM': 'Botanical Bloom' };
const produtosApp = app.ps3_produtos.map(p => ({
  sku: p.id, nome: p.nome, colecao: COLECAO[String(p.colecao).toUpperCase()] || p.colecao,
  cat: p.cat, fab: p.fab || null, val: p.validMeses || null, preco: p.preco, qtd: p.qtd, oculto: !!p.oculto, origem: 'app' }));
const wbp = X.readFile(dir + 'Promoções Petit-atualizada.xlsm');
const estP = X.utils.sheet_to_json(wbp.Sheets['Estoque '], { header: 1, defval: '' }).slice(1).filter(r => String(r[0]).trim());
const tabP = X.utils.sheet_to_json(wbp.Sheets['Tabela Produtos'], { header: 1, defval: '' }).slice(1).filter(r => String(r[0]).trim());
const tabBy = Object.fromEntries(tabP.map(r => [String(r[0]).trim().toUpperCase(), r]));
const appSkus = new Set(produtosApp.map(p => p.sku));
const prefCol = {};  // coleção mais provável pelo prefixo do SKU (ex.: BB -> Botanical Bloom)
produtosApp.forEach(p => { const k = p.sku.match(/^[A-Z]+/)[0]; (prefCol[k] = prefCol[k] || {})[p.colecao] = (prefCol[k][p.colecao] || 0) + 1; });
const colDe = sku => { const c = prefCol[sku.match(/^[A-Z]+/)[0]]; return c ? Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] : null; };
const catDe = nome => { const t = norm(nome);
  return /VELA/.test(t) ? 'Vela' : /SABONETE/.test(t) ? 'Sabonete' : /CREME|LIP |HIDRAT|LOCAO|MANTEIGA/.test(t) ? 'Hidratante'
    : /PERFUME|SPRAY|DIFUSOR|BRUMA|AROMATIZ|AGUA PARA|SACHE/.test(t) ? 'Perfume / Home Spray' : 'Outro'; };
const isoD = n => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
const produtosLegado = [];
estP.forEach(r => {
  const sku = String(r[0]).trim().toUpperCase(); if (appSkus.has(sku)) return;
  const t = tabBy[sku]; const e = Math.max(0, +r[4] || 0);
  const venc = t && typeof t[3] === 'number' ? isoD(t[3]) : null, vencido = !!venc && venc < '2026-09-18'; // vencido = desfeito → zerado
  const qtd = (ESTOQUE_LEGADO === 'zero' || vencido) ? 0 : e;
  let fab = null, val = null;
  if (qtd > 0 && t && typeof t[3] === 'number' && +t[10] > 0) { // fab a partir do vencimento da planilha (regra antiga: fim do mês de fab+K-1)
    const v = new Date(isoD(t[3]) + 'T00:00:00Z'), f = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth() - (+t[10] - 1), 1));
    fab = String(f.getUTCMonth() + 1).padStart(2, '0') + '/' + f.getUTCFullYear(); val = +t[10]; }
  produtosLegado.push({ sku, nome: String(r[1]).trim(), colecao: colDe(sku), cat: catDe(r[1]), fab, val, preco: t ? money(t[11]) : 0, qtd, oculto: qtd === 0, origem: 'planilha' });
});
const produtos = produtosApp.concat(produtosLegado);
const skuSet = new Set(produtos.map(p => p.sku));
const cat = produtos.map(p => ({ sku: p.sku, t: toks(p.nome), ex: norm(p.nome) }));

// nome do Consolidado -> SKU (catálogo do app + planilha; >=0,75 de similaridade, nome igual = 1; nome em >1 SKU = ambíguo, fica sem SKU)
const KITS = { 'kit stitch': ['STI001', 'STI002', 'STI003'] };
const mapaCache = {};
// mesmo produto com grafia diferente (abaixo do corte de similaridade) — a usuária pode vetar
const ALIAS = { 'creme hidratante patronum': 'ADC006', 'creme patronum': 'ADC006', 'perfume magnet': 'PPC008',
  'vela cúpula pequena': 'HGR006', 'perfume petit for man (250ml)': 'PFM003',
  'manteiga corporal protego': 'ADC019', 'creme hidratante al mare': 'PAM002', 'difusor passion au chocolat': 'PAC017',
  'perfume capivara': 'CAP003', 'escalda pés al mare': 'PAM003', 'vela home garden': 'HGR005', 'vela catedral 70g': 'HGR003',
  'creme hidratante amore di fragola': 'ADF003', 'lip balm hortelã': 'PAM004',
  'perfume petit for man 30ml': 'PFM004', 'creme botanical bloom lavanda': 'BB001', 'sabonete botanical bloom lavanda': 'BB016',
  'creme botanical bloom jasmim': 'BB003', 'creme corporal lavanda': 'BB001', 'vela jasmim': 'BB012', 'sabonete líquido': 'PAC010', 'vela cúpula g': 'HGR007',
  'lip balm fragola': 'ADF006', 'lip balm amore di fragola': 'ADF006', 'lip balm amore di fragola (brinde)': 'ADF006', 'vela coleção nova': 'WBR001',
  'perfume 3 em 1 luxo petit for man': 'PFM003', 'vela áquila': 'ADC013', 'vela meles': 'ADC017', 'vela harry potternoctis': 'ADC009',
  'sabonete amore di fragola': 'ADF008', 'geleia de banho amore di fragola': 'ADF005', 'vela alquimia das casas': 'ADC009', 'geleia de banho': 'ADF005',
  'vela patê home and garden': 'HGR005', 'vela catedral g': 'HGR004', 'escalda pés dia da mulher': 'DDM262', 'difusor rosa': 'HGR009', 'lip balm stitch': 'STI002', 'sabonete gelatina capivara': 'CAP001', 'vela home garden 80g': 'HGR005', 'sabonete botanical bloom calêndula e camomila': 'BB005', 'sabonete botanical bloom jasmim': 'BB006', 'sabonete camomila': 'BB005', 'sabonete glicerinado rosa': 'HGR002', 'escalda pés': 'DDM262', 'sabonete lions': 'ADC004', 'perfume for man': 'PFM004', 'perfume petit for man p': 'PFM004', 'sachê aromático lavanda e capim dourado': 'DDM261', 'vela desejos amizade p': 'N25001', 'escalda pés "um mimo..."': 'DDM262', 'creme para mãos botanical bloom (calêndula e camomila)': 'BB014', 'sugar cream botanical bloom (calêndula e camomila)': 'BB008', 'vela aromática botanical bloom (lavanda)': 'BB010', 'sabonete tarta delícia de maracujá': 'PAC026', 'vela rosas 90g': 'HGR005', 'vela rosas': 'HGR005', 'sabonete rosas': 'HGR001' };
function skuDoNome(nome) {
  if (nome in mapaCache) return mapaCache[nome];
  const al = ALIAS[String(nome).trim().toLowerCase()];
  if (al && skuSet.has(al)) return (mapaCache[nome] = { sku: al, s: 1, motivo: 'apelido confirmado' });
  const ex = cat.filter(c => c.ex === norm(nome));
  let r = { sku: null, s: 0, motivo: 'sem correspondência no catálogo do app' };
  if (ex.length === 1) r = { sku: ex[0].sku, s: 1, motivo: 'nome igual' };
  else if (ex.length > 1) r = { sku: null, s: 1, cands: ex.map(e => e.sku), motivo: 'ambíguo (' + ex.map(e => e.sku).join('/') + ')' };
  else {
    const t = toks(nome);
    const best = cat.map(c => ({ c, s: jac(t, c.t) })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 0.75) r = { sku: best.c.sku, s: best.s, motivo: 'parecido (' + best.s.toFixed(2) + ')' };
    else r = { sku: null, s: best ? best.s : 0, motivo: 'baixa similaridade (melhor: ' + (best ? best.c.sku + ' ' + best.s.toFixed(2) : '-') + ')' };
  }
  return (mapaCache[nome] = r);
}

// ---------- Consolidado -> vendas / itens / brindes ----------
const formaPgto = o => { const t = o.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/boleto/.test(t)) return 'Boleto'; if (/credito/.test(t)) return 'Cartão de crédito';
  if (/debito/.test(t)) return 'Cartão de débito'; if (/dinheiro/.test(t)) return 'Dinheiro';
  if (/pix/.test(t)) return 'Pix'; return null; };
const canalDe = (c, o) => c === 'Site' ? 'Bagy' : c === 'Consignação'
  ? (/Augusta/.test(o) ? 'Endossa Augusta' : /Asa Sul/.test(o) ? 'Endossa Asa Sul' : /Pro Horses/i.test(o) ? 'Pro Horses' : null) : c;

const vendas = {}, itens = [], brindes = [];
cv.forEach(r => {
  const [d, m, y] = r[0].split('/'), data = `${y}-${m}-${d}`, pedido = r[1], obs = String(r[14]).trim();
  const canal = canalDe(r[2], obs); if (!canal) throw new Error('canal indefinido: ' + pedido);
  const v = vendas[pedido] = vendas[pedido] || { id: crypto.randomUUID(), pedido, data, canal, forma: formaPgto(obs),
    valor: 0, desc: 0, obs, legacy: null, cli: null, taxa: 0, cc: 0, cp: 0, fc: 0, fp: 0, origem: 'consolidado' };
  const qtd = +r[4], bruto = money(r[5]), desc = money(r[13]);
  v.valor += bruto; v.taxa += money(r[7]); v.cc += money(r[8]); v.cp += money(r[9]); v.fc += money(r[10]); v.fp += money(r[11]);
  // kits: 1 item por componente, valor rateado pelo preço de cadastro (soma = valor do kit); a baixa de estoque vai em cada componente
  const kit = KITS[String(r[3]).trim().toLowerCase()];
  if (kit && bruto > 0) {
    const pesos = kit.map(c => (produtos.find(p => p.sku === c) || {}).preco || 1), tp = pesos.reduce((a, b) => a + b, 0);
    let resto = bruto;
    kit.forEach((c, k) => {
      const parte = k === kit.length - 1 ? r2(resto) : r2(bruto * pesos[k] / tp); resto -= parte;
      const nomeC = (produtos.find(p => p.sku === c) || {}).nome || c;
      itens.push({ venda: pedido, sku: c, nome: r[3] + ' — ' + nomeC, qtd, preco: r2(parte / qtd), desc: r2(r2(parte / qtd) * qtd - parte) < 0 ? 0 : r2(r2(parte / qtd) * qtd - parte),
        label: null, bruto: parte, motivo: 'kit (componente ' + c + ')' });
    });
    return;
  }
  let s = skuDoNome(r[3]);
  if (s.cands && bruto > 0) { const unit = (bruto + desc) / qtd;
    const bons = s.cands.filter(c => Math.abs(produtos.find(p => p.sku === c).preco - unit) <= 1.0);
    if (bons.length === 1) s = { sku: bons[0], s: 1, motivo: 'desempate por preço (' + s.cands.join('/') + ')' }; }
  if (bruto === 0) { brindes.push({ pedido, data, nome: r[3], qtd, sku: s.sku }); return; }
  let preco = r2((bruto + desc) / qtd), d2 = r2(preco * qtd - bruto);
  if (d2 < 0) { preco = r2(bruto / qtd); d2 = Math.max(0, r2(preco * qtd - bruto)); }
  itens.push({ venda: pedido, sku: s.sku, nome: r[3], qtd, preco, desc: d2, label: desc > 0 ? 'R$ ' + desc.toFixed(2) : null, bruto, motivo: s.motivo });
});

// ---------- vendas do app que NÃO estão no Consolidado ----------
// (após 31/08 + venda de 21/07 "Outro"/Kevin, sem par); as demais já estão no Consolidado
const appNovas = app.ps3_vendas.filter(v => v.data > '2026-08-31' || (v.data === '2026-07-21' && v.canal === 'Outro'));
const CANAL_APP = { 'Site': 'Bagy' };
appNovas.forEach(av => {
  const key = 'APP-' + av.id;
  vendas[key] = { id: crypto.randomUUID(), pedido: key, data: av.data, canal: CANAL_APP[av.canal] || av.canal, forma: null,
    valor: r2(+av.total), desc: r2(+av.descontoTotal || 0), obs: [av.obs, av.cliNome && !av.cliId ? 'Cliente: ' + av.cliNome : ''].filter(Boolean).join(' | ') || null,
    legacy: av.id, cli: av.cliId || null, taxa: null, cc: null, cp: null, fc: null, fp: null, origem: 'app' };
  av.itens.forEach(i => itens.push({ venda: key, sku: skuSet.has(i.pid) ? i.pid : null, nome: i.nome, qtd: i.qtd, preco: r2(i.preco), desc: r2(i.desconto || 0),
    label: i.descontoLabel || null, bruto: r2(i.subtotal), motivo: 'SKU do app' }));
});

// ---------- estoque: estoque_inicial retroativo = qtd do app + saídas migradas ----------
const saidas = {};
itens.filter(i => i.sku && skuSet.has(i.sku)).forEach(i => saidas[i.sku] = (saidas[i.sku] || 0) + i.qtd);
brindes.filter(b => b.sku && skuSet.has(b.sku)).forEach(b => saidas[b.sku] = (saidas[b.sku] || 0) + b.qtd);
// app: vendas já descontadas do estoque contado NÃO se somam de novo além do plug (o plug garante estoque final = app)
fs.writeFileSync(dir + 'supabase/fase2/alvo_estoque.json', JSON.stringify(Object.fromEntries(produtos.map(p => [p.sku, p.qtd]))));
const plug = produtos.map(p => ({ sku: p.sku, q: p.qtd + (saidas[p.sku] || 0) })).filter(x => x.q > 0);

// ---------- pareamento com vendas Bagy que JÁ estão no CRM (por data ±1 dia + valor; o número do pedido é outro) ----------
const crmFile = process.env.BAGY_CRM_FILE || dir + 'migracao/bagy_crm_2026.json';
const pares = [], relPed = [['pedido_planilha_ou_app', 'data', 'valor_itens', 'frete', 'bagy_pedido_id_crm', 'data_crm', 'valor_crm', 'diferenca', 'status']];
if (fs.existsSync(crmFile)) {
  const crm = JSON.parse(fs.readFileSync(crmFile, 'utf8')).map(r => ({ id: String(r.bagy_pedido_id), d: String(r.data_venda).slice(0, 10), v: +r.valor, used: false }));
  const dd = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
  Object.values(vendas).filter(v => v.canal === 'Bagy').sort((a, b) => a.data < b.data ? -1 : 1).forEach(v => {
    const opts = crm.filter(c => !c.used && dd(c.d, v.data) <= 1).map(c => ({ c, diff: Math.min(Math.abs(c.v - v.valor), Math.abs(c.v - (v.valor + (v.fc || 0)))) })).sort((a, b) => a.diff - b.diff);
    const b = opts[0];
    let st = 'SEM PAR (venda nova)';
    const unicoDoDia = opts.filter(o => o.diff <= 20).length === 1; // venda do app não tem frete: se é o único pedido do dia e a diferença é de frete, é a mesma venda
    if (b && (b.diff <= 0.5 || (v.origem === 'app' && b.diff <= 20 && unicoDoDia))) { st = b.diff <= 0.5 ? 'casado' : 'casado (diferença de R$ ' + b.diff.toFixed(2) + ' = frete provável)'; b.c.used = true; pares.push({ pedido: v.pedido, bagy: b.c.id }); }
    else if (b && b.diff <= 5) st = 'PROVÁVEL — não casado, confirmar';
    relPed.push([v.pedido, v.data, v.valor.toFixed(2), (v.fc || 0).toFixed(2), b ? b.c.id : '', b ? b.c.d : '', b ? b.c.v.toFixed(2) : '', b ? b.diff.toFixed(2) : '', st]);
  });
  fs.writeFileSync(dir + 'migracao/mapa_pedidos_bagy.csv', '﻿' + relPed.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n'));
} else console.log('AVISO: sem ' + crmFile + ' — vendas do site serão criadas SEM checar duplicidade com o CRM');

// ---------- clientes do app ----------
const clientes = app.ps3_clientes;

// ---------- SQL ----------
const L = [];
L.push(`-- Fase 2 — migração do histórico de 2026 (gerado em ${new Date().toISOString().slice(0, 10)})
-- Fontes: "Vendas Consolidado 1S2026" (jan–ago) + vendas do app sem par no Consolidado.
-- NÃO migra 2025 nem a aba Vendas da planilha de promoções.
-- Tudo roda dentro de UM bloco DO: o banco trata como uma única instrução (tudo ou nada), mesmo que o
-- SQL Editor rode os comandos em sessões separadas. Se algo falhar, nada é gravado. Só roda uma vez (trava abaixo).
do $mig$
begin

if exists (select 1 from public.vendas where origem = 'migracao') then
  raise exception 'Migração já executada (existem vendas com origem=migracao). Rode 99_rollback_fase2.sql antes de repetir.';
end if;

-- Restos de uma tentativa anterior interrompida (produtos/canais já gravados, mas nenhuma venda migrada):
-- só limpa se NÃO houver nenhum item de venda nem movimento de estoque, ou seja, nada foi realmente usado.
if exists (select 1 from public.produtos) then
  if exists (select 1 from public.venda_itens) or exists (select 1 from public.movimentos_estoque) then
    raise exception 'Já existem produtos com itens de venda ou movimentos de estoque, mas nenhuma venda migrada. Não vou apagar nada sozinho: rode 99_rollback_fase2.sql e me avise.';
  end if;
  delete from public.produtos;
end if;
delete from public.canais c where c.nome in ('Pro Horses','Outro') and not exists (select 1 from public.vendas v where v.canal_id = c.id);
delete from public.clientes cl where cl.legacy_app_id is not null and not exists (select 1 from public.vendas v where v.cliente_id = cl.id)
  and not exists (select 1 from public.cashback k where k.cliente_id = cl.id) and not exists (select 1 from public.follow_up_instancias f where f.cliente_id = cl.id);
update public.clientes set legacy_app_id = null where legacy_app_id is not null;

-- 1) Canais novos (só os que faltam no CRM)
insert into public.canais (nome, tipo)
select v.nome, v.tipo from (values ('Pro Horses','consignacao'), ('Outro','outro')) v(nome, tipo)
 where not exists (select 1 from public.canais c where c.nome = v.nome);
`);
L.push('-- 2) Produtos (' + produtos.length + ' do app; estoque_atual nasce 0 e só muda por movimento)');
L.push('insert into public.produtos (sku, nome, colecao, categoria, data_fabricacao, validade_meses, preco, oculto) values');
L.push(produtos.map(p => `  (${q(p.sku)}, ${q(p.nome)}, ${q(p.colecao)}, ${q(p.cat)}, ${q(p.fab)}, ${p.val ?? 'NULL'}, ${n(p.preco)}, ${p.oculto})`).join(',\n') + ';\n');

L.push('-- 3) Clientes do app: reaproveita quem já existe no CRM (mesmo telefone ou e-mail); cria os demais');
L.push('create temp table mig_clientes (legacy bigint, nome text, tel text, email text) on commit drop;');
if (clientes.length) L.push('insert into mig_clientes values\n' + clientes.map(c => `  (${c.id}, ${q(c.nome)}, ${q(c.tel)}, ${q(c.email)})`).join(',\n') + ';');
L.push(`update public.clientes x set legacy_app_id = m.legacy
  from mig_clientes m
 where x.legacy_app_id is null
   and ((nullif(regexp_replace(coalesce(m.tel,''),'\\D','','g'),'') is not null
         and right(regexp_replace(coalesce(x.telefone,''),'\\D','','g'),9) = right(regexp_replace(m.tel,'\\D','','g'),9))
     or (nullif(btrim(coalesce(m.email,'')),'') is not null and lower(x.email) = lower(m.email)));
insert into public.clientes (nome, telefone, email, legacy_app_id)
select m.nome, nullif(m.tel,''), nullif(m.email,''), m.legacy from mig_clientes m
 where not exists (select 1 from public.clientes x where x.legacy_app_id = m.legacy);
`);

L.push('-- 4) Vendas e itens em tabelas temporárias');
L.push(`create temp table mig_vendas (id uuid, pedido text, data date, canal text, forma text, valor numeric, desconto_venda numeric, obs text,
  legacy bigint, cli bigint, taxa numeric, cc numeric, cp numeric, fc numeric, fp numeric, origem text, existente boolean default false) on commit drop;`);
const vs = Object.values(vendas);
L.push('insert into mig_vendas (id, pedido, data, canal, forma, valor, desconto_venda, obs, legacy, cli, taxa, cc, cp, fc, fp, origem) values');
L.push(vs.map(v => `  ('${v.id}', ${q(v.pedido)}, '${v.data}', ${q(v.canal)}, ${q(v.forma)}, ${n(v.valor)}, ${n(v.desc)}, ${q(v.obs)}, ${v.legacy ?? 'NULL'}, ${v.cli ?? 'NULL'}, ${n(v.taxa)}, ${n(v.cc)}, ${n(v.cp)}, ${n(v.fc)}, ${n(v.fp)}, '${v.origem}')`).join(',\n') + ';\n');
L.push('create temp table mig_itens (pedido text, sku text, nome text, qtd int, preco numeric, desconto numeric, label text) on commit drop;');
L.push('insert into mig_itens values');
L.push(itens.map(i => `  (${q(i.venda)}, ${q(i.sku)}, ${q(i.nome)}, ${i.qtd}, ${n(i.preco)}, ${n(i.desc)}, ${q(i.label)})`).join(',\n') + ';\n');
L.push('create temp table mig_brindes (pedido text, data date, sku text, nome text, qtd int) on commit drop;');
if (brindes.length) { L.push('insert into mig_brindes values'); L.push(brindes.map(b => `  (${q(b.pedido)}, '${b.data}', ${q(b.sku)}, ${q(b.nome)}, ${b.qtd})`).join(',\n') + ';\n'); }

L.push('create temp table mig_pares (pedido text, bagy_id text) on commit drop;');
if (pares.length) L.push('insert into mig_pares values\n' + pares.map(p => `  (${q(p.pedido)}, ${q(p.bagy)})`).join(',\n') + ';');
L.push(`-- 5) Vendas do site que JÁ estão no CRM (pareadas por data + valor, ver mapa_pedidos_bagy.csv): não cria venda nova;
--    só completa a existente e anexa os itens.
update mig_vendas m set id = v.id, existente = true
  from mig_pares p join public.vendas v on v.bagy_pedido_id = p.bagy_id
 where m.pedido = p.pedido;

update public.vendas v set
       legacy_app_id       = coalesce(v.legacy_app_id, m.legacy),
       forma_pagamento     = coalesce(v.forma_pagamento, m.forma),
       pedido_externo      = coalesce(v.pedido_externo, m.pedido),
       observacao          = coalesce(v.observacao, m.obs),
       taxa_pagamento      = m.taxa, comissao_canal = m.cc, comissao_plataforma = m.cp,
       frete_cobrado       = m.fc,   frete_pago = m.fp
  from (select id, min(legacy) legacy, min(forma) forma, min(pedido) pedido, min(obs) obs, sum(taxa) taxa, sum(cc) cc, sum(cp) cp, sum(fc) fc, sum(fp) fp
          from mig_vendas where existente group by id) m
 where v.id = m.id;

-- 6) Vendas novas
insert into public.vendas (id, cliente_id, canal_id, valor, data_venda, forma_pagamento, desconto_venda, origem, pedido_externo, observacao,
                           legacy_app_id, taxa_pagamento, comissao_canal, comissao_plataforma, frete_cobrado, frete_pago, bagy_pedido_id)
select m.id, (select c.id from public.clientes c where c.legacy_app_id = m.cli),
       (select c.id from public.canais c where c.nome = m.canal), m.valor, m.data, m.forma, m.desconto_venda, 'migracao',
       m.pedido, m.obs, m.legacy, m.taxa, m.cc, m.cp, m.fc, m.fp,
       null
  from mig_vendas m where not m.existente;

-- 7) Itens (cada item com SKU gera sozinho a saída de estoque)
insert into public.venda_itens (venda_id, sku, produto_nome, quantidade, preco_unitario, desconto, desconto_label)
select m.id, i.sku, i.nome, i.qtd, i.preco, i.desconto, i.label
  from mig_itens i join mig_vendas m on m.pedido = i.pedido;

-- 8) Brindes: saída de estoque sem venda (não entram no faturamento)
insert into public.movimentos_estoque (sku, tipo, quantidade, data, observacao)
select b.sku, 'retirada', -b.qtd, b.data, 'brinde — pedido ' || b.pedido from mig_brindes b where b.sku is not null;
`);
L.push('-- 9) Estoque inicial retroativo (01/01/2026): quantidade contada no app + saídas migradas,');
L.push('--    para que o estoque atual de cada produto termine IGUAL ao contado no app.');
L.push('insert into public.movimentos_estoque (sku, tipo, quantidade, data, observacao) values');
L.push(plug.map(p => `  (${q(p.sku)}, 'estoque_inicial', ${p.q}, '2026-01-01', 'retroativo: contagem do app em 18/09/2026 + saídas migradas')`).join(',\n') + ';\n');
L.push(`end $mig$;

-- 10) Conferência (esperado: 142 / 198 / 252 / 19 / ${plug.length + brindes.filter(b => b.sku).length + itens.filter(i => i.sku).length})
select 'produtos' as item, count(*) as total from public.produtos
union all select 'vendas migradas', count(*) from public.vendas where origem = 'migracao'
union all select 'itens de venda', count(*) from public.venda_itens
union all select 'vendas do site já existentes no CRM (completadas)', count(*) from public.vendas where origem <> 'migracao' and pedido_externo is not null
union all select 'movimentos de estoque', count(*) from public.movimentos_estoque;
`);
fs.writeFileSync(outDir + '01_migracao_2026.sql', L.join('\n'));

// ---------- rollback ----------
fs.writeFileSync(outDir + '99_rollback_fase2.sql', `-- Desfaz a migração da Fase 2 (só o que ela criou). Vendas do CRM que ela apenas completou
-- (pedidos Bagy já existentes) ficam com os campos extras preenchidos — inofensivo.
begin;
delete from public.vendas where origem = 'migracao';       -- apaga itens e saídas de estoque em cascata
-- pedidos do CRM (Bagy) que a migração só completou: remove os itens anexados e limpa os campos preenchidos
delete from public.venda_itens where venda_id in (select id from public.vendas where origem <> 'migracao' and pedido_externo is not null);
update public.vendas set forma_pagamento = null, pedido_externo = null, observacao = null, taxa_pagamento = null,
       comissao_canal = null, comissao_plataforma = null, frete_cobrado = null, frete_pago = null
 where origem <> 'migracao' and pedido_externo is not null;
delete from public.movimentos_estoque where observacao like 'retroativo:%' or observacao like 'brinde — pedido %';
delete from public.produtos;                                 -- só existem os 67 da migração (Fase 1 não cria produtos)
delete from public.clientes where legacy_app_id is not null and not exists (select 1 from public.vendas v where v.cliente_id = clientes.id)
                              and not exists (select 1 from public.cashback c where c.cliente_id = clientes.id)
                              and not exists (select 1 from public.follow_up_instancias f where f.cliente_id = clientes.id);
update public.clientes set legacy_app_id = null;
delete from public.canais where nome in ('Pro Horses','Outro')
   and not exists (select 1 from public.vendas v where v.canal_id = canais.id);
commit;
`);

// ---------- relatório ----------
const semSku = {};
itens.filter(i => !i.sku).forEach(i => { const k = i.nome.trim(); const v = vendas[i.venda];
  semSku[k] = semSku[k] || { un: 0, rs: 0, n: 0, motivo: i.motivo, datas: new Set(), canais: new Set() };
  semSku[k].un += i.qtd; semSku[k].rs += i.bruto; semSku[k].n++; semSku[k].datas.add(v.data.split('-').reverse().slice(0, 2).join('/')); semSku[k].canais.add(v.canal); });
const rel = [['produto_no_consolidado', 'valor_R$', 'unidades', 'linhas', 'datas (dd/mm)', 'canais', 'palpite_do_sistema', 'SKU_correto (preencher)']];
Object.entries(semSku).sort((a, b) => b[1].rs - a[1].rs).forEach(([k, v]) => rel.push([k, v.rs.toFixed(2), v.un, v.n, [...v.datas].sort((a, b) => a.split('/').reverse().join().localeCompare(b.split('/').reverse().join())).join(' · '), [...v.canais].join(' · '), v.motivo.replace('baixa similaridade (melhor: ', 'parecido com ').replace(')', ''), '']));
brindes.filter(b => !b.sku).forEach(b => rel.push(['(BRINDE) ' + b.nome.trim(), '0.00', b.qtd, 1, b.data.split('-').reverse().slice(0, 2).join('/'), vendas[b.pedido].canal, 'brinde sem SKU: não baixa estoque', '']));
const gravaCsv = (f, c) => { try { fs.writeFileSync(f, c); } catch (e) { fs.writeFileSync(f.replace('.csv', '-novo.csv'), c); } };
gravaCsv(dir + 'migracao/itens_sem_sku_ATUALIZADO.csv', '﻿' + rel.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n'));

const tot = a => a.reduce((s, x) => s + x, 0);
console.log(JSON.stringify({
  produtos: produtos.length, legado: produtosLegado.length, legadoVencidoZerado: produtosLegado.filter(p => p.qtd === 0).length, legadoComEstoque: produtosLegado.filter(p => p.qtd > 0).length, unidadesLegado: produtosLegado.reduce((a, p) => a + p.qtd, 0), clientesApp: clientes.length, vendas: vs.length, vendasConsolidado: vs.filter(v => v.origem === 'consolidado').length, vendasApp: vs.filter(v => v.origem === 'app').length,
  itens: itens.length, itensComSku: itens.filter(i => i.sku).length, itensSemSku: itens.filter(i => !i.sku).length,
  valorItensSemSku: r2(tot(itens.filter(i => !i.sku).map(i => i.bruto))), brindes: brindes.length, brindesComSku: brindes.filter(b => b.sku).length,
  valorTotalVendas: r2(tot(vs.map(v => v.valor))), estoquePlug: plug.length }, null, 1));
