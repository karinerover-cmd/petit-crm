// ═══════════ TELA "NOTAS FISCAIS" (Fase 6b) ═══════════
// Importa NF-e (XML), deixa você revisar a classificação de cada item e grava pelo banco (gestao_importar_nota etc.).
// Depende de: NFe (nfe.js) e window.__gestao.sb() (camada_supabase.js). Nada é gravado antes de você confirmar.
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const un4 = n => (n == null || isNaN(n)) ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const CAT_DESP = { curso: 'Curso', melhoria_equipamento: 'Melhoria de equipamento', sessao_foto_video: 'Sessão de foto/vídeo', material_escritorio: 'Material de escritório / papelaria', outro: 'Outro' };
  const DEST = { materia_prima: 'Matéria-prima', embalagem_envio: 'Embalagem de envio', despesa_operacional: 'Despesa', pendente: 'Deixar pendente' };
  let D = { notas: [], itens: [], mps: [], embs: [], desp: [], mapa: [] }, aba = 'importar', lote = [], pend = [], msg = '';

  // ---------- dados ----------
  async function ler(t, col, asc) {
    let q = sb().from(t).select('*'); if (col) q = q.order(col, { ascending: asc !== false });
    const { data, error } = await q.range(0, 4999); if (error) throw new Error(t + ': ' + error.message); return data || [];
  }
  async function carregar() {
    const [notas, itens, mps, embs, desp, mapa] = await Promise.all([ler('notas_fiscais', 'data_emissao', false), ler('nota_fiscal_itens', 'n_item'), ler('materias_primas', 'nome'),
      ler('materiais_embalagem_envio', 'nome'), ler('despesas_operacionais', 'data', false), ler('mapa_itens_fornecedor')]);
    D = { notas, itens, mps, embs, desp, mapa };
    pend = D.itens.filter(i => i.destino === 'pendente').map(i => ({ id: i.id, item: i, cls: padrao(i) }));
  }
  async function rpc(nome, args) { const { data, error } = await sb().rpc(nome, args); if (error) throw new Error(error.message); return data; }

  // ---------- classificação ----------
  function memoria() {
    const m = {};
    D.mapa.forEach(r => {
      const mp = D.mps.find(x => x.id === r.materia_prima_id), em = D.embs.find(x => x.id === r.embalagem_envio_id);
      m[r.fornecedor_cnpj + '|' + r.codigo_fornecedor] = { destino: r.destino, categoria: r.despesa_categoria || (mp && mp.categoria) || null, nome: mp ? mp.nome : em ? em.nome : undefined,
        tipo: mp ? mp.tipo : undefined, unidade_base: r.unidade_base || 'un', conteudo_por_unidade: Number(r.conteudo_por_unidade), recorrente: !!r.recorrente, mp_id: r.materia_prima_id || null };
    });
    return m;
  }
  const clsDe = c => ({ destino: c.destino, categoria: c.categoria || '', nome: c.nome || '', tipo: c.tipo || '', base: c.unidade_base || 'un', cont: c.conteudo_por_unidade || 1, recorrente: !!c.recorrente, mp_id: c.mp_id || '', origem: c.origem });
  function padrao(item) {            // item já gravado e pendente: sugere de novo (agora com a memória atual)
    const nota = D.notas.find(n => n.id === item.nota_fiscal_id) || {};
    return clsDe(NFe.classificar({ codigo: item.codigo_fornecedor, descricao: item.descricao, unidade: item.unidade_compra }, nota.fornecedor_cnpj, memoria()));
  }
  function custoBase(custo, qtd, c) { const q = qtd * (Number(c.cont) || 0); return q > 0 ? custo / q : null; }

  // ---------- leitura dos XML ----------
  async function lerArquivos(files) {
    msg = ''; const mem = memoria();
    for (const f of files) {
      try {
        const nota = NFe.parse(await f.text()); const ja = D.notas.find(n => n.chave_acesso === nota.chave);
        if (lote.some(l => l.nota.chave === nota.chave)) continue;
        const entrada = { nome: f.name, nota, ja, ratear: false, linhas: [] };
        entrada.linhas = nota.itens.map(i => ({ item: i, cls: clsDe(NFe.classificar(i, nota.fornecedor.cnpj, mem)) }));
        lote.push(entrada);
      } catch (e) { msg += '⚠️ ' + f.name + ': ' + e.message + '\n'; }
    }
    desenhar();
  }

  // ---------- editor de um item ----------
  function editor(sc, i, j, row, custo, qtd) {
    const c = row.cls, k = `'${sc}',${i},${j}`, pendente = c.destino === 'pendente';
    const opt = (o, v) => Object.entries(o).map(([a, b]) => `<option value="${a}"${a === v ? ' selected' : ''}>${b}</option>`).join('');
    let cat = '';
    if (c.destino === 'materia_prima') cat = `<select onchange="PetitNF.set(${k},'categoria',this.value)"><option value="ingrediente"${c.categoria !== 'embalagem_produto' ? ' selected' : ''}>Ingrediente</option><option value="embalagem_produto"${c.categoria === 'embalagem_produto' ? ' selected' : ''}>Embalagem do produto</option></select>`;
    if (c.destino === 'despesa_operacional') cat = `<select onchange="PetitNF.set(${k},'categoria',this.value)">${opt(CAT_DESP, c.categoria || 'outro')}</select><label style="font-size:11px"><input type="checkbox" style="width:auto" ${c.recorrente ? 'checked' : ''} onchange="PetitNF.set(${k},'recorrente',this.checked)"> recorrente (entra no custo fixo mensal)</label>`;
    const usaConteudo = c.destino === 'materia_prima' || c.destino === 'embalagem_envio';
    const cb = custoBase(custo, qtd, c);
    let nomeCampo = '';
    if (c.destino === 'materia_prima') nomeCampo = `<input value="${esc(c.nome)}" placeholder="Nome da matéria-prima" ${c.mp_id ? 'disabled' : ''} onchange="PetitNF.set(${k},'nome',this.value)">
      <input value="${esc(c.tipo)}" placeholder="Tipo (essência, base, frasco…)" ${c.mp_id ? 'disabled' : ''} style="margin-top:4px" onchange="PetitNF.set(${k},'tipo',this.value)">
      <select style="margin-top:4px" onchange="PetitNF.set(${k},'mp_id',this.value)"><option value="">Nova / mesma do fornecedor</option>${D.mps.map(m => `<option value="${m.id}"${m.id === c.mp_id ? ' selected' : ''}>${esc(m.nome)}${m.fornecedor_nome ? ' — ' + esc(m.fornecedor_nome) : ''}</option>`).join('')}</select>`;
    if (c.destino === 'embalagem_envio' || c.destino === 'despesa_operacional') nomeCampo = `<input value="${esc(c.nome)}" placeholder="Nome" onchange="PetitNF.set(${k},'nome',this.value)">`;
    return `<tr style="${pendente ? 'background:#FFF8E1' : ''}">
      <td><b>${esc(row.item.descricao)}</b><div class="td-muted">cód. ${esc(row.item.codigo || row.item.codigo_fornecedor)} · ${qtd} ${esc(row.item.unidade || row.item.unidade_compra || '')}${c.origem === 'memoria' ? ' · 🧠 lembrado' : c.origem === 'sem_regra' ? ' · ❓ sem regra' : ''}</div></td>
      <td>${brl(custo)}</td>
      <td><select onchange="PetitNF.set(${k},'destino',this.value)">${opt(DEST, c.destino)}</select>${cat}</td>
      <td>${nomeCampo}</td>
      <td>${usaConteudo ? `<div style="display:flex;gap:4px"><input type="number" step="any" min="0" value="${c.cont}" style="width:80px" onchange="PetitNF.set(${k},'cont',this.value)"><select style="width:64px" onchange="PetitNF.set(${k},'base',this.value)">${['g', 'ml', 'un'].map(u => `<option${u === c.base ? ' selected' : ''}>${u}</option>`).join('')}</select></div><div class="td-muted">por unidade comprada → ${un4(cb)}/${c.base}</div>` : '<span class="td-muted">—</span>'}</td>
    </tr>`;
  }
  const payloadItem = (c) => ({ destino: c.destino, conteudo_por_unidade: Number(c.cont) || 1, unidade_base: c.base,
    materia_prima: { nome: c.nome, categoria: c.categoria || 'ingrediente', tipo: c.tipo, id: c.mp_id || null }, embalagem: { nome: c.nome },
    despesa: { descricao: c.nome, categoria: c.categoria || 'outro', recorrente: !!c.recorrente } });
  function valida(c) {
    if (c.destino === 'pendente') return '';
    if (!(Number(c.cont) > 0)) return 'conteúdo por unidade deve ser maior que zero';
    if (c.destino === 'materia_prima' && !c.mp_id && !String(c.nome).trim()) return 'informe o nome da matéria-prima';
    return '';
  }

  window.PetitNF = {
    set(sc, i, j, campo, v) {
      const row = sc === 'l' ? lote[i].linhas[j] : pend[j];
      if (campo === 'cont') v = String(v).replace(',', '.');
      row.cls[campo] = v;
      if (campo === 'destino') { row.cls.categoria = ''; row.cls.mp_id = ''; if (v === 'materia_prima' && !row.cls.nome) row.cls.nome = NFe.limparNome(row.item.descricao); if ((v === 'embalagem_envio' || v === 'despesa_operacional') && !row.cls.nome) row.cls.nome = NFe.limparNome(row.item.descricao); }
      if (campo === 'mp_id' && v) { const m = D.mps.find(x => x.id === v); if (m) { row.cls.base = m.unidade_base; row.cls.categoria = m.categoria; } }
      desenhar();
    },
    ratear(i, v) { lote[i].ratear = v; desenhar(); },
    descartar(i) { lote.splice(i, 1); desenhar(); },
    aba(a) { aba = a; msg = ''; desenhar(); },
    async importar(i) {
      const e = lote[i], n = e.nota, custos = NFe.custos(n, e.ratear);
      for (const r of e.linhas) { const erro = valida(r.cls); if (erro) { return aviso('Item "' + r.item.descricao + '": ' + erro, false); } }
      const itens = e.linhas.map((r, k) => Object.assign({ n_item: r.item.n, codigo: r.item.codigo, descricao: r.item.descricao, ncm: r.item.ncm, unidade: r.item.unidade, quantidade: r.item.quantidade,
        valor_unitario: r.item.valor_unitario, valor_produto: r.item.valor_produto, valor_frete: r.item.valor_frete, valor_desconto: r.item.valor_desconto, valor_outras: r.item.valor_outras,
        valor_difal: +(custos[k] - (r.item.valor_produto + r.item.valor_frete - r.item.valor_desconto)).toFixed(2) }, payloadItem(r.cls)));
      const nota = { chave_acesso: n.chave, numero: n.numero, serie: n.serie, data_emissao: n.data_emissao, fornecedor_cnpj: n.fornecedor.cnpj, fornecedor_nome: n.fornecedor.nome,
        fornecedor_fantasia: n.fornecedor.fantasia, natureza: n.natureza, valor_produtos: n.totais.produtos, valor_frete: n.totais.frete, valor_desconto: n.totais.desconto,
        valor_outras: n.itens.reduce((a, x) => a + x.valor_outras, 0), valor_difal: n.difal, difal_rateado: !!e.ratear, valor_total_nota: n.totais.total, origem: 'xml' };
      try {
        const r = await rpc('gestao_importar_nota', { p: { nota, itens } });
        lote.splice(i, 1); await carregar();
        aviso('Nota ' + n.numero + ' importada: ' + r.itens_classificados + ' itens classificados' + (r.itens_pendentes ? ', ' + r.itens_pendentes + ' pendentes' : '') + ' · custo real ' + brl(r.custo_total_real), true);
        if (r.itens_pendentes) aba = 'pendentes'; desenhar();
      } catch (er) { aviso(er.message, false); }
    },
    async confirmarPendente(j) {
      const r = pend[j], erro = valida(r.cls); if (erro) return aviso(erro, false);
      if (r.cls.destino === 'pendente') return aviso('Escolha um destino para o item.', false);
      try { await rpc('gestao_classificar_item', { p: Object.assign({ item_id: r.id }, payloadItem(r.cls)) }); await carregar(); aviso('Item classificado.', true); desenhar(); } catch (er) { aviso(er.message, false); }
    },
    async excluirNota(id) {
      const n = D.notas.find(x => x.id === id);
      if (!confirm('Excluir a nota ' + (n ? n.numero : '') + ' e as despesas criadas por ela? O custo atual das matérias-primas não volta atrás.')) return;
      try { await rpc('gestao_excluir_nota', { p_id: id }); await carregar(); aviso('Nota excluída.', true); desenhar(); } catch (er) { aviso(er.message, false); }
    },
    editarMp(id) { window.__mpEdit = id ? Object.assign({}, D.mps.find(m => m.id === id)) : { categoria: 'ingrediente', unidade_base: 'g', cadastro_completo: true, ativo: true }; desenhar(); },
    async salvarMp() {
      const g = k => $('mp-' + k), p = { id: window.__mpEdit.id || null, nome: g('nome').value, tipo: g('tipo').value, categoria: g('categoria').value, unidade_base: g('base').value,
        custo_unitario_atual: g('custo').value.replace(',', '.'), fornecedor_nome: g('forn').value, cadastro_completo: g('ok').checked, observacao: g('obs').value, ativo: g('ativo').checked };
      try { await rpc('gestao_salvar_materia_prima', { p }); window.__mpEdit = null; await carregar(); aviso('Matéria-prima salva.', true); desenhar(); } catch (er) { aviso(er.message, false); }
    },
    async salvarDespesa() {
      const g = k => $('ds-' + k), p = { data: g('data').value, descricao: g('desc').value, categoria: g('cat').value, valor: g('valor').value.replace(',', '.'), recorrente: g('rec').checked };
      if (!p.descricao.trim() || !(Number(p.valor) >= 0) || p.valor === '') return aviso('Informe descrição e valor.', false);
      try { await rpc('gestao_salvar_despesa', { p }); await carregar(); aviso('Despesa lançada.', true); desenhar(); } catch (er) { aviso(er.message, false); }
    },
    filtrarMp() { desenhar(true); }
  };
  function aviso(t, ok) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;bottom:44px;right:20px;max-width:420px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }

  // ---------- telas ----------
  function tabImportar() {
    let h = `<div class="import-area" style="padding:18px"><b>Importar nota fiscal (XML)</b><p class="td-muted">Selecione um ou mais arquivos .xml de NF-e. Você revisa a classificação de cada item antes de gravar — nada é criado sem a sua confirmação.</p>
      <input type="file" id="nf-arq" accept=".xml,text/xml" multiple onchange="PetitNF.arquivos(this.files)"></div>`;
    if (msg) h += `<pre style="color:#A32D2D;white-space:pre-wrap">${esc(msg)}</pre>`;
    lote.forEach((e, i) => {
      const n = e.nota, custos = NFe.custos(n, e.ratear), tot = custos.reduce((a, b) => a + b, 0), pend0 = e.linhas.filter(r => r.cls.destino === 'pendente').length;
      h += `<div class="table-card" style="margin-top:16px"><div class="table-toolbar" style="flex-wrap:wrap;gap:8px">
        <div><b>NF ${esc(n.numero)}</b> · ${esc(n.fornecedor.fantasia || n.fornecedor.nome)} · ${dataBR(n.data_emissao)} · total da nota ${brl(n.totais.total)} · <b>custo real ${brl(tot)}</b>
        <div class="td-muted">Custo de cada item = valor do produto + frete proporcional − desconto. IPI e demais impostos são só demonstrativo.${pend0 ? ' · <b>' + pend0 + ' item(ns) pendente(s)</b>' : ''}</div></div>
        ${n.difal ? `<label class="toggle-label"><input type="checkbox" ${e.ratear ? 'checked' : ''} onchange="PetitNF.ratear(${i},this.checked)"> somar o DIFAL (${brl(n.difal)}) ao custo</label>` : ''}</div>
        ${e.ja ? `<div class="alert" style="margin:10px 16px">Esta nota já foi importada em ${dataBR(e.ja.criado_em)}. Não é possível importar de novo.</div>` : ''}
        <table><thead><tr><th>Item da nota</th><th>Custo</th><th>Destino</th><th>Cadastro</th><th>Conteúdo</th></tr></thead><tbody>
        ${e.linhas.map((r, j) => editor('l', i, j, r, custos[j], r.item.quantidade)).join('')}</tbody></table>
        <div style="padding:12px 16px;display:flex;gap:8px"><button class="btn btn-primary" ${e.ja ? 'disabled' : ''} onclick="PetitNF.importar(${i})">Confirmar e importar</button><button class="btn btn-outline" onclick="PetitNF.descartar(${i})">Descartar</button></div></div>`;
    });
    return h;
  }
  function tabNotas() {
    if (!D.notas.length) return '<div class="empty-state">Nenhuma nota importada ainda.</div>';
    return `<div class="table-card"><table><thead><tr><th>Nota</th><th>Fornecedor</th><th>Emissão</th><th>Total da nota</th><th>Custo real</th><th>Itens</th><th></th></tr></thead><tbody>${D.notas.map(n => {
      const its = D.itens.filter(i => i.nota_fiscal_id === n.id), p = its.filter(i => i.destino === 'pendente').length;
      return `<tr><td>${esc(n.numero)}</td><td>${esc(n.fornecedor_fantasia || n.fornecedor_nome)}</td><td>${dataBR(n.data_emissao)}</td><td>${brl(n.valor_total_nota)}</td><td><b>${brl(n.custo_total_real)}</b>${Number(n.valor_difal) ? '<div class="td-muted">DIFAL ' + brl(n.valor_difal) + (n.difal_rateado ? ' somado' : ' só demonstrativo') + '</div>' : ''}</td>
        <td>${its.length}${p ? ' · <span class="badge badge-pink">' + p + ' pendente(s)</span>' : ''}</td><td><button class="btn-icon" title="Excluir nota" onclick="PetitNF.excluirNota('${n.id}')">🗑</button></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function tabPendentes() {
    if (!pend.length) return '<div class="empty-state">Nenhum item pendente. 🎉</div>';
    return `<p class="td-muted">Estes itens não foram reconhecidos. Escolha o destino e confirme — a escolha fica lembrada para as próximas notas do mesmo fornecedor.</p>
      <div class="table-card"><table><thead><tr><th>Item da nota</th><th>Custo</th><th>Destino</th><th>Cadastro</th><th>Conteúdo</th><th></th></tr></thead><tbody>${pend.map((r, j) => {
      const nota = D.notas.find(n => n.id === r.item.nota_fiscal_id) || {};
      return editor('p', 0, j, Object.assign({}, r, { item: Object.assign({}, r.item, { descricao: r.item.descricao + ' (NF ' + (nota.numero || '') + ' · ' + (nota.fornecedor_fantasia || nota.fornecedor_nome || '') + ')' }) }), Number(r.item.custo_total), Number(r.item.quantidade_comprada))
        .replace(/<\/tr>$/, `<td><button class="btn btn-primary btn-sm" onclick="PetitNF.confirmarPendente(${j})">Confirmar</button></td></tr>`); }).join('')}</tbody></table></div>`;
  }
  function tabMp() {
    const f = ($('nf-filtro') || {}).value || '', t = f.toLowerCase();
    const lista = D.mps.filter(m => !t || (m.nome + ' ' + (m.tipo || '') + ' ' + (m.fornecedor_nome || '')).toLowerCase().includes(t));
    let h = `<div class="table-toolbar"><input class="filter-search" id="nf-filtro" placeholder="Filtrar por nome, tipo ou fornecedor…" value="${esc(f)}" oninput="PetitNF.filtrarMp()" style="max-width:340px"><button class="btn btn-primary btn-sm" onclick="PetitNF.editarMp()">+ Nova matéria-prima</button></div>`;
    const e = window.__mpEdit;
    if (e) h += `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>${e.id ? 'Editar' : 'Nova'} matéria-prima</b><div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Nome</label><input id="mp-nome" value="${esc(e.nome)}"></div><div class="field"><label>Tipo</label><input id="mp-tipo" value="${esc(e.tipo)}"></div>
      <div class="field"><label>Fornecedor</label><input id="mp-forn" value="${esc(e.fornecedor_nome)}"></div>
      <div class="field"><label>Categoria</label><select id="mp-categoria"><option value="ingrediente"${e.categoria === 'ingrediente' ? ' selected' : ''}>Ingrediente</option><option value="embalagem_produto"${e.categoria === 'embalagem_produto' ? ' selected' : ''}>Embalagem do produto</option></select></div>
      <div class="field"><label>Unidade base</label><select id="mp-base">${['g', 'ml', 'un'].map(u => `<option${u === e.unidade_base ? ' selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="field"><label>Custo atual por unidade base (R$)</label><input id="mp-custo" value="${e.custo_unitario_atual == null ? '' : e.custo_unitario_atual}"></div>
      <div class="field"><label>Observação</label><input id="mp-obs" value="${esc(e.observacao)}"></div></div>
      <label class="toggle-label"><input type="checkbox" id="mp-ok" ${e.cadastro_completo ? 'checked' : ''}> cadastro completo</label> <label class="toggle-label"><input type="checkbox" id="mp-ativo" ${e.ativo !== false ? 'checked' : ''}> ativa</label>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitNF.salvarMp()">Salvar</button><button class="btn btn-outline btn-sm" onclick="window.__mpEdit=null;PetitNF.aba('mp')">Cancelar</button></div></div>`;
    h += lista.length ? `<div class="table-card"><table><thead><tr><th>Matéria-prima</th><th>Tipo</th><th>Fornecedor</th><th>Custo atual</th><th>Última compra</th><th></th></tr></thead><tbody>${lista.map(m => `<tr${m.ativo === false ? ' style="opacity:.5"' : ''}>
      <td class="td-name">${esc(m.nome)}<div class="td-muted">${m.categoria === 'embalagem_produto' ? 'embalagem do produto' : 'ingrediente'}${m.cadastro_completo ? '' : ' · <span class="badge badge-pink">cadastro incompleto</span>'}</div></td>
      <td>${esc(m.tipo || '—')}</td><td>${esc(m.fornecedor_nome || '—')}</td><td>${un4(m.custo_unitario_atual)}/${m.unidade_base}</td><td>${dataBR(m.data_ultima_compra)}</td>
      <td><button class="btn-icon" onclick="PetitNF.editarMp('${m.id}')">✏️</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Nenhuma matéria-prima.</div>';
    if (D.embs.length) h += `<h3 style="margin:18px 0 8px">Embalagens de envio</h3><div class="table-card"><table><thead><tr><th>Item</th><th>Custo atual</th><th>Última compra</th></tr></thead><tbody>${D.embs.map(m => `<tr><td>${esc(m.nome)}</td><td>${un4(m.custo_unitario_atual)}/${m.unidade_base}</td><td>${dataBR(m.data_ultima_compra)}</td></tr>`).join('')}</tbody></table></div>`;
    return h;
  }
  function tabDesp() {
    const dh = new Date(), hoje = dh.getFullYear() + '-' + String(dh.getMonth() + 1).padStart(2, '0') + '-' + String(dh.getDate()).padStart(2, '0'), rec = D.desp.filter(d => d.recorrente).reduce((a, d) => a + Number(d.valor), 0), tot = D.desp.reduce((a, d) => a + Number(d.valor), 0);
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>Lançar despesa</b><div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Data</label><input type="date" id="ds-data" value="${hoje}"></div><div class="field"><label>Valor (R$)</label><input id="ds-valor" placeholder="0,00"></div>
      <div class="field"><label>Descrição</label><input id="ds-desc"></div>
      <div class="field"><label>Categoria</label><select id="ds-cat">${Object.entries(CAT_DESP).map(([a, b]) => `<option value="${a}">${b}</option>`).join('')}</select></div></div>
      <label class="toggle-label"><input type="checkbox" id="ds-rec"> recorrente (soma no custo fixo mensal)</label>
      <div style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="PetitNF.salvarDespesa()">Lançar</button></div></div>
      <div class="stats-grid" style="margin-bottom:12px"><div class="stat-card"><div class="stat-label">Total lançado</div><div class="stat-val">${brl(tot)}</div></div><div class="stat-card"><div class="stat-label">Recorrentes (custo fixo mensal)</div><div class="stat-val">${brl(rec)}</div></div></div>
      ${D.desp.length ? `<div class="table-card"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Tipo</th></tr></thead><tbody>${D.desp.map(d => `<tr><td>${dataBR(d.data)}</td><td>${esc(d.descricao)}${d.nota_fiscal_item_id ? '<div class="td-muted">veio de nota fiscal</div>' : ''}</td><td>${esc(CAT_DESP[d.categoria] || d.categoria)}</td><td>${brl(d.valor)}</td><td>${d.recorrente ? 'recorrente' : 'pontual'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Nenhuma despesa.</div>'}`;
  }
  function desenhar(soLista) {
    const raiz = $('nf-conteudo'); if (!raiz) return;
    if (soLista && aba === 'mp') { const p = $('nf-filtro'), pos = p ? p.selectionStart : 0; raiz.innerHTML = tabMp(); const n = $('nf-filtro'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    document.querySelectorAll('#nf-abas button').forEach(b => { b.className = 'btn btn-sm ' + (b.dataset.a === aba ? 'btn-primary' : 'btn-outline'); });
    const np = $('nf-npend'); if (np) np.textContent = pend.length ? ' (' + pend.length + ')' : '';
    raiz.innerHTML = aba === 'importar' ? tabImportar() : aba === 'notas' ? tabNotas() : aba === 'pendentes' ? tabPendentes() : aba === 'mp' ? tabMp() : tabDesp();
  }
  window.PetitNF.arquivos = lerArquivos;

  // ---------- montagem na página ----------
  function montar() {
    if ($('sec-notas')) return;
    const nav = document.querySelector('.sb-nav');
    const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-notas'; item.innerHTML = '<span class="ico">🧾</span> Notas fiscais'; item.onclick = () => goTo('notas');
    const sec = document.createElement('div'); sec.className = 'sb-section'; sec.textContent = 'Compras';
    const ref = [].slice.call(nav.querySelectorAll('.sb-section')).pop(); nav.insertBefore(sec, ref); nav.insertBefore(item, ref);   // antes de "Ferramentas"
    const s = document.createElement('div'); s.id = 'sec-notas'; s.className = 'section';
    s.innerHTML = `<div class="page-header"><div><div class="page-title">🧾 Notas fiscais e matéria-prima</div><div class="page-sub">Importe a NF-e (XML), confira a classificação e acompanhe custos e despesas</div></div></div>
      <div class="page-content"><div id="nf-abas" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      <button data-a="importar" onclick="PetitNF.aba('importar')">📥 Importar XML</button><button data-a="notas" onclick="PetitNF.aba('notas')">🧾 Notas</button>
      <button data-a="pendentes" onclick="PetitNF.aba('pendentes')">❓ Pendentes<span id="nf-npend"></span></button><button data-a="mp" onclick="PetitNF.aba('mp')">🧪 Matérias-primas</button><button data-a="desp" onclick="PetitNF.aba('desp')">💸 Despesas</button></div>
      <div id="nf-conteudo"></div></div>`;
    $('main').appendChild(s);
    const g0 = window.goTo;
    window.goTo = function (sec2) {
      g0(sec2);
      if (sec2 === 'notas') { $('nav-notas').classList.add('active'); carregar().then(desenhar).catch(e => { $('nf-conteudo').innerHTML = '<div class="alert">Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 6 precisa ter sido rodado no Supabase.</div>'; }); }
    };
  }
  montar();
})();
