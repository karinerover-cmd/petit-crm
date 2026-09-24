// ═══════════ TELAS "LOTES DE MATÉRIA-PRIMA" e "ROTINA" (Fase 11) ═══════════
// Registro de compra de matéria-prima com validade e alerta de vencimento (mesmos limites do produto acabado:
// crítico ≤60 dias, próximo ≤120 dias), e checklist de rotina com a data da última execução de cada tarefa.
// Nenhum fornecedor real traz validade no XML da nota — o cadastro é quase sempre manual.
// Depende de window.__gestao.sb() (camada_supabase.js).
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const numero = v => window.petitNumero(v);
  const hojeISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const VAL = { VENCIDO: ['Vencido', 'background:#FCE8E8;color:#A32D2D'], 'CRÍTICO': ['Crítico', 'background:#FCE8E8;color:#A32D2D'], 'PRÓXIMO': ['Próximo', 'background:#FFF4DC;color:#8A5A00'], OK: ['OK', 'background:#E6F4EA;color:#2e7d32'] };
  const FREQ = { sob_demanda: 'sob demanda', semanal: 'semanal', mensal: 'mensal' };
  const ROT = { em_dia: ['Em dia', 'background:#E6F4EA;color:#2e7d32'], atrasada: ['Atrasada', 'background:#FCE8E8;color:#A32D2D'], nunca: ['Nunca feita', 'background:#FFF4DC;color:#8A5A00'] };
  let D = { mps: [], lotes: [], execucoes: [] }, aba = 'lotes', filtro = '', novoLote = null;

  async function ler(t, col, asc) {
    let q = sb().from(t).select('*'); if (col) q = q.order(col, { ascending: asc !== false });
    const { data, error } = await q.range(0, 4999); if (error) throw new Error(t + ': ' + error.message); return data || [];
  }
  async function carregarMP() { const [mps, lotes] = await Promise.all([ler('materias_primas', 'nome'), ler('materia_prima_lotes_vencimento', 'data_validade')]); D.mps = mps; D.lotes = lotes; }
  async function carregarRotina() { const [tarefas, execucoes] = await Promise.all([ler('rotina_status', 'ordem'), ler('rotina_execucoes', 'executado_em', false)]); D.tarefas = tarefas; D.execucoes = execucoes; }
  async function rpc(nome, args) { const { data, error } = await sb().rpc(nome, args); if (error) throw new Error(error.message); return data; }
  function aviso(t, ok) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;bottom:44px;right:20px;max-width:440px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }

  // ---------- lotes de matéria-prima ----------
  function formLote() {
    const e = novoLote; if (!e) return '';
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>${e.id ? 'Editar' : 'Novo'} lote de matéria-prima</b><div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Matéria-prima</label><select id="ml-mp"><option value="">Escolha…</option>${D.mps.map(m => `<option value="${m.id}"${m.id === e.materia_prima_id ? ' selected' : ''}>${esc(m.nome)}${m.fornecedor_nome ? ' — ' + esc(m.fornecedor_nome) : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Quantidade (unidade base da matéria-prima)</label><input id="ml-qtd" value="${e.quantidade != null ? window.petitFmt(e.quantidade) : ''}" placeholder="opcional"></div>
      <div class="field"><label>Data da compra</label><input type="date" id="ml-compra" value="${esc(String(e.data_compra || hojeISO()).slice(0, 10))}"></div>
      <div class="field"><label>Data de validade</label><input type="date" id="ml-validade" value="${esc(String(e.data_validade || '').slice(0, 10))}"></div>
      <div class="field"><label>Nº do lote do fornecedor</label><input id="ml-numero" value="${esc(e.numero_lote_fornecedor)}" placeholder="opcional"></div>
      <div class="field" style="grid-column:1/-1"><label>Observação</label><input id="ml-obs" value="${esc(e.observacao)}"></div></div>
      <div class="td-muted" style="margin-top:6px">Nenhuma nota fiscal real traz a validade no XML — este cadastro é manual, olhando o rótulo ou o certificado do fornecedor.</div>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitMP.salvarLote()">Salvar</button><button class="btn btn-outline btn-sm" onclick="PetitMP.cancelar()">Cancelar</button></div></div>`;
  }
  function tabLotes() {
    const opts = [...new Set(D.lotes.map(l => l.status_validade).filter(Boolean))];
    const lista = D.lotes.filter(l => !filtro || l.status_validade === filtro).sort((a, b) => (a.dias_para_vencer ?? 1e9) - (b.dias_para_vencer ?? 1e9));
    let h = formLote();
    h += `<div class="table-toolbar" style="flex-wrap:wrap;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitMP.novoLote()">+ Novo lote</button>
      <select onchange="PetitMP.filtro(this.value)"><option value="">Todos os status</option>${opts.map(o => `<option value="${o}"${o === filtro ? ' selected' : ''}>${VAL[o] ? VAL[o][0] : o}</option>`).join('')}</select></div>`;
    if (!D.lotes.length) return h + '<div class="empty-state">Nenhum lote de matéria-prima cadastrado ainda.</div>';
    if (!lista.length) return h + '<div class="empty-state">Nenhum lote com esse status.</div>';
    h += `<div class="table-card"><table><thead><tr><th>Matéria-prima</th><th>Quantidade</th><th>Compra</th><th>Validade</th><th>Situação</th><th>Lote do fornecedor</th><th>Origem</th><th></th></tr></thead><tbody>${lista.map(l => {
      const v = VAL[l.status_validade];
      return `<tr><td>${esc(l.nome)}${l.fornecedor_nome ? '<div class="td-muted">' + esc(l.fornecedor_nome) + '</div>' : ''}</td><td>${l.quantidade != null ? window.petitFmt(l.quantidade) + ' ' + esc(l.unidade_base) : '—'}</td>
        <td>${dataBR(l.data_compra)}</td><td>${l.data_validade ? dataBR(l.data_validade) + (l.dias_para_vencer != null ? '<div class="td-muted">' + (l.dias_para_vencer >= 0 ? l.dias_para_vencer + ' dia(s)' : 'há ' + (-l.dias_para_vencer) + ' dia(s)') + '</div>' : '') : '<span class="td-muted">sem validade</span>'}</td>
        <td>${v ? `<span class="badge" style="${v[1]}">${v[0]}</span>` : '—'}</td><td>${esc(l.numero_lote_fornecedor || '—')}</td><td>${l.origem === 'nota_fiscal' ? 'nota fiscal' : 'manual'}</td>
        <td style="white-space:nowrap"><button class="btn-icon" title="Editar" onclick="PetitMP.editarLote('${l.id}')">✏️</button> <button class="btn-icon" title="Excluir" onclick="PetitMP.excluirLote('${l.id}')">🗑</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
    return h;
  }

  // ---------- rotina ----------
  function tabRotina() {
    if (!D.tarefas) return '<div class="empty-state">Carregando…</div>';
    return `<div class="table-card"><table><thead><tr><th>Tarefa</th><th>Frequência</th><th>Última vez</th><th>Situação</th><th></th></tr></thead><tbody>${D.tarefas.map(t => {
      const st = t.status ? ROT[t.status] : null;
      return `<tr><td>${esc(t.titulo)}</td><td>${FREQ[t.frequencia]}</td><td>${t.ultima_execucao ? dataBR(t.ultima_execucao) + (t.dias_desde != null ? '<div class="td-muted">há ' + t.dias_desde + ' dia(s)</div>' : '') : '<span class="td-muted">nunca</span>'}</td>
        <td>${st ? `<span class="badge" style="${st[1]}">${st[0]}</span>` : '<span class="td-muted">—</span>'}</td>
        <td><button class="btn btn-primary btn-sm" onclick="PetitMP.marcarFeita('${t.id}')">Marcar como feito</button></td></tr>`;
    }).join('')}</tbody></table></div>
      <h3 style="margin:18px 0 6px">Últimas execuções</h3><div class="table-card"><table><tbody>${D.execucoes.slice(0, 20).map(e => { const t = D.tarefas.find(x => x.id === e.tarefa_id);
        return `<tr><td>${new Date(e.executado_em).toLocaleString('pt-BR')}</td><td>${esc(t ? t.titulo : '?')}</td>${e.observacao ? '<td class="td-muted">' + esc(e.observacao) + '</td>' : '<td></td>'}<td><button class="btn-icon" title="Desfazer" onclick="PetitMP.desfazer('${e.id}')">↩️</button></td></tr>`; }).join('') || '<tr><td class="td-muted">Nenhuma execução registrada ainda.</td></tr>'}</tbody></table></div>`;
  }

  window.PetitMP = {
    // matéria-prima
    novoLote() { novoLote = { data_compra: hojeISO() }; desenhar(); },
    editarLote(id) { novoLote = Object.assign({}, D.lotes.find(l => l.id === id)); desenhar(); },
    cancelar() { novoLote = null; desenhar(); },
    filtro(v) { filtro = v; desenhar(); },
    async salvarLote() {
      const mp = $('ml-mp').value; if (!mp) return aviso('Escolha a matéria-prima.', false);
      const p = { id: novoLote.id || null, materia_prima_id: mp, quantidade: numero($('ml-qtd').value), data_compra: $('ml-compra').value,
        data_validade: $('ml-validade').value || '', numero_lote_fornecedor: $('ml-numero').value, observacao: $('ml-obs').value };
      try { await rpc('gestao_registrar_lote_materia_prima', { p }); novoLote = null; await carregarMP(); aviso('Lote salvo.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async excluirLote(id) {
      if (!confirm('Excluir este lote de matéria-prima?')) return;
      try { await rpc('gestao_excluir_lote_materia_prima', { p_id: id }); await carregarMP(); aviso('Lote excluído.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    // rotina
    async marcarFeita(id) {
      try { await rpc('gestao_marcar_tarefa_feita', { p_tarefa_id: id }); await carregarRotina(); aviso('Marcado como feito.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async desfazer(id) {
      if (!confirm('Desfazer esta execução?')) return;
      try { await rpc('gestao_desfazer_execucao', { p_id: id }); await carregarRotina(); aviso('Desfeito.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    }
  };

  function desenhar() {
    const raizMP = $('mp-conteudo'), raizR = $('rt-conteudo');
    if (raizMP) raizMP.innerHTML = tabLotes();
    if (raizR) raizR.innerHTML = tabRotina();
  }
  function montar() {
    const ref = $('nav-margem') || $('nav-lotes') || $('nav-indicadores'); if (!ref) return;
    if (!$('sec-materiaprima')) {
      const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-materiaprima'; item.innerHTML = '<span class="ico">🧪</span> Lotes de matéria-prima'; item.onclick = () => goTo('materiaprima');
      ref.parentNode.insertBefore(item, ref.nextSibling);
      const s = document.createElement('div'); s.id = 'sec-materiaprima'; s.className = 'section';
      s.innerHTML = `<div class="page-header"><div><div class="page-title">🧪 Lotes de matéria-prima</div><div class="page-sub">Validade por lote de compra, com alerta de vencimento</div></div></div><div class="page-content"><div id="mp-conteudo"></div></div>`;
      $('main').appendChild(s);
    }
    if (!$('sec-rotina')) {
      const item2 = document.createElement('div'); item2.className = 'nav-item'; item2.id = 'nav-rotina'; item2.innerHTML = '<span class="ico">✅</span> Rotina'; item2.onclick = () => goTo('rotina');
      $('nav-materiaprima').parentNode.insertBefore(item2, $('nav-materiaprima').nextSibling);
      const s2 = document.createElement('div'); s2.id = 'sec-rotina'; s2.className = 'section';
      s2.innerHTML = `<div class="page-header"><div><div class="page-title">✅ Rotina</div><div class="page-sub">Checklist com a última vez que cada tarefa foi feita</div></div></div><div class="page-content"><div id="rt-conteudo"></div></div>`;
      $('main').appendChild(s2);
    }
    const g0 = window.goTo;
    window.goTo = function (sec) {
      g0(sec);
      if (sec === 'materiaprima') { $('nav-materiaprima').classList.add('active'); novoLote = null; carregarMP().then(desenhar).catch(e => { $('mp-conteudo').innerHTML = '<div class="alert">Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 11 precisa ter sido rodado no Supabase.</div>'; }); }
      if (sec === 'rotina') { $('nav-rotina').classList.add('active'); carregarRotina().then(desenhar).catch(e => { $('rt-conteudo').innerHTML = '<div class="alert">Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 11 precisa ter sido rodado no Supabase.</div>'; }); }
    };
  }
  montar();
})();
