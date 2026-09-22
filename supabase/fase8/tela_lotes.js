// ═══════════ TELA "LOTES E PREÇOS" (Fase 8) ═══════════
// Registra lotes de fabricação, calcula o custo (fórmula + embalagem de produto + mão de obra) e sugere o preço (custo unitário × markup).
// O preço sugerido só vira preço do produto quando VOCÊ aprova ou ajusta. Depende de window.__gestao.sb() (camada_supabase.js).
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const num4 = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const numero = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? null : n; };
  const arred90 = p => Math.ceil(Number(p) + 0.10) - 0.10;            // preços terminados em ,90 (ex.: 36,42 → 36,90)
  const STATUS = { pendente: ['aguardando aprovação', 'badge-pink'], aprovado: ['aprovado', 'badge-blue'], ajustado: ['ajustado', 'badge-blue'], descartado: ['descartado', ''] };
  let D = { produtos: [], formulas: [], mps: [], emb: [], lotes: [], cfg: { valor_hora_mao_de_obra: 14.03, markup_varejo: 3 } }, aba = 'novo', soPendentes = true, calc = null, embSku = '', embLinhas = [], aberto = null, NP = null, npCalc = null, npSeq = 0;

  async function ler(t, col, asc) {
    let q = sb().from(t).select('*'); if (col) q = q.order(col, { ascending: asc !== false });
    const { data, error } = await q.range(0, 4999); if (error) throw new Error(t + ': ' + error.message); return data || [];
  }
  async function carregar() {
    const [produtos, formulas, mps, emb, lotes, cfg] = await Promise.all([ler('produtos', 'sku'), ler('formulas', 'criado_em', false), ler('materias_primas', 'nome'), ler('produto_embalagem'), ler('lotes_fabricacao', 'criado_em', false), ler('configuracao_precificacao')]);
    D = { produtos, formulas, mps, emb, lotes, cfg: cfg[0] || D.cfg };
  }
  async function rpc(nome, args) { const { data, error } = await sb().rpc(nome, args); if (error) throw new Error(error.message); return data; }
  function aviso(t, ok) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;bottom:44px;right:20px;max-width:440px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }
  const produto = sku => D.produtos.find(p => p.sku === sku);
  const nomeProd = sku => { const p = produto(sku); return p ? p.nome : sku; };
  const pendentes = () => D.lotes.filter(l => l.status_aprovacao === 'pendente');
  const skusComFormula = () => [...new Set(D.formulas.filter(f => f.ativa && f.sku).map(f => f.sku))].sort();

  // ---------- detalhe do cálculo ----------
  function detalhe(c) {
    const linhas = (c.detalhe || []).map(i => `<tr><td>${i.tipo === 'formula' ? 'Fórmula' : 'Embalagem'}</td><td>${esc(i.nome)}</td><td>${num4(i.quantidade)} ${esc(i.unidade)}</td><td>${i.custo_unitario == null ? '<span style="color:#A32D2D">sem custo</span>' : 'R$ ' + num4(i.custo_unitario)}</td><td>${i.subtotal == null ? '—' : brl(i.subtotal)}</td></tr>`).join('');
    return `<table><thead><tr><th>Origem</th><th>Item</th><th>Quantidade no lote</th><th>Custo unitário</th><th>Subtotal</th></tr></thead><tbody>${linhas}</tbody></table>`;
  }
  function resumo(c) {
    const sug = c.preco_sugerido_varejo;
    return `<div class="stats-grid" style="margin-bottom:12px">
      <div class="stat-card"><div class="stat-label">Matéria-prima</div><div class="stat-val" style="font-size:18px">${brl(c.custo_materia_prima_total)}</div><div class="stat-sub">${num4(c.receitas)} receita(s) da fórmula v${c.formula_versao}</div></div>
      <div class="stat-card"><div class="stat-label">Embalagem de produto</div><div class="stat-val" style="font-size:18px">${brl(c.custo_embalagem_total)}</div></div>
      <div class="stat-card"><div class="stat-label">Mão de obra</div><div class="stat-val" style="font-size:18px">${brl(c.custo_mao_de_obra)}</div><div class="stat-sub">${num4(c.horas)} h × ${brl(c.valor_hora)}</div></div>
      <div class="stat-card"><div class="stat-label">Custo unitário</div><div class="stat-val" style="font-size:18px">${brl(c.custo_unitario)}</div><div class="stat-sub">total ${brl(c.custo_total)} ÷ ${c.quantidade}</div></div>
      <div class="stat-card"><div class="stat-label">Preço sugerido (× ${num4(c.markup)})</div><div class="stat-val" style="font-size:18px">${sug == null ? '—' : brl(sug)}</div><div class="stat-sub">${sug == null ? '' : 'arredondado: ' + brl(arred90(sug)) + ' · '}${c.produto_novo ? 'produto novo: começa sem preço' : 'preço atual ' + brl(c.preco_atual)}</div></div></div>
      ${c.custo_incompleto ? `<div class="alert" style="margin-bottom:10px">⚠️ Custo incompleto — sem custo cadastrado: <b>${esc(c.itens_sem_custo)}</b>. O preço sugerido não é calculado. Preencha os custos em Notas fiscais → Matérias-primas.</div>` : ''}
      <details><summary class="td-muted">Ver o custo de cada item</summary><div class="table-card" style="margin-top:8px">${detalhe(c)}</div></details>`;
  }

  // ---------- abas ----------
  function tabNovo() {
    const skus = skusComFormula(), hoje = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    if (!skus.length) return '<div class="empty-state">Nenhum produto tem fórmula ativa ainda. Cadastre a fórmula em 🧴 Fórmulas, ou use 🆕 Produto novo.</div>';
    return `<p class="td-muted">Lote de um produto que já existe. Para um produto que ainda não existe, use 🆕 Produto novo.</p><div class="table-card" style="padding:16px;margin-bottom:12px"><div class="grid2f">
      <div class="field"><label>Produto</label><select id="lt-sku" onchange="PetitLT.calc()">${skus.map(s => `<option value="${esc(s)}">${esc(s)} — ${esc(nomeProd(s))}</option>`).join('')}</select></div>
      <div class="field"><label>Data de fabricação</label><input type="date" id="lt-data" value="${hoje}"></div>
      <div class="field"><label>Unidades produzidas</label><input id="lt-qtd" placeholder="ex.: 18" onchange="PetitLT.calc()"></div>
      <div class="field"><label>Horas trabalhadas (no lote todo)</label><input id="lt-horas" placeholder="ex.: 6" onchange="PetitLT.calc()"></div>
      <div class="field" style="grid-column:1/-1"><label>Observação</label><input id="lt-obs"></div></div>
      <div class="td-muted">Mão de obra: ${brl(D.cfg.valor_hora_mao_de_obra)}/h · markup de varejo: × ${num4(D.cfg.markup_varejo)} (altere em ⚙️ Configuração). O lote não altera o estoque.</div></div>
      <div id="lt-resultado"><div class="td-muted">Preencha as unidades e as horas para ver o custo e o preço sugerido.</div></div>`;
  }
  function tabLotes() {
    if (!D.lotes.length) return '<div class="empty-state">Nenhum lote registrado ainda.</div>';
    const lista = soPendentes ? pendentes() : D.lotes;
    const filtro = `<div class="table-toolbar"><label class="toggle-label"><input type="checkbox" ${soPendentes ? 'checked' : ''} onchange="PetitLT.filtro(this.checked)"> mostrar só os que esperam aprovação (${pendentes().length})</label></div>`;
    if (!lista.length) return filtro + '<div class="empty-state">Nenhum lote esperando aprovação. 🎉</div>';
    return filtro + `<div class="table-card"><table><thead><tr><th>Data</th><th>Produto</th><th>Unid.</th><th>Custo unit.</th><th>Sugerido</th><th>Preço atual</th><th>Situação</th><th></th></tr></thead><tbody>${lista.map(l => {
      const st = l.custo_incompleto && l.status_aprovacao === 'pendente' ? ['custo incompleto', 'badge-pink'] : (STATUS[l.status_aprovacao] || [l.status_aprovacao, '']), p = produto(l.sku), sug = l.preco_sugerido_varejo, pend = l.status_aprovacao === 'pendente';
      let acoes = '';
      if (pend) acoes = `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">${sug != null ? `<button class="btn btn-primary btn-sm" onclick="PetitLT.aprovar('${l.id}')">Aprovar ${brl(sug)}</button>` : ''}
        <input id="lt-preco-${l.id}" style="width:90px" value="${sug != null ? arred90(sug).toFixed(2).replace('.', ',') : ''}" placeholder="preço"><button class="btn btn-outline btn-sm" onclick="PetitLT.ajustar('${l.id}')">Ajustar</button><button class="btn btn-outline btn-sm" onclick="PetitLT.descartar('${l.id}')">Descartar</button></div>`;
      const ver = `<button class="btn-icon" title="Ver detalhes" onclick="PetitLT.ver('${l.id}')">🔍</button> <button class="btn-icon" title="Excluir lote" onclick="PetitLT.excluir('${l.id}')">🗑</button>`;
      let h = `<tr><td>${dataBR(l.data_fabricacao)}</td><td>${esc(l.sku)}<div class="td-muted">${esc(nomeProd(l.sku))}</div></td><td>${l.quantidade_produzida}<div class="td-muted">${num4(l.horas_trabalhadas)} h</div></td><td>${brl(l.custo_unitario)}</td>
        <td>${sug == null ? '—' : brl(sug)}</td><td>${p ? brl(p.preco) : '—'}${l.preco_aprovado != null ? '<div class="td-muted">aplicado ' + brl(l.preco_aprovado) + '</div>' : ''}</td><td><span class="badge ${st[1]}">${st[0]}</span></td><td>${acoes}${acoes ? '<div style="margin-top:4px">' + ver + '</div>' : ver}</td></tr>`;
      if (aberto === l.id) h += `<tr><td colspan="8" style="background:var(--surface2)">${resumo(Object.assign({}, l, { quantidade: l.quantidade_produzida, horas: l.horas_trabalhadas, formula_versao: l.formula_versao, preco_atual: p ? p.preco : null, detalhe: l.detalhe, itens_sem_custo: l.itens_sem_custo, custo_incompleto: l.custo_incompleto }))}${l.observacao ? '<div class="td-muted">Obs.: ' + esc(l.observacao) + '</div>' : ''}</td></tr>`;
      return h;
    }).join('')}</tbody></table></div>`;
  }
  function tabEmb() {
    const skus = D.produtos.filter(p => !p.oculto).map(p => p.sku), mpsEmb = D.mps.filter(m => m.categoria === 'embalagem_produto' && m.ativo !== false);
    return `<p class="td-muted">Embalagem de produto de UMA unidade (pote, tampa, rótulo, caixa…). Ela entra no custo do lote e na precificação. Embalagem de envio não entra aqui (é custo fixo). Só aparecem matérias-primas da categoria "embalagem do produto".</p>
      <div class="table-card" style="padding:16px"><div class="field"><label>Produto</label><select onchange="PetitLT.embSku(this.value)"><option value="">Escolha…</option>${skus.map(s => `<option value="${esc(s)}"${s === embSku ? ' selected' : ''}>${esc(s)} — ${esc(nomeProd(s))}</option>`).join('')}</select></div>
      ${embSku ? `<table style="margin-top:10px"><thead><tr><th>Embalagem</th><th>Quantidade por unidade</th><th>Custo unitário</th><th></th></tr></thead><tbody>${embLinhas.map((l, j) => { const m = D.mps.find(x => x.id === l.mp); return `<tr><td><select onchange="PetitLT.embSet(${j},'mp',this.value)"><option value="">Escolha…</option>${mpsEmb.map(x => `<option value="${x.id}"${x.id === l.mp ? ' selected' : ''}>${esc(x.nome)}${x.fornecedor_nome ? ' — ' + esc(x.fornecedor_nome) : ''}</option>`).join('')}</select></td>
        <td><input value="${esc(l.qtd)}" style="width:100px" onchange="PetitLT.embSet(${j},'qtd',this.value)"></td><td>${m ? (m.custo_unitario_atual == null ? '<span style="color:#A32D2D">sem custo</span>' : 'R$ ' + num4(m.custo_unitario_atual) + '/' + m.unidade_base) : '—'}</td><td><button class="btn-icon" onclick="PetitLT.embRem(${j})">✕</button></td></tr>`; }).join('') || '<tr><td colspan="4" class="td-muted">Nenhuma embalagem cadastrada para este produto.</td></tr>'}</tbody></table>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn btn-outline btn-sm" onclick="PetitLT.embAdd()">+ Embalagem</button><button class="btn btn-primary btn-sm" onclick="PetitLT.embSalvar()">Salvar embalagem do produto</button>
        <span><b>Custo de embalagem por unidade: ${brl(embLinhas.reduce((a, l) => { const m = D.mps.find(x => x.id === l.mp), q = numero(l.qtd); return a + (m && m.custo_unitario_atual != null && q ? Number(m.custo_unitario_atual) * q : 0); }, 0))}</b></span></div>` : ''}</div>`;
  }
  function tabCfg() {
    return `<div class="table-card" style="padding:16px"><div class="grid2f"><div class="field"><label>Valor da hora de mão de obra (R$)</label><input id="cf-hora" value="${esc(String(D.cfg.valor_hora_mao_de_obra).replace('.', ','))}"></div>
      <div class="field"><label>Markup de varejo (× custo unitário)</label><input id="cf-mk" value="${esc(String(D.cfg.markup_varejo).replace('.', ','))}"></div></div>
      <div class="td-muted">R$ 14,03/h = 1,5 × salário mínimo (R$ 1.621) ÷ 173,3 h. Revise todo ano quando o salário mínimo reajustar. Vale para os PRÓXIMOS lotes; os já registrados guardam os valores da época.</div>
      <div style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="PetitLT.cfgSalvar()">Salvar configuração</button></div></div>`;
  }

  // ---------- produto novo: SKU sugerido pela coleção (iniciais + próximo número) ----------
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normCol = s => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const CATEGORIAS = ['Sabonete', 'Vela', 'Hidratante', 'Perfume / Home Spray', 'Outro'];
  function hojeISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  const npNovo = () => ({ nome: '', colecao: '', categoria: '', sku: '', skuManual: false, validade: '', modo: '', formula: '', fonte: '', emb: [], data: hojeISO(), qtd: '', horas: '', obs: '', estoque: true });
  NP = npNovo();
  function prefixoNovo(texto) {     // coleção nova: "Botanical Bloom" → BB, "Capivara" → CAP, "Natal 2026" → N26
    const pal = semAcento(texto).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const letras = pal.filter(w => /^[A-Z]/.test(w)), ano = pal.find(w => /^\d{4}$/.test(w));
    const pre = letras.length > 1 ? letras.map(w => w[0]).join('') : (letras[0] || 'PRD').slice(0, ano ? 1 : 3);
    return pre + (ano ? ano.slice(2) : '');
  }
  function sugerirSku() {           // coleção existente: prefixo mais usado nela + (maior número + 1), ex.: PAM004 → PAM005
    const col = normCol(NP.colecao), usados = new Set(D.produtos.map(p => p.sku));
    const doCol = col ? D.produtos.filter(p => normCol(p.colecao) === col).map(p => String(p.sku).match(/^([A-Z]+)(\d+)$/)).filter(Boolean) : [];
    let pre, larg = 3, n = 1;
    if (doCol.length) {
      const cont = {}; doCol.forEach(m => { cont[m[1]] = (cont[m[1]] || 0) + 1; });
      pre = Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0];
      const nums = doCol.filter(m => m[1] === pre);
      larg = Math.max(...nums.map(m => m[2].length)); n = Math.max(...nums.map(m => Number(m[2]))) + 1;
    } else pre = prefixoNovo(NP.colecao || NP.nome);
    let s; do { s = pre + String(n).padStart(larg, '0'); n++; } while (usados.has(s));
    return s;
  }
  const skuLimpo = () => String(NP.sku || '').toUpperCase().trim();
  function skuAviso() {
    const s = skuLimpo(); if (!s) return '';
    if (!/^[A-Z0-9]+$/.test(s)) return '<span style="color:#A32D2D">só letras e números, sem espaços</span>';
    const p = D.produtos.find(x => x.sku === s);
    return p ? `<span style="color:#A32D2D">⚠ já existe: ${esc(p.nome)}</span>` : '<span style="color:#2e7d32">✔ disponível</span>';
  }
  const formulasSemProduto = () => D.formulas.filter(f => f.ativa && !f.sku);
  function npFormulaId() {
    if (NP.modo === 'vincular') return NP.formula || '';
    if (NP.modo === 'copiar') { const f = D.formulas.find(x => x.ativa && x.sku === NP.fonte); return f ? f.id : ''; }
    return '';
  }
  function tabProdNovo() {
    const cols = [...new Map(D.produtos.filter(p => p.colecao).map(p => [normCol(p.colecao), p.colecao])).values()].sort((a, b) => a.localeCompare(b));
    const cats = [...new Set(CATEGORIAS.concat(D.produtos.map(p => p.categoria).filter(Boolean)))];
    const semP = formulasSemProduto(), comF = skusComFormula(), mpsEmb = D.mps.filter(m => m.categoria === 'embalagem_produto' && m.ativo !== false);
    const opt = (lista, v) => lista.map(([val, txt]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(txt)}</option>`).join('');
    const embCusto = NP.emb.reduce((a, l) => { const m = D.mps.find(x => x.id === l.mp), q = numero(l.qtd); return a + (m && m.custo_unitario_atual != null && q ? Number(m.custo_unitario_atual) * q : 0); }, 0);
    return `<p class="td-muted">Cadastre um produto que ainda não existe: ele ganha o SKU, a fórmula, a embalagem e o 1º lote de uma vez. O custo e o preço sugerido aparecem antes de gravar. O produto começa <b>sem preço (R$ 0,00)</b> — o preço só é definido quando você aprovar o lote.</p>
      <div class="table-card" style="padding:16px;margin-bottom:12px"><b>1. Produto</b><div class="grid2f" style="margin-top:8px">
        <div class="field"><label>Nome</label><input id="np-nome" value="${esc(NP.nome)}" placeholder="ex.: SABONETE CERISE VELOUTÉ" onchange="PetitLT.np('nome',this.value)"></div>
        <div class="field"><label>Coleção</label><input id="np-colecao" list="np-cols" value="${esc(NP.colecao)}" placeholder="escolha ou digite uma nova" onchange="PetitLT.np('colecao',this.value)"><datalist id="np-cols">${cols.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="field"><label>Categoria</label><select id="np-categoria" onchange="PetitLT.np('categoria',this.value)"><option value="">Escolha…</option>${opt(cats.map(c => [c, c]), NP.categoria)}</select></div>
        <div class="field"><label>SKU <button class="btn-icon" style="padding:0 6px;font-size:11px" title="Sugerir o próximo SKU da coleção" onclick="PetitLT.npSku()">↻ sugerir</button></label><input id="np-sku" value="${esc(NP.sku)}" style="text-transform:uppercase" onchange="PetitLT.np('sku',this.value)"><div class="td-muted">${skuAviso() || 'sugerido pela coleção (iniciais + próximo número)'}</div></div>
        <div class="field"><label>Validade (meses)</label><input id="np-validade" value="${esc(NP.validade)}" placeholder="ex.: 12" onchange="PetitLT.np('validade',this.value)"></div></div></div>
      <div class="table-card" style="padding:16px;margin-bottom:12px"><b>2. Fórmula</b>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><label class="toggle-label"><input type="radio" name="np-modo" ${NP.modo === 'vincular' ? 'checked' : ''} onchange="PetitLT.np('modo','vincular')"> usar uma fórmula cadastrada sem produto (${semP.length})</label>
        <label class="toggle-label"><input type="radio" name="np-modo" ${NP.modo === 'copiar' ? 'checked' : ''} onchange="PetitLT.np('modo','copiar')"> copiar a fórmula de outro produto</label></div>
        ${NP.modo === 'vincular' ? (semP.length ? `<div class="field" style="margin-top:8px"><select id="np-formula" onchange="PetitLT.np('formula',this.value)"><option value="">Escolha a fórmula…</option>${opt(semP.map(f => [f.id, f.nome + ' · v' + f.versao + ' · ' + Number(f.unidades_por_receita) + ' un. por receita']), NP.formula)}</select><div class="td-muted">A fórmula (com as versões anteriores) passa a ser deste produto.</div></div>` : '<div class="td-muted" style="margin-top:8px">Nenhuma fórmula sem produto. Crie em 🧴 Fórmulas escolhendo "(produto ainda não cadastrado)", ou copie de outro produto.</div>') : ''}
        ${NP.modo === 'copiar' ? `<div class="field" style="margin-top:8px"><select id="np-fonte" onchange="PetitLT.np('fonte',this.value)"><option value="">Escolha o produto…</option>${opt(comF.map(s => [s, s + ' — ' + nomeProd(s)]), NP.fonte)}</select><div class="td-muted">O produto novo ganha uma cópia (v1) da fórmula; depois dá para editá-la em 🧴 Fórmulas sem mexer na original.</div></div>` : ''}</div>
      <div class="table-card" style="padding:16px;margin-bottom:12px"><b>3. Embalagem de produto (por unidade)</b> <span class="td-muted">opcional — pote, tampa, rótulo, caixa…</span>
        <table style="margin-top:8px"><tbody>${NP.emb.map((l, j) => { const m = D.mps.find(x => x.id === l.mp); return `<tr><td><select onchange="PetitLT.npEmb(${j},'mp',this.value)"><option value="">Escolha…</option>${opt(mpsEmb.map(x => [x.id, x.nome + (x.fornecedor_nome ? ' — ' + x.fornecedor_nome : '')]), l.mp)}</select></td>
          <td><input value="${esc(l.qtd)}" style="width:90px" onchange="PetitLT.npEmb(${j},'qtd',this.value)"></td><td>${m ? (m.custo_unitario_atual == null ? '<span style="color:#A32D2D">sem custo</span>' : 'R$ ' + num4(m.custo_unitario_atual) + '/' + m.unidade_base) : '—'}</td><td><button class="btn-icon" onclick="PetitLT.npEmbRem(${j})">✕</button></td></tr>`; }).join('') || '<tr><td class="td-muted">Nenhuma embalagem.</td></tr>'}</tbody></table>
        <div style="margin-top:8px;display:flex;gap:10px;align-items:center"><button class="btn btn-outline btn-sm" onclick="PetitLT.npEmbAdd()">+ Embalagem</button><span class="td-muted">por unidade: ${brl(embCusto)}</span></div></div>
      <div class="table-card" style="padding:16px;margin-bottom:12px"><b>4. Primeiro lote</b><div class="grid2f" style="margin-top:8px">
        <div class="field"><label>Data de fabricação</label><input id="np-data" type="date" value="${esc(NP.data)}" onchange="PetitLT.np('data',this.value)"></div>
        <div class="field"><label>Unidades produzidas</label><input id="np-qtd" value="${esc(NP.qtd)}" placeholder="ex.: 9" onchange="PetitLT.np('qtd',this.value)"></div>
        <div class="field"><label>Horas trabalhadas (no lote todo)</label><input id="np-horas" value="${esc(NP.horas)}" placeholder="ex.: 3" onchange="PetitLT.np('horas',this.value)"></div>
        <div class="field"><label>Observação</label><input value="${esc(NP.obs)}" onchange="PetitLT.np('obs',this.value)"></div></div>
        <label class="toggle-label"><input id="np-estoque" type="checkbox" ${NP.estoque ? 'checked' : ''} onchange="PetitLT.np('estoque',this.checked)"> lançar as unidades produzidas no estoque (estoque inicial)</label>
        <div class="td-muted">Mão de obra: ${brl(D.cfg.valor_hora_mao_de_obra)}/h · markup de varejo: × ${num4(D.cfg.markup_varejo)}.</div></div>
      <div id="np-resultado"><div class="td-muted">Escolha a fórmula e preencha unidades e horas para ver o custo e o preço sugerido.</div></div>`;
  }
  async function npSimular() {
    const r = $('np-resultado'); if (!r) return;
    const fid = npFormulaId(), qtd = numero(NP.qtd), h = numero(NP.horas), seq = ++npSeq;
    if (!fid || !(qtd > 0) || h == null) { npCalc = null; r.innerHTML = '<div class="td-muted">Escolha a fórmula e preencha unidades e horas para ver o custo e o preço sugerido.</div>'; return; }
    try {
      const c = await rpc('gestao_simular_lote', { p: { formula_id: fid, embalagem: NP.emb.filter(l => l.mp && numero(l.qtd) > 0).map(l => ({ materia_prima_id: l.mp, quantidade: numero(l.qtd) })), quantidade: qtd, horas: h, sku: skuLimpo() } });
      if (seq !== npSeq || !$('np-resultado')) return;     // chegou uma resposta mais nova, ou a aba mudou
      npCalc = c;
      $('np-resultado').innerHTML = resumo(c) + '<div style="margin-top:12px"><button class="btn btn-primary" onclick="PetitLT.npCadastrar()">Cadastrar produto e registrar lote</button> <span class="td-muted">Nada é gravado antes deste botão.</span></div>';
    } catch (e) { if (seq === npSeq && $('np-resultado')) { npCalc = null; $('np-resultado').innerHTML = '<div class="alert">' + esc(e.message) + '</div>'; } }
  }

  window.PetitLT = {
    aba(a) { aba = a; calc = null; desenhar(); },
    async calc() {
      const r = $('lt-resultado'); if (!r) return; const qtd = numero($('lt-qtd').value), h = numero($('lt-horas').value);
      if (!(qtd > 0) || h == null) { r.innerHTML = '<div class="td-muted">Preencha as unidades e as horas para ver o custo e o preço sugerido.</div>'; calc = null; return; }
      try { calc = await rpc('gestao_calcular_lote', { p: { sku: $('lt-sku').value, quantidade: qtd, horas: h } });
        r.innerHTML = resumo(calc) + '<div style="margin-top:12px"><button class="btn btn-primary" onclick="PetitLT.registrar()">Registrar lote</button> <span class="td-muted">O preço só muda quando você aprovar, na aba Lotes.</span></div>'; }
      catch (e) { calc = null; r.innerHTML = '<div class="alert">' + esc(e.message) + '</div>'; }
    },
    async registrar() {
      if (!calc) return; const p = { sku: $('lt-sku').value, quantidade: numero($('lt-qtd').value), horas: numero($('lt-horas').value), data_fabricacao: $('lt-data').value, observacao: $('lt-obs').value };
      try { const r = await rpc('gestao_registrar_lote', { p }); await carregar(); aviso('Lote registrado.' + (r.custo_incompleto ? ' Custo incompleto: sem preço sugerido.' : ' Aprove ou ajuste o preço na aba Lotes.'), true); aba = 'lotes'; soPendentes = true; aberto = r.lote_id; desenhar(); } catch (e) { aviso(e.message, false); }
    },
    filtro(v) { soPendentes = v; desenhar(); },
    ver(id) { aberto = aberto === id ? null : id; desenhar(); },
    async aprovar(id) {
      const l = D.lotes.find(x => x.id === id), p = produto(l.sku);
      if (!confirm('Aplicar ' + brl(l.preco_sugerido_varejo) + ' como preço de venda de ' + l.sku + ' (hoje ' + brl(p && p.preco) + ')?')) return;
      try { await rpc('gestao_aprovar_preco_lote', { p: { lote_id: id, acao: 'aprovar' } }); await carregar(); aviso('Preço aplicado ao produto.', true); desenhar(); if (window.__gestao && window.__gestao.recarregar) window.__gestao.recarregar().catch(() => {}); } catch (e) { aviso(e.message, false); }
    },
    async ajustar(id) {
      const l = D.lotes.find(x => x.id === id), p = produto(l.sku), v = numero($('lt-preco-' + id).value);
      if (!(v > 0)) return aviso('Informe o preço.', false);
      if (!confirm('Aplicar ' + brl(v) + ' como preço de venda de ' + l.sku + ' (hoje ' + brl(p && p.preco) + ')?')) return;
      try { await rpc('gestao_aprovar_preco_lote', { p: { lote_id: id, acao: 'ajustar', preco: v } }); await carregar(); aviso('Preço aplicado ao produto.', true); desenhar(); if (window.__gestao && window.__gestao.recarregar) window.__gestao.recarregar().catch(() => {}); } catch (e) { aviso(e.message, false); }
    },
    async descartar(id) {
      if (!confirm('Descartar o preço sugerido deste lote? O preço do produto não muda.')) return;
      try { await rpc('gestao_aprovar_preco_lote', { p: { lote_id: id, acao: 'descartar' } }); await carregar(); aviso('Sugestão descartada.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async excluir(id) {
      if (!confirm('Excluir este lote? O preço que já foi aplicado ao produto não volta atrás.')) return;
      try { await rpc('gestao_excluir_lote', { p_id: id }); await carregar(); aviso('Lote excluído.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    embSku(s) { embSku = s; embLinhas = D.emb.filter(x => x.sku === s).map(x => ({ mp: x.materia_prima_id, qtd: String(Number(x.quantidade)) })); desenhar(); },
    embSet(j, c, v) { embLinhas[j][c] = v; desenhar(); }, embAdd() { embLinhas.push({ mp: '', qtd: '1' }); desenhar(); }, embRem(j) { embLinhas.splice(j, 1); desenhar(); },
    async embSalvar() {
      const itens = embLinhas.filter(l => l.mp).map(l => ({ materia_prima_id: l.mp, quantidade: numero(l.qtd) }));
      try { await rpc('gestao_salvar_embalagem_produto', { p: { sku: embSku, itens } }); await carregar(); aviso('Embalagem do produto salva.', true); PetitLT.embSku(embSku); } catch (e) { aviso(e.message, false); }
    },
    np(campo, v) {
      NP[campo] = v;
      if (campo === 'sku') { NP.sku = String(v || '').toUpperCase().trim(); NP.skuManual = !!NP.sku; }
      if ((campo === 'colecao' || campo === 'nome') && !NP.skuManual) NP.sku = (NP.colecao || NP.nome) ? sugerirSku() : '';
      if (campo === 'modo') { NP.formula = ''; NP.fonte = ''; }
      if (campo === 'fonte' && v) {   // copiando de outro produto: aproveita categoria, validade e embalagem, se ainda estiverem vazias
        const p = produto(v);
        if (p) { if (!NP.categoria && p.categoria) NP.categoria = p.categoria; if (!NP.validade && p.validade_meses) NP.validade = String(p.validade_meses); }
        if (!NP.emb.length) NP.emb = D.emb.filter(x => x.sku === v).map(x => ({ mp: x.materia_prima_id, qtd: String(Number(x.quantidade)) }));
      }
      desenhar();
    },
    npSku() { NP.skuManual = false; NP.sku = sugerirSku(); desenhar(); },
    npEmb(j, c, v) { NP.emb[j][c] = v; desenhar(); }, npEmbAdd() { NP.emb.push({ mp: '', qtd: '1' }); desenhar(); }, npEmbRem(j) { NP.emb.splice(j, 1); desenhar(); },
    async npCadastrar() {
      const sku = skuLimpo(), qtd = numero(NP.qtd), h = numero(NP.horas), val = numero(NP.validade), fid = npFormulaId(), NL = String.fromCharCode(10);
      if (!NP.nome.trim()) return aviso('Informe o nome do produto.', false);
      if (!sku || !/^[A-Z0-9]+$/.test(sku)) return aviso('Informe um SKU só com letras e números, sem espaços.', false);
      if (D.produtos.some(p => p.sku === sku)) return aviso('O SKU ' + sku + ' já existe. Escolha outro.', false);
      if (NP.validade !== '' && !(val > 0 && val === Math.floor(val))) return aviso('A validade deve ser um número inteiro de meses.', false);
      if (!fid) return aviso('Escolha a fórmula do produto.', false);
      if (!(qtd > 0) || qtd !== Math.floor(qtd)) return aviso('Informe as unidades produzidas (número inteiro).', false);
      if (h == null || h < 0) return aviso('Informe as horas trabalhadas.', false);
      const c = npCalc, emb = NP.emb.filter(l => l.mp).map(l => ({ materia_prima_id: l.mp, quantidade: numero(l.qtd) }));
      if (!confirm('Cadastrar ' + sku + ' — ' + NP.nome.trim() + '?' + NL + NL
        + '• Preço: R$ 0,00 até você aprovar o preço do lote' + (c && c.preco_sugerido_varejo != null ? ' (sugerido ' + brl(c.preco_sugerido_varejo) + ')' : '') + NL
        + '• Estoque inicial: ' + (NP.estoque ? qtd + ' unidades' : 'nenhum') + NL
        + '• Fórmula: ' + (NP.modo === 'vincular' ? 'passa a ser deste produto' : 'cópia da fórmula de ' + NP.fonte))) return;
      const p = { produto: { sku, nome: NP.nome.trim(), colecao: NP.colecao.trim(), categoria: NP.categoria, validade_meses: val },
        formula: { modo: NP.modo, formula_id: fid }, embalagem: emb, lote: { data_fabricacao: NP.data, quantidade: qtd, horas: h, observacao: NP.obs }, estoque_inicial: !!NP.estoque };
      try {
        const r = await rpc('gestao_cadastrar_produto_com_lote', { p });
        NP = npNovo(); npCalc = null; await carregar();
        aviso('Produto ' + sku + ' cadastrado e 1º lote registrado.' + (r.custo_incompleto ? ' Custo incompleto: sem preço sugerido.' : ' Agora aprove ou ajuste o preço.'), true);
        aba = 'lotes'; soPendentes = true; aberto = r.lote_id; desenhar();
        if (window.__gestao && window.__gestao.recarregar) window.__gestao.recarregar().catch(() => {});   // o produto aparece no Estoque
      } catch (e) { aviso(e.message, false); }
    },
    async cfgSalvar() {
      const h = numero($('cf-hora').value), m = numero($('cf-mk').value); if (!(h >= 0) || !(m > 0)) return aviso('Confira os valores.', false);
      try { await rpc('gestao_salvar_config_precificacao', { p: { valor_hora_mao_de_obra: h, markup_varejo: m } }); await carregar(); aviso('Configuração salva.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    }
  };

  function desenhar() {
    const raiz = $('lt-conteudo'); if (!raiz) return;
    document.querySelectorAll('#lt-abas button').forEach(b => { b.className = 'btn btn-sm ' + (b.dataset.a === aba ? 'btn-primary' : 'btn-outline'); });
    const n = pendentes().length, np = $('lt-npend'); if (np) np.textContent = n ? ' (' + n + ')' : '';
    raiz.innerHTML = aba === 'novo' ? tabNovo() : aba === 'produto' ? tabProdNovo() : aba === 'lotes' ? tabLotes() : aba === 'emb' ? tabEmb() : tabCfg();
    if (aba === 'produto') npSimular();
  }
  function montar() {
    if ($('sec-lotes')) return;
    const ref = $('nav-formulas') || $('nav-notas'); if (!ref) return;
    const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-lotes'; item.innerHTML = '<span class="ico">🏭</span> Lotes e preços'; item.onclick = () => goTo('lotes');
    ref.parentNode.insertBefore(item, ref.nextSibling);
    const s = document.createElement('div'); s.id = 'sec-lotes'; s.className = 'section';
    s.innerHTML = `<div class="page-header"><div><div class="page-title">🏭 Lotes e preços</div><div class="page-sub">Custo real de cada lote e preço sugerido — só vira preço quando você aprova</div></div></div>
      <div class="page-content"><div id="lt-abas" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><button data-a="novo" onclick="PetitLT.aba('novo')">🔁 Lote de reposição</button><button data-a="produto" onclick="PetitLT.aba('produto')">🆕 Produto novo</button><button data-a="lotes" onclick="PetitLT.aba('lotes')">✅ Aprovação de preço<span id="lt-npend"></span></button>
      <button data-a="emb" onclick="PetitLT.aba('emb')">📦 Embalagem por produto</button><button data-a="cfg" onclick="PetitLT.aba('cfg')">⚙️ Configuração</button></div><div id="lt-conteudo"></div></div>`;
    $('main').appendChild(s);
    const g0 = window.goTo;
    window.goTo = function (sec) { g0(sec); if (sec === 'lotes') { $('nav-lotes').classList.add('active'); carregar().then(desenhar).catch(e => { $('lt-conteudo').innerHTML = '<div class="alert">Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 8 precisa ter sido rodado no Supabase.</div>'; }); } };
  }
  montar();
})();
