// ═══════════ TELA "DÍVIDAS" (Fase 13) ═══════════
// Registro de dívidas, pagamentos e ajustes de saldo (juros lançados, renegociação...), sem misturar dinheiro
// pessoal com o do negócio. O saldo nunca é digitado direto: só existe pagamento (desconta) e ajuste (soma/desconta,
// com motivo). O ataque de 65% (ou o % configurado) incide sobre o faturamento LÍQUIDO do mês, que você digita —
// é só sugestão, nada é aplicado sozinho até você registrar o pagamento de fato.
// Depende de window.__gestao.sb() (camada_supabase.js).
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = n => (n == null || isNaN(n)) ? '—' : (Number(n) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + '%';
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const d10 = s => String(s || '').slice(0, 10);
  const numero = v => window.petitNumero(v);
  const hojeISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const TIPO = { cartao: 'Cartão', emprestimo: 'Empréstimo', parcelamento: 'Parcelamento', outro: 'Outro' };
  const ORIGEM = { faturamento_mes: 'Faturamento do mês', reserva: 'Reserva', receita_extraordinaria: 'Receita extraordinária', outro: 'Outro' };
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesTxt = m => { const [y, mm] = d10(m).split('-'); return MESES[Number(mm) - 1] + '/' + y; };
  let D = { dividas: [], pagamentos: [], ajustes: [], faturamentos: [] }, aba = 'dividas', dividaEdit = null, pagEdit = null, ajEdit = null, mesSel = hojeISO().slice(0, 7);

  async function ler(t, col, asc) {
    let q = sb().from(t).select('*'); if (col) q = q.order(col, { ascending: asc !== false });
    const { data, error } = await q.range(0, 4999); if (error) throw new Error(t + ': ' + error.message); return data || [];
  }
  async function carregar() {
    const [dividas, pagamentos, ajustes, faturamentos, ataque] = await Promise.all([ler('divida_resumo', 'valor_original', false), ler('divida_pagamentos', 'data_pagamento', false),
      ler('divida_ajustes', 'data_ajuste', false), ler('faturamento_liquido_mensal', 'mes', false), ler('divida_ataque_mensal', 'mes', false)]);
    D = { dividas, pagamentos, ajustes, faturamentos, ataque };
  }
  async function rpc(nome, args) { const { data, error } = await sb().rpc(nome, args); if (error) throw new Error(error.message); return data; }
  function aviso(t, ok) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;bottom:44px;right:20px;max-width:440px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }
  const divida = id => D.dividas.find(x => x.id === id);

  // ---------- dívidas ----------
  function formDivida() {
    const e = dividaEdit; if (!e) return '';
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>${e.id ? 'Editar' : 'Nova'} dívida</b><div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Nome / credor</label><input id="dv-nome" value="${esc(e.nome)}" placeholder="ex.: Nubank"></div>
      <div class="field"><label>Tipo</label><select id="dv-tipo">${Object.entries(TIPO).map(([k, v]) => `<option value="${k}"${k === e.tipo ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Valor original (R$)</label><input id="dv-valor" value="${e.valor_original != null ? window.petitFmt(e.valor_original) : ''}" ${e.id ? 'disabled' : ''}></div>
      <div class="field"><label>Data de início</label><input type="date" id="dv-inicio" value="${esc(d10(e.data_inicio || hojeISO()))}"></div>
      <div class="field"><label>Taxa de juros mensal (%, opcional — só informativo)</label><input id="dv-juros" value="${e.taxa_juros_mensal != null ? window.petitFmt(e.taxa_juros_mensal * 100) : ''}"></div>
      <div class="field"><label>% do faturamento líquido destinado a esta dívida (opcional)</label><input id="dv-pct" value="${e.percentual_ataque_faturamento != null ? window.petitFmt(e.percentual_ataque_faturamento * 100) : ''}" placeholder="ex.: 65"></div>
      <div class="field" style="grid-column:1/-1"><label>Observação</label><input id="dv-obs" value="${esc(e.observacao)}"></div></div>
      ${e.id ? '<div class="td-muted">O valor original não muda depois de criada — se a dívida aumentar, registre um ajuste.</div>' : ''}
      <label class="toggle-label"><input type="checkbox" id="dv-ativa" ${e.ativa !== false ? 'checked' : ''}> ativa</label>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitDV.salvarDivida()">Salvar</button><button class="btn btn-outline btn-sm" onclick="PetitDV.cancelar()">Cancelar</button></div></div>`;
  }
  function tabDividas() {
    let h = formDivida();
    h += `<div class="table-toolbar"><button class="btn btn-primary btn-sm" onclick="PetitDV.novaDivida()">+ Nova dívida</button></div>`;
    if (!D.dividas.length) return h + '<div class="empty-state">Nenhuma dívida cadastrada ainda.</div>';
    h += `<div class="table-card"><table><thead><tr><th>Dívida</th><th>Saldo atual</th><th>Já pago</th><th>Ritmo (3 meses)</th><th>Projeção</th><th>Ataque</th><th>Situação</th><th></th></tr></thead><tbody>${D.dividas.map(d => `<tr${d.ativa === false ? ' style="opacity:.5"' : ''}>
      <td>${esc(d.nome)}<div class="td-muted">${TIPO[d.tipo]} · desde ${dataBR(d.data_inicio)}</div></td>
      <td><b>${brl(d.saldo_atual)}</b>${d.status === 'quitada' ? '<div><span class="badge badge-blue">quitada</span></div>' : ''}</td>
      <td>${brl(d.total_pago)}</td><td>${Number(d.ritmo_mensal) > 0 ? brl(d.ritmo_mensal) + '/mês' : '<span class="td-muted">sem dado</span>'}</td>
      <td>${d.meses_para_quitar != null ? d.meses_para_quitar + ' mês(es)' : '<span class="td-muted">—</span>'}</td>
      <td>${d.percentual_ataque_faturamento != null ? pct(d.percentual_ataque_faturamento) + ' do líquido' : '<span class="td-muted">—</span>'}</td>
      <td>${d.status === 'quitada' ? '<span class="badge badge-blue">Quitada</span>' : '<span class="badge badge-pink">Em aberto</span>'}</td>
      <td style="white-space:nowrap"><button class="btn-icon" title="Editar" onclick="PetitDV.editarDivida('${d.id}')">✏️</button> <button class="btn-icon" title="Registrar pagamento" onclick="PetitDV.novoPagamento('${d.id}')">💸</button> <button class="btn-icon" title="Ajustar saldo" onclick="PetitDV.novoAjuste('${d.id}')">⚖️</button> <button class="btn-icon" title="Excluir" onclick="PetitDV.excluirDivida('${d.id}')">🗑</button></td></tr>`).join('')}</tbody></table></div>`;
    const geral = { devido: D.dividas.filter(d => d.ativa !== false && d.status !== 'quitada').reduce((a, d) => a + Number(d.saldo_atual), 0), pago: D.dividas.reduce((a, d) => a + Number(d.total_pago), 0) };
    h += `<div class="stats-grid" style="margin-top:12px"><div class="stat-card"><div class="stat-label">Total ainda devido</div><div class="stat-val">${brl(geral.devido)}</div></div><div class="stat-card"><div class="stat-label">Total já pago</div><div class="stat-val">${brl(geral.pago)}</div></div></div>`;
    return h;
  }

  // ---------- pagamento ----------
  function formPagamento() {
    const e = pagEdit; if (!e) return '';
    const d = divida(e.divida_id);
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>Registrar pagamento — ${esc(d ? d.nome : '')}</b><div class="td-muted">Saldo atual: ${brl(d ? d.saldo_atual : null)}</div>
      <div class="grid2f" style="margin-top:8px"><div class="field"><label>Valor pago (R$)</label><input id="pg-valor" value="${e.valor != null ? window.petitFmt(e.valor) : ''}"></div>
      <div class="field"><label>Data</label><input type="date" id="pg-data" value="${esc(e.data_pagamento || hojeISO())}"></div>
      <div class="field"><label>De onde saiu o dinheiro</label><select id="pg-origem">${Object.entries(ORIGEM).map(([k, v]) => `<option value="${k}"${k === e.origem_recurso ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Observação</label><input id="pg-obs" value="${esc(e.observacao)}"></div></div>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitDV.salvarPagamento()">Registrar</button><button class="btn btn-outline btn-sm" onclick="PetitDV.cancelar()">Cancelar</button></div></div>`;
  }
  function formAjuste() {
    const e = ajEdit; if (!e) return '';
    const d = divida(e.divida_id);
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>Ajustar saldo — ${esc(d ? d.nome : '')}</b><div class="td-muted">Saldo atual: ${brl(d ? d.saldo_atual : null)}. Use um valor negativo para abater, positivo se a dívida aumentou (ex.: juros lançados).</div>
      <div class="grid2f" style="margin-top:8px"><div class="field"><label>Valor do ajuste (R$, pode ser negativo)</label><input id="aj-valor" value="${e.valor != null ? window.petitFmt(e.valor) : ''}" placeholder="ex.: 250 ou -500"></div>
      <div class="field"><label>Data</label><input type="date" id="aj-data" value="${esc(e.data_ajuste || hojeISO())}"></div>
      <div class="field" style="grid-column:1/-1"><label>Motivo</label><input id="aj-motivo" value="${esc(e.motivo)}" placeholder="ex.: juros lançados em setembro"></div></div>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitDV.salvarAjuste()">Registrar ajuste</button><button class="btn btn-outline btn-sm" onclick="PetitDV.cancelar()">Cancelar</button></div></div>`;
  }
  function tabHistorico() {
    let h = formPagamento() + formAjuste();
    const pagamentos = D.pagamentos.map(p => Object.assign({ tipo: 'pagamento' }, p)), ajustes = D.ajustes.map(a => Object.assign({ tipo: 'ajuste', data_pagamento: a.data_ajuste }, a));
    const tudo = pagamentos.concat(ajustes).sort((a, b) => d10(b.data_pagamento).localeCompare(d10(a.data_pagamento)));
    if (!tudo.length) return h + '<div class="empty-state">Nenhum pagamento ou ajuste registrado ainda.</div>';
    h += `<div class="table-card"><table><thead><tr><th>Data</th><th>Dívida</th><th>Tipo</th><th>Valor</th><th>Detalhe</th><th></th></tr></thead><tbody>${tudo.map(x => { const d = divida(x.divida_id);
      return `<tr><td>${dataBR(x.data_pagamento)}</td><td>${esc(d ? d.nome : '?')}</td><td>${x.tipo === 'pagamento' ? 'Pagamento' : (Number(x.valor) > 0 ? 'Ajuste (+)' : 'Ajuste (−)')}</td>
        <td>${brl(Math.abs(Number(x.valor)))}</td><td class="td-muted">${x.tipo === 'pagamento' ? ORIGEM[x.origem_recurso] : esc(x.motivo)}${x.observacao ? ' · ' + esc(x.observacao) : ''}</td>
        <td><button class="btn-icon" title="Excluir" onclick="PetitDV.${x.tipo === 'pagamento' ? 'excluirPagamento' : 'excluirAjuste'}('${x.id}')">🗑</button></td></tr>`; }).join('')}</tbody></table></div>`;
    return h;
  }

  // ---------- ataque mensal ----------
  function tabAtaque() {
    const fat = D.faturamentos.find(f => d10(f.mes).startsWith(mesSel)), meses = [...new Set(D.faturamentos.map(f => d10(f.mes).slice(0, 7)).concat([mesSel]))].sort().reverse();
    const linhas = D.ataque.filter(a => d10(a.mes).startsWith(mesSel));
    return `<p class="td-muted">Digite o faturamento líquido do mês (já descontado o que você considera obrigatório/imposto). O sistema sugere o valor a atacar em cada dívida configurada — nada é aplicado sozinho, o pagamento de fato entra na aba Histórico.</p>
      <div class="table-card" style="padding:16px;margin-bottom:12px"><div class="grid2f">
        <div class="field"><label>Mês</label><input type="month" id="at-mes" value="${esc(mesSel)}" onchange="PetitDV.mesAtaque(this.value)"></div>
        <div class="field"><label>Faturamento líquido do mês (R$)</label><input id="at-valor" value="${fat ? window.petitFmt(fat.valor) : ''}"></div></div>
        <div style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="PetitDV.salvarFaturamento()">Salvar</button></div></div>
      ${!linhas.length ? '<div class="empty-state">Nenhuma dívida tem % de ataque configurado, ou o faturamento líquido deste mês ainda não foi digitado.</div>' :
      `<div class="table-card"><table><thead><tr><th>Dívida</th><th>%</th><th>Sugestão do mês</th><th>Já pago no mês</th><th>Falta sugerido</th></tr></thead><tbody>${linhas.map(a => `<tr><td>${esc(a.divida_nome)}</td><td>${pct(a.percentual_ataque_faturamento)}</td>
        <td><b>${brl(a.sugestao)}</b></td><td>${brl(a.pago_no_mes)}</td><td>${Number(a.diferenca) > 0 ? brl(a.diferenca) : '<span class="badge badge-blue">cumprido</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div style="margin-top:10px"><button class="btn btn-outline btn-sm" onclick="goTo('dividas')">Ir para Dívidas para registrar o pagamento</button></div>`}
      ${meses.length > 1 ? `<h3 style="margin:18px 0 6px">Meses com faturamento líquido digitado</h3><div class="td-muted">${meses.map(m => mesTxt(m + '-01')).join(' · ')}</div>` : ''}`;
  }

  window.PetitDV = {
    aba(a) { aba = a; dividaEdit = null; pagEdit = null; ajEdit = null; desenhar(); },
    mesAtaque(v) { mesSel = v; desenhar(); },
    novaDivida() { dividaEdit = { ativa: true, tipo: 'cartao' }; desenhar(); },
    editarDivida(id) { dividaEdit = Object.assign({}, divida(id)); desenhar(); },
    cancelar() { dividaEdit = null; pagEdit = null; ajEdit = null; desenhar(); },
    async salvarDivida() {
      const v = numero($('dv-valor').value), juros = numero($('dv-juros').value), pctA = numero($('dv-pct').value);
      if (!$('dv-nome').value.trim()) return aviso('Informe o nome da dívida.', false);
      if (v == null) return aviso('Informe o valor original.', false);
      const p = { id: dividaEdit.id || null, nome: $('dv-nome').value, tipo: $('dv-tipo').value, valor_original: v, data_inicio: $('dv-inicio').value,
        taxa_juros_mensal: juros != null ? String(juros / 100) : '', percentual_ataque_faturamento: pctA != null ? String(pctA / 100) : '',
        observacao: $('dv-obs').value, ativa: $('dv-ativa').checked };
      try { await rpc('gestao_salvar_divida', { p }); dividaEdit = null; await carregar(); aviso('Dívida salva.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async excluirDivida(id) {
      if (!confirm('Excluir esta dívida? Se ela já tiver pagamento ou ajuste, não será possível — marque como inativa nesse caso.')) return;
      try { await rpc('gestao_excluir_divida', { p_id: id }); await carregar(); aviso('Dívida excluída.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    novoPagamento(divida_id) { pagEdit = { divida_id, data_pagamento: hojeISO(), origem_recurso: 'faturamento_mes' }; aba = 'historico'; desenhar(); },
    async salvarPagamento() {
      const v = numero($('pg-valor').value); if (v == null || v <= 0) return aviso('Informe o valor pago.', false);
      const p = { divida_id: pagEdit.divida_id, valor: v, data_pagamento: $('pg-data').value, origem_recurso: $('pg-origem').value, observacao: $('pg-obs').value };
      try { await rpc('gestao_registrar_pagamento_divida', { p }); pagEdit = null; await carregar(); aviso('Pagamento registrado.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async excluirPagamento(id) {
      if (!confirm('Excluir este pagamento? O saldo da dívida volta a subir.')) return;
      try { await rpc('gestao_excluir_pagamento_divida', { p_id: id }); await carregar(); aviso('Pagamento excluído.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    novoAjuste(divida_id) { ajEdit = { divida_id, data_ajuste: hojeISO() }; aba = 'historico'; desenhar(); },
    async salvarAjuste() {
      const v = numero($('aj-valor').value); if (v == null || v === 0) return aviso('Informe um valor de ajuste diferente de zero.', false);
      if (!$('aj-motivo').value.trim()) return aviso('Informe o motivo do ajuste.', false);
      const p = { divida_id: ajEdit.divida_id, valor: v, data_ajuste: $('aj-data').value, motivo: $('aj-motivo').value };
      try { await rpc('gestao_registrar_ajuste_divida', { p }); ajEdit = null; await carregar(); aviso('Ajuste registrado.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async excluirAjuste(id) {
      if (!confirm('Excluir este ajuste?')) return;
      try { await rpc('gestao_excluir_ajuste_divida', { p_id: id }); await carregar(); aviso('Ajuste excluído.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async salvarFaturamento() {
      const v = numero($('at-valor').value); if (v == null) return aviso('Informe o faturamento líquido do mês.', false);
      try { await rpc('gestao_salvar_faturamento_liquido', { p: { mes: mesSel + '-01', valor: v } }); await carregar(); aviso('Faturamento líquido salvo.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    }
  };

  function desenhar() {
    const raiz = $('dv-conteudo'); if (!raiz) return;
    document.querySelectorAll('#dv-abas button').forEach(b => { b.className = 'btn btn-sm ' + (b.dataset.a === aba ? 'btn-primary' : 'btn-outline'); });
    raiz.innerHTML = aba === 'dividas' ? tabDividas() : aba === 'historico' ? tabHistorico() : tabAtaque();
  }
  function montar() {
    if ($('sec-dividas')) return;
    const ref = $('nav-rotina') || $('nav-materiaprima') || $('nav-indicadores'); if (!ref) return;
    const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-dividas'; item.innerHTML = '<span class="ico">💳</span> Dívidas'; item.onclick = () => goTo('dividas');
    ref.parentNode.insertBefore(item, ref.nextSibling);
    const s = document.createElement('div'); s.id = 'sec-dividas'; s.className = 'section';
    s.innerHTML = `<div class="page-header"><div><div class="page-title">💳 Dívidas</div><div class="page-sub">Sem misturar dinheiro pessoal com o do negócio</div></div></div>
      <div class="page-content"><div id="dv-abas" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><button data-a="dividas" onclick="PetitDV.aba('dividas')">📋 Dívidas</button>
      <button data-a="historico" onclick="PetitDV.aba('historico')">🧾 Histórico</button><button data-a="ataque" onclick="PetitDV.aba('ataque')">🎯 Ataque mensal</button></div><div id="dv-conteudo"></div></div>`;
    $('main').appendChild(s);
    const g0 = window.goTo;
    window.goTo = function (sec) { g0(sec); if (sec === 'dividas') { $('nav-dividas').classList.add('active'); carregar().then(desenhar).catch(e => { $('dv-conteudo').innerHTML = '<div class="alert">Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 13 precisa ter sido rodado no Supabase.</div>'; }); } };
  }
  montar();
})();
