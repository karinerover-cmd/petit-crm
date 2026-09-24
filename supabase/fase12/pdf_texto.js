// Extrator mínimo de texto de PDF, sem dependências. Entende as fontes Type0/Identity-H com ToUnicode que os bancos usam
// (Chrome/Skia, PDFium, openhtmltopdf), texto em hexadecimal ou literal, páginas na ordem de leitura. Uso: node pdf_texto.js arquivo.pdf
const fs = require('fs'), zlib = require('zlib');
const b = fs.readFileSync(process.argv[2]), s = b.toString('latin1');
const objs = {};
for (const m of s.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) objs[m[1]] = m[2];
const streamDe = n => { const o = objs[n]; if (!o) return ''; const i = o.indexOf('stream'); if (i < 0) return '';
  let ini = i + 6; if (o[ini] === '\r') ini++; if (o[ini] === '\n') ini++; const fim = o.lastIndexOf('endstream');
  const raw = Buffer.from(o.slice(ini, fim), 'latin1'); try { return zlib.inflateSync(raw).toString('latin1'); } catch { return raw.toString('latin1'); } };
const hexStr = h => { let out = ''; for (let i = 0; i + 3 < h.length + 1; i += 4) out += String.fromCodePoint(parseInt(h.substr(i, 4), 16)); return out; };
function cmap(txt) {
  const map = {};
  for (const bl of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of bl[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map[parseInt(m[1], 16)] = hexStr(m[2]);
  for (const bl of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of bl[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
    const a = parseInt(m[1], 16), z = parseInt(m[2], 16), base = parseInt(m[3], 16); for (let c = a; c <= z; c++) map[c] = String.fromCodePoint(base + c - a); }
  return map;
}
// string literal do PDF (com escapes \n \( \) \\ \ddd) → hexadecimal dos bytes
function literalHex(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let ch = s.charCodeAt(i);
    if (s[i] === '\\') {
      const n = s[++i];
      if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]; ch = parseInt(o, 8); }
      else if (n === '\r' || n === '\n') { if (n === '\r' && s[i + 1] === '\n') i++; continue; }
      else ch = ({ n: 10, r: 13, t: 9, b: 8, f: 12 })[n] ?? n.charCodeAt(0);
    }
    bytes.push(ch & 255);
  }
  return bytes.map(x => x.toString(16).padStart(2, '0')).join('');
}
// fontes: nome do recurso -> cmap
const fontes = {};
for (const [n, o] of Object.entries(objs)) {
  if (!/\/Type\s*\/Font/.test(o) || !/\/ToUnicode\s+(\d+)/.test(o)) continue;
  fontes[n] = cmap(streamDe(o.match(/\/ToUnicode\s+(\d+)/)[1]));
}
const linhas = [];
// páginas na ordem de leitura (árvore /Pages → /Kids), não na ordem interna dos objetos
const ordem = [];
const visitar = n => { const o = objs[n] || ''; if (/\/Type\s*\/Pages/.test(o)) { for (const k of ((o.match(/\/Kids\s*\[([^\]]*)\]/) || [])[1] || '').matchAll(/(\d+) 0 R/g)) visitar(k[1]); } else if (/\/Type\s*\/Page[^s]/.test(o)) ordem.push(n); };
const raiz = Object.keys(objs).find(n => /\/Type\s*\/Catalog/.test(objs[n]));
if (raiz) visitar((objs[raiz].match(/\/Pages\s+(\d+)/) || [])[1]);
if (!ordem.length) for (const n of Object.keys(objs)) if (/\/Type\s*\/Page[^s]/.test(objs[n])) ordem.push(n);
for (const n of ordem) {
  const o = objs[n];
  // dicionário de fontes: direto na página, em /Resources indireto, e/ou em /Font indireto
  const dicFontes = txt => { const d = (txt.match(/\/Font\s*<<([^>]*)>>/) || [])[1]; if (d) return d; const r = txt.match(/\/Font\s+(\d+) 0 R/); return r ? objs[r[1]] || '' : ''; };
  const res = dicFontes(o) || (() => { const r = o.match(/\/Resources\s+(\d+) 0 R/); return r ? dicFontes(objs[r[1]] || '') : ''; })() || '';
  const nomes = {}; for (const m of res.matchAll(/\/(\w+)\s+(\d+) 0 R/g)) nomes[m[1]] = fontes[m[2]] || {};
  const cont = (o.match(/\/Contents\s+(\d+)/) || [])[1]; const c = streamDe(cont);
  let fonte = {}, y = null, linha = '', itens = [];
  for (const m of c.matchAll(/\/(\w+)\s+[\d.]+\s+Tf|([-\d.]+)\s+([-\d.]+)\s+Td|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm|<([0-9A-Fa-f]+)>\s*Tj|\[((?:\\[\s\S]|[^\]\\])*)\]\s*TJ|\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g)) {
    if (m[1]) fonte = nomes[m[1]] || {};
    else if (m[2] !== undefined) { const dy = Number(m[3]); if (Math.abs(dy) > 2) { itens.push([y, linha]); linha = ''; y = (y || 0) - dy; } }
    else if (m[4] !== undefined) { const ny = Number(m[5]); if (y !== null && Math.abs(ny - y) > 2) { itens.push([y, linha]); linha = ''; } else if (linha) linha += ' | '; y = ny; }
    else {
      // texto em hexadecimal <...> ou literal (...) — os dois viram a mesma sequência de códigos de 2 bytes (Identity-H)
      const pedacos = m[6] !== undefined ? ['<' + m[6] + '>'] : m[8] !== undefined ? ['(' + m[8] + ')'] : (m[7].match(/<[0-9A-Fa-f]+>|\((?:\\[\s\S]|[^\\)])*\)/g) || []);
      const hx = pedacos.map(p => p[0] === '<' ? p.slice(1, -1) : literalHex(p.slice(1, -1))).join('');
      for (let i = 0; i + 3 < hx.length + 1; i += 4) linha += fonte[parseInt(hx.substr(i, 4), 16)] || '';
    }
  }
  if (linha) itens.push([y, linha]);
  const invertida = /1 0 0 -1 [-\d.]+ [-\d.]+ Tm/.test(c);   // Chrome/Skia gravam com o eixo y para baixo
  itens.sort((a, b) => invertida ? a[0] - b[0] : b[0] - a[0]); linhas.push('=== página'); for (const [, l] of itens) linhas.push(l.replace(/\s+/g, ' ').trim());
}
console.log(linhas.filter(Boolean).join('\n'));
