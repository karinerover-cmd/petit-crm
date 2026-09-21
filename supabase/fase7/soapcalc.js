// Leitor de receita do SoapCalc (texto do PDF impresso) — Petit Sabó, Fase 7.
// Funciona no navegador e no Node. Uso:  const r = SoapCalc.parse(textoDoPdf);
// Devolve { nome, peso_total_g, itens:[{nome, quantidade, unidade, grupo, original, obs}], observacao, avisos }
(function (raiz) {
  const num = s => parseFloat(String(s).replace(',', '.'));
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // nomes em inglês do SoapCalc → nome usado no cadastro (editável na tela)
  const TRAD = {
    'castor oil': 'Óleo de mamona', 'coconut oil': 'Óleo de coco', 'palm oil': 'Óleo de palma', 'sunflower oil': 'Óleo de girassol',
    'almond oil': 'Óleo de amêndoas doce', 'palm kernel oil': 'Óleo de palmiste', 'cupuacu butter': 'Manteiga de cupuaçu', 'olive oil': 'Óleo de oliva',
    'shea butter': 'Manteiga de karité', 'cocoa butter': 'Manteiga de cacau', 'soybean oil': 'Óleo de soja', 'canola oil': 'Óleo de canola',
    'avocado oil': 'Óleo de abacate', 'babassu oil': 'Óleo de babaçu', 'jojoba oil': 'Óleo de jojoba', 'rice bran oil': 'Óleo de farelo de arroz',
    'sesame oil': 'Óleo de gergelim', 'macadamia nut oil': 'Óleo de macadâmia', 'grapeseed oil': 'Óleo de semente de uva', 'cocoa butter ': 'Manteiga de cacau',
    'mango butter': 'Manteiga de manga', 'murumuru butter': 'Manteiga de murumuru', 'beeswax': 'Cera de abelha', 'lard': 'Banha de porco', 'tallow': 'Sebo'
  };
  function traduz(nomeEn) {
    const t = String(nomeEn || '').trim().toLowerCase();
    if (TRAD[t]) return TRAD[t];
    const base = t.split(',')[0].trim();
    return TRAD[base] || String(nomeEn).trim();
  }

  function parse(texto) {
    const linhas = String(texto || '').split(/\r?\n/).map(l => l.replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);   // o PDF traz caracteres de controle (caixinhas) entre as colunas
    if (!linhas.length) throw new Error('O arquivo está vazio.');
    const r = { nome: linhas[0], peso_total_g: null, itens: [], observacao: '', avisos: [] };
    const oleos = [], extras = []; let agua = null, soda = null, fragr = null, emOleos = false, emAdit = false; const obs = [];
    for (const l of linhas.slice(1)) {
      let m;
      if (/^Additives\b/i.test(l)) { emAdit = true; emOleos = false; continue; }
      if (emAdit) {
        if ((m = l.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|ml)\s+(.+)$/i))) {
          let q = num(m[1]), u = m[2].toLowerCase(), resto = m[3].trim();
          if (u === 'kg') { q *= 1000; u = 'g'; }
          let fase = ''; const f = resto.match(/\s+(na|no)\s+(lixivia|agua|água|oleo|óleo|oleos|óleos)\b.*$/i);
          if (f) { fase = f[0].trim(); resto = resto.slice(0, f.index).trim(); }
          const semBlend = resto.replace(/\s+blend$/i, '').trim();
          if (semBlend !== resto) { obs.push('blend'); resto = semBlend; }
          extras.push({ nome: resto, quantidade: q, unidade: u, grupo: 'aditivo', original: l, obs: fase });
        } else obs.push(l);
        continue;
      }
      if (/^#\s*Oil\/Fat/i.test(l)) { emOleos = true; continue; }
      if (/^Totals\b/i.test(l)) { emOleos = false; continue; }
      if (emOleos && (m = l.match(/^\d+\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/))) { oleos.push({ nome: traduz(m[1]), quantidade: num(m[5]), unidade: 'g', grupo: 'óleo', original: m[1], obs: m[2] + '%' }); continue; }
      if ((m = l.match(/^Water\s+[\d.]+\s+[\d.]+\s+([\d.]+)$/i))) { agua = num(m[1]); continue; }
      if ((m = l.match(/^Lye\s*-\s*(\w+)\s+[\d.]+\s+[\d.]+\s+([\d.]+)$/i))) { soda = { q: num(m[2]), t: m[1].toUpperCase() }; continue; }
      if ((m = l.match(/^Fragrance\s+[\d.]+\s+[\d.]+\s+([\d.]+)$/i))) { fragr = num(m[1]); continue; }
      if ((m = l.match(/^Soap weight.*?([\d.]+)$/i))) { r.peso_total_g = num(m[1]); continue; }
    }
    r.itens.push(...oleos);
    if (soda && soda.q > 0) r.itens.push({ nome: soda.t === 'KOH' ? 'Potassa cáustica (KOH)' : 'Soda cáustica (NaOH)', quantidade: soda.q, unidade: 'g', grupo: 'soda', original: 'Lye - ' + soda.t, obs: '' });
    if (agua && agua > 0) r.itens.push({ nome: 'Água destilada', quantidade: agua, unidade: 'g', grupo: 'água', original: 'Water', obs: '' });
    if (fragr && fragr > 0) r.itens.push({ nome: 'Fragrância', quantidade: fragr, unidade: 'g', grupo: 'aditivo', original: 'Fragrance', obs: '' });
    r.itens.push(...extras);
    r.observacao = [...new Set(obs)].join('; ');
    if (!oleos.length) r.avisos.push('Não encontrei a tabela de óleos — confira se é uma receita do SoapCalc.');
    if (!r.peso_total_g) r.avisos.push('Não encontrei o peso total da massa.');
    const somaOleos = oleos.reduce((a, b) => a + b.quantidade, 0);
    if (oleos.length && !/total oil weight\s+([\d.]+)/i.test(texto)) r.avisos.push('Total de óleos: ' + somaOleos + ' g (não achei a linha "Total oil weight").');
    return r;
  }

  const SoapCalc = { parse, traduz, semAcento };
  if (typeof module !== 'undefined' && module.exports) module.exports = SoapCalc; else raiz.SoapCalc = SoapCalc;
})(typeof window !== 'undefined' ? window : globalThis);
