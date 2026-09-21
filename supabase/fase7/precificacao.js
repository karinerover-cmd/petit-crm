// Leitor das abas de fórmula da planilha "PRECIFICAÇÃO - ATACADO E VAREJO" — Petit Sabó, Fase 7.
// Funciona no navegador e no Node. Recebe as linhas da aba (matriz de células, como o SheetJS entrega com header:1).
// Cada aba de produto tem o bloco  MATERIAIS | PESO (G/ML) | PREÇO/Unitário | Unidade | Total  e a pergunta "QUANTAS UNIDADES ...?".
//   peso = tamanho da embalagem comprada, preço = valor dessa embalagem, Unidade = quantidade usada em UMA receita.
// Uso:  const r = Precificacao.parse(linhas, 'COLD PROCESS');  → { nome, unidades, itens:[{nome, quantidade, unidade, custo, embalagem, preco_embalagem}], avisos, total_planilha }
(function (raiz) {
  const sa = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const num = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  const ABAS_IGNORADAS = /^(atacado|varejo)$/;

  function ehAbaDeProduto(nome) { return !ABAS_IGNORADAS.test(sa(nome)); }

  function parse(rows, nomeAba) {
    const r = { nome: String(nomeAba || '').trim(), unidades: null, itens: [], avisos: [], total_planilha: null };
    let h = -1, c0 = 0;
    for (let i = 0; i < rows.length && h < 0; i++) for (let c = 0; c <= 2; c++) if (sa(rows[i] && rows[i][c]) === 'materiais') { h = i; c0 = c; break; }
    if (h < 0) throw new Error('Não encontrei a tabela "MATERIAIS" nesta aba.');
    for (let i = 0; i < rows.length; i++) {
      const linha = rows[i] || [];
      const k = linha.findIndex(x => /quantas unidades/.test(sa(x)));
      if (k >= 0) { const v = linha.slice(k + 1).map(num).find(x => x > 0); if (v) { r.unidades = v; break; } }
    }
    if (!r.unidades) r.avisos.push('Não achei "QUANTAS UNIDADES" — informe o rendimento da receita.');
    for (let i = h + 1; i < rows.length; i++) {
      const l = rows[i] || [], nome = String(l[c0] == null ? '' : l[c0]).trim();
      if (/^total$/.test(sa(nome))) { r.total_planilha = num(l[c0 + 4]) || null; break; }
      if (/preco de venda/.test(sa(nome))) break;
      if (!nome) continue;
      const peso = num(l[c0 + 1]), preco = num(l[c0 + 2]), qtd = num(l[c0 + 3]);
      if (!(qtd > 0)) { r.avisos.push('"' + nome + '": sem quantidade na receita — ignorado.'); continue; }
      r.itens.push({ nome, quantidade: qtd, unidade: 'g', custo: peso > 0 && preco > 0 ? preco / peso : null, embalagem: peso || null, preco_embalagem: preco || null });
    }
    if (!r.itens.length) r.avisos.push('Nenhum ingrediente com quantidade nesta aba.');
    return r;
  }

  const Precificacao = { parse, ehAbaDeProduto };
  if (typeof module !== 'undefined' && module.exports) module.exports = Precificacao; else raiz.Precificacao = Precificacao;
})(typeof window !== 'undefined' ? window : globalThis);
