/**
 * Modal de Comparação Visual e Estrutural (As-Is vs To-Be).
 *
 * Apresentação executiva para a Etapa 3 da consultoria Audaces.
 */
(function () {
  'use strict';

  const escapeHtml = window.escapeHtml || ((v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

  const POSTURA_LABELS = {
    realista: { label: 'Realista', cor: '#3b82f6', bg: 'rgba(59,130,246,0.15)', icon: 'fa-scale-balanced' },
    otimista: { label: 'Otimista', cor: '#10b981', bg: 'rgba(16,185,129,0.15)', icon: 'fa-arrow-trend-up' },
    pessimista: { label: 'Pessimista', cor: '#f59e0b', bg: 'rgba(245,158,11,0.15)', icon: 'fa-shield-halved' },
    exploratorio: { label: 'Exploratória', cor: '#a855f7', bg: 'rgba(168,85,247,0.15)', icon: 'fa-rocket' },
  };

  function deltaFormat(d, { inverteCor = false } = {}) {
    if (d === 0) return `<span style="color:#94a3b8">=</span>`;
    const sinal = d > 0 ? `+${d}` : `−${Math.abs(d)}`;
    const isGood = inverteCor ? d > 0 : d < 0;
    const cor = isGood ? '#34d399' : '#f87171';
    return `<span style="color:${cor};font-weight:700;">${sinal}</span>`;
  }

  async function abrirModalComparador(clientId, cenarioId) {
    document.getElementById('comparador-modal')?.remove();

    const effClientId = (clientId && clientId !== 'undefined') ? clientId : (window.activeClientId || (window.clientOfCanvas ? window.clientOfCanvas(cenarioId) : null));
    const effCenarioId = (cenarioId && cenarioId !== 'undefined') ? cenarioId : window.activeCanvasId;

    if (!effClientId || !effCenarioId) {
      alert('Não foi possível identificar o cliente ou o cenário para comparar.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'comparador-modal';
    overlay.className = 'esc-overlay modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 780px; max-height: 90vh; display:flex; flex-direction:column;">
        <button class="close-modal-btn" data-fechar-comp>&times;</button>
        <div class="modal-header" style="flex-shrink:0;">
          <div class="modal-title-glow" style="color:var(--accent-glow); font-size:16px;">
            <i class="fa-solid fa-code-compare"></i> COMPARAÇÃO EXECUTIVA: AS-IS vs CENÁRIO "E SE"
          </div>
          <p class="modal-subtitle" id="comp-subtitulo">Carregando comparativo estrutural...</p>
        </div>
        
        <div class="modal-body" id="comp-body" style="flex:1; overflow-y:auto; padding: 12px 0;">
          <div style="text-align:center; padding: 40px; color:#94a3b8;">
            <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
            <p style="margin-top:12px;">Calculando impacto estrutural do processo...</p>
          </div>
        </div>

        <div class="modal-footer" style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11px; color:#64748b;">* Comparação baseada em dados desenhados e apurados honestamente.</span>
          <div style="display:flex; gap:10px;">
            <button class="header-btn" id="btn-copiar-relatorio-comp"><i class="fa-solid fa-copy"></i> Copiar Relatório</button>
            <button class="header-btn" data-fechar-comp>Fechar</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar-comp]') || e.target === overlay) {
        overlay.remove();
      }
    });

    try {
      const { comparacao, texto } = await Audasys.api.compararCenario(effClientId, effCenarioId);
      const est = comparacao.estrutura;
      const postura = POSTURA_LABELS[comparacao.postura || 'realista'] || POSTURA_LABELS.realista;

      overlay.querySelector('#comp-subtitulo').innerHTML = `
        Premissa: <strong>"${escapeHtml(comparacao.premissa || 'Sem premissa')}"</strong> 
        <span class="op-postura-badge" style="color:${postura.cor};background:${postura.bg};margin-left:8px;"><i class="fa-solid ${postura.icon}"></i> ${postura.label}</span>`;

      let diffPassosHtml = '';
      if (comparacao.passos.removidos.length || comparacao.passos.novos.length) {
        diffPassosHtml = `
          <div class="comp-section-title"><i class="fa-solid fa-arrows-split-up-and-left"></i> Modificações de Etapas</div>
          <table class="comp-diff-table">
            <thead>
              <tr><th>Tipo</th><th>Nome do Passo</th></tr>
            </thead>
            <tbody>
              ${comparacao.passos.removidos.map(p => `<tr><td><span class="comp-tag-del">− REMOVIDO</span></td><td>${escapeHtml(p)}</td></tr>`).join('')}
              ${comparacao.passos.novos.map(p => `<tr><td><span class="comp-tag-add">+ ADICIONADO</span></td><td>${escapeHtml(p)}</td></tr>`).join('')}
            </tbody>
          </table>`;
      }

      let leanHtml = '';
      const leanEntries = Object.entries(comparacao.porCategoriaLean || {});
      if (leanEntries.length) {
        leanHtml = `
          <div class="comp-section-title"><i class="fa-solid fa-recycle"></i> Desperdícios Lean por Categoria</div>
          <table class="comp-diff-table">
            <thead>
              <tr><th>Categoria</th><th>Processo Atual</th><th>Cenário Simulado</th><th>Impacto</th></tr>
            </thead>
            <tbody>
              ${leanEntries.map(([cat, v]) => `
                <tr>
                  <td><strong>${escapeHtml(cat)}</strong></td>
                  <td>${v.antes}</td>
                  <td>${v.depois}</td>
                  <td>${deltaFormat(v.delta)}</td>
                </tr>`).join('')}
            </tbody>
          </table>`;
      }

      overlay.querySelector('#comp-body').innerHTML = `
        <div class="comp-grid-summary">
          <div class="comp-metric-card neutral">
            <div class="val">${est.passos.base} → ${est.passos.cenario} (${deltaFormat(est.passos.delta)})</div>
            <div class="lbl">Total de Passos</div>
          </div>
          <div class="comp-metric-card ${est.handoffs.delta < 0 ? 'good' : est.handoffs.delta > 0 ? 'warning' : 'neutral'}">
            <div class="val">${est.handoffs.base} → ${est.handoffs.cenario} (${deltaFormat(est.handoffs.delta)})</div>
            <div class="lbl">Passagens de Bastão (Handoffs)</div>
          </div>
          <div class="comp-metric-card ${est.gargalos.delta < 0 ? 'good' : est.gargalos.delta > 0 ? 'warning' : 'neutral'}">
            <div class="val">${est.gargalos.base} → ${est.gargalos.cenario} (${deltaFormat(est.gargalos.delta)})</div>
            <div class="lbl">Gargalos Totais</div>
          </div>
          <div class="comp-metric-card ${est.malhasAbertas.delta < 0 ? 'good' : 'neutral'}">
            <div class="val">${est.malhasAbertas.base} → ${est.malhasAbertas.cenario} (${deltaFormat(est.malhasAbertas.delta)})</div>
            <div class="lbl">Malhas Abertas (Sem Dono)</div>
          </div>
        </div>

        ${diffPassosHtml}
        ${leanHtml}
      `;

      overlay.querySelector('#btn-copiar-relatorio-comp').onclick = () => {
        navigator.clipboard.writeText(texto);
        alert('Relatório comparativo em texto copiado para a área de transferência!');
      };
    } catch (err) {
      overlay.querySelector('#comp-body').innerHTML = `
        <div style="padding: 24px; color:#f87171; text-align:center;">
          <i class="fa-solid fa-triangle-exclamation fa-2x"></i>
          <p style="margin-top:12px;">Falha ao carregar comparativo: ${escapeHtml(err.message)}</p>
        </div>`;
    }
  }

  async function abrirListaCenarios(clientId, baseCanvasId) {
    document.getElementById('cenarios-lista-overlay')?.remove();

    const ov = document.createElement('div');
    ov.id = 'cenarios-lista-overlay';
    ov.className = 'esc-overlay';
    ov.innerHTML = `
      <div class="qd-box" style="max-width: 600px;">
        <div class="esc-head">
          <div>
            <b>Cenários e Simulações "E Se"</b>
            <div class="agd-sub">Versões alternativas baseadas no processo real</div>
          </div>
          <button class="agd-close" data-fechar-cenarios>✕</button>
        </div>
        <div class="op-lista" id="cenarios-lista-conteudo">
          <div style="text-align:center; padding: 20px; color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Carregando cenários...</div>
        </div>
        <div style="padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end;">
          <button class="audit-btn" id="btn-novo-cenario-modal" style="margin:0;"><span class="audit-btn-inner"><i class="fa-solid fa-plus"></i> Novo Cenário</span></button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    ov.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar-cenarios]') || e.target === ov) return ov.remove();
      const id = e.target.closest('[data-abrir-cenario]')?.dataset.abrirCenario;
      if (id) {
        ov.remove();
        if (window.openCanvas) window.openCanvas(id);
      }
      if (e.target.closest('#btn-novo-cenario-modal')) {
        ov.remove();
        if (window.AudasysOportunidades?.abrirModalCriarCenario) {
          window.AudasysOportunidades.abrirModalCriarCenario({ id: null, titulo: 'Novo Cenário Alternativo' });
        }
      }
    });

    const effClientId = (clientId && clientId !== 'undefined') ? clientId : (window.activeClientId || (window.clientOfCanvas ? window.clientOfCanvas(baseCanvasId) : null));
    const effBaseId = (baseCanvasId && baseCanvasId !== 'undefined') ? baseCanvasId : window.activeCanvasId;

    try {
      const { cenarios } = await Audasys.api.listarCenarios(effClientId, effBaseId);
      const listaEl = ov.querySelector('#cenarios-lista-conteudo');
      if (!cenarios.length) {
        listaEl.innerHTML = `<div class="qd-vazia">Nenhum cenário desenhado para este processo ainda. Crie um cenário para comparar hipóteses de intervenção.</div>`;
        return;
      }
      listaEl.innerHTML = cenarios.map((c) => {
        const postura = POSTURA_LABELS[c.derivadoDe?.postura || 'realista'] || POSTURA_LABELS.realista;
        return `
          <div class="op-lista-item" data-abrir-cenario="${c.id}" style="border-left-color: ${postura.cor};">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span class="op-postura-badge" style="color:${postura.cor};background:${postura.bg}"><i class="fa-solid ${postura.icon}"></i> ${postura.label}</span>
              <span style="font-size:11px; color:#94a3b8;">${c.nodeCount || 0} passos · ${c.edgeCount || 0} arestas</span>
            </div>
            <div class="op-card-titulo" style="margin-top:6px;">${escapeHtml(c.name)}</div>
            <div class="op-lista-onde" style="color:#cbd5e1;">Premissa: "${escapeHtml(c.derivadoDe?.premissa || '—')}"</div>
          </div>`;
      }).join('');
    } catch (err) {
      ov.querySelector('#cenarios-lista-conteudo').innerHTML = `<div style="color:#f87171;padding:16px;">Erro ao listar cenários: ${escapeHtml(err.message)}</div>`;
    }
  }

  function toggleListaCenarios(clientId, baseCanvasId) {
    const existing = document.getElementById('cenarios-lista-overlay');
    if (existing) {
      existing.remove();
      return;
    }
    window.OverlayManager?.closeAll('cenarios');
    abrirListaCenarios(clientId, baseCanvasId);
  }

  function toggleModalComparador(clientId, cenarioId) {
    const existing = document.getElementById('comparador-modal');
    if (existing) {
      existing.remove();
      return;
    }
    window.OverlayManager?.closeAll('comparador');
    abrirModalComparador(clientId, cenarioId);
  }

  window.AudasysComparador = {
    abrirModalComparador,
    toggleModalComparador,
    abrirListaCenarios,
    toggleListaCenarios,
  };
})();
