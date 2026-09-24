// Leitor de números no formato brasileiro, usado por todas as telas das Fases 6–10.
//   "1.234,56" → 1234.56   "7.200" → 7200   "7.200,00" → 7200   "0,035" → 0.035   "R$ 36,90" → 36.9
//   "1234.50" / "0.25" / "1.5" → decimal com ponto (como o banco e os campos numéricos do navegador devolvem)
// Regra: com vírgula, os pontos são de milhar. Sem vírgula, só é milhar o formato 1.234 / 12.345.678 (grupos de 3,
// sem começar por zero); qualquer outro ponto é decimal. Os campos preenchidos pelo app mostram vírgula (petitFmt),
// então um "1.055" só aparece se a pessoa digitar — e aí é mil e cinquenta e cinco, como se escreve no Brasil.
(function (raiz) {
  function petitNumero(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v == null ? '' : v).replace(/R\$|\s| /g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    const n = parseFloat(s); return isNaN(n) ? null : n;
  }
  function petitFmt(n) { return n == null || n === '' ? '' : String(n).replace('.', ','); }
  raiz.petitNumero = petitNumero; raiz.petitFmt = petitFmt;
  if (typeof module !== 'undefined' && module.exports) module.exports = { petitNumero, petitFmt };
})(typeof window !== 'undefined' ? window : globalThis);
