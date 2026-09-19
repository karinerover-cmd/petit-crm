// ═══════════ CAMADA SUPABASE (Fase 3b — grava no Supabase e espelha no localStorage) ═══════════
// Lê produtos, vendas, clientes e canais do Supabase e coloca nas listas do app (produtos/vendas/clientes/canais).
// Cada ação que grava chama uma função do banco (gestao_*), que roda numa transação única; depois o app recarrega tudo.
(function () {
  const SUPABASE_URL = 'https://cayvyoufdsfcrvwdscln.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_M9JVwfgdCD9K0nDeKN_d2g_ipq6KkBq'; // chave publicável (a mesma do CRM)
  let sb = null, todosProdutos = [];

  const $ = id => document.getElementById(id);
  const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v);
  const r2 = n => Math.round(n * 100) / 100;
  const norm = s => String(s || '').trim().toLowerCase();

  // ---------- leitura ----------
  async function todas(tabela, select, ordem) {          // busca paginada (o servidor entrega no máximo 1000 por vez)
    let out = [];
    for (let de = 0; ; de += 1000) {
      let q = sb.from(tabela).select(select);
      if (ordem) q = q.order(ordem.col, { ascending: ordem.asc !== false });
      const { data, error } = await q.range(de, de + 999);
      if (error) throw new Error(tabela + ': ' + error.message);
      out = out.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async function buscar() {
    return { produtos: await todas('produtos', '*', { col: 'sku' }), canais: await todas('canais', '*', { col: 'nome' }),
      clientes: await todas('clientes', 'id,nome,telefone,email', { col: 'nome' }),
      vendas: await todas('vendas', '*, canais(nome), clientes(nome,telefone,email), venda_itens(sku,produto_nome,quantidade,preco_unitario,desconto,desconto_label,subtotal)', { col: 'data_venda', asc: false }) };
  }

  function mapear(bruto) {
    const todos = bruto.produtos.map(p => ({
      id: p.sku, nome: p.nome, colecao: p.colecao || '', cat: p.categoria || 'Outro', fab: p.data_fabricacao || '',
      validMeses: p.validade_meses || 0, preco: num(p.preco), qtd: p.estoque_atual, oculto: !!p.oculto }));
    const prod = todos.filter(p => !p.oculto);                 // produtos ocultos (esgotados/vencidos) não aparecem no app
    const porSku = Object.fromEntries(todos.map(p => [p.id, p]));
    const cli = bruto.clientes.map(c => ({ id: c.id, nome: c.nome, tel: c.telefone || '', email: c.email || '' }));
    const vend = bruto.vendas.map(v => {
      const itens = (v.venda_itens || []).map(i => {
        const p = porSku[i.sku] || {};
        return { pid: i.sku || '', nome: i.produto_nome, colecao: p.colecao || '', cat: p.cat || '', preco: num(i.preco_unitario), qtd: i.quantidade,
          desconto: num(i.desconto), descontoLabel: i.desconto_label || '', subtotal: num(i.subtotal) };
      });
      const c = v.clientes || {};
      const base = { id: v.id, data: v.data_venda, total: num(v.valor), descontoTotal: num(v.desconto_venda), canal: (v.canais && v.canais.nome) || '',
        obs: v.observacao || '', cliNome: c.nome || '', cliTel: c.telefone || '', cliEmail: c.email || '', cliId: v.cliente_id,
        origem: v.origem === 'app_vendedor' ? 'vendedor' : 'manual', forma: v.forma_pagamento || '', origemBanco: v.origem };
      if (itens.length) {
        return Object.assign(base, { itens, subtotalItens: r2(itens.reduce((a, i) => a + i.subtotal, 0)),
          produtoNome: itens[0].nome + (itens.length > 1 ? ' + ' + (itens.length - 1) + ' item(ns)' : '') });
      }
      return Object.assign(base, { produtoNome: '(itens não detalhados)', qtd: 1, preco: base.total, desconto: 0 }); // usa o formato antigo do app
    });
    vend.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
    return { todos, prod, cli, vend, canais: bruto.canais.filter(c => c.ativo !== false).map(c => c.nome) };
  }

  function conferencia(m) {
    const el = $('conf-supabase') || (() => {
      const d = document.createElement('div'); d.id = 'conf-supabase'; d.className = 'card';
      d.style.cssText = 'margin-bottom:18px;border-left:4px solid #2e7d32;';
      const alvo = $('dash-stats'); alvo.parentNode.insertBefore(d, alvo); return d; })();
    const un = m.prod.reduce((a, p) => a + p.qtd, 0), vEst = r2(m.prod.reduce((a, p) => a + p.preco * p.qtd, 0));
    const fat = r2(m.vend.reduce((a, v) => a + v.total, 0));
    const mes = {}; m.vend.forEach(v => { const k = (v.data || '').slice(0, 7); mes[k] = r2((mes[k] || 0) + v.total); });
    el.innerHTML = '<div style="font-weight:600;margin-bottom:8px">✅ Conectado ao Supabase — Fase 3b <button id="gs-recarregar" class="btn btn-ghost" style="margin-left:8px;padding:2px 10px;font-size:12px">🔄 Recarregar</button></div>'
      + '<div style="font-size:13px;line-height:1.7">'
      + '<b>Supabase:</b> ' + m.prod.length + ' produtos visíveis (' + (m.todos.length - m.prod.length) + ' ocultos, ' + m.todos.length + ' no total) · ' + un + ' un · estoque R$ ' + vEst.toFixed(2)
      + ' · ' + m.vend.length + ' vendas (R$ ' + fat.toFixed(2) + ') · ' + m.cli.length + ' clientes<br>'
      + '<b>Faturamento por mês:</b> ' + Object.keys(mes).sort().map(k => k + ' R$ ' + mes[k].toFixed(2)).join(' · ')
      + '</div>';
    const b = $('gs-recarregar'); if (b) b.onclick = () => recarregar();
  }

  // ---------- espelho no localStorage (rede de segurança: o app antigo continua com os dados em dia) ----------
  const idNum = u => parseInt(String(u).replace(/-/g, '').slice(0, 12), 16);   // uuid → número estável (o app antigo usa ids numéricos)
  function espelhar() {
    try {
      if (!localStorage.getItem('ps3_bkp_pre_supabase')) {       // 1ª vez: guarda uma cópia do que já existia neste navegador
        const b = { em: new Date().toISOString() };
        ['ps3_produtos', 'ps3_vendas', 'ps3_clientes', 'ps3_canais'].forEach(k => { b[k] = JSON.parse(localStorage.getItem(k) || 'null'); });
        localStorage.setItem('ps3_bkp_pre_supabase', JSON.stringify(b));
      }
      _lsSet('ps3_produtos', produtos); _lsSet('ps3_canais', canais);
      _lsSet('ps3_clientes', clientes.map(c => Object.assign({}, c, { id: idNum(c.id) })));
      _lsSet('ps3_vendas', vendas.map(v => Object.assign({}, v, { id: idNum(v.id), cliId: v.cliId ? idNum(v.cliId) : null })));
    } catch (e) { console.warn('espelho no localStorage falhou:', e.message); }
  }

  function aplicar(m) {
    todosProdutos = m.todos;
    produtos = m.prod; vendas = m.vend; clientes = m.cli; canais = m.canais;   // listas do app (declaradas com let no script principal)
    renderColFilter(); renderCanaisSel();
    const ativa = document.querySelector('.section.active');
    goTo(ativa ? ativa.id.replace('sec-', '') : 'dashboard');
    if ($('sec-dashboard')) { renderDashboard(); conferencia(m); }
    espelhar();
  }
  async function recarregar() { aplicar(mapear(await buscar())); }

  // ---------- gravação ----------
  async function rpc(nome, args) {
    const { data, error } = await sb.rpc(nome, args);
    if (error) throw new Error(error.message);
    return data;
  }
  // executa a gravação, recarrega tudo e mostra erro (sem perder o que estava na tela) se algo falhar
  async function agir(fazer) {
    try { const r = await fazer(); await recarregar(); return { ok: true, r }; }
    catch (e) { mostrarErroModal(e.message); return { ok: false }; }
  }
  const aviso = (msg, ok) => { const t = document.createElement('div'); t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:44px;right:20px;background:' + (ok === false ? '#A32D2D' : '#2e7d32') + ';color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,.2);';
    document.body.appendChild(t); setTimeout(() => t.remove(), 4000); };

  function instalarGravacao() {
    // — Produtos —
    // Ao digitar o ID de um produto OCULTO, puxa o cadastro anterior (nome, coleção, categoria, preço, validade — editáveis);
    // a pessoa só informa o novo lote (fabricação e quantidade).
    let auto = false;
    const dica = () => {
      let a = $('p-aviso-oculto');
      if (!a) {
        a = document.createElement('div'); a.id = 'p-aviso-oculto';
        a.style.cssText = 'display:none;margin:-4px 0 12px;padding:8px 10px;border-radius:8px;background:#fff6e5;border:1px solid #f0d9a8;color:#7a5200;font-size:12px;line-height:1.45';
        $('p-id').closest('.grid2f').insertAdjacentElement('afterend', a);
      }
      return a;
    };
    const limparAuto = () => {
      if (auto) { ['p-nome', 'p-col', 'p-preco', 'p-fab', 'p-qtd'].forEach(i => $(i).value = ''); $('p-cat').value = 'Hidratante'; $('p-valid').value = '12'; $('p-vence').value = ''; auto = false; }
      dica().style.display = 'none';
    };
    const preencherOculto = () => {
      if ($('p-edit-id').value) return;                                   // só no cadastro novo
      const id = $('p-id').value.trim().toUpperCase();
      const ex = id && todosProdutos.find(p => String(p.id).toUpperCase() === id && p.oculto);
      if (!ex) { limparAuto(); return; }
      if (!auto && $('p-nome').value.trim()) return;                      // não sobrescreve o que já foi digitado
      $('p-nome').value = ex.nome; $('p-col').value = ex.colecao || ''; $('p-cat').value = ex.cat || 'Outro'; $('p-preco').value = ex.preco;
      if ([...$('p-valid').options].some(o => o.value === String(ex.validMeses))) $('p-valid').value = String(ex.validMeses);
      $('p-fab').value = ''; $('p-qtd').value = ''; $('p-vence').value = ''; auto = true;
      const a = dica(); a.style.display = 'block';
      a.innerHTML = '♻️ <b>Produto oculto encontrado</b> — preenchi nome, coleção, categoria, preço e validade com o cadastro anterior (pode editar). Informe só o <b>novo lote</b>: fabricação e quantidade.'
        + ([6, 12, 24].includes(Number(ex.validMeses)) ? '' : '<br>⚠️ Este produto não tem <b>validade</b> cadastrada: escolha 6, 12 ou 24 meses.');
      $('p-fab').focus();
    };
    $('p-id').addEventListener('input', preencherOculto);
    const fecharOrig = window.closeModal;
    window.closeModal = function (id) { fecharOrig(id); if (id === 'modal-produto') limparAuto(); };
    window.salvarProduto = async function () {
      const editId = $('p-edit-id').value, id = $('p-id').value.trim().toUpperCase(), nome = $('p-nome').value.trim(), colecao = $('p-col').value.trim();
      const cat = $('p-cat').value, fab = $('p-fab').value.trim(), validMeses = parseInt($('p-valid').value);
      const preco = parseFloat($('p-preco').value) || 0, qtd = parseInt($('p-qtd').value) || 0;
      if (!id) { mostrarErroModal('Preencha o ID.'); return; }
      if (!nome || !fab) { mostrarErroModal('Preencha nome e fabricação.'); return; }
      if (!/^\d{2}\/\d{4}$/.test(fab)) { mostrarErroModal('Fabricação deve estar no formato MM/AAAA.'); return; }
      const existente = !editId && todosProdutos.find(p => String(p.id).toUpperCase() === id);
      if (existente && !existente.oculto) { mostrarErroModal('ID já existe.'); return; }
      if (existente && !confirm('O produto ' + id + ' ("' + existente.nome + '") está oculto (esgotado ou vencido).\n\nReativar e registrar o novo lote com os dados desta tela (fabricação, preço e quantidade)? O histórico de vendas dele é preservado.')) return;
      const r = await agir(() => rpc('gestao_salvar_produto', { p: { novo: !editId && !existente, sku: id, nome, colecao, categoria: cat, data_fabricacao: fab, validade_meses: validMeses, preco, qtd } }));
      if (!r.ok) return;
      closeModal('modal-produto');
      ['p-edit-id', 'p-id', 'p-nome', 'p-col', 'p-fab', 'p-preco', 'p-qtd'].forEach(i => $(i).value = '');
      $('p-valid').value = '12'; $('modal-produto-titulo').textContent = 'Cadastrar produto';
    };
    window.excluirProduto = async function (id) {
      if (!confirm('Excluir este produto? Se ele já tiver vendas, será apenas ocultado (o histórico é preservado).')) return;
      const r = await agir(() => rpc('gestao_excluir_produto', { p_sku: String(id) }));
      if (r.ok) aviso(r.r === 'ocultado' ? 'Produto ocultado (tem vendas no histórico).' : 'Produto excluído.');
    };
    window.salvarFabricacao = async function () {
      const id = $('fab-prod-id').value, fab = $('fab-nova').value.trim(), qtd = parseInt($('fab-qtd').value) || 0;
      if (!/^\d{2}\/\d{4}$/.test(fab)) { mostrarErroModal('Formato MM/AAAA.'); return; }
      const r = await agir(() => rpc('gestao_atualizar_fabricacao', { p_sku: String(id), p_fab: fab, p_qtd: qtd }));
      if (r.ok) closeModal('modal-fab');
    };

    // — Vendas —
    window.finalizarVendaG = async function () {
      const data = $('v-data').value, canal = $('v-canal').value, obs = $('v-obs').value.trim();
      const cliNome = $('v-cli-nome').value.trim(), cliTel = $('v-cli-tel').value.trim(), cliEmail = $('v-cli-email').value.trim();
      const salvar = $('v-salvar-cli').checked, erroEl = $('g-venda-erro');
      const mostrarErro = msg => { if (erroEl) { erroEl.textContent = msg; erroEl.style.display = 'block'; setTimeout(() => erroEl.style.display = 'none', 3000); } };
      if (!canal) { mostrarErro('Selecione o canal de venda.'); return; }
      if (!carrinhoG.length) { mostrarErro('Adicione pelo menos um produto ao carrinho.'); return; }
      for (const item of carrinhoG) {
        const p = produtos.find(x => String(x.id) === String(item.pid));
        if (!p || p.qtd < item.qtd) { mostrarErro('Estoque insuficiente para: ' + item.nome); return; }
      }
      const subtotalGeral = carrinhoG.reduce((a, i) => a + i.subtotal, 0);
      const cartDesc = parseFloat(($('g-cart-desc') || {}).value) || 0, cartTipo = (($('g-cart-desc-tipo') || {}).value) || 'R$';
      const cartDescVal = cartTipo === '%' ? subtotalGeral * (cartDesc / 100) : cartDesc;
      const payload = { data, canal, obs, origem: 'gestao', desconto_venda: r2(cartDescVal),
        itens: carrinhoG.map(i => ({ sku: i.pid, nome: i.nome, preco: i.preco, qtd: i.qtd, desconto: r2(i.desconto), label: i.descontoLabel })) };
      const sel = $('v-cli-sel').value;
      if (sel) payload.cliente_id = sel; else if (cliNome) payload.cliente = { nome: cliNome, tel: cliTel, email: cliEmail, salvar };
      const r = await agir(() => rpc('gestao_registrar_venda', { p: payload }));
      if (!r.ok) return;
      carrinhoG = [];
      const gcd = $('g-cart-desc'); if (gcd) gcd.value = '0'; const gcdt = $('g-cart-desc-tipo'); if (gcdt) gcdt.value = 'R$';
      renderCarrinhoG();
      ['v-canal', 'v-obs', 'v-cli-nome', 'v-cli-tel', 'v-cli-email', 'v-cli-sel'].forEach(i => $(i).value = '');
      $('v-qtd').value = '1'; $('v-desc').value = '0'; $('v-total').value = ''; $('v-salvar-cli').checked = false;
      renderProdutosSel();
      const a = $('alert-venda'); a.style.display = 'block'; setTimeout(() => a.style.display = 'none', 3000);
    };
    window.excluirVendaG = async function (id) {
      if (!confirm('Excluir esta venda? O estoque volta e o cashback/follow-ups ligados a ela também são apagados.')) return;
      const r = await agir(() => rpc('gestao_excluir_venda', { p_id: String(id) }));
      if (r.ok) aviso('Venda excluída.');
    };
    window.salvarEdicaoVendaG = async function () {
      const p = { id: $('evg-id').value, data: $('evg-data').value, canal: $('evg-canal').value, obs: $('evg-obs').value.trim(),
        cliente: { nome: $('evg-cliente').value.trim(), tel: $('evg-tel').value.trim(), email: $('evg-email').value.trim() } };
      const r = await agir(() => rpc('gestao_editar_venda', { p }));
      if (r.ok) closeModal('modal-editar-venda-g');
    };

    // — Clientes —
    window.salvarCliente = async function () {
      const nome = $('c-nome').value.trim(), tel = $('c-tel').value.trim(), email = $('c-email').value.trim();
      if (!nome) { mostrarErroModal('Preencha o nome.'); return; }
      const r = await agir(() => rpc('gestao_salvar_cliente', { p_nome: nome, p_tel: tel, p_email: email }));
      if (!r.ok) return;
      renderCliSel(); closeModal('modal-cliente'); ['c-nome', 'c-tel', 'c-email'].forEach(i => $(i).value = '');
    };
    window.excluirCliente = async function (id) {
      if (!confirm('Excluir este cliente?')) return;
      const r = await agir(() => rpc('gestao_excluir_cliente', { p_id: String(id) }));
      if (r.ok) renderCliSel();
    };

    // — Canais —
    window.adicionarCanal = async function () {
      const v = $('canal-novo').value.trim(); if (!v) return;
      const r = await agir(() => rpc('gestao_salvar_canal', { p_nome: v }));
      if (r.ok) $('canal-novo').value = '';
    };
    window.removerCanal = async function (i) {
      const nome = canais[i]; if (!nome || !confirm('Remover o canal "' + nome + '"? Se já tiver vendas, ele só é desativado.')) return;
      const r = await agir(() => rpc('gestao_remover_canal', { p_nome: nome }));
      if (r.ok && r.r === 'desativado') aviso('Canal desativado (tem vendas no histórico).');
    };
    window.salvarEdicaoCanal = async function (i) {
      const inp = $('canal-edit-' + i); if (!inp) return;
      const v = inp.value.trim(), antigo = canais[i];
      if (v && v !== antigo) await agir(() => rpc('gestao_renomear_canal', { p_antigo: antigo, p_novo: v })); else { renderListaCanais(); renderCanaisSel(); }
    };

    // — Importar vendas do app do vendedor (CSV) —
    window.importarVendasVendedor = function (e) {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = async function (ev) {
        const text = ev.target.result.replace(/^﻿/, '').replace(/\r\n/g, '\n');
        const lines = text.split('\n').filter(l => l.trim());
        if (!lines.length) { mostrarAlertImport('Arquivo vazio.', false); return; }
        const hl = lines[0].toLowerCase(), temCab = hl.includes('produto') || hl.includes('data') || hl.includes('vendaid');
        const dados = temCab ? lines.slice(1) : lines;
        const c = { vendaId: 0, data: 1, local: 2, produto: 3, cat: 4, qtd: 5, preco: 6, desconto: 7, totalItem: 8, totalVenda: 9, pgto: 10, cliente: 11, tel: 12, email: 13, obs: 14 };
        if (temCab) lines[0].split(',').forEach((h, i) => {
          const x = h.toLowerCase().trim();
          if (x.includes('vendaid') || x === 'id') c.vendaId = i; else if (x === 'data') c.data = i; else if (x === 'local' || x === 'local / feira') c.local = i;
          else if (x === 'produto') c.produto = i; else if (x === 'categoria' || x === 'cat') c.cat = i; else if (x === 'qtd' || x === 'quantidade') c.qtd = i;
          else if (x.includes('preco') || x.includes('preço')) c.preco = i; else if (x.includes('desconto')) c.desconto = i;
          else if (x.includes('total item') || x.includes('subtotal')) c.totalItem = i; else if (x.includes('total venda') || x === 'total') c.totalVenda = i;
          else if (x === 'pagamento' || x.includes('pgto') || x.includes('pagamento')) c.pgto = i; else if (x === 'cliente') c.cliente = i;
          else if (x === 'telefone' || x === 'tel') c.tel = i; else if (x === 'email') c.email = i; else if (x === 'observacoes' || x.includes('obs')) c.obs = i;
        });
        const mapa = {}, erros = [];
        dados.forEach(line => {
          const p = line.split(','), nomeProd = (p[c.produto] || '').trim(), qtd = parseInt(p[c.qtd]) || 0;
          if (!nomeProd || !qtd) return;
          const prod = produtos.find(x => norm(x.nome) === norm(nomeProd)) || todosProdutos.find(x => norm(x.nome) === norm(nomeProd));
          if (!prod) { if (!erros.includes(nomeProd)) erros.push(nomeProd); return; }
          const vid = (p[c.vendaId] || '').trim() || (Date.now() + '-' + Math.random());
          const data = (p[c.data] || '').trim(), local = (p[c.local] || '').trim(), desc = parseFloat(p[c.desconto]) || 0;
          const totalItem = parseFloat(p[c.totalItem]) || 0, totalVenda = parseFloat(p[c.totalVenda]) || 0;
          const chave = vid + '|' + data;
          if (!mapa[chave]) mapa[chave] = { data, canal: 'Feira', forma_pagamento: (p[c.pgto] || '').trim(), origem: 'app_vendedor',
            pedido_externo: 'VEND-' + data + '-' + vid + '-' + totalVenda,   // evita importar o mesmo arquivo duas vezes
            obs: [local, (p[c.obs] || '').trim()].filter(Boolean).join(' | '),
            cliente: { nome: (p[c.cliente] || '').trim(), tel: (p[c.tel] || '').trim(), email: (p[c.email] || '').trim(), salvar: false }, itens: [] };
          mapa[chave].itens.push({ sku: prod.id, nome: prod.nome, preco: prod.preco, qtd, desconto: desc, label: desc > 0 ? 'R$ ' + desc.toFixed(2) : '' });
        });
        let novas = 0, repetidas = 0; const falhas = [];
        for (const v of Object.values(mapa)) {
          try { const id = await rpc('gestao_registrar_venda', { p: v }); if (id) novas++; else repetidas++; }
          catch (err) { falhas.push(err.message); }
        }
        await recarregar();
        mostrarAlertImport(novas + ' venda(s) importada(s) e estoque atualizado.' + (repetidas ? ' ' + repetidas + ' já tinha(m) sido importada(s) antes (ignorada(s)).' : '')
          + (erros.length ? ' Produtos não encontrados: ' + erros.join(', ') + '.' : '') + (falhas.length ? ' Erros: ' + falhas.join(' | ') : ''), !falhas.length);
      };
      r.readAsText(file, 'UTF-8'); e.target.value = '';
    };

    // — Importar / atualizar estoque (CSV) —
    window.importarEstoque = function (e) {
      const file = e.target.files[0]; if (!file) return;
      const modo = $('imp-est-modo').value, al = $('alert-imp-estoque');
      const showAl = (msg, ok) => { al.className = 'alert ' + (ok ? 'alert-success' : 'alert-error'); al.textContent = msg; al.style.display = 'block'; setTimeout(() => al.style.display = 'none', 9000); };
      if (modo === 'substituir') { showAl('🔒 "Substituir tudo" está desativado: o estoque agora é compartilhado com o CRM e o histórico. Use "Atualizar" ou "Adicionar".', false); e.target.value = ''; return; }
      const r = new FileReader();
      r.onload = async function (ev) {
        const lines = ev.target.result.replace(/﻿/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
        if (!lines.length) { showAl('Arquivo vazio.', false); return; }
        const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
        const heads = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''));
        const ci = cands => { for (const x of cands) { const i = heads.indexOf(x); if (i >= 0) return i; } return -1; };
        const iN = ci(['nome', 'produto', 'name']), iCol = ci(['colecao', 'collection', 'linha']), iCat = ci(['categoria', 'cat', 'category', 'tipo']), iFab = ci(['fabricacao', 'fab', 'datafab']);
        const iVal = ci(['validadesmeses', 'validade', 'validmeses', 'meses', 'months']), iPr = ci(['preco', 'price', 'valor', 'precounit', 'precovenda']);
        const iQ = ci(['quantidade', 'qtd', 'qty', 'estoque', 'stock', 'quantity']), iId = ci(['id']);
        if (iN < 0) { showAl('Coluna "Nome" não encontrada. Verifique os cabeçalhos.', false); return; }
        const parsePreco = s => { if (!s) return 0; s = String(s).trim().replace(/[^0-9,\.]/g, ''); if (s.includes(',') && s.includes('.')) s = s.replace('.', '').replace(',', '.'); else s = s.replace(',', '.'); return parseFloat(s) || 0; };
        let adicionados = 0, atualizados = 0, ignorados = 0; const problemas = [];
        for (const line of lines.slice(1)) {
          const p = line.split(sep).map(v => v.trim().replace(/^"|"$/g, '')), nome = (p[iN] || '').trim();
          if (!nome) { ignorados++; continue; }
          const colecao = iCol >= 0 ? (p[iCol] || '').trim() : '', cat = iCat >= 0 ? (p[iCat] || '').trim() : 'Outro', fab = iFab >= 0 ? (p[iFab] || '').trim() : '';
          const validMeses = iVal >= 0 ? (parseInt(p[iVal]) || 12) : 12, preco = iPr >= 0 ? parsePreco(p[iPr]) : 0;
          const qtd = iQ >= 0 ? (parseInt((p[iQ] || '0').replace(/[^0-9]/g, '')) || 0) : 0, idVal = iId >= 0 ? ((p[iId] || '').trim().toUpperCase() || null) : null;
          const ex = todosProdutos.find(x => norm(x.nome) === norm(nome)) || (idVal ? todosProdutos.find(x => x.id === idVal) : null);
          try {
            if (ex) {
              if (modo !== 'atualizar') { ignorados++; continue; }
              await rpc('gestao_salvar_produto', { p: { novo: false, sku: ex.id, nome: ex.nome, colecao: colecao || ex.colecao, categoria: (cat && cat !== 'Outro') ? cat : ex.cat,
                data_fabricacao: fab || ex.fab, validade_meses: ex.validMeses, preco: preco > 0 ? preco : ex.preco, qtd: iQ >= 0 ? qtd : ex.qtd } });
              atualizados++;
            } else {
              if (!idVal) { problemas.push(nome + ' (produto novo precisa da coluna ID)'); continue; }
              await rpc('gestao_salvar_produto', { p: { novo: true, sku: idVal, nome, colecao, categoria: cat || 'Outro', data_fabricacao: fab, validade_meses: validMeses, preco, qtd } });
              adicionados++;
            }
          } catch (err) { problemas.push(nome + ': ' + err.message); }
        }
        await recarregar();
        showAl('✓ Concluído: ' + adicionados + ' adicionado(s), ' + atualizados + ' atualizado(s)' + (ignorados ? ' · ' + ignorados + ' ignorado(s)' : '')
          + (problemas.length ? ' · Problemas: ' + problemas.slice(0, 5).join(' | ') : ''), !problemas.length);
      };
      r.readAsText(file); e.target.value = '';
    };

    // — Desativadas nesta versão —
    window.limparVendas = function () { alert('🔒 Desativado: as vendas ficam no Supabase, compartilhadas com o CRM. Para apagar uma venda, use a lixeira no Histórico.'); };
    const sheets = function () { alert('🔒 A sincronização com o Google Sheets (leitura) foi desativada nesta versão: os dados agora vêm do Supabase.'); };
    window.carregarDoSheets = sheets; window.sincronizarSheets = sheets;
  }

  async function carregar(cliente) {
    if (cliente) sb = cliente;
    instalarGravacao();
    aplicar(mapear(await buscar()));
    $('gs-login').style.display = 'none';
    $('gs-banner').style.display = 'flex';
  }

  async function entrar(ev) {
    ev.preventDefault();
    const msg = $('gs-msg'); msg.textContent = 'Entrando…';
    try {
      const { error } = await sb.auth.signInWithPassword({ email: $('gs-email').value.trim(), password: $('gs-senha').value });
      if (error) { msg.textContent = 'E-mail ou senha incorretos.'; return; }
      $('gs-senha').value = ''; msg.textContent = 'Carregando dados…';
      await carregar();
    } catch (e) { msg.textContent = 'Erro: ' + e.message; }
  }

  async function iniciar() {
    if (!window.supabase) { $('gs-msg').textContent = 'Não foi possível carregar a biblioteca do Supabase (sem internet?).'; return; }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, storageKey: 'petit-gestao-auth' } });
    $('gs-form').addEventListener('submit', entrar);
    $('gs-sair').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    const { data } = await sb.auth.getSession();
    if (data && data.session) { $('gs-msg').textContent = 'Carregando dados…'; try { await carregar(); } catch (e) { $('gs-msg').textContent = 'Erro: ' + e.message; } }
  }

  window.__gestao = { carregar, mapear, recarregar };   // usado nos testes
  iniciar();
})();
