// Gera supabase/fase12/02_importacao_planilha_2026.sql a partir das abas mensais de livro-caixa da planilha
// "Vendas Consolidado" (Jan–Jun = Banco Inter, Jul–Ago = Conta C6). Node + xlsx.
// O SQL gerado tem os valores do negócio: fica só no computador da Karine (.gitignore), nunca no GitHub.
// Recusa gerar se a planilha não fechar sozinha (saldo linha a linha, encadeamento entre meses, conta começando do zero).
const X = require('xlsx'), fs = require('fs');
const dir = 'C:/Users/karin/OneDrive/Documentos/petit sabo/financeiro petit/sistema petit/';
const PLANILHA = dir + 'Petit Sabó - Vendas Consolidado 1S2026_6.xlsx';
const SAIDA = dir + 'supabase/fase12/02_importacao_planilha_2026.sql';
const MARCA = 'Importado da planilha Vendas Consolidado';
const ABAS = [['Janeiro', 1, 'Banco Inter'], ['Fevereiro', 2, 'Banco Inter'], ['Março', 3, 'Banco Inter'], ['Abril', 4, 'Banco Inter'],
  ['Maio', 5, 'Banco Inter'], ['Junho', 6, 'Banco Inter'], ['Julho', 7, 'Conta C6'], ['Agosto', 8, 'Conta C6']];

const r2 = n => Math.round(n * 100) / 100;
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v);
const erro = msg => { console.error('NÃO GEROU: ' + msg); process.exit(1); };

const wb = X.readFile(PLANILHA);
const linhas = [], esperado = [];
let contaAnterior = null, saldo = 0;
for (const [aba, mes, conta] of ABAS) {
  const ws = wb.Sheets[aba]; if (!ws) erro('aba "' + aba + '" não encontrada.');
  const corpo = X.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true }).slice(1).filter(r => r && r[1]);
  const comData = corpo.filter(r => r[0] !== null && r[0] !== undefined && r[0] !== '');
  const inicial = comData[0];
  if (!/saldo inicial/i.test(String(inicial[1]))) erro(aba + ': a 1ª linha não é o "Saldo inicial do mês".');
  const saldoInicial = num(inicial[5]);
  if (conta !== contaAnterior) {
    if (saldoInicial !== 0) erro(aba + ': ' + conta + ' deveria começar do zero.');
    saldo = 0;
  } else if (Math.abs(saldoInicial - saldo) > 0.005) erro(aba + ': o saldo inicial não é o saldo final do mês anterior.');
  for (const r of comData.slice(1)) {
    const d = X.SSF.parse_date_code(r[0]);
    if (!d || d.y !== 2026 || d.m !== mes) erro(aba + ': data fora do mês na linha "' + r[1] + '".');
    const e = r2(num(r[3])), s = r2(num(r[4]));
    if ((e > 0) === (s > 0)) erro(aba + ': a linha "' + r[1] + '" precisa ter só entrada ou só saída.');
    if (e < 0 || s < 0) erro(aba + ': valor negativo na linha "' + r[1] + '".');
    saldo = r2(saldo + e - s);
    if (r[5] !== null && r[5] !== undefined && r[5] !== '' && Math.abs(num(r[5]) - saldo) > 0.005) erro(aba + ': saldo acumulado não bate na linha "' + r[1] + '".');
    const categoria = String(r[2] || '').trim() || 'Sem categoria';
    const data = d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0');
    const extrato = (r[6] === null || r[6] === undefined || r[6] === '') ? 'null' : String(r2(num(r[6])));
    linhas.push(`((select id from public.contas_bancarias where nome = ${q(conta)}), '${data}', ${q(String(r[1]).trim())}, ${q(categoria)}, ` +
      `${e}, ${s}, ${/^investimento/i.test(categoria) ? "'investimento'" : "'manual'"}, true, ${extrato}, ${q(MARCA)})`);
  }
  esperado.push(`(${q(conta)}, date '2026-${String(mes).padStart(2, '0')}-01', ${saldo})`);
  contaAnterior = conta;
}

const sql = `-- GERADO por gerar_importacao_caixa.js — NÃO versionar (valores do negócio). ${linhas.length} lançamentos, Jan–Ago/2026.
-- Roda uma vez só, depois da migration da Fase 12. Se o saldo final de algum mês não bater com a planilha, desfaz tudo.
begin;

do $$ begin
  if exists (select 1 from public.fluxo_caixa_movimentos where observacao = ${q(MARCA)}) then
    raise exception 'A planilha já foi importada — nada foi feito.';
  end if;
end $$;

insert into public.fluxo_caixa_movimentos
  (conta_bancaria_id, data_caixa, descricao, categoria, entrada, saida, origem_tipo, confirmado_extrato, saldo_real_banco, observacao)
values
  ${linhas.join(',\n  ')};

-- Conferência: saldo final de cada mês no sistema = "Saldo Final Acumulado" da planilha.
do $$
declare r record; v numeric;
begin
  for r in select * from (values
    ${esperado.join(',\n    ')}
  ) t(conta, mes, saldo_planilha) loop
    select saldo_final into v from public.fluxo_caixa_resumo_mensal where conta_nome = r.conta and mes = r.mes;
    if v is distinct from r.saldo_planilha then
      raise exception 'Conferência falhou em % (%): sistema % x planilha %', r.conta, to_char(r.mes, 'MM/YYYY'), v, r.saldo_planilha;
    end if;
  end loop;
end $$;

commit;
`;
fs.writeFileSync(SAIDA, sql);
console.log('gerado: ' + SAIDA + ' — ' + linhas.length + ' lançamentos, ' + esperado.length + ' meses conferidos no próprio SQL.');
