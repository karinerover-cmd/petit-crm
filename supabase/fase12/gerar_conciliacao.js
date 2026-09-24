// Gera o SQL da conciliação do mês a partir dos extratos em PDF (Conta C6, Nubank PJ; também lê o Banco Inter).
// Uso: node gerar_conciliacao.js [--desde AAAA-MM-DD] [--saida arquivo.sql] extrato1.pdf extrato2.pdf ...
//   --desde: só entram linhas a partir desta data (padrão 2026-09-01, o início do espelho do banco); o saldo de abertura
//            é recalculado para essa data a partir do próprio extrato.
// Recusa gerar se o saldo recalculado de algum extrato não bater com o que o banco imprime.
// O SQL gerado tem os lançamentos reais das contas: fica só no computador da Karine (.gitignore), nunca no GitHub.
// Ele só chama gestao_importar_extrato(); o pareamento e a aprovação acontecem na aba "Conciliação" do app.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { ler, conferir } = require('./ler_extrato.js');
const CONTA = { 'Banco Inter': 'Banco Inter', 'Conta C6': 'Conta C6', 'Nubank PJ': 'Nubank PJ Berenice' };
const r2 = n => Math.round(n * 100) / 100;

const args = process.argv.slice(2); let desde = '2026-09-01', saida = null; const arquivos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--desde') desde = args[++i]; else if (args[i] === '--saida') saida = args[++i]; else arquivos.push(args[i]);
}
if (!arquivos.length) { console.error('Uso: node gerar_conciliacao.js [--desde AAAA-MM-DD] [--saida arquivo.sql] extrato1.pdf ...'); process.exit(1); }

const chamadas = [], resumo = [];
for (const arq of arquivos) {
  const r = ler(arq), c = conferir(r), conta = CONTA[r.banco];
  if (c.erros.length) { console.error(`NÃO GEROU: o extrato ${path.basename(arq)} (${r.banco}) não bate com o saldo do banco:\n  ` + c.erros.slice(0, 10).join('\n  ')); process.exit(1); }
  if (!r.periodo) { console.error(`NÃO GEROU: não achei o período no extrato ${path.basename(arq)}.`); process.exit(1); }
  if (r.periodo.fim < desde) { resumo.push(`${conta}: extrato termina em ${r.periodo.fim}, antes de ${desde} — nada a importar`); continue; }
  const inicio = r.periodo.inicio > desde ? r.periodo.inicio : desde;
  // saldo corrido; a última linha de cada dia leva o saldo do fim do dia (conferido acima com o que o banco imprime)
  let saldo = r.abertura, abertura = r.abertura; const vistos = {}, linhas = [];
  r.lanc.forEach((l, i) => {
    saldo = r2(saldo + l.valor);
    if (l.data < inicio) { abertura = saldo; return; }
    const chave = [conta, l.data, l.valor.toFixed(2), l.descricao].join('|');
    vistos[chave] = (vistos[chave] || 0) + 1;
    const ultimoDoDia = !r.lanc[i + 1] || r.lanc[i + 1].data !== l.data;
    linhas.push({ data: l.data, descricao: l.descricao, valor: r2(l.valor), saldo_banco: ultimoDoDia ? saldo : null,
      ref: crypto.createHash('sha1').update(chave + '|' + vistos[chave]).digest('hex').slice(0, 20) });
  });
  const p = { conta, periodo_inicio: inicio, periodo_fim: r.periodo.fim, saldo_abertura: abertura, saldo_final: c.saldoFinal,
    arquivo: path.basename(arq), linhas };
  chamadas.push(`select public.gestao_importar_extrato($json$${JSON.stringify(p)}$json$::jsonb);`);
  resumo.push(`${conta}: ${inicio} a ${r.periodo.fim} — ${linhas.length} linha(s), saldo do banco ${abertura} → ${c.saldoFinal} ✓ conferido`);
}

if (!chamadas.length) { console.log('Nada a importar:\n  ' + resumo.join('\n  ')); process.exit(0); }
const destino = saida || path.join(__dirname, 'conciliacoes', 'conciliacao_' + new Date().toISOString().slice(0, 10) + '.sql');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, `-- GERADO por gerar_conciliacao.js — NÃO versionar (lançamentos reais das contas).
-- ${resumo.join('\n-- ')}
-- Rode no SQL Editor do Supabase; depois abra Fluxo de caixa → Conciliação. Rodar de novo não duplica nada.
begin;
${chamadas.join('\n')}
commit;
`);
console.log('gerado: ' + destino + '\n  ' + resumo.join('\n  '));
