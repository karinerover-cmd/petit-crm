// ═══════════ TELA "FÓRMULAS" (Fase 7) ═══════════
// Receitas por SKU, versionadas. Entradas: PDF do SoapCalc, aba da planilha de precificação (.xlsx), texto colado ou digitação.
// Depende de: SoapCalc (soapcalc.js), Precificacao (precificacao.js) e window.__gestao.sb() (camada_supabase.js). Nada é gravado sem você salvar.
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const un4 = n => (n == null || isNaN(n)) ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const nz = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const numero = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? null : n; };
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const XLSXJS = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  let D = { formulas: [], itens: [], mps: [], custos: [], produtos: [] }, aba = 'lista', F = null, verSku = null, planilha = null;

  // ---------- dados ----------
  async function ler(t, col, asc) {
    let q = sb().from(t).select('*'); if (col) q = q.order(col, { ascending: asc !== false });
    const { data, error } = await q.range(0, 4999); if (error) throw new Error(t + ': ' + error.message); return data || [];
  }
  async function carregar() {
    const [formulas, itens, mps, custos, produtos] = await Promise.all([ler('formulas', 'criado_em', false), ler('formula_itens', 'ordem'), ler('materias_primas', 'nome'), ler('formulas_custo'), ler('produtos', 'sku')]);
    D = { formulas, itens, mps, custos, produtos };
  }
  async function rpc(nome, args) { const { data, error } = await sb().rpc(nome, args); if (error) throw new Error(error.message); return data; }
  function aviso(t, ok) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;bottom:44px;right:20px;max-width:440px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }
  function script(src) { return new Promise((ok, no) => { if ([].some.call(document.scripts, s => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Não foi possível carregar a biblioteca (sem internet?).')); document.head.appendChild(s); }); }

  // ---------- casamento com matérias-primas ----------
  function acharMp(nome) {
    const n = nz(nome); if (!n) return '';
    const ex = D.mps.filter(m => nz(m.nome) === n); if (ex.length === 1) return ex[0].id; if (ex.length > 1) return '';
    const tk = n.split(' ').filter(t => t.length > 2); if (tk.length < 2) return '';   // nome de uma palavra só (ex.: "essência") só casa se for idêntico
    const c = D.mps.filter(m => tk.every(t => nz(m.nome).includes(t))); return c.length === 1 ? c[0].id : '';
  }
  const mpDe = id => D.mps.find(m => m.id === id);
  const novoF = () => ({ id: null, sku: '', nome: '', unidades: '', peso: '', obs: '', origem: 'manual', itens: [] });
  function linha(i) { const mp = i.materia_prima_id || i.mp_id || acharMp(i.nome); return { nome: i.nome || '', mp_id: mp, tipo: i.tipo || '', qtd: i.quantidade == null ? '' : String(i.quantidade), un: i.unidade || 'g', grupo: i.grupo || '', custo: i.custo == null ? '' : String(+Number(i.custo).toFixed(6)), obs: i.obs || '' }; }
  function custoLinha(l) { const mp = l.mp_id ? mpDe(l.mp_id) : null; if (mp && mp.custo_unitario_atual != null) return Number(mp.custo_unitario_atual); return numero(l.custo); }
  function totais() {
    let tot = 0, sem = 0; F.itens.forEach(l => { const c = custoLinha(l), q = numero(l.qtd); if (c == null) sem++; else if (q) tot += c * q; });
    const un = numero(F.unidades); return { tot, sem, un: un > 0 ? tot / un : null };
  }

  // ---------- leitura de PDF / planilha / texto ----------
  async function textoPdf(file) {
    await script(PDFJS); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; let out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const its = (await (await doc.getPage(p)).getTextContent()).items.filter(x => String(x.str).replace(/[\x00-\x1f]/g, '').trim()).map(x => ({ s: x.str, x: x.transform[4], y: x.transform[5] }));
      its.sort((a, b) => b.y - a.y || a.x - b.x); const ls = [];
      its.forEach(it => { const l = ls.find(z => Math.abs(z.y - it.y) < 3); if (l) l.it.push(it); else ls.push({ y: it.y, it: [it] }); });
      ls.sort((a, b) => b.y - a.y).forEach(l => out.push(l.it.sort((a, b) => a.x - b.x).map(z => z.s.trim()).join(' ')));
    }
    return out.join('\n');
  }
  function preencher(r, origem, nomeSugerido) {
    F = novoF(); F.origem = origem; F.nome = nomeSugerido || r.nome || ''; F.unidades = r.unidades ? String(r.unidades) : ''; F.peso = r.peso_total_g ? String(r.peso_total_g) : ''; F.obs = r.observacao || '';
    F.itens = r.itens.map(i => { const l = linha(i); if (/^agua destilada/.test(nz(l.nome)) && l.custo === '' && !l.mp_id) l.custo = '0'; return l; });
    if (r.avisos && r.avisos.length) aviso(r.avisos.join(' '), false);
    aba = 'editor'; desenhar();
  }
  const A = {
    async pdf(files) {
      if (!files.length) return; try { const r = SoapCalc.parse(await textoPdf(files[0])); preencher(r, 'soapcalc_pdf'); } catch (e) { aviso('Não consegui ler o PDF: ' + e.message, false); }
    },
    texto() { try { const r = SoapCalc.parse($('fm-texto').value); preencher(r, 'soapcalc_pdf'); } catch (e) { aviso(e.message, false); } },
    async xlsx(files) {
      if (!files.length) return;
      try { await script(XLSXJS); const wb = window.XLSX.read(await files[0].arrayBuffer(), { type: 'array' });
        planilha = wb.SheetNames.filter(n => Precificacao.ehAbaDeProduto(n)).map(n => { try { const r = Precificacao.parse(window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }), n); return { aba: n, r }; } catch (e) { return { aba: n, erro: e.message }; } });
        desenhar(); } catch (e) { aviso('Não consegui ler a planilha: ' + e.message, false); }
    },
    aba(i) { const p = planilha[i]; preencher(p.r, 'manual', p.aba.trim()); }
  };

  // ---------- editor ----------
  function linhaHtml(l, j) {
    const mp = l.mp_id ? mpDe(l.mp_id) : null, tem = mp && mp.custo_unitario_atual != null, c = custoLinha(l), q = numero(l.qtd);
    return `<tr><td><input value="${esc(l.nome)}" ${mp ? 'disabled' : ''} placeholder="Ingrediente" onchange="PetitFM.set(${j},'nome',this.value)">
        <select style="margin-top:4px" onchange="PetitFM.set(${j},'mp_id',this.value)"><option value="">${mp ? 'Trocar…' : 'Nova matéria-prima (ou mesma de mesmo nome)'}</option>${D.mps.map(m => `<option value="${m.id}"${m.id === l.mp_id ? ' selected' : ''}>${esc(m.nome)}${m.fornecedor_nome ? ' — ' + esc(m.fornecedor_nome) : ''}</option>`).join('')}</select>
        ${!mp ? `<input value="${esc(l.tipo)}" placeholder="Tipo (óleo, essência, aditivo…)" style="margin-top:4px" onchange="PetitFM.set(${j},'tipo',this.value)">` : ''}</td>
      <td><input value="${esc(l.qtd)}" style="width:90px" onchange="PetitFM.set(${j},'qtd',this.value)"><select style="width:64px;margin-top:4px" onchange="PetitFM.set(${j},'un',this.value)">${['g', 'ml', 'un'].map(u => `<option${u === l.un ? ' selected' : ''}>${u}</option>`).join('')}</select></td>
      <td>${tem ? `<b>${un4(mp.custo_unitario_atual)}</b>/${mp.unidade_base}<div class="td-muted">custo já cadastrado</div>${numero(l.custo) != null && Math.abs(numero(l.custo) - Number(mp.custo_unitario_atual)) > 0.000001 ? `<div style="color:#B26A00;font-size:11px">⚠ a planilha usava ${un4(numero(l.custo))}/${l.un}. Vale o custo cadastrado; para mudar, edite a matéria-prima.</div>` : ''}` : `<input value="${esc(l.custo)}" style="width:110px" placeholder="R$ por ${l.un}" onchange="PetitFM.set(${j},'custo',this.value)"><div class="td-muted">${c == null ? '<span style="color:#A32D2D">sem custo</span>' : 'R$ por ' + l.un}</div>`}</td>
      <td>${c != null && q ? brl(c * q) : '—'}</td><td><button class="btn-icon" title="Remover" onclick="PetitFM.rem(${j})">✕</button></td></tr>`;
  }
  function editor() {
    const t = totais(), ant = F.sku ? D.formulas.filter(f => f.sku === F.sku) : [], ver = F.id ? 'Editando: ao salvar, cria a versão ' + (Math.max(0, ...D.formulas.filter(f => f.id === F.id || (F.sku ? f.sku === F.sku : nz(f.nome) === nz(F.nome))).map(f => f.versao)) + 1) : (ant.length ? 'Já existe fórmula para este SKU: ao salvar, cria a versão ' + (Math.max(...ant.map(f => f.versao)) + 1) : 'Nova fórmula (versão 1)');
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><div class="grid2f">
      <div class="field"><label>Produto (SKU)</label><select onchange="PetitFM.campo('sku',this.value)"><option value="">(produto ainda não cadastrado)</option>${D.produtos.map(p => `<option value="${esc(p.sku)}"${p.sku === F.sku ? ' selected' : ''}>${esc(p.sku)} — ${esc(p.nome)}</option>`).join('')}</select></div>
      <div class="field"><label>Nome da fórmula</label><input value="${esc(F.nome)}" onchange="PetitFM.campo('nome',this.value)"></div>
      <div class="field"><label>Unidades que saem de UMA receita</label><input value="${esc(F.unidades)}" placeholder="ex.: 9" onchange="PetitFM.campo('unidades',this.value)"></div>
      <div class="field"><label>Peso total da massa (g, opcional)</label><input value="${esc(F.peso)}" onchange="PetitFM.campo('peso',this.value)"></div>
      <div class="field" style="grid-column:1/-1"><label>Observações</label><input value="${esc(F.obs)}" onchange="PetitFM.campo('obs',this.value)"></div></div>
      <div class="td-muted">${ver}</div></div>
      <div class="table-card"><table><thead><tr><th>Ingrediente</th><th>Quantidade (uma receita)</th><th>Custo por unidade</th><th>Subtotal</th><th></th></tr></thead><tbody>${F.itens.map(linhaHtml).join('') || '<tr><td colspan="5" class="td-muted">Nenhum ingrediente.</td></tr>'}</tbody></table>
      <div class="td-muted" style="padding:8px 16px">Ingrediente chamado só "Essência" é salvo como "Essência + nome da fórmula" (cada fragrância é uma matéria-prima diferente).</div><div style="padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn btn-outline btn-sm" onclick="PetitFM.add()">+ Ingrediente</button>
      <span><b>Custo da receita: ${brl(t.tot)}</b>${t.un != null ? ' · por unidade: <b>' + un4(t.un) + '</b>' : ''}${t.sem ? ' · <span style="color:#A32D2D">' + t.sem + ' ingrediente(s) sem custo — o total está incompleto</span>' : ''}</span></div></div>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn btn-primary" onclick="PetitFM.salvar()">Salvar fórmula</button><button class="btn btn-outline" onclick="PetitFM.aba('lista')">Cancelar</button></div>`;
  }

  // ---------- lista ----------
  function lista() {
    const ativas = D.formulas.filter(f => f.ativa), skusCom = new Set(ativas.map(f => f.sku).filter(Boolean)), ativosProd = D.produtos.filter(p => !p.oculto);
    const semF = ativosProd.filter(p => !skusCom.has(p.sku));
    let h = `<div class="td-muted" style="margin-bottom:10px">${ativosProd.length - semF.length} de ${ativosProd.length} produtos ativos têm fórmula.</div>`;
    h += ativas.length ? `<div class="table-card"><table><thead><tr><th>Produto</th><th>Fórmula</th><th>Versão</th><th>Unid./receita</th><th>Custo da receita</th><th>Custo por unidade</th><th></th></tr></thead><tbody>${ativas.map(f => {
      const c = D.custos.find(x => x.formula_id === f.id) || {}, its = D.itens.filter(i => i.formula_id === f.id).length, prod = D.produtos.find(p => p.sku === f.sku);
      return `<tr><td>${esc(f.sku || '—')}<div class="td-muted">${esc(prod ? prod.nome : 'sem produto')}</div></td><td class="td-name">${esc(f.nome)}<div class="td-muted">${its} ingredientes${f.observacao ? ' · ' + esc(f.observacao) : ''}</div></td>
        <td>v${f.versao} <span class="td-muted">${dataBR(f.criado_em)}</span></td><td>${Number(f.unidades_por_receita)}</td>
        <td><b>${brl(c.custo_receita)}</b>${Number(c.itens_sem_custo) ? '<div><span class="badge badge-pink">' + c.itens_sem_custo + ' sem custo</span></div>' : ''}</td><td>${un4(c.custo_unitario)}</td>
        <td style="white-space:nowrap"><button class="btn-icon" title="Editar (salva como nova versão)" onclick="PetitFM.editar('${f.id}')">✏️</button> <button class="btn-icon" title="Versões" onclick="PetitFM.versoes('${esc(f.sku || f.nome)}')">📜</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty-state">Nenhuma fórmula cadastrada ainda. Use "Importar / nova fórmula".</div>';
    if (verSku) {
      const vs = D.formulas.filter(f => (f.sku || f.nome) === verSku).sort((a, b) => b.versao - a.versao);
      h += `<h3 style="margin:18px 0 8px">Versões de ${esc(verSku)}</h3><div class="table-card"><table><thead><tr><th>Versão</th><th>Data</th><th>Situação</th><th>Custo da receita hoje</th><th></th></tr></thead><tbody>${vs.map(f => { const c = D.custos.find(x => x.formula_id === f.id) || {};
        return `<tr><td>v${f.versao}</td><td>${dataBR(f.criado_em)}</td><td>${f.ativa ? '<span class="badge badge-pink">ativa</span>' : 'antiga'}</td><td>${brl(c.custo_receita)}</td><td style="white-space:nowrap">
          <button class="btn-icon" title="Abrir como base de nova versão" onclick="PetitFM.editar('${f.id}')">✏️</button> ${f.ativa ? '' : `<button class="btn btn-outline btn-sm" onclick="PetitFM.ativar('${f.id}')">Reativar</button> <button class="btn-icon" title="Excluir versão" onclick="PetitFM.excluir('${f.id}')">🗑</button>`}</td></tr>`; }).join('')}</tbody></table></div>`;
    }
    if (semF.length) h += `<details style="margin-top:14px"><summary class="td-muted">Produtos ativos sem fórmula (${semF.length})</summary><div class="td-muted" style="margin-top:6px">${semF.map(p => esc(p.sku)).join(' · ')}</div></details>`;
    return h;
  }

  function importar() {
    let h = `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>📄 PDF do SoapCalc</b><p class="td-muted">Lê óleos, soda, água e aditivos (Additives/Notes) e leva para o editor.</p><input type="file" accept="application/pdf,.pdf" onchange="PetitFM.pdf(this.files)"></div>
      <div class="table-card" style="padding:16px;margin-bottom:12px"><b>📊 Planilha de precificação (.xlsx)</b><p class="td-muted">Cada aba de produto vira uma fórmula: ingredientes, quantidades da receita, custo (preço ÷ peso da embalagem) e rendimento.</p><input type="file" accept=".xlsx,.xlsm" onchange="PetitFM.xlsx(this.files)">`;
    if (planilha) h += `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">${planilha.map((p, i) => p.erro ? `<span class="td-muted">${esc(p.aba)}: ${esc(p.erro)}</span>` : `<button class="btn btn-outline btn-sm" onclick="PetitFM.abaPlanilha(${i})">${esc(p.aba.trim())} · ${p.r.itens.length} ingr. · ${p.r.unidades || '?'} un.</button>`).join('')}</div>`;
    h += `</div><div class="table-card" style="padding:16px;margin-bottom:12px"><b>📋 Colar texto do SoapCalc</b><textarea id="fm-texto" rows="6" placeholder="Cole aqui o texto da receita"></textarea><div style="margin-top:8px"><button class="btn btn-outline btn-sm" onclick="PetitFM.texto()">Ler texto</button></div></div>
      <div class="table-card" style="padding:16px"><b>✍️ Digitar do zero</b><div style="margin-top:8px"><button class="btn btn-outline btn-sm" onclick="PetitFM.nova()">Nova fórmula em branco</button></div></div>`;
    return h;
  }

  window.PetitFM = Object.assign({
    aba(a) { aba = a; if (a === 'lista') { F = null; } desenhar(); },
    nova() { F = novoF(); F.itens = [linha({})]; aba = 'editor'; desenhar(); },
    campo(c, v) { F[c] = v; if (c === 'sku' && v && !F.nome) { const p = D.produtos.find(x => x.sku === v); if (p) F.nome = p.nome; } desenhar(); },
    set(j, c, v) { const l = F.itens[j]; l[c] = v; if (c === 'nome' && !l.mp_id) l.mp_id = acharMp(v); if (c === 'mp_id' && v) { const m = mpDe(v); if (m) { l.un = m.unidade_base; l.nome = m.nome; } } desenhar(); },
    add() { F.itens.push(linha({})); desenhar(); },
    rem(j) { F.itens.splice(j, 1); desenhar(); },
    editar(id) { const f = D.formulas.find(x => x.id === id); F = novoF(); F.id = id; F.sku = f.sku || ''; F.nome = f.nome; F.unidades = String(Number(f.unidades_por_receita)); F.peso = f.peso_total_g == null ? '' : String(Number(f.peso_total_g)); F.obs = f.observacao || ''; F.origem = f.origem;
      F.itens = D.itens.filter(i => i.formula_id === id).map(i => { const m = mpDe(i.materia_prima_id); return { nome: m ? m.nome : '', mp_id: i.materia_prima_id, tipo: '', qtd: String(Number(i.quantidade)), un: i.unidade, grupo: i.grupo || '', custo: '', obs: '' }; }); aba = 'editor'; desenhar(); },
    versoes(k) { verSku = verSku === k ? null : k; desenhar(); },
    async salvar() {
      const un = numero(F.unidades); if (!F.nome.trim()) return aviso('Informe o nome da fórmula.', false); if (!(un > 0)) return aviso('Informe quantas unidades saem da receita.', false);
      F.itens.forEach(l => { if (!l.mp_id && nz(l.nome) === 'essencia') l.nome = 'Essência ' + F.nome.trim(); });   // cada fragrância é uma matéria-prima diferente
      const itens = F.itens.filter(l => l.nome.trim() || l.mp_id); if (!itens.length) return aviso('Adicione pelo menos um ingrediente.', false);
      for (const l of itens) { if (!(numero(l.qtd) > 0)) return aviso('Ingrediente "' + l.nome + '": informe a quantidade.', false); }
      const p = { sku: F.sku || null, nome: F.nome, unidades_por_receita: un, peso_total_g: numero(F.peso), origem: F.origem, observacao: F.obs,
        itens: itens.map(l => ({ materia_prima_id: l.mp_id || null, nome: l.nome, tipo: l.tipo, quantidade: numero(l.qtd), unidade: l.un, grupo: l.grupo, custo: numero(l.custo) })) };
      try { const r = await rpc('gestao_salvar_formula', { p }); await carregar(); F = null; aba = 'lista';
        aviso('Fórmula salva (versão ' + r.versao + ').' + (r.materias_primas_criadas.length ? ' Matérias-primas novas: ' + r.materias_primas_criadas.length + ' (cadastro incompleto).' : ''), true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async ativar(id) { try { await rpc('gestao_ativar_formula', { p_id: id }); await carregar(); aviso('Versão reativada.', true); desenhar(); } catch (e) { aviso(e.message, false); } },
    async excluir(id) { if (!confirm('Excluir esta versão da fórmula?')) return; try { await rpc('gestao_excluir_formula', { p_id: id }); await carregar(); aviso('Versão excluída.', true); desenhar(); } catch (e) { aviso(e.message, false); } }
  }, { pdf: A.pdf, texto: A.texto, xlsx: A.xlsx, abaPlanilha: A.aba });

  function desenhar() {
    const raiz = $('fm-conteudo'); if (!raiz) return;
    document.querySelectorAll('#fm-abas button').forEach(b => { b.className = 'btn btn-sm ' + (b.dataset.a === (aba === 'editor' ? 'importar' : aba) ? 'btn-primary' : 'btn-outline'); });
    raiz.innerHTML = aba === 'lista' ? lista() : aba === 'importar' ? importar() : editor();
  }
  function montar() {
    if ($('sec-formulas')) return;
    const ref = $('nav-notas'); if (!ref) return;
    const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-formulas'; item.innerHTML = '<span class="ico">🧴</span> Fórmulas'; item.onclick = () => goTo('formulas');
    ref.parentNode.insertBefore(item, ref.nextSibling);
    const s = document.createElement('div'); s.id = 'sec-formulas'; s.className = 'section';
    s.innerHTML = `<div class="page-header"><div><div class="page-title">🧴 Fórmulas</div><div class="page-sub">Receita de cada produto, com versões e custo pela matéria-prima</div></div></div>
      <div class="page-content"><div id="fm-abas" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><button data-a="lista" onclick="PetitFM.aba('lista')">📚 Fórmulas</button><button data-a="importar" onclick="PetitFM.aba('importar')">➕ Importar / nova fórmula</button></div><div id="fm-conteudo"></div></div>`;
    $('main').appendChild(s);
    const g0 = window.goTo;
    window.goTo = function (sec) { g0(sec); if (sec === 'formulas') { $('nav-formulas').classList.add('active'); carregar().then(desenhar).catch(e => { $('fm-conteudo').innerHTML = '<div class="alert">Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 7 precisa ter sido rodado no Supabase.</div>'; }); } };
  }
  montar();
})();
