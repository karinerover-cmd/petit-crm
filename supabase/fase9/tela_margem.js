// ═══════════ TELA "MARGEM DE VENDAS" (Fase 9) ═══════════
// Mostra a margem de contribuição real de cada venda (custo travado + despesas variáveis), e deixa configurar
// as taxas/comissões estimadas e o kit de embalagem de envio por canal. O preço de venda não muda aqui.
// Depende de window.__gestao.sb() (camada_supabase.js).
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = n => (n == null || isNaN(n)) ? '—' : (Number(n) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const numero = v => window.petitNumero(v);   // formato brasileiro: 1.234,56 · 7.200 · 0,035 (leitor único do app)
  const TIPOS = { taxa_pagamento: 'Taxa de cartão/Pix', comissao_canal: 'Comissão do canal', comissao_plataforma: 'Comissão da plataforma', frete_absorvido: 'Frete absorvido', perda_extravio: 'Perda/extravio', embalagem_envio_fallback: 'Embalagem de envio (valor médio)' };
  const ORIGEM = { registrado: ['registrado na venda', ''], estimado: ['estimado (configuração)', 'badge-blue'], sem_regra: ['sem regra (R$ 0)', ''], kit: ['kit de embalagem', ''], kit_incompleto: ['kit sem custo completo → valor médio', 'badge-pink'], fallback: ['valor médio (sem kit)', 'badge-pink'] };
  let D = { margens: [], vendas: [], canais: [], config: [], mps: [], emb: [], kit: [] }, aba = 'vendas', filtroCanal = '', aberto = null, kitCanal = '', kitLinhas = [], regraEdit = null;

  async function ler(t, col, asc) {
    let q = sb().from(t).select('*'); if (col) q = q.order(col, { ascending: asc !== false });
    const { data, error } = await q.range(0, 4999); if (error) throw new Error(t + ': ' + error.message); return data || [];
  }
  async function carregar() {
    const [margens, vendas, canais, config, mps, emb, kit] = await Promise.all([ler('venda_margem', 'calculada_em', false), ler('vendas', 'data_venda', false),
      ler('canais', 'nome'), ler('despesas_variaveis_config'), ler('materias_primas', 'nome'), ler('materiais_embalagem_envio', 'nome'), ler('embalagem_envio_kit')]);
    D = { margens, vendas, canais, config, mps, emb, kit };
  }
  async function rpc(nome, args) { const { data, error } = await sb().rpc(nome, args); if (error) throw new Error(error.message); return data; }
  function aviso(t, ok) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;bottom:44px;right:20px;max-width:440px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }
  const venda = id => D.vendas.find(v => v.id === id);
  const canalNome = id => { const c = D.canais.find(x => x.id === id); return c ? c.nome : '—'; };
  const origemTxt = o => ORIGEM[o] || [o, ''];

  // ---------- aba: vendas e margem ----------
  function tabVendas() {
    const canais = [...new Set(D.margens.map(m => venda(m.venda_id)).filter(Boolean).map(v => v.canal_id))].map(canalNome).sort();
    const lista = D.margens.filter(m => { const v = venda(m.venda_id); return v && (!filtroCanal || canalNome(v.canal_id) === filtroCanal); }).slice(0, 200);
    const semMargem = D.vendas.length - D.margens.length;
    let h = `<div class="table-toolbar"><select onchange="PetitMG.filtroCanal(this.value)"><option value="">Todos os canais</option>${canais.map(c => `<option${c === filtroCanal ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <span class="td-muted">${lista.length} venda(s) com margem calculada${semMargem > 0 ? ' · ' + semMargem + ' venda(s) antiga(s) sem margem (de antes da Fase 9)' : ''}</span></div>`;
    if (!lista.length) return h + '<div class="empty-state">Nenhuma venda com margem ainda. A margem é calculada automaticamente a partir da próxima venda registrada.</div>';
    h += `<div class="table-card"><table><thead><tr><th>Data</th><th>Canal</th><th>Receita</th><th>Custo</th><th>Despesas</th><th>Margem</th><th>%</th><th></th></tr></thead><tbody>${lista.map(m => {
      const v = venda(m.venda_id) || {}; const incompleto = !m.custo_completo;
      let row = `<tr><td>${dataBR(v.data_venda)}</td><td>${esc(canalNome(v.canal_id))}<div class="td-muted">${esc(v.forma_pagamento || '')}</div></td><td>${brl(m.receita_produtos)}</td>
        <td>${incompleto ? '<span class="badge badge-pink">sem custo</span>' : brl(m.custo_produtos)}</td><td>${brl(m.despesas_variaveis_total)}</td>
        <td><b>${incompleto ? '—' : brl(m.margem_real)}</b></td><td>${incompleto ? '—' : pct(m.margem_pct)}</td><td><button class="btn-icon" title="Ver detalhe" onclick="PetitMG.ver('${m.venda_id}')">🔍</button></td></tr>`;
      if (aberto === m.venda_id) {
        const linhas = [['taxa_pagamento', 'Taxa de pagamento'], ['comissao_canal', 'Comissão do canal'], ['comissao_plataforma', 'Comissão da plataforma'], ['frete_absorvido', 'Frete absorvido'], ['embalagem_envio', 'Embalagem de envio'], ['perda_extravio', 'Perda/extravio']];
        row += `<tr><td colspan="8" style="background:var(--surface2)"><table><thead><tr><th>Despesa</th><th>Valor</th><th>Origem</th></tr></thead><tbody>${linhas.map(([k, nome]) => { const o = origemTxt(m[k + '_origem']); return `<tr><td>${nome}</td><td>${brl(m[k])}</td><td><span class="badge ${o[1]}">${o[0]}</span></td></tr>`; }).join('')}</tbody></table>
          ${incompleto ? `<div class="alert" style="margin-top:8px">Item(ns) sem custo travado: <b>${esc(m.itens_sem_custo || '')}</b>. A margem não é calculada até o produto ter um lote aprovado.</div>` : ''}
          <div class="td-muted" style="margin-top:6px">Calculada em ${dataBR(m.calculada_em)}. Não muda sozinha se a configuração for alterada depois.</div></td></tr>`;
      }
      return row;
    }).join('')}</tbody></table></div>`;
    return h;
  }

  // ---------- aba: despesas variáveis (configuração) ----------
  function formRegra() {
    const e = regraEdit; if (!e) return '';
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>${e.id ? 'Editar' : 'Nova'} regra</b><div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Tipo</label><select id="rg-tipo" ${e.id ? 'disabled' : ''}>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${k === e.tipo ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Canal (opcional = vale para todos)</label><select id="rg-canal"><option value="">Todos os canais</option>${D.canais.map(c => `<option${c.nome === e.canal ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
      <div class="field"><label>Forma de pagamento (opcional)</label><input id="rg-forma" value="${esc(e.forma_pagamento)}" placeholder="ex.: Cartão de crédito"></div>
      <div class="field"><label>Percentual (%)</label><input id="rg-pct" value="${e.percentual != null ? String(e.percentual * 100).replace('.', ',') : ''}" placeholder="ex.: 5"></div>
      <div class="field"><label>Ou valor fixo (R$)</label><input id="rg-fixo" value="${e.valor_fixo != null ? String(e.valor_fixo).replace('.', ',') : ''}"></div>
      <div class="field" style="grid-column:1/-1"><label>Observação</label><input id="rg-obs" value="${esc(e.observacao)}"></div></div>
      <label class="toggle-label"><input type="checkbox" id="rg-ativo" ${e.ativo !== false ? 'checked' : ''}> ativa</label>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitMG.salvarRegra()">Salvar</button><button class="btn btn-outline btn-sm" onclick="PetitMG.cancelarRegra()">Cancelar</button></div></div>`;
  }
  function tabConfig() {
    let h = formRegra();
    h += `<div class="table-toolbar"><button class="btn btn-primary btn-sm" onclick="PetitMG.novaRegra()">+ Nova regra</button></div>`;
    const grupos = Object.keys(TIPOS);
    grupos.forEach(tipo => {
      const linhas = D.config.filter(c => c.tipo === tipo);
      if (!linhas.length) return;
      h += `<h3 style="margin:16px 0 6px">${TIPOS[tipo]}</h3><div class="table-card"><table><thead><tr><th>Canal</th><th>Forma</th><th>Valor</th><th>Observação</th><th></th></tr></thead><tbody>${linhas.map(c => `<tr${c.ativo === false ? ' style="opacity:.5"' : ''}>
        <td>${esc(canalNome(c.canal_id) === '—' ? 'Todos' : canalNome(c.canal_id))}</td><td>${esc(c.forma_pagamento || '—')}</td>
        <td>${c.percentual != null ? pct(c.percentual) : brl(c.valor_fixo)}</td><td class="td-muted">${esc(c.observacao || '')}</td>
        <td style="white-space:nowrap"><button class="btn-icon" title="Editar" onclick="PetitMG.editarRegra('${c.id}')">✏️</button> <button class="btn-icon" title="Excluir" onclick="PetitMG.excluirRegra('${c.id}')">🗑</button></td></tr>`).join('')}</tbody></table></div>`;
    });
    return h;
  }

  // ---------- aba: kit de embalagem de envio ----------
  function tabKit() {
    const kitDoCanal = c => D.kit.filter(k => (c ? canalNome(k.canal_id) === c : k.canal_id === null));
    if (kitCanal === '' && !kitLinhas.length) kitLinhas = kitDoCanal('').map(k => ({ id: k.embalagem_envio_id, qtd: window.petitFmt(Number(k.quantidade_por_venda)) }));
    const opt = D.emb.filter(m => m.ativo !== false);
    return `<p class="td-muted">Quantos itens de embalagem de envio uma venda desse canal consome. O custo vem do cadastro em 🧾 Notas fiscais → Matérias-primas (nunca digitado aqui). Um canal sem kit próprio usa o kit <b>padrão</b>.</p>
      <div class="table-toolbar"><select onchange="PetitMG.kitCanal(this.value)"><option value=""${kitCanal === '' ? ' selected' : ''}>Padrão (canais sem kit próprio)</option>${D.canais.map(c => `<option${c.nome === kitCanal ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
      <div class="table-card" style="padding:16px"><table><tbody>${kitLinhas.map((l, j) => { const m = D.emb.find(x => x.id === l.id); return `<tr><td><select onchange="PetitMG.kitSet(${j},'id',this.value)"><option value="">Escolha…</option>${opt.map(x => `<option value="${x.id}"${x.id === l.id ? ' selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></td>
        <td><input value="${esc(l.qtd)}" style="width:90px" onchange="PetitMG.kitSet(${j},'qtd',this.value)"> por venda</td><td>${m ? (m.custo_unitario_atual == null ? '<span style="color:#A32D2D">sem custo</span>' : brl(m.custo_unitario_atual) + '/' + m.unidade_base) : '—'}</td><td><button class="btn-icon" onclick="PetitMG.kitRem(${j})">✕</button></td></tr>`; }).join('') || '<tr><td class="td-muted">Nenhum item.</td></tr>'}</tbody></table>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-outline btn-sm" onclick="PetitMG.kitAdd()">+ Item</button><button class="btn btn-primary btn-sm" onclick="PetitMG.kitSalvar()">Salvar kit</button></div></div>
      <div class="td-muted" style="margin-top:10px">Enquanto algum item do kit não tem custo, a venda usa o valor médio (${brl((D.config.find(c => c.tipo === 'embalagem_envio_fallback') || {}).valor_fixo)}/venda).</div>`;
  }

  window.PetitMG = {
    aba(a) { aba = a; aberto = null; desenhar(); },
    filtroCanal(v) { filtroCanal = v; desenhar(); },
    ver(id) { aberto = aberto === id ? null : id; desenhar(); },
    novaRegra() { regraEdit = { tipo: 'taxa_pagamento', ativo: true }; desenhar(); },
    editarRegra(id) { const c = D.config.find(x => x.id === id); regraEdit = { id: c.id, tipo: c.tipo, canal: canalNome(c.canal_id) === '—' ? '' : canalNome(c.canal_id), forma_pagamento: c.forma_pagamento, percentual: c.percentual, valor_fixo: c.valor_fixo, observacao: c.observacao, ativo: c.ativo }; desenhar(); },
    cancelarRegra() { regraEdit = null; desenhar(); },
    async salvarRegra() {
      const pctv = numero($('rg-pct').value), fixo = numero($('rg-fixo').value);
      if (pctv == null && fixo == null) return aviso('Informe o percentual ou o valor fixo.', false);
      const p = { id: regraEdit.id || null, tipo: $('rg-tipo').value, canal: $('rg-canal').value, forma_pagamento: $('rg-forma').value,
        percentual: pctv != null ? String(pctv / 100) : '', valor_fixo: fixo != null ? String(fixo) : '', observacao: $('rg-obs').value, ativo: $('rg-ativo').checked };
      try { await rpc('gestao_salvar_despesa_variavel', { p }); regraEdit = null; await carregar(); aviso('Regra salva.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async excluirRegra(id) {
      if (!confirm('Excluir esta regra? Vendas já calculadas não mudam; só as próximas deixam de usá-la.')) return;
      try { await rpc('gestao_excluir_despesa_variavel', { id }); await carregar(); aviso('Regra excluída.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    kitCanal(c) { kitCanal = c; kitLinhas = D.kit.filter(k => (c ? canalNome(k.canal_id) === c : k.canal_id === null)).map(k => ({ id: k.embalagem_envio_id, qtd: window.petitFmt(Number(k.quantidade_por_venda)) })); desenhar(); },
    kitSet(j, c, v) { kitLinhas[j][c] = v; desenhar(); }, kitAdd() { kitLinhas.push({ id: '', qtd: '1' }); desenhar(); }, kitRem(j) { kitLinhas.splice(j, 1); desenhar(); },
    async kitSalvar() {
      const itens = kitLinhas.filter(l => l.id).map(l => ({ embalagem_envio_id: l.id, quantidade: numero(l.qtd) }));
      try { await rpc('gestao_salvar_kit_embalagem_envio', { p: { canal: kitCanal, itens } }); await carregar(); aviso('Kit salvo.', true); PetitMG.kitCanal(kitCanal); } catch (e) { aviso(e.message, false); }
    }
  };

  function desenhar() {
    const raiz = $('mg-conteudo'); if (!raiz) return;
    document.querySelectorAll('#mg-abas button').forEach(b => { b.className = 'btn btn-sm ' + (b.dataset.a === aba ? 'btn-primary' : 'btn-outline'); });
    raiz.innerHTML = aba === 'vendas' ? tabVendas() : aba === 'config' ? tabConfig() : tabKit();
  }
  function montar() {
    if ($('sec-margem')) return;
    const ref = $('nav-lotes') || $('nav-formulas') || $('nav-notas'); if (!ref) return;
    const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-margem'; item.innerHTML = '<span class="ico">📊</span> Margem de vendas'; item.onclick = () => goTo('margem');
    ref.parentNode.insertBefore(item, ref.nextSibling);
    const s = document.createElement('div'); s.id = 'sec-margem'; s.className = 'section';
    s.innerHTML = `<div class="page-header"><div><div class="page-title">📊 Margem de vendas</div><div class="page-sub">Quanto sobra de verdade depois das despesas da venda — o preço não muda aqui</div></div></div>
      <div class="page-content"><div id="mg-abas" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><button data-a="vendas" onclick="PetitMG.aba('vendas')">📈 Vendas e margem</button>
      <button data-a="config" onclick="PetitMG.aba('config')">⚙️ Despesas variáveis</button><button data-a="kit" onclick="PetitMG.aba('kit')">📦 Kit de embalagem de envio</button></div><div id="mg-conteudo"></div></div>`;
    $('main').appendChild(s);
    const g0 = window.goTo;
    window.goTo = function (sec) { g0(sec); if (sec === 'margem') { $('nav-margem').classList.add('active'); carregar().then(desenhar).catch(e => { $('mg-conteudo').innerHTML = '<div class="alert">Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 9 precisa ter sido rodado no Supabase.</div>'; }); } };
  }
  montar();
})();
