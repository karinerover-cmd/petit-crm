// Monta petit_sabo_gestao_supabase.html a partir do app original (que NÃO é alterado).
const fs = require('fs');
const dir = 'C:/Users/karin/OneDrive/Documentos/petit sabo/financeiro petit/sistema petit/';
let h = fs.readFileSync(dir + 'petit_sabo_gestao.html', 'utf8');
const camada = fs.readFileSync(__dirname + '/camada_supabase.js', 'utf8');
const nfe = fs.readFileSync(__dirname + '/../fase6/nfe.js', 'utf8'), telaNotas = fs.readFileSync(__dirname + '/../fase6/tela_notas.js', 'utf8');   // Fase 6b
const soapcalc = fs.readFileSync(__dirname + '/../fase7/soapcalc.js', 'utf8'), precificacao = fs.readFileSync(__dirname + '/../fase7/precificacao.js', 'utf8'), telaFormulas = fs.readFileSync(__dirname + '/../fase7/tela_formulas.js', 'utf8');   // Fase 7
const telaLotes = fs.readFileSync(__dirname + '/../fase8/tela_lotes.js', 'utf8');   // Fase 8
const telaMargem = fs.readFileSync(__dirname + '/../fase9/tela_margem.js', 'utf8');   // Fase 9
const telaIndicadores = fs.readFileSync(__dirname + '/../fase10/tela_indicadores.js', 'utf8');   // Fase 10
const telaMateriaPrimaRotina = fs.readFileSync(__dirname + '/../fase11/tela_materia_prima_rotina.js', 'utf8');   // Fase 11
const numeros = fs.readFileSync(__dirname + '/numeros.js', 'utf8');   // leitor único de números (formato brasileiro), usado pelas telas 6–10

function troca(de, para, rotulo) {
  const n = h.split(de).length - 1;
  if (n !== 1) throw new Error(rotulo + ': esperava 1 ocorrência, achei ' + n);
  h = h.split(de).join(para);
}

// 1) não gravar dados de negócio no localStorage enquanto for somente leitura
troca("function save(k,v){_lsSet(k,v);if(k!=='ps3_checklist')agendarSync();}",
  "function save(k,v){if(window.__SEM_LS&&['ps3_produtos','ps3_vendas','ps3_clientes','ps3_canais'].includes(k))return;_lsSet(k,v);if(k!=='ps3_checklist')agendarSync();}", 'save');
// 2) regra de vencimento do PRD: último dia do mês (fabricação + validade), um mês depois da regra antiga do app
troca("const d=new Date(parseInt(y),parseInt(m)-1+parseInt(meses),1);", "const d=new Date(parseInt(y),parseInt(m)-1+parseInt(meses)+1,1); // regra do PRD (Fase 3)", 'calcVencimento');
// 2b) fevereiro sempre vence dia 28 (fevereiro varia entre 28 e 29 dias)
troca("  d.setDate(d.getDate()-1);\n  return d;", "  d.setDate(d.getDate()-1);\n  if(d.getMonth()===1) d.setDate(28); // fevereiro: sempre dia 28\n  return d;", 'calcVencimento fev');
// 3) ids de cliente agora são texto (uuid): precisam de aspas no onclick
troca("onclick=\"excluirCliente(${c.id})\"", "onclick=\"excluirCliente('${c.id}')\"", 'excluirCliente');

const css = `<style>
/* Fase 6+: o menu ganhou várias seções novas (Notas fiscais, Fórmulas, Lotes e preços, Margem de vendas) e passou a não caber
   na altura da tela; o menu original não tinha rolagem própria (só ele, o conteúdo da página rola normalmente). */
.sb-nav{overflow-y:auto;min-height:0}
/* No app original, .alert nasce escondida (display:none) e o próprio app a mostra por código. Nas telas das Fases 6–10
   os avisos são sempre para aparecer — sem isto, eles ficavam invisíveis (ex.: "nota já importada", "custo incompleto"). */
#sec-notas .alert,#sec-formulas .alert,#sec-lotes .alert,#sec-margem .alert,#sec-indicadores .alert{display:block;background:#FFF4DC;color:#8A5A00;border:1px solid #F0D9A8}
#gs-login{position:fixed;inset:0;z-index:99999;background:#fdf8f6;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif}
#gs-login form{background:#fff;border:1px solid #eadfd9;border-radius:14px;padding:28px;width:min(360px,92vw);box-shadow:0 8px 30px rgba(0,0,0,.08)}
#gs-login h1{font-size:20px;margin:0 0 4px;color:#a63d63}#gs-login p{margin:0 0 16px;color:#777;font-size:13px}
#gs-login label{display:block;font-size:12px;margin:10px 0 4px;color:#555}
#gs-login input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d9cfc9;border-radius:8px;font-size:14px}
#gs-login button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:8px;background:#d4537e;color:#fff;font-size:14px;cursor:pointer}
#gs-msg{margin-top:12px;font-size:12px;color:#a63d63;min-height:16px}
#gs-banner{display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#2e7d32;color:#fff;font:600 12px system-ui,sans-serif;padding:5px 12px;align-items:center;gap:12px;justify-content:center}
#gs-banner button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;padding:2px 10px;cursor:pointer;font-size:12px}
body{padding-bottom:30px}
</style>`;
troca('</head>', '<script>window.__SEM_LS=true;</script>\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>\n' + css + '\n</head>', 'head');

const overlay = `
<div id="gs-banner">✅ FASE 3b — grava no Supabase e espelha no localStorage <button id="gs-sair" type="button">Sair</button></div>
<div id="gs-login"><form id="gs-form"><h1>🌸 Petit Sabó — Gestão</h1><p>Entre com o mesmo e-mail e senha do CRM.</p>
<label>E-mail</label><input id="gs-email" type="email" required autocomplete="username">
<label>Senha</label><input id="gs-senha" type="password" required autocomplete="current-password">
<button type="submit">Entrar</button><div id="gs-msg"></div></form></div>`;
troca('<body>', '<body>' + overlay, 'body');

// 4) camada Supabase depois do script principal
troca('</script>\n</body>', '</script>\n<script>\n' + camada + '\n</script>\n<script>\n' + numeros + '\n</script>\n<script>\n' + nfe + '\n</script>\n<script>\n' + telaNotas + '\n</script>\n<script>\n' + soapcalc + '\n' + precificacao + '\n</script>\n<script>\n' + telaFormulas + '\n</script>\n<script>\n' + telaLotes + '\n</script>\n<script>\n' + telaMargem + '\n</script>\n<script>\n' + telaIndicadores + '\n</script>\n<script>\n' + telaMateriaPrimaRotina + '\n</script>\n</body>', 'fim');

fs.writeFileSync(dir + 'petit_sabo_gestao_supabase.html', h);
console.log('gerado:', (h.length / 1024).toFixed(1) + ' KB');
