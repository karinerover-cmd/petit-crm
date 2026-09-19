import { PGlite } from '@electric-sql/pglite'; import fs from 'fs'; import { createRequire } from 'module';
const require = createRequire(import.meta.url); const X = require('xlsx');
const d = 'C:/Users/karin/OneDrive/Documentos/petit sabo/financeiro petit/sistema petit/';

// ---------- Supabase simulado (mesmo estado do banco real após a Fase 2) ----------
const db = new PGlite();
await db.exec(fs.readFileSync('crm_stub.sql', 'utf8').split('-- a venda que já existe no CRM')[0]);
await db.exec(`insert into canais(nome,tipo) values ('Bagy','online'),('Endossa Asa Sul','consignacao'),('Endossa Augusta','consignacao'),('Feira','fisico'),('Instagram','online'),('WhatsApp','online');`);
for (const f of ['supabase/migrations/20260918120000_fase1_schema_estoque_venda.sql', 'supabase/migrations/20260918120100_fase1_seed_regras_desconto.sql']) await db.exec(fs.readFileSync(d + f, 'utf8'));
await db.exec(`insert into clientes(nome,telefone) values ('Cliente Bagy','61999990000');`);
for (const b of JSON.parse(fs.readFileSync(d + 'migracao/bagy_crm_2026.json', 'utf8')))
  await db.exec(`insert into vendas(cliente_id,canal_id,valor,data_venda,bagy_pedido_id) select (select id from clientes limit 1),(select id from canais where nome='Bagy'),${b.valor},'${b.data_venda}','${b.bagy_pedido_id}'`);
const mig = fs.readFileSync(d + 'supabase/fase2/01_migracao_2026.sql', 'utf8'); const FIM = 'end $mig$;';
await db.query(mig.slice(mig.indexOf('do $mig$'), mig.indexOf(FIM) + FIM.length));
const hojeStr = (await db.query('select hoje_brt()::text h')).rows[0].h;      // "hoje" do banco (fuso de Brasília)
const S = Object.fromEntries((await db.query(`select sku, nome, estoque_atual e, vendas_30d::int v30, data_vencimento::text venc, validade_meses k, valor_sem_desconto::float8 l, dias_para_vencer dias,
  status_validade sv, promocao_sugerida promo, rotatividade rot, meses_restantes mr, desconto_pct::float8 desc, valor_final::float8 vf, status st from tabela_produtos`)).rows.map(r => [r.sku, r]));

// ---------- planilha (valores e dados de entrada) ----------
const wb = X.readFile(d + 'Promoções Petit-atualizada.xlsm');
const tab = X.utils.sheet_to_json(wb.Sheets['Tabela Produtos'], { header: 1, defval: '' }).slice(1).filter(r => String(r[0]).trim());
const vend = X.utils.sheet_to_json(wb.Sheets['Vendas'], { header: 1, defval: '' }).slice(1).filter(r => r[0] && r[1] && typeof r[0] === 'number');
const est = Object.fromEntries(X.utils.sheet_to_json(wb.Sheets['Estoque '], { header: 1, defval: '' }).slice(1).filter(r => String(r[0]).trim()).map(r => [String(r[0]).trim().toUpperCase(), r]));
const desc = X.utils.sheet_to_json(wb.Sheets['DESCONTOS'], { header: 1, defval: '' }).slice(1).filter(r => r[0] !== '');
const iso = n => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
const T = new Date(hojeStr + 'T00:00:00Z'), tMs = T.getTime(), dia = 86400000;

// ---------- a LÓGICA da planilha, fórmula por fórmula ----------
function planilha({ estoque, v30, venc, k, l }) {
  const D = venc ? new Date(venc + 'T00:00:00Z') : null;
  const E = D ? (D.getTime() >= tMs ? Math.round((D.getTime() - tMs) / dia) : 'VENCIDO') : null;
  const num = typeof E === 'number';
  const G = E === null ? null : (num ? (E <= 0 ? 'VENCIDO' : E <= 60 ? 'CRÍTICO' : E <= 120 ? 'PRÓXIMO' : 'OK') : 'OK');   // texto > número: cai em "OK" (erro da planilha)
  const H = E === null ? '' : (num ? (E <= 120 ? 'OUTLET' : E <= 180 ? 'PINK WEEK' : estoque >= 5 ? 'DESCONTO PROGRESSIVO' : 'WHATSHOP') : (estoque >= 5 ? 'DESCONTO PROGRESSIVO' : 'WHATSHOP'));
  const I = v30 >= 5 ? 'BEST-SELLER' : v30 >= 3 ? 'MÉDIO-GIRO' : 'ENCALHADO';
  const M = D && D.getTime() >= tMs ? (D.getUTCFullYear() - T.getUTCFullYear()) * 12 + D.getUTCMonth() - T.getUTCMonth() - (D.getUTCDate() < T.getUTCDate() ? 1 : 0) : null;
  const faixa = M === null ? null : desc.find(r => Number(r[0]) === Number(k) && Number(r[1]) <= M && Number(r[2]) >= M);
  const N = faixa ? Number(faixa[3]) : null;
  const O = N === null ? null : Math.round(l * (1 - N) * 100) / 100;
  const P = !D ? null : (D.getTime() < tMs ? 'Vencido' : estoque > 0 ? 'Ativo' : 'Inativo');
  return { dias: E, sv: G, promo: H, rot: I, mr: M, desc: N, vf: O, st: P };
}

// ---------- CAMADA 1: mesma entrada → mesma saída? (a lógica do banco reproduz a da planilha?) ----------
const dif1 = []; let ok1 = 0, n1 = 0, vencidos = 0, faixaNova = 0;
for (const s of Object.values(S)) {
  if (!s.venc) continue; n1++;
  const p = planilha({ estoque: s.e, v30: s.v30, venc: s.venc, k: s.k, l: s.l });
  const venceu = p.dias === 'VENCIDO';
  if (venceu) { vencidos++; continue; }                           // mudança decidida: vencido sem promoção e com status VENCIDO
  if (p.desc === null && s.desc === 0) { faixaNova++; continue; } // mudança decidida: mês de fabricação = 0% (a planilha dá erro)
  const b = { dias: s.dias, sv: s.sv, promo: s.promo, rot: s.rot, mr: s.mr, desc: s.desc, vf: s.vf, st: s.st };
  const campos = Object.keys(b).filter(c => String(p[c]) !== String(b[c]) && !(typeof b[c] === 'number' && Math.abs(Number(p[c]) - b[c]) < 0.011));
  if (campos.length) dif1.push({ sku: s.sku, campos, planilha: p, banco: b }); else ok1++;
}
console.log('=== CAMADA 1 — mesma entrada, a lógica dá o mesmo resultado? (hoje =', hojeStr + ') ===');
console.log('produtos com vencimento:', n1, '| iguais:', ok1, '| divergentes:', dif1.length, '| fora da comparação por mudança decidida — vencidos:', vencidos, ', mês de fabricação (0%):', faixaNova);
dif1.slice(0, 10).forEach(x => console.log(' ', x.sku, x.campos.join(','), JSON.stringify(x.planilha), JSON.stringify(x.banco)));

// ---------- CAMADA 2: os DADOS das duas fontes ----------
const linhas = [['sku', 'produto', 'estoque_planilha', 'estoque_supabase', 'dif_estoque', 'vendas30d_planilha', 'vendas30d_supabase', 'dif_vendas30d',
  'vencimento_planilha', 'vencimento_supabase', 'dif_vencimento_meses', 'promocao_planilha (hoje)', 'promocao_supabase', 'mesma_promocao', 'motivo_da_diferenca']];
let linhasVazias = 0, so = 0, igual = 0, contagem = { estoque: 0, vendas: 0, venc: 0, promoDif: 0 };
const soPlan = [], soSup = [];
const codigos = new Set(tab.map(r => String(r[0]).trim().toUpperCase()));
for (const r of tab) {
  const sku = String(r[0]).trim().toUpperCase(); const s = S[sku];
  if (sku === '0' || sku === '') { linhasVazias++; continue; }   // linhas em branco do modelo da planilha
  if (!s) { soPlan.push(sku); continue; }
  const eP = Number(est[sku] ? est[sku][4] : r[2]) || 0;
  const v30P = vend.filter(x => String(x[1]).trim().toUpperCase() === sku && iso(x[0]) >= new Date(tMs - 30 * dia).toISOString().slice(0, 10) && iso(x[0]) <= hojeStr).reduce((a, x) => a + (Number(x[3]) || 0), 0);
  const vencP = typeof r[3] === 'number' ? iso(r[3]) : '';
  const pl = planilha({ estoque: eP, v30: v30P, venc: vencP, k: r[10], l: Number(r[11]) || 0 });
  const mesesDif = (vencP && s.venc) ? (Number(s.venc.slice(0, 4)) - Number(vencP.slice(0, 4))) * 12 + Number(s.venc.slice(5, 7)) - Number(vencP.slice(5, 7)) : '';
  const motivo = [];
  const semVenc = !s.venc && vencP;   // produto oculto no Supabase: vencido/esgotado que a usuária desfez (estoque zerado)
  if (semVenc) motivo.push('produto oculto no Supabase (vencido/esgotado desfeito)');
  if (eP !== s.e) { if (!semVenc) motivo.push('estoque diferente'); contagem.estoque++; }
  if (v30P !== s.v30) { motivo.push(s.v30 > v30P ? 'vendas 30d: Supabase tem mais (planilha incompleta em 2026)' : 'vendas 30d: planilha tem mais'); contagem.vendas++; }
  if (mesesDif !== '' && mesesDif !== 0) { motivo.push(mesesDif === 1 ? 'vencimento +1 mês (regra do PRD)' : 'vencimento diferente em ' + mesesDif + ' meses (fabricação divergente)'); contagem.venc++; if (mesesDif === 1) contagem.regra = (contagem.regra || 0) + 1; }
  const promoS = s.promo || '(vencido: sem promoção)', promoP = pl.promo || '';
  const mesma = promoS === promoP;
  if (!mesma) contagem.promoDif++;
  if (!motivo.length && mesma) igual++;
  linhas.push([sku, s.nome, eP, s.e, s.e - eP, v30P, s.v30, s.v30 - v30P, vencP, s.venc || '', mesesDif, promoP, promoS, mesma ? 'sim' : 'NÃO', motivo.join(' + ')]);
}
for (const sku of Object.keys(S)) if (!codigos.has(sku)) soSup.push(sku);
console.log('\n=== CAMADA 2 — dados: planilha × Supabase ===');
console.log('linhas em branco do modelo da planilha (ignoradas):', linhasVazias);
console.log('SKUs na Tabela Produtos da planilha:', tab.length - linhasVazias, '| só na planilha:', soPlan.length, '| só no Supabase:', soSup.length, '(' + soSup.filter(s => !S[s].oculto).length + ' com estoque relevante)');
console.log('em ambos:', tab.length - linhasVazias - soPlan.length, '| totalmente iguais (estoque, vendas 30d, vencimento e promoção):', igual);
console.log('estoque diferente:', contagem.estoque, '| vendas 30d diferentes:', contagem.vendas, '| vencimento diferente:', contagem.venc, '(dos quais +1 mês pela regra do PRD:', contagem.regra || 0, ')', '| promoção sugerida diferente:', contagem.promoDif);
fs.writeFileSync(d + 'migracao/conferencia_planilha_x_supabase.csv', '\uFEFF' + linhas.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n'));
const promoDifs = linhas.slice(1).filter(r => r[13] === 'NÃO');
const porMotivo = {}; promoDifs.forEach(r => { const m = r[14] || '(sem motivo aparente)'; porMotivo[m] = (porMotivo[m] || 0) + 1; });
console.log('\npromoções diferentes por motivo:'); Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).forEach(([m, n]) => console.log('  ', n, m));
console.log('\nSKUs só na planilha (amostra):', soPlan.slice(0, 12).join(', '));
console.log('SKUs só no Supabase:', soSup.slice(0, 12).join(', '));
