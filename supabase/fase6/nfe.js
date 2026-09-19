// Leitor de NF-e (XML) + classificador de itens — Petit Sabó, Fase 6.
// Funciona no navegador e no Node (sem dependências). Uso:  const nota = NFe.parse(xmlTexto);  NFe.classificar(item, memoria)
(function (raiz) {
  const dec = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const tag = (x, t) => { const m = x.match(new RegExp('<' + t + '>([^<]*)</' + t + '>')); return m ? dec(m[1]).trim() : ''; };
  const num = s => { const v = parseFloat(s); return isNaN(v) ? 0 : v; };
  const r2 = n => Math.round(n * 100) / 100;
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function parse(xml) {
    const chave = (xml.match(/Id="NFe(\d{44})"/) || [])[1] || tag(xml, 'chNFe');
    if (!chave) throw new Error('Arquivo não parece uma NF-e (chave de acesso não encontrada).');
    const emit = (xml.match(/<emit>[\s\S]*?<\/emit>/) || [''])[0];
    const tot = (xml.match(/<ICMSTot>[\s\S]*?<\/ICMSTot>/) || [''])[0];
    const infCpl = dec(tag(xml, 'infCpl'));        // vem codificado duas vezes (&amp;lt;br /&amp;gt;)
    const difalM = infCpl.replace(/<[^>]+>/g, ' ').match(/DIFAL[^$]{0,80}\$\s*([\d.]+,\d{2})/i);
    const itens = (xml.match(/<det nItem="\d+">[\s\S]*?<\/det>/g) || []).map(d => {
      const p = (d.match(/<prod>[\s\S]*?<\/prod>/) || [''])[0];
      return { n: +d.match(/nItem="(\d+)"/)[1], codigo: tag(p, 'cProd'), descricao: tag(p, 'xProd'), ncm: tag(p, 'NCM'), unidade: tag(p, 'uCom'),
        quantidade: num(tag(p, 'qCom')), valor_unitario: num(tag(p, 'vUnCom')), valor_produto: num(tag(p, 'vProd')),
        valor_frete: num(tag(p, 'vFrete')), valor_desconto: num(tag(p, 'vDesc')),
        // impostos cobrados POR FORA do valor do produto (entram no total da nota e são custo real): IPI, ICMS-ST, imposto de importação, seguro, outras
        valor_outras: r2(num(tag(p, 'vOutro')) + num(tag(p, 'vSeg')) + num(tag(d, 'vIPI')) + num(tag(d, 'vICMSST')) + num(tag(d, 'vII'))) };
    });
    return {
      chave, numero: tag(xml, 'nNF'), serie: tag(xml, 'serie'), data_emissao: tag(xml, 'dhEmi').slice(0, 10), natureza: tag(xml, 'natOp'),
      fornecedor: { cnpj: tag(emit, 'CNPJ') || tag(emit, 'CPF'), nome: tag(emit, 'xNome'), fantasia: tag(emit, 'xFant') },
      totais: { produtos: num(tag(tot, 'vProd')), frete: num(tag(tot, 'vFrete')), seguro: num(tag(tot, 'vSeg')), desconto: num(tag(tot, 'vDesc')), outras: num(tag(tot, 'vOutro')), total: num(tag(tot, 'vNF')) },
      difal: difalM ? num(difalM[1].replace(/\./g, '').replace(',', '.')) : 0,      // imposto de diferença de alíquota: NÃO está no total da nota
      itens
    };
  }

  // custo real de cada item = valor do produto + frete (já rateado) − desconto. IPI e DIFAL são só demonstrativo (não entram).
  function custos(nota, ratearDifal) {
    const base = nota.itens.map(i => i.valor_produto - i.valor_desconto), somaBase = base.reduce((a, b) => a + b, 0) || 1;
    return nota.itens.map((i, k) => {
      const difal = ratearDifal ? nota.difal * base[k] / somaBase : 0;
      return r2(i.valor_produto + i.valor_frete - i.valor_desconto + difal);   // IPI e demais impostos são só demonstrativo; DIFAL só se ratear (padrão: não)
    });
  }

  // ---------- classificação ----------
  // Ordem importa: equipamento e envio são conferidos antes dos materiais; "caixa base" (ingrediente) vence "caixa" (envio).
  const REGRAS = [
    { destino: 'despesa_operacional', categoria: 'melhoria_equipamento', re: /\b(balanca|proveta|becker|beque?r|termometro|espatula|medidor|batedeira|panela|liquidificador|mixer|forma de silicone|molde|expositor|suporte|estante|maquina|seladora|etiquetadora|impressora)\b/ },
    { destino: 'despesa_operacional', categoria: 'outro', re: /\b(bandeja|decoracao|enfeite|toalha de mesa|cesto decorativo)\b/ },   // decoração para feira/fotos
  { destino: 'despesa_operacional', categoria: 'curso', re: /\b(curso|apostila|aula|workshop|mentoria|ebook)\b/ },
    { destino: 'despesa_operacional', categoria: 'sessao_foto_video', re: /\b(sessao de fotos?|ensaio fotografico|filmagem|fotografo)\b/ },
    { destino: 'despesa_operacional', categoria: 'material_escritorio', re: /\b(super fita|caneta|papel sulfite|grampeador|pasta arquivo|toner|cartucho|caderno)\b/ },
    { destino: 'materia_prima', categoria: 'ingrediente', re: /\b(caixa base|base (branca|transparente|glicerinada|vegetal|para sabonete)|essencia|fragrancia|aroma|oleo (essencial|vegetal|de)|manteiga de|cera (de|vegetal|soja|palma)|parafina|corante|pigmento|glicerina|extrato|argila|lauril|betaina|cocamido|conservante|acido|soda caustica|hidroxido|silicone liquido|tensoativo|emulsificante|alcool (de cereais|etilico)|vitamina|mica|glitter|pavio)\b/ },
    { destino: 'materia_prima', categoria: 'embalagem_produto', re: /\b(frasco|valvula|gatilho|tampa|copo de vidro|porta vela|pote|bisnaga|pump|lata|atomizador|difusor de vidro|vidro ambar|vidro para vela)\b/ },
    { destino: 'embalagem_envio', categoria: null, re: /\b(sacola|papel de seda|fita adesiva|lacre|plastico bolha|embalagem kraft|envelope|saco (plastico|kraft|de presente)|etiqueta (adesiva|de envio)|adesivo|caixa (de papelao|de envio|kraft|para envio|de presente))\b/ }
  ];

  // "Copo ... 6 unidades" → 6 ; "Essência 100g" → 100 g ; "Base 6,5kg" → 6500 g ; "Frasco 30ml" (capacidade, não quantidade) → 1 un
  function conteudo(descricao, categoria, unidadeCompra) {
    const t = semAcento(descricao);
    if (categoria === 'ingrediente') {
      const m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/);
      if (m) { const v = num(m[1].replace(',', '.')); const u = m[2]; return u === 'kg' ? { qtd: v * 1000, base: 'g' } : u === 'g' ? { qtd: v, base: 'g' } : u === 'l' ? { qtd: v * 1000, base: 'ml' } : { qtd: v, base: 'ml' }; }
      return { qtd: 1, base: 'un', incerto: true };
    }
    const m = t.match(/(\d+)\s*(unidades|unidade|und|un|pecas|pcs)\b/);
    return { qtd: m ? +m[1] : 1, base: 'un' };
  }

  // tipo da matéria-prima (para diferenciar essência comum × cold process, base, frasco...)
  const TIPOS = [['essencia', 'Essência'], ['fragrancia', 'Fragrância'], ['caixa base', 'Base'], ['base', 'Base'], ['corante', 'Corante'], ['manteiga', 'Manteiga'], ['oleo', 'Óleo'], ['cera', 'Cera'], ['frasco', 'Frasco'], ['valvula', 'Válvula'], ['copo', 'Copo'], ['porta vela', 'Porta-vela'], ['tampa', 'Tampa']];
  const tipoDe = (t, cat) => { const x = TIPOS.find(k => t.includes(k[0])); return x ? x[1] + (/cold process/.test(t) ? ' cold process' : '') : (cat === 'embalagem_produto' ? 'Embalagem' : 'Ingrediente'); };

  const limparNome = d => String(d || '').replace(/\s*-\s*\d+\s*(unidades|unidade|und|un)\b/i, '').replace(/\s+/g, ' ').trim();

  // memoria: { 'cnpj|codigo': { destino, categoria, nome, unidade_base, conteudo_por_unidade, materia_prima_id, ... } } (o que já foi confirmado antes)
  function classificar(item, fornecedorCnpj, memoria) {
    const lembrado = memoria && memoria[fornecedorCnpj + '|' + item.codigo];
    if (lembrado) return Object.assign({ origem: 'memoria', confianca: 'alta', motivo: 'já confirmado numa nota anterior deste fornecedor' }, lembrado);
    const t = semAcento(item.descricao);
    const r = REGRAS.find(x => x.re.test(t));
    if (!r) return { origem: 'sem_regra', confianca: 'nenhuma', destino: 'pendente', categoria: null, nome: limparNome(item.descricao), unidade_base: 'un', conteudo_por_unidade: 1, motivo: 'nenhuma regra reconhece este item' };
    const tipo = r.destino === 'materia_prima' ? tipoDe(t, r.categoria) : null;
    const c = r.destino === 'materia_prima' ? conteudo(item.descricao, r.categoria, item.unidade) : { qtd: 1, base: 'un' };
    return { origem: 'regra', confianca: c.incerto ? 'media' : 'alta', destino: r.destino, categoria: r.categoria, nome: limparNome(item.descricao), tipo,
      unidade_base: c.base, conteudo_por_unidade: c.qtd, recorrente: false, motivo: 'regra: ' + String(r.re).slice(1, 38) + '…' };
  }

  const NFe = { parse, custos, classificar, conteudo, limparNome, REGRAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = NFe; else raiz.NFe = NFe;
})(typeof window !== 'undefined' ? window : globalThis);
