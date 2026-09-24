// ═══════════ TELA "FLUXO DE CAIXA" (Fase 12) ═══════════
// Livro-caixa por conta bancária (cada conta com o seu próprio saldo, nunca encadeia com outra), vendas "a confirmar"
// (a data e a conta em que o dinheiro caiu de fato), saldo projetado do mês e cadastro de contas.
// Venda não confirmada fica em "a receber" e não entra no saldo. Depende de window.__gestao.sb() (camada_supabase.js).
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const d10 = s => String(s || '').slice(0, 10);
  const numero = v => window.petitNumero(v);
  const hojeISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesTxt = m => { const [y, mm] = d10(m).split('-'); return MESES[Number(mm) - 1] + '/' + y; };
  const ORIGEM = { venda: 'venda', divida_pagamento: 'dívida', despesa_operacional: 'custo fixo', investimento: 'investimento' };
  let D = { contas: [], extrato: [], resumo: [], projetado: [], categorias: [], custos: [] };
  let aba = 'livro', contaSel = null, mesSel = hojeISO().slice(0, 7), movEdit = null, contaEdit = null, selecionados = new Set();
  let conc = {};                                           // escolhas da Karine na conciliação, por linha do extrato

  async function ler(t, col, asc) {
    let q = sb().from(t).select('*'); if (col) q = q.order(col, { ascending: asc !== false });
    const { data, error } = await q.range(0, 9999); if (error) throw new Error(t + ': ' + error.message); return data || [];
  }
  const lerOpcional = (t, col, asc) => ler(t, col, asc).catch(() => null);   // Fase 12b ainda não rodada: a tela abre sem a aba de conciliação
  async function carregar() {
    const [contas, extrato, resumo, projetado, categorias, custos, proposta, importacoes, saldoDiario] = await Promise.all([ler('contas_bancarias', 'data_abertura'),
      ler('fluxo_caixa_extrato', 'data_caixa'), ler('fluxo_caixa_resumo_mensal', 'mes'), ler('saldo_caixa_projetado', 'mes'),
      ler('fluxo_caixa_categorias', 'usos', false), ler('custos_fixos', 'nome'),
      lerOpcional('extrato_conciliacao_proposta', 'data'), lerOpcional('extrato_importacoes_resumo', 'importado_em', false), lerOpcional('extrato_saldo_diario', 'data')]);
    extrato.sort((a, b) => (a.data_caixa < b.data_caixa ? -1 : a.data_caixa > b.data_caixa ? 1 : Number(a.seq) - Number(b.seq)));
    D = { contas, extrato, resumo, projetado, categorias, custos, proposta, importacoes, saldoDiario };
    if (!contaSel || !contas.find(c => c.id === contaSel)) contaSel = (contas.find(c => c.principal) || contas[0] || {}).id || null;
    const vivas = new Set((proposta || []).map(p => p.linha_id));
    for (const id of Object.keys(conc)) if (!vivas.has(id)) delete conc[id];
    for (const p of proposta || []) if (!conc[p.linha_id]) conc[p.linha_id] = { acao: p.acao_sugerida, categoria: p.categoria_sugerida || '', marcado: p.acao_sugerida !== 'novo' || !!p.categoria_sugerida };
  }
  async function rpc(nome, args) { const { data, error } = await sb().rpc(nome, args); if (error) throw new Error(error.message); return data; }
  function aviso(t, ok) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;bottom:44px;right:20px;max-width:440px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }
  const conta = id => D.contas.find(c => c.id === id) || {};
  const opcoesContas = (sel, soAtivas) => D.contas.filter(c => !soAtivas || c.ativa || c.id === sel)
    .map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.nome)}${c.ativa ? '' : ' (encerrada)'}${c.principal ? ' — principal' : ''}</option>`).join('');
  const aReceber = m => m.origem_tipo === 'venda' && !m.confirmado_extrato;
  const quebraAviso = '<div style="background:#FFF4DC;color:#8A5A00;border:1px solid #F0D9A8;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px">';

  // ---------- livro-caixa ----------
  function formMovimento() {
    const e = movEdit; if (!e) return '';
    const ligado = e.id && !['manual', 'investimento'].includes(e.origem_tipo);
    const tipo = e.id ? (Number(e.entrada) > 0 ? 'entrada' : 'saida') : (e.tipo || 'saida');
    const valor = e.id ? (Number(e.entrada) > 0 ? e.entrada : e.saida) : e.valor;
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>${e.id ? 'Editar lançamento' : 'Novo lançamento'}</b>
      ${ligado ? `<div class="td-muted">Lançamento ligado a ${ORIGEM[e.origem_tipo]} — dá para mudar conta, data, valor e a conferência, mas não o sentido (entrada/saída).</div>` : ''}
      ${e.origem_tipo === 'venda' && !e.confirmado_extrato ? '<div class="td-muted">Venda ainda não confirmada: ajuste a data e a conta em que o dinheiro caiu e o valor que de fato entrou (já sem taxa/comissão), e marque "conferido".</div>' : ''}
      <div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Conta</label><select id="fc-conta">${opcoesContas(e.conta_bancaria_id || contaSel)}</select></div>
      <div class="field"><label>Data em que o dinheiro mexeu</label><input type="date" id="fc-data" value="${esc(d10(e.data_caixa) || hojeISO())}"></div>
      <div class="field"><label>Entrada ou saída</label><select id="fc-tipo" ${e.id ? 'disabled' : ''}><option value="entrada"${tipo === 'entrada' ? ' selected' : ''}>Entrada</option><option value="saida"${tipo === 'saida' ? ' selected' : ''}>Saída</option></select></div>
      <div class="field"><label>Valor (R$)</label><input id="fc-valor" value="${valor != null && valor !== '' ? window.petitFmt(valor) : ''}"></div>
      <div class="field"><label>Descrição</label><input id="fc-desc" value="${esc(e.descricao)}"></div>
      <div class="field"><label>Categoria</label><input id="fc-cat" list="fc-cats" value="${esc(e.categoria)}" placeholder="comece a digitar…"><datalist id="fc-cats">${D.categorias.map(c => `<option value="${esc(c.categoria)}">`).join('')}</datalist></div>
      <div class="field"><label>Saldo real do banco neste ponto (opcional, do extrato)</label><input id="fc-extrato" value="${e.saldo_real_banco != null ? window.petitFmt(e.saldo_real_banco) : ''}"></div>
      <div class="field"><label>Observação</label><input id="fc-obs" value="${esc(e.observacao)}"></div></div>
      ${ligado ? '' : `<label class="toggle-label"><input type="checkbox" id="fc-invest" ${e.origem_tipo === 'investimento' ? 'checked' : ''}> é investimento (ex.: aplicação/resgate de CDB)</label>`}
      <label class="toggle-label"><input type="checkbox" id="fc-conf" ${e.confirmado_extrato ? 'checked' : ''}> conferido no extrato</label>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitFC.salvarMovimento()">Salvar</button><button class="btn btn-outline btn-sm" onclick="PetitFC.cancelar()">Cancelar</button></div></div>`;
  }
  function tabLivro() {
    let h = formMovimento();
    const c = conta(contaSel);
    h += `<div class="table-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Conta</label><select onchange="PetitFC.conta(this.value)">${opcoesContas(contaSel)}</select></div>
      <div class="field" style="margin:0"><label>Mês</label><input type="month" value="${mesSel}" onchange="PetitFC.mes(this.value)"></div>
      <button class="btn btn-primary btn-sm" onclick="PetitFC.novoMovimento()">+ Novo lançamento</button></div>`;
    if (!c.id) return h + '<div class="empty-state">Nenhuma conta cadastrada.</div>';
    const r = D.resumo.find(x => x.conta_bancaria_id === contaSel && d10(x.mes).slice(0, 7) === mesSel);
    const anteriores = D.resumo.filter(x => x.conta_bancaria_id === contaSel && d10(x.mes).slice(0, 7) < mesSel);
    const saldoIni = r ? r.saldo_inicial : (anteriores.length ? anteriores[anteriores.length - 1].saldo_final : 0);
    h += `<div class="stats-grid"><div class="stat-card"><div class="stat-label">Saldo inicial de ${mesTxt(mesSel + '-01')}</div><div class="stat-val">${brl(saldoIni)}</div></div>
      <div class="stat-card"><div class="stat-label">Entradas</div><div class="stat-val">${brl(r ? r.entradas : 0)}</div></div>
      <div class="stat-card"><div class="stat-label">Saídas</div><div class="stat-val">${brl(r ? r.saidas : 0)}</div></div>
      <div class="stat-card"><div class="stat-label">Saldo final</div><div class="stat-val">${brl(r ? r.saldo_final : saldoIni)}</div></div>
      <div class="stat-card"><div class="stat-label">A receber (vendas não confirmadas)</div><div class="stat-val">${brl(r ? r.a_receber : 0)}</div></div></div>`;
    const linhas = D.extrato.filter(m => m.conta_bancaria_id === contaSel && d10(m.data_caixa).slice(0, 7) === mesSel);
    if (!linhas.length) return h + `<div class="empty-state">Nenhum lançamento em ${mesTxt(mesSel + '-01')} na ${esc(c.nome)}.</div>`;
    h += `<div class="table-card" style="margin-top:12px"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Entrada</th><th>Saída</th><th>Saldo</th><th>Extrato</th><th></th></tr></thead><tbody>${linhas.map(m => `<tr${aReceber(m) ? ' style="background:#FFFBEF"' : ''}>
      <td>${dataBR(m.data_caixa)}</td>
      <td>${esc(m.descricao)}${ORIGEM[m.origem_tipo] ? ` <span class="badge badge-blue">${ORIGEM[m.origem_tipo]}</span>` : ''}${aReceber(m) ? ' <span class="badge badge-pink">a receber</span>' : ''}${m.observacao ? `<div class="td-muted">${esc(m.observacao)}</div>` : ''}</td>
      <td>${esc(m.categoria)}</td>
      <td>${Number(m.entrada) > 0 ? brl(m.entrada) : ''}</td><td>${Number(m.saida) > 0 ? brl(m.saida) : ''}</td>
      <td>${m.entra_no_saldo ? brl(m.saldo_acumulado) : '<span class="td-muted">fora do saldo</span>'}</td>
      <td>${m.saldo_real_banco != null ? brl(m.saldo_real_banco) + (Math.abs(Number(m.diferenca_extrato)) >= 0.01 ? `<div style="color:#A32D2D;font-size:12px">diferença ${brl(m.diferenca_extrato)}</div>` : '<div style="color:#2e7d32;font-size:12px">bate ✓</div>') : (m.confirmado_extrato ? '<span style="color:#2e7d32">✓</span>' : '')}</td>
      <td style="white-space:nowrap"><button class="btn-icon" title="Editar / confirmar" onclick="PetitFC.editarMovimento('${m.id}')">✏️</button>${['venda', 'divida_pagamento'].includes(m.origem_tipo) ? '' : ` <button class="btn-icon" title="Excluir" onclick="PetitFC.excluirMovimento('${m.id}')">🗑</button>`}</td></tr>`).join('')}</tbody></table></div>`;
    return h;
  }

  // ---------- a confirmar ----------
  function tabConfirmar() {
    let h = formMovimento();
    const pend = D.extrato.filter(aReceber).sort((a, b) => (a.data_caixa < b.data_caixa ? -1 : 1));
    h += `${quebraAviso}Vendas que ainda não foram conferidas no banco. Enquanto não confirmadas, ficam em "a receber" e <b>não entram no saldo</b>.
      Para o acerto mensal da consignação (vários pedidos num depósito só), marque as vendas e confirme todas de uma vez. Para ajustar o valor que caiu (já sem taxa/comissão), use ✏️.</div>`;
    if (!pend.length) return h + '<div class="empty-state">Nenhuma venda esperando confirmação. 🎉</div>';
    const soma = pend.filter(m => selecionados.has(m.id)).reduce((a, m) => a + Number(m.entrada), 0);
    const principal = (D.contas.find(c => c.principal) || {}).id;
    h += `<div class="table-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="margin:0"><label>Caiu em</label><input type="date" id="fc-conf-data" value="${hojeISO()}"></div>
      <div class="field" style="margin:0"><label>Na conta</label><select id="fc-conf-conta">${opcoesContas(principal, true)}</select></div>
      <button class="btn btn-primary btn-sm" onclick="PetitFC.confirmarSelecionados()">✓ Confirmar selecionadas (${selecionados.size} · ${brl(soma)})</button></div>
      <div class="table-card"><table><thead><tr><th><input type="checkbox" onchange="PetitFC.marcarTodos(this.checked)" ${selecionados.size === pend.length ? 'checked' : ''}></th><th>Data da venda</th><th>Venda</th><th>Categoria</th><th>Valor</th><th>Conta prevista</th><th></th></tr></thead><tbody>${pend.map(m => `<tr>
      <td><input type="checkbox" ${selecionados.has(m.id) ? 'checked' : ''} onchange="PetitFC.marcar('${m.id}', this.checked)"></td>
      <td>${dataBR(m.data_caixa)}</td><td>${esc(m.descricao)}</td><td>${esc(m.categoria)}</td><td>${brl(m.entrada)}</td><td>${esc(m.conta_nome)}</td>
      <td><button class="btn-icon" title="Ajustar e confirmar" onclick="PetitFC.editarMovimento('${m.id}')">✏️</button></td></tr>`).join('')}</tbody></table></div>`;
    return h;
  }

  // ---------- saldo projetado ----------
  function custosPendentes(mes) {
    return D.custos.filter(cf => d10(cf.vigente_desde) <= mes && (!cf.vigente_ate || d10(cf.vigente_ate) >= mes))
      .filter(cf => !D.extrato.some(m => m.origem_tipo === 'despesa_operacional' && m.origem_id === cf.id && d10(m.data_caixa).slice(0, 7) === mes.slice(0, 7)));
  }
  function tabProjetado() {
    const mesAtual = hojeISO().slice(0, 7) + '-01';
    let h = `${quebraAviso}<b>Saldo projetado = saldo da conta + a receber − custos fixos ainda não lançados − ataque de dívida ainda não pago.</b>
      Custos fixos e ataque de dívida só entram na conta principal (senão seriam contados duas vezes). Para conferir um mês fechado com a planilha, compare a coluna "Saldo final".</div>`;
    const ativas = D.contas.filter(c => c.ativa);
    for (const c of ativas) {
      const atual = D.projetado.find(p => p.conta_bancaria_id === c.id && d10(p.mes) === mesAtual);
      if (atual) h += `<div style="font-weight:600;margin:14px 0 8px">${esc(c.nome)}${c.principal ? ' <span class="badge badge-blue">principal</span>' : ''} — ${mesTxt(mesAtual)}</div>
        <div class="stats-grid"><div class="stat-card"><div class="stat-label">Saldo no fim do mês (lançado)</div><div class="stat-val">${brl(atual.saldo_fim_mes)}</div></div>
        <div class="stat-card"><div class="stat-label">+ A receber</div><div class="stat-val">${brl(atual.a_receber)}</div></div>
        <div class="stat-card"><div class="stat-label">− Custos fixos pendentes</div><div class="stat-val">${brl(atual.custos_fixos_pendentes)}</div></div>
        <div class="stat-card"><div class="stat-label">− Ataque de dívida pendente</div><div class="stat-val">${brl(atual.ataque_divida_pendente)}</div></div>
        <div class="stat-card"><div class="stat-label">= Saldo projetado</div><div class="stat-val" style="color:${Number(atual.saldo_projetado) < 0 ? '#A32D2D' : 'inherit'}">${brl(atual.saldo_projetado)}</div></div></div>`;
      if (c.principal) {
        const pend = custosPendentes(mesAtual);
        if (pend.length) h += `<div class="table-card" style="margin-top:10px"><table><thead><tr><th>Custo fixo pendente em ${mesTxt(mesAtual)}</th><th>Valor</th><th></th></tr></thead><tbody>${pend.map(cf => `<tr>
          <td>${esc(cf.nome)}</td><td>${brl(cf.valor_mensal)}</td><td><button class="btn btn-outline btn-sm" onclick="PetitFC.lancarCusto('${cf.id}')">Lançar como pago</button></td></tr>`).join('')}</tbody></table></div>`;
      }
    }
    for (const c of D.contas) {
      const meses = D.resumo.filter(r => r.conta_bancaria_id === c.id);
      if (!meses.length) continue;
      h += `<div style="font-weight:600;margin:18px 0 8px">Mês a mês — ${esc(c.nome)}${c.ativa ? '' : ' (encerrada)'}</div><div class="table-card"><table><thead><tr><th>Mês</th><th>Saldo inicial</th><th>Entradas</th><th>Saídas</th><th>Resultado</th><th>Saldo final</th><th>A receber</th><th>Projetado</th></tr></thead><tbody>${meses.map(r => {
        const p = D.projetado.find(x => x.conta_bancaria_id === c.id && d10(x.mes) === d10(r.mes));
        return `<tr><td>${mesTxt(r.mes)}</td><td>${brl(r.saldo_inicial)}</td><td>${brl(r.entradas)}</td><td>${brl(r.saidas)}</td><td>${brl(r.resultado)}</td><td><b>${brl(r.saldo_final)}</b></td><td>${Number(r.a_receber) ? brl(r.a_receber) : ''}</td><td>${p ? brl(p.saldo_projetado) : '<span class="td-muted">—</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    return h;
  }

  // ---------- contas ----------
  function formConta() {
    const e = contaEdit; if (!e) return '';
    return `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>${e.id ? 'Editar' : 'Nova'} conta</b><div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Nome</label><input id="cb-nome" value="${esc(e.nome)}" placeholder="ex.: Conta C6"></div>
      <div class="field"><label>Observação</label><input id="cb-obs" value="${esc(e.observacao)}"></div>
      <div class="field"><label>Data de abertura</label><input type="date" id="cb-abertura" value="${esc(d10(e.data_abertura) || hojeISO())}"></div>
      <div class="field"><label>Data de encerramento (vazio = ativa)</label><input type="date" id="cb-encerramento" value="${esc(d10(e.data_encerramento))}"></div></div>
      <label class="toggle-label"><input type="checkbox" id="cb-principal" ${e.principal ? 'checked' : ''}> conta principal (recebe as vendas novas e a projeção de custos e dívida)</label>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitFC.salvarConta()">Salvar</button><button class="btn btn-outline btn-sm" onclick="PetitFC.cancelar()">Cancelar</button></div></div>`;
  }
  function tabContas() {
    let h = formConta() + `<div class="table-toolbar"><button class="btn btn-primary btn-sm" onclick="PetitFC.novaConta()">+ Nova conta</button></div>`;
    h += `<div class="table-card"><table><thead><tr><th>Conta</th><th>Período</th><th>Saldo atual</th><th>Situação</th><th></th></tr></thead><tbody>${D.contas.map(c => {
      const ult = D.resumo.filter(r => r.conta_bancaria_id === c.id).pop();
      return `<tr${c.ativa ? '' : ' style="opacity:.6"'}><td>${esc(c.nome)}${c.principal ? ' <span class="badge badge-blue">principal</span>' : ''}${c.observacao ? `<div class="td-muted">${esc(c.observacao)}</div>` : ''}</td>
      <td>${dataBR(c.data_abertura)} → ${c.data_encerramento ? dataBR(c.data_encerramento) : 'hoje'}</td><td>${brl(ult ? ult.saldo_final : 0)}</td>
      <td>${c.ativa ? '<span class="badge badge-pink">Ativa</span>' : '<span class="badge badge-blue">Encerrada</span>'}</td>
      <td><button class="btn-icon" title="Editar" onclick="PetitFC.editarConta('${c.id}')">✏️</button></td></tr>`;
    }).join('')}</tbody></table></div><div class="td-muted" style="margin-top:8px">Cada conta tem o seu próprio saldo: o saldo de uma nunca passa para outra.</div>`;
    return h;
  }

  // ---------- conciliação com o extrato do banco (Fase 12b) ----------
  const ACAO = { confirmar: 'Confirmar lançamento', transferencia: 'Transferência entre contas', novo: 'Lançar como novo', ignorar: 'Ignorar' };
  function tabConciliacao() {
    if (!D.proposta) return quebraAviso + 'A conciliação por extrato ainda não está ativa: falta rodar o SQL da Fase 12b no Supabase.</div>';
    let h = `${quebraAviso}<b>Como funciona:</b> me passe os extratos do mês em PDF (C6 e Nubank PJ). Eu confiro o saldo com o do banco e te entrego um SQL;
      rode no Supabase e as linhas aparecem aqui com uma sugestão. Revise, ajuste o que precisar e aprove — o valor e a data que ficam são sempre os do banco.</div>`;
    const imps = (D.importacoes || []).filter(i => Math.abs(Number(i.diferenca_abertura)) >= 0.01 || i.linhas_pendentes > 0);
    if (imps.length) h += `<div class="table-card" style="margin-bottom:12px"><table><thead><tr><th>Extrato</th><th>Período</th><th>Saldo do banco no início</th><th>Sistema no início</th><th>Diferença de abertura</th><th>Pendentes</th><th></th></tr></thead><tbody>${imps.map(i => `<tr>
      <td>${esc(i.conta_nome)}<div class="td-muted">${esc(i.arquivo || '')}</div></td><td>${dataBR(i.periodo_inicio)} a ${dataBR(i.periodo_fim)}</td>
      <td>${brl(i.saldo_abertura)}</td><td>${brl(i.saldo_sistema_abertura)}</td>
      <td>${Math.abs(Number(i.diferenca_abertura)) >= 0.01 ? `<b style="color:#A32D2D">${brl(i.diferenca_abertura)}</b>` : '<span style="color:#2e7d32">bate ✓</span>'}</td>
      <td>${i.linhas_pendentes}</td>
      <td>${Math.abs(Number(i.diferenca_abertura)) >= 0.01 ? `<button class="btn btn-outline btn-sm" title="Lança um ajuste no 1º dia do período para o saldo do sistema começar igual ao do banco" onclick="PetitFC.ajusteAbertura('${i.id}')">Lançar ajuste de abertura</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    const prop = D.proposta;
    if (!prop.length) h += '<div class="empty-state">Nenhuma linha de extrato esperando conciliação. 🎉</div>';
    else {
      const marcadas = prop.filter(p => conc[p.linha_id] && conc[p.linha_id].marcado).length;
      h += `<div class="table-toolbar"><button class="btn btn-primary btn-sm" onclick="PetitFC.aprovarConciliacao()">✓ Aprovar selecionadas (${marcadas} de ${prop.length})</button></div>
        <div class="table-card"><table><thead><tr><th><input type="checkbox" onchange="PetitFC.marcarConc(null, this.checked)" ${marcadas === prop.length ? 'checked' : ''}></th><th>Data</th><th>Conta</th><th>No extrato</th><th>Valor</th><th>O que fazer</th><th>Detalhe</th></tr></thead><tbody>${prop.map(p => {
        const e = conc[p.linha_id] || {}, acoes = ['novo', 'ignorar'].concat(p.movimento_id ? ['confirmar'] : [], p.par_linha_id ? ['transferencia'] : []);
        let det = '';
        if (e.acao === 'confirmar') det = `↔ ${esc(p.movimento_descricao)}${p.movimento_origem === 'venda' ? '' : ` <span class="td-muted">(${dataBR(p.movimento_data)})</span>`}`;   // descrição da venda já traz a data
        else if (e.acao === 'transferencia') det = `↔ a outra ponta no <b>${esc(p.par_conta_nome)}</b>`;
        else if (e.acao === 'novo') det = `<input list="fc-cats-conc" value="${esc(e.categoria)}" placeholder="categoria…" style="min-width:170px" onchange="PetitFC.categoriaConc('${p.linha_id}', this.value)">${p.custo_fixo_nome ? ` <span class="badge badge-blue" title="Quita o custo fixo do mês">custo fixo: ${esc(p.custo_fixo_nome)}</span>` : ''}`;
        return `<tr${e.marcado ? '' : ' style="opacity:.55"'}><td><input type="checkbox" ${e.marcado ? 'checked' : ''} onchange="PetitFC.marcarConc('${p.linha_id}', this.checked)"></td>
          <td>${dataBR(p.data)}</td><td>${esc(p.conta_nome)}</td><td>${esc(p.descricao)}</td>
          <td style="color:${Number(p.valor) < 0 ? '#A32D2D' : '#2e7d32'};white-space:nowrap">${brl(p.valor)}</td>
          <td><select onchange="PetitFC.acaoConc('${p.linha_id}', this.value)">${acoes.map(a => `<option value="${a}"${a === e.acao ? ' selected' : ''}>${ACAO[a]}</option>`).join('')}</select></td><td>${det}</td></tr>`;
      }).join('')}</tbody></table><datalist id="fc-cats-conc">${D.categorias.map(c => `<option value="${esc(c.categoria)}">`).join('')}</datalist></div>`;
    }
    const dias = D.saldoDiario || [];
    if (dias.length) {
      const errados = dias.filter(x => Math.abs(Number(x.diferenca)) >= 0.01).length;
      h += `<div style="font-weight:600;margin:18px 0 8px">Sistema x banco, dia a dia ${errados ? `<span class="badge badge-pink">${errados} dia(s) diferente(s)</span>` : '<span class="badge badge-blue">tudo batendo ✓</span>'}</div>
        <div class="table-card"><table><thead><tr><th>Dia</th><th>Conta</th><th>Saldo do banco</th><th>Saldo do sistema</th><th>Diferença</th></tr></thead><tbody>${dias.slice().reverse().map(x => `<tr>
        <td>${dataBR(x.data)}</td><td>${esc(x.conta_nome)}</td><td>${brl(x.saldo_banco)}</td><td>${brl(x.saldo_sistema)}</td>
        <td>${Math.abs(Number(x.diferenca)) >= 0.01 ? `<b style="color:#A32D2D">${brl(x.diferenca)}</b>${x.linhas_pendentes ? ` <span class="td-muted">(${x.linhas_pendentes} pendente(s))</span>` : ''}` : '<span style="color:#2e7d32">✓</span>'}</td></tr>`).join('')}</tbody></table></div>`;
    }
    return h;
  }

  window.PetitFC = {
    aba(a) { aba = a; movEdit = null; contaEdit = null; desenhar(); },
    conta(id) { contaSel = id; desenhar(); },
    mes(m) { if (m) { mesSel = m; desenhar(); } },
    cancelar() { movEdit = null; contaEdit = null; desenhar(); },
    novoMovimento() { movEdit = { conta_bancaria_id: contaSel, data_caixa: mesSel === hojeISO().slice(0, 7) ? hojeISO() : mesSel + '-01', tipo: 'saida' }; desenhar(); },
    editarMovimento(id) { movEdit = Object.assign({}, D.extrato.find(m => m.id === id)); if (movEdit.origem_tipo === 'venda' && !movEdit.confirmado_extrato) movEdit.confirmado_extrato = true; desenhar(); window.scrollTo(0, 0); },
    async salvarMovimento() {
      const v = numero($('fc-valor').value); if (v == null || v <= 0) return aviso('Informe o valor.', false);
      const ext = $('fc-extrato').value.trim(), extN = ext ? numero(ext) : null; if (ext && extN == null) return aviso('Saldo do extrato inválido.', false);
      const p = { id: movEdit.id || null, conta_bancaria_id: $('fc-conta').value, data_caixa: $('fc-data').value, tipo: $('fc-tipo').value, valor: v,
        descricao: $('fc-desc').value, categoria: $('fc-cat').value, investimento: $('fc-invest') ? $('fc-invest').checked : false,
        confirmado_extrato: $('fc-conf').checked, saldo_real_banco: extN, observacao: $('fc-obs').value };
      try { await rpc('gestao_salvar_movimento_caixa', { p }); movEdit = null; await carregar(); aviso('Lançamento salvo.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async excluirMovimento(id) {
      if (!confirm('Excluir este lançamento do livro-caixa?')) return;
      try { await rpc('gestao_excluir_movimento_caixa', { p_id: id }); await carregar(); aviso('Lançamento excluído.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    marcar(id, on) { on ? selecionados.add(id) : selecionados.delete(id); desenhar(); },
    marcarTodos(on) { selecionados = new Set(on ? D.extrato.filter(aReceber).map(m => m.id) : []); desenhar(); },
    async confirmarSelecionados() {
      if (!selecionados.size) return aviso('Marque pelo menos uma venda.', false);
      try {
        const n = await rpc('gestao_confirmar_movimentos_caixa', { p: { ids: [...selecionados], data_caixa: $('fc-conf-data').value, conta_bancaria_id: $('fc-conf-conta').value } });
        selecionados = new Set(); await carregar(); aviso(n + ' venda(s) confirmada(s).', true); desenhar();
      } catch (e) { aviso(e.message, false); }
    },
    async lancarCusto(id) {
      const cf = D.custos.find(c => c.id === id); if (!cf) return;
      if (!confirm('Lançar "' + cf.nome + '" (' + brl(cf.valor_mensal) + ') como saída hoje na conta principal?')) return;
      try { await rpc('gestao_lancar_custo_fixo', { p: { custo_fixo_id: id, mes: hojeISO().slice(0, 7) + '-01' } }); await carregar(); aviso('Custo fixo lançado.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    marcarConc(id, on) { if (id) conc[id].marcado = on; else for (const p of D.proposta || []) conc[p.linha_id].marcado = on; desenhar(); },
    acaoConc(id, a) { conc[id].acao = a; if (a !== 'novo') conc[id].marcado = true; desenhar(); },
    categoriaConc(id, v) { conc[id].categoria = v.trim(); if (conc[id].categoria) conc[id].marcado = true; desenhar(); },
    async ajusteAbertura(id) {
      const i = (D.importacoes || []).find(x => x.id === id); if (!i) return;
      if (!confirm(`Lançar um ajuste de ${brl(i.diferenca_abertura)} em ${dataBR(i.periodo_inicio)} na ${i.conta_nome}, para o saldo do sistema começar igual ao do banco (${brl(i.saldo_abertura)})?`)) return;
      try { await rpc('gestao_lancar_ajuste_abertura', { p_importacao_id: id }); await carregar(); aviso('Ajuste de abertura lançado.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    async aprovarConciliacao() {
      const itens = (D.proposta || []).filter(p => conc[p.linha_id] && conc[p.linha_id].marcado).map(p => {
        const e = conc[p.linha_id];
        return { linha_id: p.linha_id, acao: e.acao, movimento_id: p.movimento_id, par_linha_id: p.par_linha_id, categoria: e.categoria, custo_fixo_id: e.acao === 'novo' ? p.custo_fixo_id : null };
      });
      if (!itens.length) return aviso('Marque pelo menos uma linha.', false);
      const semCat = itens.find(i => i.acao === 'novo' && !i.categoria);
      if (semCat) return aviso('Escolha a categoria de todas as linhas marcadas como "Lançar como novo".', false);
      try { const n = await rpc('gestao_aplicar_conciliacao', { p: { itens } }); await carregar(); aviso(n + ' linha(s) conciliada(s).', true); desenhar(); } catch (e) { aviso(e.message, false); }
    },
    novaConta() { contaEdit = { data_abertura: hojeISO() }; desenhar(); },
    editarConta(id) { contaEdit = Object.assign({}, conta(id)); desenhar(); },
    async salvarConta() {
      const p = { id: contaEdit.id || null, nome: $('cb-nome').value, observacao: $('cb-obs').value, data_abertura: $('cb-abertura').value,
        data_encerramento: $('cb-encerramento').value, principal: $('cb-principal').checked };
      try { await rpc('gestao_salvar_conta_bancaria', { p }); contaEdit = null; await carregar(); aviso('Conta salva.', true); desenhar(); } catch (e) { aviso(e.message, false); }
    }
  };

  function desenhar() {
    const raiz = $('fc-conteudo'); if (!raiz) return;
    const n = D.extrato.filter(aReceber).length;
    document.querySelectorAll('#fc-abas button').forEach(b => {
      b.className = 'btn btn-sm ' + (b.dataset.a === aba ? 'btn-primary' : 'btn-outline');
      if (b.dataset.a === 'confirmar') b.textContent = '⏳ A confirmar' + (n ? ' (' + n + ')' : '');
      if (b.dataset.a === 'conciliacao') { const k = (D.proposta || []).length; b.textContent = '🧾 Conciliação' + (k ? ' (' + k + ')' : ''); }
    });
    raiz.innerHTML = aba === 'livro' ? tabLivro() : aba === 'confirmar' ? tabConfirmar() : aba === 'projetado' ? tabProjetado()
      : aba === 'conciliacao' ? tabConciliacao() : tabContas();
  }
  function montar() {
    if ($('sec-caixa')) return;
    const ref = $('nav-dividas') || $('nav-rotina') || $('nav-indicadores'); if (!ref) return;
    const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-caixa'; item.innerHTML = '<span class="ico">💰</span> Fluxo de caixa'; item.onclick = () => goTo('caixa');
    ref.parentNode.insertBefore(item, ref.nextSibling);
    const s = document.createElement('div'); s.id = 'sec-caixa'; s.className = 'section';
    s.innerHTML = `<div class="page-header"><div><div class="page-title">💰 Fluxo de caixa</div><div class="page-sub">Livro-caixa por conta — cada conta com o seu próprio saldo</div></div></div>
      <div class="page-content"><div id="fc-abas" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><button data-a="livro" onclick="PetitFC.aba('livro')">📒 Livro-caixa</button>
      <button data-a="confirmar" onclick="PetitFC.aba('confirmar')">⏳ A confirmar</button><button data-a="projetado" onclick="PetitFC.aba('projetado')">📈 Saldo projetado</button>
      <button data-a="conciliacao" onclick="PetitFC.aba('conciliacao')">🧾 Conciliação</button><button data-a="contas" onclick="PetitFC.aba('contas')">🏦 Contas</button></div><div id="fc-conteudo"></div></div>`;
    $('main').appendChild(s);
    const g0 = window.goTo;
    window.goTo = function (sec) { g0(sec); if (sec === 'caixa') { $('nav-caixa').classList.add('active'); carregar().then(desenhar).catch(e => { $('fc-conteudo').innerHTML = quebraAviso + 'Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 12 precisa ter sido rodado no Supabase.</div>'; }); } };
  }
  montar();
})();
