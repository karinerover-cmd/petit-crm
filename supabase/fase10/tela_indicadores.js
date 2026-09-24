// ═══════════ TELA "INDICADORES" (Fase 10) ═══════════
// Ponto de equilíbrio e meta de faturamento saudável por mês, com a margem REAL (Fase 9) e o custo fixo configurado
// (custos fixos + média móvel de 12 meses do custo de feira). Depende de window.__gestao.sb() (camada_supabase.js).
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = n => (n == null || isNaN(n)) ? '—' : (Number(n) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const numero = v => window.petitNumero(v);   // formato brasileiro: 1.234,56 · 7.200 · 0,035 (leitor único do app)
  const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesTxt = m => { const [y, mm] = String(m).slice(0, 7).split('-'); return MESES[Number(mm) - 1] + '/' + y; };
  const mesInput = m => String(m || '').slice(0, 7);
  const hojeISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const STATUS = { abaixo_equilibrio: ['Abaixo do equilíbrio', 'background:#FCE8E8;color:#A32D2D'], entre_equilibrio_e_meta: ['Entre o equilíbrio e a meta', 'background:#FFF4DC;color:#8A5A00'], acima_meta: ['Acima da meta', 'background:#E6F4EA;color:#2e7d32'] };
  const CLASSE = { A: 'background:#E6F4EA;color:#2e7d32', B: 'background:#FFF4DC;color:#8A5A00', C: 'background:#EFE7E2;color:#7A6A60' };   // Fase 15
  let D = { ind: [], feiraMedia: [], feiras: [], custos: [], cfg: {}, despRec: [], metas: [], temMetas: false }, aba = 'painel', mesSel = '', feiraEdit = null, custoEdit = null, anoMetas = new Date().getFullYear();
  let janelaAbc = '90d', mesPlan = new Date().toISOString().slice(0, 7);   // Fase 15

  async function ler(t, col, asc) {
    let q = sb().from(t).select('*'); if (col) q = q.order(col, { ascending: asc !== false });
    const { data, error } = await q.range(0, 4999); if (error) throw new Error(t + ': ' + error.message); return data || [];
  }
  async function carregar() {
    const [ind, feiraMedia, feiras, custos, cfg, desp] = await Promise.all([ler('indicadores_financeiros_mensal', 'mes', false), ler('feira_custo_medio_mensal', 'mes', false),
      ler('feiras_realizadas', 'data_evento', false), ler('custos_fixos', 'vigente_desde', false), ler('config_indicadores'), ler('despesas_operacionais', 'data', false)]);
    let metas = [], temMetas = true;
    try { metas = await ler('metas_faturamento', 'mes'); } catch (e) { temMetas = false; }   // complemento de metas ainda não rodado: a tela funciona sem ele
    let temNiveis = false; try { await ler('progresso_mensal'); temNiveis = true; } catch (e) { }   // Fase 14 (mínima/desafio) ainda não rodada
    // Fase 15: curva ABC visual + Pareto, e planejamento de vendas por produto (a tela funciona sem, se ainda não rodou)
    let abc = [], temABC = true; try { abc = await ler('curva_abc_detalhe', 'ordem_reposicao'); } catch (e) { temABC = false; }
    let plano = [], produtosSel = [], temPlanejamento = true;
    try { [plano, produtosSel] = await Promise.all([ler('progresso_planejamento_mensal', 'sku'), ler('produtos', 'nome')]); } catch (e) { temPlanejamento = false; }
    D = { ind, feiraMedia, feiras, custos, cfg: cfg[0] || {}, despRec: desp.filter(x => x.recorrente), metas, temMetas, temNiveis, abc, temABC, plano, produtosSel, temPlanejamento };   // produtosSel inclui os ocultos: planejar uma nova fabricação de um campeão esgotado é o uso mais útil
    if (!mesSel || !D.ind.some(i => i.mes === mesSel)) mesSel = D.ind.length ? D.ind[0].mes : '';
  }
  async function rpc(nome, args) { const { data, error } = await sb().rpc(nome, args); if (error) throw new Error(error.message); return data; }
  function aviso(t, ok) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;bottom:44px;right:20px;max-width:440px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2)'; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }
  const d10 = s => String(s || '').slice(0, 10);   // o banco pode devolver a data com horário junto ("2026-09-01T00:00…")
  const vigente = (c, mes) => d10(c.vigente_desde) <= mes && (!c.vigente_ate || d10(c.vigente_ate) >= mes);
  const REAL = { atingida: ['Meta atingida', 'background:#E6F4EA;color:#2e7d32'], abaixo: ['Abaixo da meta', 'background:#FCE8E8;color:#A32D2D'] };
  const badgeReal = s => s ? `<span class="badge" style="${REAL[s][1]}">${REAL[s][0]}</span>` : '<span class="td-muted">sem meta</span>';
  const badge = s => s ? `<span class="badge" style="${STATUS[s][1]}">${STATUS[s][0]}</span>` : '<span class="td-muted">—</span>';

  // ---------- painel ----------
  function projecao(i) {
    const hoje = hojeISO(); if (mesInput(i.mes) !== hoje.slice(0, 7)) return null;
    const [y, m, dia] = hoje.split('-').map(Number), dias = new Date(y, m, 0).getDate();
    return Number(i.faturamento_total) / dia * dias;
  }
  function tabPainel() {
    if (!D.ind.length) return '<div class="empty-state">Sem dados ainda.</div>';
    const i = D.ind.find(x => x.mes === mesSel) || D.ind[0], fm = D.feiraMedia.find(x => d10(x.mes) === d10(i.mes)) || {};
    const ativo = i.custo_fixo_mensal != null, proj = projecao(i);
    let h = `<div class="table-toolbar"><select onchange="PetitIN.mes(this.value)">${D.ind.map(x => `<option value="${x.mes}"${x.mes === i.mes ? ' selected' : ''}>${mesTxt(x.mes)}</option>`).join('')}</select>
      ${D.temMetas ? badgeReal(i.status_meta_realista) : ''}
      ${ativo ? badge(i.status) : '<span class="td-muted">Equilíbrio e meta saudável só a partir de ' + mesTxt(D.cfg.indicadores_inicio || '2026-09-01') + '.</span>'}</div>`;
    if (D.temNiveis) h += '<div id="in-progresso"></div>';   // barra de progresso da Fase 14 (preenchida depois de desenhar)
    const hj = new Date(), anoHj = hj.getFullYear();
    if (D.temMetas && !D.metas.some(x => d10(x.mes).startsWith(anoHj + '-')) && hj.getMonth() <= 1)   // janeiro e fevereiro: lembrete para traçar o ano
      h += `<div class="alert" style="margin-bottom:12px">📅 Ainda não há metas para ${anoHj}. <button class="btn btn-primary btn-sm" style="margin-left:8px" onclick="PetitIN.anoMetas(${anoHj})">Traçar as metas de ${anoHj}</button></div>`;
    h += `<div class="stats-grid" style="margin-bottom:12px">
      <div class="stat-card"><div class="stat-label">Faturamento</div><div class="stat-val" style="font-size:20px">${brl(i.faturamento_total)}</div><div class="stat-sub">${i.vendas} venda(s)${proj != null ? ' · projeção do mês ' + brl(proj) : ''}</div></div>`;
    if (D.temMetas) {
      const mr = i.meta_realista != null ? Number(i.meta_realista) : null;
      h += `<div class="stat-card" style="border:2px solid var(--pink-m)"><div class="stat-label">Meta realista (sua)</div><div class="stat-val" style="font-size:20px">${mr == null ? '—' : brl(mr)}</div>
        <div class="stat-sub">${mr == null ? 'sem meta para este mês — cadastre em 🎯 Metas' : pct(i.pct_meta_realista) + ' atingido' + (Number(i.faturamento_total) < mr ? ' · faltam ' + brl(mr - Number(i.faturamento_total)) : '') + (proj != null && mr > 0 ? ' · no ritmo atual fecha em ' + pct(proj / mr) : '')}</div></div>`;
    }
    if (ativo) {
      const origem = i.margem_origem === 'mes' ? 'do mês' : i.margem_origem === '12_meses' ? 'acumulada de 12 meses (o mês não tem venda com custo)' : 'ainda não existe';
      h += `<div class="stat-card"><div class="stat-label">Margem real</div><div class="stat-val" style="font-size:20px">${pct(i.margem_pct_usada)}</div><div class="stat-sub">${origem}${i.cobertura_margem != null ? ' · cobertura ' + pct(i.cobertura_margem) : ''}</div></div>
        <div class="stat-card"><div class="stat-label">Custo fixo do mês</div><div class="stat-val" style="font-size:20px">${brl(i.custo_fixo_mensal)}</div><div class="stat-sub">itens ${brl(i.custo_fixo_itens)} + feira ${brl(i.custo_feira)}</div></div>
        <div class="stat-card"><div class="stat-label">Ponto de equilíbrio</div><div class="stat-val" style="font-size:20px">${brl(i.ponto_equilibrio_faturamento)}</div><div class="stat-sub">custo fixo ÷ margem real</div></div>
        <div class="stat-card"><div class="stat-label">Meta saudável (ideal)</div><div class="stat-val" style="font-size:20px">${brl(i.meta_faturamento_saudavel)}</div><div class="stat-sub">custo fixo × ${String(Number(D.cfg.multiplicador_meta || 3)).replace('.', ',')}</div></div>`;
    }
    h += '</div>';
    if (ativo && i.margem_pct_usada == null) h += `<div class="alert" style="margin-bottom:12px">Ainda não há venda com margem real calculada, então o ponto de equilíbrio fica em branco (não usamos margem teórica). Ele aparece assim que uma venda de produto com lote aprovado for registrada.</div>`;
    if (ativo) {
      const pe = Number(i.ponto_equilibrio_faturamento), meta = Number(i.meta_faturamento_saudavel), fat = Number(i.faturamento_total), mreal = i.meta_realista != null ? Number(i.meta_realista) : 0, max = Math.max(meta, pe || 0, fat, mreal) || 1;
      const barra = (v, cor) => `<div style="height:10px;border-radius:6px;background:${cor};width:${Math.min(100, v / max * 100).toFixed(1)}%"></div>`;
      h += `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>Onde o mês está</b>
        <div style="margin-top:10px;display:grid;grid-template-columns:150px 1fr 110px;gap:8px;align-items:center;font-size:13px">
          <span>Faturamento</span>${barra(fat, 'var(--pink)')}<span>${brl(fat)}</span>
          ${mreal ? `<span>Meta realista</span>${barra(mreal, '#993556')}<span>${brl(mreal)}</span>` : ''}
          ${pe ? `<span>Ponto de equilíbrio</span>${barra(pe, '#8A5A00')}<span>${brl(pe)}</span>` : ''}
          <span>Meta saudável</span>${barra(meta, '#2e7d32')}<span>${brl(meta)}</span></div>
        ${pe ? `<div class="td-muted" style="margin-top:10px">${fat >= pe ? 'O faturamento já cobre o custo fixo.' : 'Faltam ' + brl(pe - fat) + ' para o equilíbrio.'}${fat < meta ? ' Faltam ' + brl(meta - fat) + ' para a meta.' : ''}</div>` : ''}
        <div class="td-muted" style="margin-top:6px">Feira: ${fm.meses_reais || 0} mês(es) com registro real + ${fm.meses_semente != null ? fm.meses_semente : 12} de semente (${brl(D.cfg.feira_semente_mensal)}/mês).</div></div>`;
    }
    h += `<h3 style="margin:16px 0 6px">Todos os meses</h3><div class="table-card"><table><thead><tr><th>Mês</th><th>Faturamento</th>${D.temMetas ? '<th>Meta realista</th><th>% da meta</th>' : ''}<th>Margem real</th><th>Custo fixo</th><th>Equilíbrio</th><th>Meta saudável</th><th>Situação</th></tr></thead><tbody>${D.ind.map(x =>
      `<tr style="cursor:pointer" onclick="PetitIN.mes('${x.mes}')"><td>${mesTxt(x.mes)}</td><td>${brl(x.faturamento_total)}</td>${D.temMetas ? `<td>${brl(x.meta_realista)}</td><td>${x.status_meta_realista ? badgeReal(x.status_meta_realista) + ' ' + pct(x.pct_meta_realista) : '—'}</td>` : ''}<td>${pct(x.margem_pct_usada)}</td><td>${brl(x.custo_fixo_mensal)}</td><td>${brl(x.ponto_equilibrio_faturamento)}</td><td>${brl(x.meta_faturamento_saudavel)}</td><td>${badge(x.status)}</td></tr>`).join('')}</tbody></table></div>`;
    return h;
  }

  // ---------- feiras ----------
  function tabFeiras() {
    const e = feiraEdit;
    let h = `<p class="td-muted">O custo da Petit é o rateio do custo total pelo faturamento de cada artesã. Se ninguém vender, o custo é dividido 50/50. A média de 12 meses entra no custo fixo; enquanto não houver 12 meses de registro, os meses que faltam usam a semente de ${brl(D.cfg.feira_semente_mensal)}/mês.</p>`;
    if (e) h += `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>${e.id ? 'Editar' : 'Nova'} feira</b><div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Data</label><input type="date" id="fe-data" value="${esc(String(e.data_evento || hojeISO()).slice(0, 10))}"></div>
      <div class="field"><label>Nome da feira</label><input id="fe-nome" value="${esc(e.nome_evento)}"></div>
      <div class="field"><label>Custo total do evento (R$)</label><input id="fe-custo" value="${e.custo_total_evento != null ? String(e.custo_total_evento).replace('.', ',') : ''}" oninput="PetitIN.previa()"></div>
      <div class="field"><label>Faturamento da Petit (R$)</label><input id="fe-petit" value="${e.faturamento_petit != null ? String(e.faturamento_petit).replace('.', ',') : ''}" oninput="PetitIN.previa()"></div>
      <div class="field"><label>Faturamento da parceira (R$)</label><input id="fe-parc" value="${e.faturamento_parceira != null ? String(e.faturamento_parceira).replace('.', ',') : ''}" oninput="PetitIN.previa()"></div>
      <div class="field"><label>Observação</label><input id="fe-obs" value="${esc(e.observacao)}"></div></div>
      <div id="fe-previa" class="td-muted"></div>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitIN.salvarFeira()">Salvar</button><button class="btn btn-outline btn-sm" onclick="PetitIN.cancelar()">Cancelar</button></div></div>`;
    h += `<div class="table-toolbar"><button class="btn btn-primary btn-sm" onclick="PetitIN.novaFeira()">+ Nova feira</button></div>`;
    h += D.feiras.length ? `<div class="table-card"><table><thead><tr><th>Data</th><th>Feira</th><th>Custo total</th><th>Faturamento Petit</th><th>Faturamento parceira</th><th>Custo da Petit</th><th></th></tr></thead><tbody>${D.feiras.map(f => `<tr>
      <td>${dataBR(f.data_evento)}</td><td>${esc(f.nome_evento)}${f.observacao ? '<div class="td-muted">' + esc(f.observacao) + '</div>' : ''}</td><td>${brl(f.custo_total_evento)}</td><td>${brl(f.faturamento_petit)}</td><td>${brl(f.faturamento_parceira)}</td><td><b>${brl(f.custo_petit)}</b></td>
      <td style="white-space:nowrap"><button class="btn-icon" title="Editar" onclick="PetitIN.editarFeira('${f.id}')">✏️</button> <button class="btn-icon" title="Excluir" onclick="PetitIN.excluirFeira('${f.id}')">🗑</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Nenhuma feira registrada ainda.</div>';
    return h;
  }

  // ---------- custos fixos ----------
  function tabCustos() {
    const mesAtual = hojeISO().slice(0, 7) + '-01', vig = D.custos.filter(c => vigente(c, mesAtual)), fora = D.custos.filter(c => !vigente(c, mesAtual));
    const total = vig.reduce((a, c) => a + Number(c.valor_mensal), 0), fm = D.feiraMedia.find(x => d10(x.mes) === mesAtual) || {}, e = custoEdit;
    let h = `<p class="td-muted">Lista oficial do custo fixo. Mudar um valor a partir de um mês não reescreve os meses anteriores. A feira não entra aqui: vem da média móvel das feiras registradas.</p>`;
    if (e) h += `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>${e.id ? 'Mudar valor' : 'Novo custo fixo'}</b><div class="grid2f" style="margin-top:8px">
      <div class="field"><label>Nome</label><input id="cf-nome" value="${esc(e.nome)}"></div>
      <div class="field"><label>Valor mensal (R$)</label><input id="cf-valor" value="${e.valor_mensal != null ? String(e.valor_mensal).replace('.', ',') : ''}"></div>
      <div class="field"><label>A partir de (mês)</label><input type="month" id="cf-mes" value="${esc(mesInput(e.a_partir_de || mesAtual))}"></div>
      <div class="field"><label>Observação</label><input id="cf-obs" value="${esc(e.observacao)}"></div></div>
      ${e.id ? '<div class="td-muted">Se o mês for depois do início deste custo, o valor antigo continua valendo nos meses anteriores.</div>' : ''}
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="PetitIN.salvarCusto()">Salvar</button><button class="btn btn-outline btn-sm" onclick="PetitIN.cancelar()">Cancelar</button></div></div>`;
    h += `<div class="table-toolbar"><button class="btn btn-primary btn-sm" onclick="PetitIN.novoCusto()">+ Novo custo fixo</button></div>
      <div class="table-card"><table><thead><tr><th>Custo</th><th>Valor/mês</th><th>Desde</th><th></th></tr></thead><tbody>${vig.map(c => `<tr><td>${esc(c.nome)}${c.observacao ? '<div class="td-muted">' + esc(c.observacao) + '</div>' : ''}</td><td>${brl(c.valor_mensal)}</td><td>${mesTxt(c.vigente_desde)}</td>
        <td style="white-space:nowrap"><button class="btn-icon" title="Mudar valor" onclick="PetitIN.editarCusto('${c.id}')">✏️</button> <button class="btn-icon" title="Encerrar a partir de um mês" onclick="PetitIN.encerrarCusto('${c.id}')">⏹</button> <button class="btn-icon" title="Excluir (lançado por engano)" onclick="PetitIN.excluirCusto('${c.id}')">🗑</button></td></tr>`).join('')}
        <tr><td>Feira (média móvel 12 meses)</td><td>${brl(fm.custo_medio)}</td><td class="td-muted">${fm.meses_reais || 0} real + ${fm.meses_semente != null ? fm.meses_semente : 12} semente</td><td></td></tr>
        <tr><td><b>Total este mês</b></td><td><b>${brl(total + Number(fm.custo_medio || 0))}</b></td><td></td><td></td></tr></tbody></table></div>`;
    if (fora.length) h += `<details style="margin-top:12px"><summary class="td-muted">Valores anteriores e custos encerrados (${fora.length})</summary><div class="table-card" style="margin-top:8px"><table><tbody>${fora.map(c => `<tr><td>${esc(c.nome)}</td><td>${brl(c.valor_mensal)}</td><td class="td-muted">${mesTxt(c.vigente_desde)} → ${c.vigente_ate ? mesTxt(c.vigente_ate) : 'em aberto'}</td></tr>`).join('')}</tbody></table></div></details>`;
    if (D.despRec.length) h += `<h3 style="margin:18px 0 6px">Despesas recorrentes lançadas pelas notas <span class="td-muted" style="font-weight:400">— só para comparar, não somam no custo fixo</span></h3>
      <div class="table-card"><table><tbody>${D.despRec.slice(0, 30).map(x => `<tr><td>${dataBR(x.data)}</td><td>${esc(x.descricao)}</td><td>${brl(x.valor)}</td></tr>`).join('')}</tbody></table></div>`;
    return h;
  }

  function tabMetas() {
    if (!D.temMetas) return '<div class="alert">As metas realistas precisam do SQL "20260923110000_fase10_metas_realistas.sql" rodado no Supabase.</div>';
    const fatMes = m => { const x = D.ind.find(r => d10(r.mes) === m); return x ? Number(x.faturamento_total) : null; };
    const metaMes = m => { const x = D.metas.find(r => d10(r.mes) === m); return x ? String(Number(x.valor)).replace('.', ',') : ''; };
    const nivelMes = (m, col) => { const x = D.metas.find(r => d10(r.mes) === m); return x && x[col] != null ? String(Number(x[col])).replace('.', ',') : ''; };
    const N = D.temNiveis;                                  // Fase 14: meta mínima e desafio ao lado da realista
    const mesDe = (ano, k) => ano + '-' + String(k + 1).padStart(2, '0') + '-01', anoAnt = anoMetas - 1;
    const anosComMeta = [...new Set(D.metas.map(x => Number(d10(x.mes).slice(0, 4))))];
    const anoAtual = new Date().getFullYear(), anos = [...new Set(anosComMeta.concat([anoAtual, anoAtual + 1, anoMetas]))].sort();
    let totAnt = 0, totMeta = 0, totReal = 0, temAnt = false;
    const linhas = MESES.map((nome, k) => {
      const m = mesDe(anoMetas, k), f = fatMes(m), ant = fatMes(mesDe(anoAnt, k)), mt = numero(metaMes(m));
      if (ant != null) { totAnt += ant; temAnt = true; } if (mt) totMeta += mt; if (f != null) totReal += f;
      return `<tr><td>${nome}/${anoMetas}</td><td class="td-muted">${ant == null ? '—' : brl(ant)}</td>
        ${N ? `<td><input id="mt-min-${k + 1}" value="${nivelMes(m, 'meta_minima')}" style="width:100px" placeholder="—"></td>` : ''}
        <td><input id="mt-${k + 1}" value="${metaMes(m)}" style="width:120px" placeholder="—" oninput="PetitIN.totalMetas()"></td>
        ${N ? `<td><input id="mt-des-${k + 1}" value="${nivelMes(m, 'meta_desafio')}" style="width:100px" placeholder="—"></td>` : ''}
        <td class="td-muted" id="mt-var-${k + 1}">${ant && mt ? (mt >= ant ? '+' : '') + pct(mt / ant - 1) : '—'}</td>
        <td>${f == null ? '—' : brl(f)}</td><td>${f != null && mt ? `${badgeReal(f >= mt ? 'atingida' : 'abaixo')} ${pct(f / mt)}` : '—'}</td></tr>`;
    }).join('');
    return `<p class="td-muted">Suas metas de faturamento, mês a mês — viram a primeira flag do painel. Em janeiro, trace o ano novo olhando o faturamento do ano anterior (coluna ${anoAnt}); a projeção abaixo ajuda a preencher, e nada é gravado até você clicar em Salvar.</p>
      <div class="table-toolbar" style="flex-wrap:wrap;gap:6px">${anos.map(a => `<button class="btn btn-sm ${a === anoMetas ? 'btn-primary' : 'btn-outline'}" onclick="PetitIN.anoMetas(${a})">${a}${anosComMeta.includes(a) ? '' : ' (novo)'}</button>`).join('')}
        <button class="btn-icon" title="Outro ano" onclick="PetitIN.outroAno()">…</button></div>
      <div class="table-card" style="padding:12px 16px;margin-bottom:12px">
        <b>Projeção a partir de ${anoAnt}</b>
        ${temAnt ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><span>Mesmo mês de ${anoAnt}</span><input id="mt-cresc" value="10" style="width:70px"><span>% de crescimento</span>
          <button class="btn btn-outline btn-sm" onclick="PetitIN.projetar()">Preencher as metas</button><span class="td-muted">preenche só os meses que têm faturamento em ${anoAnt}; confira e ajuste antes de salvar</span></div>`
          : `<div class="td-muted" style="margin-top:6px">Não há faturamento de ${anoAnt} no sistema para projetar (o histórico começa em nov/2025). Digite as metas direto na tabela.</div>`}</div>
      <div class="table-card"><table><thead><tr><th>Mês</th><th>Faturamento ${anoAnt}</th>${N ? '<th>Mínima (R$)</th>' : ''}<th>${N ? 'Realista' : 'Meta'} ${anoMetas} (R$)</th>${N ? '<th>Desafio (R$)</th>' : ''}<th>vs ${anoAnt}</th><th>Faturamento ${anoMetas}</th><th>% da meta</th></tr></thead><tbody>${linhas}
        <tr style="font-weight:600"><td>Total</td><td>${temAnt ? brl(totAnt) : '—'}</td>${N ? '<td></td>' : ''}<td id="mt-total">${brl(totMeta)}</td>${N ? '<td></td>' : ''}<td class="td-muted">${temAnt && totMeta ? (totMeta >= totAnt ? '+' : '') + pct(totMeta / totAnt - 1) : '—'}</td><td>${brl(totReal)}</td><td>${totMeta ? pct(totReal / totMeta) : '—'}</td></tr></tbody></table>
      <div style="padding:12px 16px"><button class="btn btn-primary btn-sm" onclick="PetitIN.salvarMetas()">Salvar metas de ${anoMetas}</button></div></div>`;
  }


  function tabConfig() {
    const c = D.cfg;
    return `<div class="table-card" style="padding:16px"><div class="grid2f">
      <div class="field"><label>Semente do custo de feira (R$/mês)</label><input id="cg-semente" value="${esc(String(c.feira_semente_mensal || '').replace('.', ','))}"></div>
      <div class="field"><label>Início do registro de feiras (mês)</label><input type="month" id="cg-feira" value="${esc(mesInput(c.feira_registro_inicio))}"></div>
      <div class="field"><label>Início dos indicadores (mês)</label><input type="month" id="cg-ind" value="${esc(mesInput(c.indicadores_inicio))}"></div>
      <div class="field"><label>Meta saudável = custo fixo ×</label><input id="cg-mult" value="${esc(String(c.multiplicador_meta || '').replace('.', ','))}"></div></div>
      <div class="td-muted">A semente de feira é a média mensal do histórico de feiras. Ela completa a média até existirem 12 meses de feiras registradas.</div>
      <div style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="PetitIN.salvarConfig()">Salvar</button></div></div>`;
  }

  const recarregar = async msg => { await carregar(); if (msg) aviso(msg, true); desenhar(); };
  // ---------- Curva ABC + Pareto (Fase 15) ----------
  function tabABC() {
    if (!D.temABC) return '<div class="alert">A Curva ABC visual precisa do SQL "20261001100000_fase15_curva_abc_planejamento.sql" rodado no Supabase.</div>';
    const lista = D.abc.filter(r => r.janela === janelaAbc);
    let h = `<div class="table-toolbar"><button class="btn btn-sm ${janelaAbc === '90d' ? 'btn-primary' : 'btn-outline'}" onclick="PetitIN.janela('90d')">Últimos 90 dias</button>
      <button class="btn btn-sm ${janelaAbc === '12m' ? 'btn-primary' : 'btn-outline'}" onclick="PetitIN.janela('12m')">Últimos 12 meses</button>
      <button class="btn btn-outline btn-sm" style="margin-left:auto" title="Baixa um CSV desta janela (ordem de faturamento), para colar no chat e planejar" onclick="PetitIN.exportarAbc()">⬇ Exportar CSV</button></div>`;
    if (!lista.length) return h + '<div class="empty-state">Sem venda de produto de catálogo nessa janela ainda.</div>';
    const porFaturamento = lista.slice().sort((a, b) => a.posicao - b.posicao);   // Pareto sempre em ordem de faturamento, mesmo a tabela abaixo estando por prioridade de reposição
    h += `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>Pareto — faturamento por produto</b><div class="td-muted" style="margin-bottom:8px">Barras em ordem decrescente de faturamento; a linha é o % acumulado, com marca em 80% e 95% (os mesmos cortes da classe).</div>
      <div>${paretoSvg(porFaturamento)}</div></div>`;
    h += `<div class="table-card"><table><thead><tr><th>Produto</th><th>Classe</th><th>Faturamento</th><th>% do total</th><th>% acumulado</th><th>Estoque</th><th></th></tr></thead><tbody>${lista.map(r => `<tr>
      <td>${esc(r.nome)} <span class="chip">${esc(r.sku)}</span>${r.oculto ? ' <span class="td-muted">(oculto)</span>' : ''}<div class="td-muted">${esc(r.categoria || '')}</div></td>
      <td><span class="badge" style="${CLASSE[r.classe]}">${r.classe}</span></td>
      <td>${brl(r.faturamento)}</td><td>${pct(r.participacao)}</td><td>${pct(r.participacao_acumulada)}</td>
      <td>${r.estoque_atual}${r.status_estoque === 'baixo' ? ' <span class="badge" style="background:#FCE8E8;color:#A32D2D">baixo</span>' : ''}</td>
      <td></td></tr>`).join('')}</tbody></table></div>
      <div class="td-muted" style="margin-top:8px">Ordenado para saber o que repor primeiro: classe A antes de B e C; dentro da mesma classe, estoque baixo primeiro.</div>`;
    return h;
  }
  // Pareto que cabe na largura da tela (com 80+ produtos não pode depender de rolagem: as classes B e C ficavam escondidas).
  // Faixas coloridas por classe, com rótulo, + legenda. Lista já vem em ordem de faturamento (posição), então cada classe é um bloco contínuo.
  function paretoSvg(lista) {
    const W = 1000, H = 270, ml = 78, mr = 66, base = H - 34, topo = 46, escala = base - topo, n = lista.length, passo = (W - ml - mr) / n, larg = Math.max(2, passo * 0.72);
    const COR = { A: '#2e7d32', B: '#B8860B', C: '#B0A69C' }, FAIXA = { A: '#EAF5EC', B: '#FFF7E3', C: '#F3EEEA' };
    const maxFat = Math.max(...lista.map(r => Number(r.faturamento)), 1), x = i => ml + i * passo, cx = i => x(i) + passo / 2;
    const blocos = []; lista.forEach((r, i) => { const u = blocos[blocos.length - 1]; if (u && u.classe === r.classe) u.fim = i; else blocos.push({ classe: r.classe, ini: i, fim: i }); });
    const faixas = blocos.map(b => { const x0 = x(b.ini), x1 = x(b.fim + 1), q = b.fim - b.ini + 1;
      return `<rect x="${x0}" y="${topo - 24}" width="${x1 - x0}" height="${base - topo + 24}" fill="${FAIXA[b.classe]}"/>
        <text x="${(x0 + x1) / 2}" y="${topo - 8}" text-anchor="middle" class="pt-faixa" font-weight="600" fill="${COR[b.classe]}">${b.classe}<tspan class="pt-qtd"> · ${q} produto${q > 1 ? 's' : ''}</tspan></text>`; }).join('');
    const barras = lista.map((r, i) => { const alt = Number(r.faturamento) / maxFat * escala;
      return `<rect x="${x(i) + (passo - larg) / 2}" y="${base - alt}" width="${larg}" height="${alt}" fill="${COR[r.classe]}"><title>${esc(r.nome)} [${esc(r.sku)}] (classe ${r.classe}): ${brl(r.faturamento)} · acumulado ${pct(r.participacao_acumulada)}</title></rect>`; }).join('');
    const pontos = lista.map((r, i) => `${cx(i)},${base - Number(r.participacao_acumulada) * escala}`).join(' ');
    const corte = p => `<line x1="${ml}" y1="${base - p * escala}" x2="${W - mr}" y2="${base - p * escala}" stroke="#777" stroke-dasharray="4,3"/>
      <text x="${W - mr + 4}" y="${base - p * escala + 4}" class="pt-eixo" fill="#555">${Math.round(p * 100)}%</text>`;
    const eixo = [0, 0.5, 1].map(p => `<text x="${ml - 6}" y="${base - p * escala + 4}" text-anchor="end" class="pt-eixo" fill="#999">${Math.round(p * 100)}%</text>`).join('');
    const leg = (c, t, k) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:16px"><span style="width:11px;height:11px;border-radius:3px;background:${c}"></span>${t}</span>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-width:${W}px">
        <style>.pt-faixa{font-size:12px}.pt-eixo{font-size:11px}@media (max-width:640px){.pt-faixa{font-size:34px}.pt-eixo{font-size:24px}.pt-qtd{display:none}}</style>
        ${faixas}${eixo}${corte(0.80)}${corte(0.95)}${barras}
        <polyline points="${pontos}" fill="none" stroke="#993556" stroke-width="2"/>
        <line x1="${ml}" y1="${base}" x2="${W - mr}" y2="${base}" stroke="#bbb"/>
      </svg>
      <div style="font-size:12px;margin-top:6px;color:#555">${leg(COR.A, 'A — juntos somam até 80% do faturamento')}${leg(COR.B, 'B — de 80% a 95%')}${leg(COR.C, 'C — o resto (95% a 100%)')}${leg('#993556', '% acumulado (linha)')}</div>
      <div class="td-muted" style="font-size:12px">Passe o mouse (ou toque) numa barra para ver o produto. Os nomes estão na tabela abaixo.</div>`;
  }

  // ---------- Planejamento de vendas por produto (Fase 15) ----------
  function tabPlanejamento() {
    if (!D.temPlanejamento) return '<div class="alert">O planejamento de vendas precisa do SQL "20261001100000_fase15_curva_abc_planejamento.sql" rodado no Supabase.</div>';
    const itens = D.plano.filter(r => d10(r.mes) === mesPlan + '-01').sort((a, b) => a.nome.localeCompare(b.nome));
    let h = `<p class="td-muted">Planejamento livre de quantidades por produto — não precisa bater com a meta de faturamento, é só um guia de estratégia. Todos os produtos do cadastro aparecem, inclusive os ocultos/esgotados (dá para planejar uma nova fabricação).</p>
      <div class="table-toolbar"><input type="month" value="${mesPlan}" onchange="PetitIN.mesPlan(this.value)"></div>
      <div class="table-card" style="padding:16px;margin-bottom:12px"><b>+ Adicionar produto ao planejamento</b>
        <div class="grid2f" style="margin-top:8px">
          <div class="field"><label>Produto</label><select id="pl-sku"><option value="">Selecione...</option>${D.produtosSel.map(p => `<option value="${p.sku}">${esc(p.nome)} — ${esc(p.sku)}${p.oculto ? ' (oculto/esgotado)' : ''}</option>`).join('')}</select></div>
          <div class="field"><label>Quantidade planejada</label><input id="pl-qtd" placeholder="ex.: 20"></div>
        </div>
        <div class="field"><label>Observação (opcional)</label><input id="pl-obs" placeholder="ex.: lançar promoção na 2ª quinzena"></div>
        <button class="btn btn-primary btn-sm" onclick="PetitIN.planoAdicionar()">Adicionar</button></div>`;
    if (!itens.length) return h + '<div class="empty-state">Nenhum produto planejado para ' + mesTxt(mesPlan + '-01') + ' ainda.</div>';
    const totPlan = itens.reduce((a, r) => a + r.quantidade_planejada, 0), totVend = itens.reduce((a, r) => a + r.quantidade_vendida, 0);
    h += `<div class="table-card"><table><thead><tr><th>Produto</th><th>Planejado</th><th>Vendido</th><th>%</th><th>Diferença</th><th></th><th></th></tr></thead><tbody>${itens.map(r => {
      const p = Math.min(1, Number(r.pct_planejado));
      return `<tr><td>${esc(r.nome)} <span class="chip">${esc(r.sku)}</span>${r.observacao ? `<div class="td-muted">${esc(r.observacao)}</div>` : ''}</td>
      <td>${r.quantidade_planejada}</td><td>${r.quantidade_vendida}</td><td>${pct(r.pct_planejado)}</td>
      <td style="color:${r.diferenca > 0 ? 'inherit' : '#2e7d32'}">${r.diferenca > 0 ? r.diferenca + ' faltam' : r.mes_fechado ? 'bateu ✓' : 'já bateu ✓'}</td>
      <td style="min-width:100px"><div style="height:8px;border-radius:4px;background:#EFE7E2"><div style="height:100%;border-radius:4px;background:${p >= 1 ? '#2e7d32' : 'var(--pink)'};width:${(p * 100).toFixed(0)}%"></div></div></td>
      <td><button class="btn-icon" title="Excluir" onclick="PetitIN.planoExcluir('${r.id}')">🗑</button></td></tr>`;
    }).join('')}</tbody></table>
      <div style="padding:10px 16px;font-weight:600">Total: ${totPlan} planejadas · ${totVend} vendidas (${pct(totVend / (totPlan || 1))})</div></div>`;
    return h;
  }

  window.PetitIN = {
    janela(j) { janelaAbc = j; desenhar(); },
    exportarAbc() {   // CSV da janela na tela, em ordem de faturamento; vírgula e ponto decimal, como os outros CSVs do app
      const lista = D.abc.filter(r => r.janela === janelaAbc).sort((a, b) => a.posicao - b.posicao);
      if (!lista.length) return aviso('Não há dados nessa janela para exportar.', false);
      const cel = v => { const t = String(v == null ? '' : v); return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const p100 = v => v == null ? '' : (Number(v) * 100).toFixed(2);
      const linhas = [['janela', 'posicao_faturamento', 'sku', 'produto', 'categoria', 'colecao', 'classe', 'faturamento', 'unidades_vendidas', 'participacao_pct', 'acumulado_pct',
        'estoque_atual', 'status_estoque', 'oculto', 'ordem_reposicao']].concat(lista.map(r => [r.janela, r.posicao, r.sku, r.produto || r.nome, r.categoria, r.colecao, r.classe,
        Number(r.faturamento).toFixed(2), r.unidades, p100(r.participacao), p100(r.participacao_acumulada), r.estoque_atual, r.status_estoque, r.oculto ? 'sim' : 'nao', r.ordem_reposicao]));
      csvDown(linhas.map(l => l.map(cel).join(',')).join('\n'), 'curva_abc_' + janelaAbc + '_' + hojeISO() + '.csv');
      aviso('CSV da curva ABC (' + (janelaAbc === '90d' ? '90 dias' : '12 meses') + ', ' + lista.length + ' produtos) baixado.', true);
    },
    mesPlan(m) { if (m) { mesPlan = m; desenhar(); } },
    async planoAdicionar() {
      const sku = $('pl-sku').value; if (!sku) return aviso('Selecione um produto.', false);
      const qtd = numero($('pl-qtd').value); if (qtd == null || qtd <= 0) return aviso('Informe uma quantidade maior que zero.', false);
      try {
        await rpc('gestao_salvar_planejamento_mensal', { p: { mes: mesPlan + '-01', itens: [{ sku, quantidade: qtd, observacao: $('pl-obs').value }] } });
        $('pl-sku').value = ''; $('pl-qtd').value = ''; $('pl-obs').value = '';
        await recarregar('Adicionado ao planejamento.');
      } catch (e) { aviso(e.message, false); }
    },
    async planoExcluir(id) {
      if (!confirm('Excluir este produto do planejamento do mês?')) return;
      try { await rpc('gestao_excluir_item_planejamento', { p_id: id }); await recarregar('Removido do planejamento.'); } catch (e) { aviso(e.message, false); }
    },
    aba(a) { aba = a; feiraEdit = null; custoEdit = null; desenhar(); },
    mes(m) { mesSel = m; aba = 'painel'; desenhar(); },
    cancelar() { feiraEdit = null; custoEdit = null; desenhar(); },
    novaFeira() { feiraEdit = {}; desenhar(); },
    editarFeira(id) { feiraEdit = Object.assign({}, D.feiras.find(f => f.id === id)); desenhar(); PetitIN.previa(); },
    previa() {
      const el = $('fe-previa'); if (!el) return;
      const c = numero($('fe-custo').value), p = numero($('fe-petit').value) || 0, q = numero($('fe-parc').value) || 0;
      if (c == null) { el.textContent = ''; return; }
      const v = p + q === 0 ? c / 2 : c * p / (p + q);
      el.textContent = 'Custo da Petit: ' + brl(v) + (p + q === 0 ? ' (ninguém vendeu: 50/50)' : ' (' + pct(p / (p + q)) + ' do faturamento)');
    },
    async salvarFeira() {
      const p = { id: feiraEdit.id || null, data_evento: $('fe-data').value, nome_evento: $('fe-nome').value, custo_total_evento: numero($('fe-custo').value),
        faturamento_petit: numero($('fe-petit').value) || 0, faturamento_parceira: numero($('fe-parc').value) || 0, observacao: $('fe-obs').value };
      if (p.custo_total_evento == null) return aviso('Informe o custo total do evento.', false);
      try { await rpc('gestao_salvar_feira', { p }); feiraEdit = null; await recarregar('Feira salva.'); } catch (e) { aviso(e.message, false); }
    },
    async excluirFeira(id) {
      if (!confirm('Excluir esta feira? A média do custo de feira será recalculada.')) return;
      try { await rpc('gestao_excluir_feira', { p_id: id }); await recarregar('Feira excluída.'); } catch (e) { aviso(e.message, false); }
    },
    novoCusto() { custoEdit = {}; desenhar(); },
    editarCusto(id) { const c = D.custos.find(x => x.id === id); custoEdit = { id: c.id, nome: c.nome, valor_mensal: c.valor_mensal, observacao: c.observacao, a_partir_de: hojeISO().slice(0, 7) + '-01' }; desenhar(); },
    async salvarCusto() {
      const v = numero($('cf-valor').value); if (v == null) return aviso('Informe o valor mensal.', false);
      const p = { id: custoEdit.id || null, nome: $('cf-nome').value, valor_mensal: v, a_partir_de: ($('cf-mes').value || hojeISO().slice(0, 7)) + '-01', observacao: $('cf-obs').value };
      try { await rpc('gestao_salvar_custo_fixo', { p }); custoEdit = null; await recarregar('Custo fixo salvo.'); } catch (e) { aviso(e.message, false); }
    },
    async encerrarCusto(id) {
      const c = D.custos.find(x => x.id === id), m = prompt('Encerrar "' + c.nome + '" a partir de qual mês? (formato AAAA-MM) — ele deixa de contar desse mês em diante.', hojeISO().slice(0, 7));
      if (!m) return; if (!/^\d{4}-\d{2}$/.test(m.trim())) return aviso('Use o formato AAAA-MM, por exemplo 2026-12.', false);
      try { await rpc('gestao_encerrar_custo_fixo', { p_id: id, p_a_partir_de: m.trim() + '-01' }); await recarregar('Custo encerrado.'); } catch (e) { aviso(e.message, false); }
    },
    async excluirCusto(id) {
      if (!confirm('Excluir este custo de todos os meses? Use só para algo lançado por engano — para parar de contar a partir de um mês, use Encerrar.')) return;
      try { await rpc('gestao_excluir_custo_fixo', { p_id: id }); await recarregar('Custo excluído.'); } catch (e) { aviso(e.message, false); }
    },
    anoMetas(a) { anoMetas = a; aba = 'metas'; desenhar(); },
    outroAno() { const a = Number(prompt('Qual ano?', String(anoMetas + 1))); if (a >= 2020 && a <= 2100) PetitIN.anoMetas(a); },
    projetar() {   // meta = faturamento do mesmo mês do ano anterior × (1 + crescimento); só preenche, não grava
      const c = numero($('mt-cresc').value); if (c == null) return aviso('Informe o % de crescimento (pode ser 0).', false);
      let n = 0;
      for (let k = 0; k < 12; k++) {
        const m = (anoMetas - 1) + '-' + String(k + 1).padStart(2, '0') + '-01', x = D.ind.find(r => d10(r.mes) === m);
        if (x && Number(x.faturamento_total) > 0) { $('mt-' + (k + 1)).value = (Math.round(Number(x.faturamento_total) * (1 + c / 100) / 10) * 10).toFixed(2).replace('.', ','); n++; }
      }
      PetitIN.totalMetas();
      aviso(n ? n + ' mês(es) preenchido(s) com ' + String(c).replace('.', ',') + '% sobre ' + (anoMetas - 1) + ' (arredondado de R$ 10 em R$ 10). Confira e clique em Salvar.' : 'Não há faturamento de ' + (anoMetas - 1) + ' para projetar.', n > 0);
    },
    totalMetas() {
      let t = 0; for (let k = 1; k <= 12; k++) { const v = numero(($('mt-' + k) || {}).value); if (v) t += v; }
      const el = $('mt-total'); if (el) el.textContent = brl(t);
    },
    async salvarMetas() {
      const metas = []; for (let k = 1; k <= 12; k++) { const raw = ($('mt-' + k).value || '').trim(), v = raw === '' ? '' : numero(raw);
        if (raw !== '' && (v == null || v < 0)) return aviso('Meta inválida em ' + MESES[k - 1] + '.', false);
        const item = { mes: k, valor: v === '' ? '' : String(v) };
        if (D.temNiveis) for (const [campo, id] of [['minima', 'mt-min-'], ['desafio', 'mt-des-']]) {   // Fase 14
          const r = ($(id + k).value || '').trim(), n = r === '' ? '' : numero(r);
          if (r !== '' && (n == null || n < 0)) return aviso('Meta ' + (campo === 'minima' ? 'mínima' : 'desafio') + ' inválida em ' + MESES[k - 1] + '.', false);
          item[campo] = n === '' ? '' : String(n);
        }
        metas.push(item); }
      try { const n = await rpc('gestao_salvar_metas', { p: { ano: anoMetas, metas } }); await recarregar(n + ' meta(s) de ' + anoMetas + ' salva(s).'); } catch (e) { aviso(e.message, false); }
    },
    async salvarConfig() {
      const p = { feira_semente_mensal: numero($('cg-semente').value), feira_registro_inicio: $('cg-feira').value ? $('cg-feira').value + '-01' : '',
        indicadores_inicio: $('cg-ind').value ? $('cg-ind').value + '-01' : '', multiplicador_meta: numero($('cg-mult').value) };
      try { await rpc('gestao_salvar_config_indicadores', { p }); await recarregar('Configuração salva.'); } catch (e) { aviso(e.message, false); }
    }
  };

  function desenhar() {
    const raiz = $('in-conteudo'); if (!raiz) return;
    document.querySelectorAll('#in-abas button').forEach(b => { b.className = 'btn btn-sm ' + (b.dataset.a === aba ? 'btn-primary' : 'btn-outline'); });
    raiz.innerHTML = aba === 'painel' ? tabPainel() : aba === 'feiras' ? tabFeiras() : aba === 'custos' ? tabCustos() : aba === 'metas' ? tabMetas()
      : aba === 'abc' ? tabABC() : aba === 'planejamento' ? tabPlanejamento() : tabConfig();
    if (aba === 'painel' && window.PetitProgresso) window.PetitProgresso.mes('in-progresso', mesSel);
  }
  function montar() {
    if ($('sec-indicadores')) return;
    const ref = $('nav-margem') || $('nav-lotes') || $('nav-notas'); if (!ref) return;
    const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-indicadores'; item.innerHTML = '<span class="ico">🎯</span> Indicadores'; item.onclick = () => goTo('indicadores');
    ref.parentNode.insertBefore(item, ref.nextSibling);
    const s = document.createElement('div'); s.id = 'sec-indicadores'; s.className = 'section';
    s.innerHTML = `<div class="page-header"><div><div class="page-title">🎯 Indicadores</div><div class="page-sub">Ponto de equilíbrio e meta de faturamento saudável, com a margem real das vendas</div></div></div>
      <div class="page-content"><div id="in-abas" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><button data-a="painel" onclick="PetitIN.aba('painel')">📊 Painel</button><button data-a="metas" onclick="PetitIN.aba('metas')">🎯 Metas</button>
      <button data-a="feiras" onclick="PetitIN.aba('feiras')">🎪 Feiras</button><button data-a="custos" onclick="PetitIN.aba('custos')">🧾 Custos fixos</button>
      <button data-a="abc" onclick="PetitIN.aba('abc')">📊 Curva ABC</button><button data-a="planejamento" onclick="PetitIN.aba('planejamento')">📅 Planejamento</button>
      <button data-a="config" onclick="PetitIN.aba('config')">⚙️ Configuração</button></div><div id="in-conteudo"></div></div>`;
    $('main').appendChild(s);
    const g0 = window.goTo;
    window.goTo = function (sec) { g0(sec); if (sec === 'indicadores') { $('nav-indicadores').classList.add('active'); carregar().then(desenhar).catch(e => { $('in-conteudo').innerHTML = '<div class="alert">Não foi possível carregar: ' + esc(e.message) + '<br>Se for a primeira vez, o SQL da Fase 10 precisa ter sido rodado no Supabase.</div>'; }); } };
  }
  montar();
})();
