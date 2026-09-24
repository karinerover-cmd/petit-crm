// Lê o extrato em PDF do Banco Inter, da Conta C6 ou do Nubank PJ e devolve:
//   { banco, periodo: {inicio, fim}, abertura, lanc: [{data, descricao, valor (+ entrada / − saída)}], saldos: {data: saldo do dia} }
// e confere a si mesmo: o saldo recalculado lançamento a lançamento tem que bater com o que o banco imprime.
// Sem dependências (usa pdf_texto.js). Uso: node ler_extrato.js arquivo.pdf
const { execFileSync } = require('child_process');
const MES = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const MES3 = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const r2 = n => Math.round(n * 100) / 100;
const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const brl = s => { const neg = /-\s*R\$/.test(s); const n = Number(String(s).replace(/[^\d,]/g, '').replace(',', '.')); return neg ? -n : n; };
const num = s => Number(String(s).replace(/[^\d,]/g, '').replace(',', '.'));
const mesNome = s => MES[String(s).toLowerCase()];

function ler(arquivo) {
  const txt = execFileSync(process.execPath, [__dirname + '/pdf_texto.js', arquivo], { encoding: 'utf8', maxBuffer: 1e8 });
  const paginas = txt.split('=== página').map(p => p.split('\n').filter(Boolean));
  if (/Banco Inter/.test(txt)) return lerInter(paginas, txt);
  if (/Nu Pagamentos|nubank\.com\.br/i.test(txt)) return lerNubank(paginas, txt);
  if (/C6 Bank|Data\s*\n?lançamento|lançamento\n/i.test(txt)) return lerC6(paginas, txt);
  throw new Error('Não reconheci o banco deste extrato (só leio Banco Inter, Conta C6 e Nubank PJ).');
}

// Inter: "D de Mês de AAAA | Saldo do dia: | R$ x", depois "Descrição | ±R$ valor | R$ saldo por transação".
function lerInter(paginas, txt) {
  const p = txt.match(/Período:\s*\|?\s*(\d{2})\/(\d{2})\/(\d{4}) a (\d{2})\/(\d{2})\/(\d{4})/);
  const periodo = p ? { inicio: iso(p[3], p[2], p[1]), fim: iso(p[6], p[5], p[4]) } : null;
  const lanc = [], saldos = {};
  const dinheiro = x => /^-?R\$ [\d.]+,\d{2}$/.test(String(x).trim());
  let dia = null, pendente = '';                         // um dia pode continuar na página seguinte
  for (const l of paginas.flat()) {
    const d = l.match(/(\d{1,2}) de ([^\s|]+) de (\d{4}) \| Saldo do dia: \| (-?R\$ [\d.]+,\d{2})/);
    if (d) { dia = iso(d[3], mesNome(d[2]), d[1]); saldos[dia] = brl(d[4]); pendente = ''; continue; }
    const t = l.split(' | ');
    if (dia && t.length >= 3 && dinheiro(t[t.length - 2]) && dinheiro(t[t.length - 1])) {
      lanc.push({ data: dia, descricao: t.slice(0, -2).join(' ').replace(/\s+/g, ' ').trim(), valor: brl(t[t.length - 2]), saldo_transacao: brl(t[t.length - 1]) }); pendente = '';
    } else if (dia && t.length === 2 && dinheiro(t[0]) && dinheiro(t[1]) && pendente) {   // descrição longa: o valor fica numa linha só dele
      lanc.push({ data: dia, descricao: pendente, valor: brl(t[0]), saldo_transacao: brl(t[1]) }); pendente = '';
    } else if (dia && t.length === 1 && !/Fale com a gente|SAC:|Ouvidoria/.test(l)) {
      pendente = (pendente + ' ' + l).replace(/\s+/g, ' ').trim();
    }
  }
  const primeiro = lanc[0];
  return { banco: 'Banco Inter', periodo, lanc, saldos, abertura: primeiro ? r2(primeiro.saldo_transacao - primeiro.valor) : 0 };
}

// C6: "dd/mm | dd/mm | Tipo | Descrição | ±R$ valor" (data de lançamento, data contábil) e "Saldo do dia dd/mm/aa | R$ x".
// Usa a data contábil, que é a que casa com o "Saldo do dia".
function lerC6(paginas, txt) {
  const p = txt.match(/Período •(?: \|)? (\d{1,2}) de (\S+) de (\d{4})(?: \|)? até(?: \|)? (\d{1,2}) de (\S+) de (\d{4})/);
  const periodo = p ? { inicio: iso(p[3], mesNome(p[2]), p[1]), fim: iso(p[6], mesNome(p[5]), p[4]) } : null;
  const ano = periodo ? Number(periodo.inicio.slice(0, 4)) : Number((txt.match(/de (20\d\d)/) || [])[1]);
  const lanc = [], saldos = {};
  for (const l of paginas.flat()) {
    const s = l.match(/^Saldo do dia (\d{2})\/(\d{2})\/(\d{2}) \| (.*)$/); if (s) { saldos[iso(2000 + Number(s[3]), s[2], s[1])] = brl(s[4]); continue; }
    const t = l.split(' | '); if (t.length !== 5 || !/^\d{2}\/\d{2}$/.test(t[1])) continue;
    const [dd, mm] = t[1].split('/');
    lanc.push({ data: iso(ano, mm, dd), descricao: (t[2] + ': ' + t[3]).trim(), valor: brl(t[4]) });
  }
  // abertura: saldo do 1º dia − soma dos lançamentos desse dia
  let abertura = 0;
  if (lanc.length) { const d0 = lanc[0].data; abertura = saldos[d0] !== undefined ? r2(saldos[d0] - lanc.filter(l => l.data === d0).reduce((a, l) => a + l.valor, 0)) : 0; }
  return { banco: 'Conta C6', periodo, lanc, saldos, abertura };
}

// Nubank PJ: por dia, grupos "DD MMM AAAA | Total de entradas|saídas | ± valor", as transações do grupo e "Saldo do dia | x".
// Valor sem "R$"; o sinal vem do grupo. A descrição fica só com o tipo e o nome (sem CPF mascarado nem dados da conta).
// O rendimento da conta só aparece no resumo do período: vira uma linha no último dia, para o saldo final bater.
function lerNubank(paginas, txt) {
  const p = txt.match(/(\d{1,2}) DE (\S+) DE (\d{4}) \| (\d{1,2}) DE (\S+) DE (\d{4})/);
  const periodo = p ? { inicio: iso(p[3], mesNome(p[2]), p[1]), fim: iso(p[6], mesNome(p[5]), p[4]) } : null;
  const valorNu = x => /^[\d.]+,\d{2}$/.test(String(x).trim());
  const TIPO = /^(Transferência|Depósito|Pagamento|Compra|Resgate|Aplicação|Pix|Boleto|Estorno|Rendimento|Tarifa|Débito|Crédito|Reembolso)/i;
  const linhas = paginas.flat(), lanc = [], saldos = {};
  const depois = re => { const i = linhas.findIndex(l => re.test(l)); return i >= 0 ? (linhas[i + 1] || '').replace(/^\|\s*/, '').trim() : null; };
  const abertura = valorNu(depois(/\| Saldo inicial$/) || '') ? num(depois(/\| Saldo inicial$/)) : 0;
  const rend = (depois(/\| Rendimento líquido$/) || '').match(/^([+-])\s*([\d.]+,\d{2})$/);
  const nome = d => d.split(' - ')[0].trim();
  let dia = null, sinal = 0, pend = null;
  for (const l of linhas) {
    const g = l.match(/^(\d{2}) ([A-Z]{3}) (\d{4}) \| Total de (entradas|saídas) \| ([+-]) ?([\d.]+,\d{2})$/);
    if (g) { dia = iso(g[3], MES3[g[2]], g[1]); sinal = g[5] === '-' ? -1 : 1; pend = null; continue; }
    const s = l.match(/^Saldo do dia \| ([\d.]+,\d{2})$/); if (s && dia) { saldos[dia] = num(s[1]); pend = null; continue; }
    if (!dia || !sinal) continue;
    const t = l.split(' | ');
    if (TIPO.test(t[0]) && t.length >= 2) {
      const desc = t[0].trim() + ': ' + nome(t[1]);
      if (t.length >= 3 && valorNu(t[t.length - 1])) { lanc.push({ data: dia, descricao: desc, valor: sinal * num(t[t.length - 1]) }); pend = null; }
      else pend = desc;                                   // o valor vem na linha de baixo
    } else if (pend && t.length === 1 && valorNu(l)) { lanc.push({ data: dia, descricao: pend, valor: sinal * num(l) }); pend = null; }
  }
  if (rend && periodo) {
    const v = (rend[1] === '-' ? -1 : 1) * num(rend[2]);
    if (v !== 0) {
      lanc.push({ data: periodo.fim, descricao: 'Rendimento líquido do período', valor: v });
      const total = r2(abertura + lanc.reduce((a, l) => a + l.valor, 0));
      saldos[periodo.fim] = total;                        // = "Saldo final do período" impresso no resumo
    }
  }
  return { banco: 'Nubank PJ', periodo, lanc, saldos, abertura };
}

// Autoconferência: recalcula o saldo e compara com o que o banco imprime (por lançamento no Inter, por dia em todos).
function conferir(r) {
  const erros = []; let saldo = r.abertura; const fimDoDia = {};
  for (const l of r.lanc) {
    saldo = r2(saldo + l.valor);
    if (l.saldo_transacao !== undefined && Math.abs(saldo - l.saldo_transacao) > 0.005) erros.push(`${l.data} "${l.descricao.slice(0, 45)}": recalculado ${saldo} x banco ${l.saldo_transacao}`);
    fimDoDia[l.data] = saldo;
  }
  for (const [d, v] of Object.entries(r.saldos)) if (fimDoDia[d] !== undefined && Math.abs(fimDoDia[d] - v) > 0.005) erros.push(`saldo do dia ${d}: recalculado ${fimDoDia[d]} x banco ${v}`);
  return { erros, saldoFinal: saldo };
}

module.exports = { ler, conferir };
if (require.main === module) {
  const r = ler(process.argv[2]), c = conferir(r);
  console.log(`${r.banco} — ${r.periodo ? r.periodo.inicio + ' a ' + r.periodo.fim : 'período ?'} — ${r.lanc.length} lançamentos — abertura ${r.abertura} — final ${c.saldoFinal}`);
  console.log(c.erros.length ? '  ✘ ' + c.erros.length + ' divergência(s) com o banco:\n    ' + c.erros.slice(0, 10).join('\n    ') : '  ✓ saldo bate com o banco em todos os dias');
}
