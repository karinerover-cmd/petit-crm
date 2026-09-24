// ═══════════ PROGRESSO DAS METAS (Fase 14) ═══════════
// Barra de progresso guiada pela meta Realista, com a Mínima e a Desafio como marcos na mesma barra, e o
// progresso da semana. Todos os números vêm prontos das views progresso_mensal e progresso_semanal — aqui só se desenha.
// Aparece num card no topo do Dashboard (mês e semana corrente) e no painel de Indicadores (mês escolhido).
// Depende de window.__gestao.sb() (camada_supabase.js).
(function () {
  const $ = id => document.getElementById(id);
  const sb = () => window.__gestao && window.__gestao.sb();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = n => (n == null || isNaN(n)) ? '—' : (Number(n) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%';
  const d10 = s => String(s || '').slice(0, 10);
  const dataBR = d => d10(d).split('-').reverse().slice(0, 2).join('/');
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mesTxt = m => { const [y, mm] = d10(m).split('-'); return MESES[Number(mm) - 1] + '/' + y; };

  async function ler(view, filtro) {
    const cli = sb(); if (!cli) return null;
    const { data, error } = await cli.from(view).select('*').range(0, 999);
    if (error) return null;                               // Fase 14 ainda não rodada: o card simplesmente não aparece
    return (data || []).filter(filtro);
  }

  // posição (0–100%) de um valor na barra: a barra vai de 0 até "escala_barra" vezes a Realista
  const pos = (r, escala) => Math.max(0, Math.min(100, Number(r) / Number(escala) * 100)).toFixed(1) + '%';

  function barraMes(pm) {
    if (!pm) return '';
    const e = pm.escala_barra || 1, cor = pm.atingiu_realista ? '#2e7d32' : 'var(--pink)';
    // Realista embaixo da barra; Mínima e Desafio em cima (assim não se sobrepõem nem em tela de celular).
    // Rótulo perto de uma ponta da barra se alinha para dentro, em vez de centralizar e vazar para fora.
    const marco = (r, rotulo, valor, feito, emCima) => {
      if (r == null) return '';
      const p = Number(r) / Number(e), alinha = p > 0.85 ? 'translateX(-100%)' : p < 0.15 ? 'none' : 'translateX(-50%)';
      return `<div title="${rotulo}: ${brl(valor)}" style="position:absolute;left:${pos(r, e)};top:-4px;bottom:-4px;width:2px;background:#555"></div>
      <div style="position:absolute;left:${pos(r, e)};${emCima ? 'bottom:20px' : 'top:20px'};transform:${alinha};font-size:11px;line-height:1.25;white-space:nowrap;color:${feito ? '#2e7d32' : '#555'}">${rotulo}${feito ? ' ✓' : ''}<br><b>${brl(valor)}</b></div>`;
    };
    const temCima = pm.marco_minima != null || pm.marco_desafio != null;
    const niveis = [pm.meta_minima != null ? `Mínima ${pct(pm.pct_minima)}` : '', `Realista ${pct(pm.pct_realista)}`, pm.meta_desafio != null ? `Desafio ${pct(pm.pct_desafio)}` : ''].filter(Boolean).join(' · ');
    return `<div style="position:relative;height:14px;border-radius:7px;background:#EFE7E2;margin:${temCima ? 40 : 10}px 0 44px">
        <div style="height:100%;border-radius:7px;background:${cor};width:${pos(pm.pct_realista, e)}"></div>
        ${marco(pm.marco_minima, 'Mínima', pm.meta_minima, pm.atingiu_minima, true)}
        ${marco(1, 'Realista', pm.meta_realista, pm.atingiu_realista, false)}
        ${marco(pm.marco_desafio, 'Desafio', pm.meta_desafio, pm.atingiu_desafio, true)}
      </div>
      <div style="font-size:13px"><b>${brl(pm.faturamento)}</b> de ${brl(pm.meta_realista)} (${pct(pm.pct_realista)} da realista) <span class="td-muted">· ${niveis}</span></div>
      <div class="td-muted" style="font-size:12px;margin-top:4px">${pm.atingiu_realista ? 'Meta realista batida! 🎉'
        : pm.dias_restantes > 0 ? `Faltam ${brl(pm.falta_realista)} em ${pm.dias_restantes} dia(s) — <b>${brl(pm.ritmo_diario_realista)}/dia</b> para bater a realista.`
        : `O mês fechou ${brl(pm.falta_realista)} abaixo da realista.`}</div>`;
  }

  function barraSemana(ps) {
    if (!ps || ps.meta_semanal == null) return '';
    const cheio = Number(ps.pct_semana) >= 1;
    return `<div style="margin-top:14px;font-size:13px"><b>Semana ${dataBR(ps.semana_inicio)} a ${dataBR(ps.semana_fim)}</b></div>
      <div style="height:10px;border-radius:5px;background:#EFE7E2;margin:6px 0"><div style="height:100%;border-radius:5px;background:${cheio ? '#2e7d32' : '#993556'};width:${pos(ps.pct_semana, 1)}"></div></div>
      <div style="font-size:13px">${brl(ps.faturamento)} de ${brl(ps.meta_semanal)} (${pct(ps.pct_semana)})${cheio ? ' — meta da semana batida ✓' : ` <span class="td-muted">· faltam ${brl(ps.falta_semana)}</span>`}
      ${ps.meta_completa ? '' : '<span class="td-muted"> · parte da semana cai num mês sem meta</span>'}</div>`;
  }

  async function cardDashboard() {
    const alvo = $('sec-dashboard'); if (!alvo || !sb()) return;
    const [mes, sem] = await Promise.all([ler('progresso_mensal', r => r.mes_corrente), ler('progresso_semanal', r => r.semana_corrente)]);
    let card = $('dash-progresso');
    if (mes === null) { if (card) card.remove(); return; }
    if (!card) {
      card = document.createElement('div'); card.id = 'dash-progresso'; card.className = 'card';
      card.style.cssText = 'margin-bottom:18px;padding:16px 18px';
      const ref = $('conf-supabase') || $('dash-stats'); ref.parentNode.insertBefore(card, ref);
    }
    const pm = mes[0];
    card.innerHTML = `<div style="font-weight:600">🎯 Meta de ${mesTxt(pm ? pm.mes : new Date().toISOString())}</div>`
      + (pm ? barraMes(pm) + barraSemana(sem && sem[0]) : '<div class="td-muted" style="margin-top:6px">Sem meta para este mês — cadastre em Indicadores → 🎯 Metas.</div>');
  }

  // painel de Indicadores: barra do mês escolhido
  async function noElemento(id, mes) {
    const el = $(id); if (!el) return;
    const r = await ler('progresso_mensal', x => d10(x.mes) === d10(mes));
    if (!r || !r.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="table-card" style="padding:16px;margin-bottom:12px"><b>Progresso da meta — ${mesTxt(mes)}</b>${barraMes(r[0])}</div>`;
  }

  window.PetitProgresso = { dashboard: cardDashboard, mes: noElemento };
  const g0 = window.goTo;
  window.goTo = function (sec) { g0(sec); if (sec === 'dashboard') cardDashboard().catch(() => {}); };
})();
