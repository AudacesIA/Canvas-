/**
 * Modal de Comparação Executiva Baseado em Markdown & Estrutura (As-Is vs To-Be).
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
      <div class="modal-content" style="max-width: 860px; max-height: 90vh; display:flex; flex-direction:column;">
        <button class="close-modal-btn" data-fechar-comp>&times;</button>
        <div class="modal-header" style="flex-shrink:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div class="modal-title-glow" style="color:var(--accent-glow); font-size:16px;">
              <i class="fa-solid fa-code-compare"></i> COMPARAÇÃO EXECUTIVA (MARKDOWN & ESTRUTURA)
            </div>
            <div id="comp-selo-recomendacao"></div>
          </div>
          <p class="modal-subtitle" id="comp-subtitulo" style="margin-top:6px;">Carregando análise comparativa de processos...</p>

          <!-- Abas de Navegação -->
          <div class="comp-nav-tabs" style="display:flex; gap:8px; margin-top:14px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:2px;">
            <button class="comp-tab-btn active" data-tab="pros-cons"><i class="fa-solid fa-trophy"></i> Parecer & Prós e Contras</button>
            <button class="comp-tab-btn" data-tab="diff"><i class="fa-solid fa-arrows-split-up-and-left"></i> Diff Passo a Passo</button>
            <button class="comp-tab-btn" data-tab="markdowns"><i class="fa-solid fa-file-lines"></i> Arquivos Markdown (.md)</button>
          </div>
        </div>
        
        <div class="modal-body" id="comp-body" style="flex:1; overflow-y:auto; padding: 16px 0;">
          <div style="text-align:center; padding: 40px; color:#94a3b8;">
            <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
            <p style="margin-top:12px;">Sintetizando arquivos Markdown e calculando prós e contras...</p>
          </div>
        </div>

        <div class="modal-footer" style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <span style="font-size:11px; color:#64748b;">* Análise comparativa baseada na fonte da verdade dos arquivos Markdown.</span>
          <div style="display:flex; gap:10px;">
            <button class="header-btn highlight-btn" id="btn-copiar-relatorio-comp"><i class="fa-solid fa-copy"></i> Copiar Dossiê Executivo (.md)</button>
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
      const data = await Audasys.api.compararCenario(effClientId, effCenarioId);
      const { comparacao, texto, analiseMarkdown } = data;
      const est = comparacao.estrutura;
      const postura = POSTURA_LABELS[comparacao.postura || 'realista'] || POSTURA_LABELS.realista;
      const analise = analiseMarkdown || {};

      // Subtítulo e Selo de Recomendação
      overlay.querySelector('#comp-subtitulo').innerHTML = `
        Premissa: <strong>"${escapeHtml(comparacao.premissa || 'Sem premissa')}"</strong> 
        <span class="op-postura-badge" style="color:${postura.cor};background:${postura.bg};margin-left:8px;"><i class="fa-solid ${postura.icon}"></i> ${postura.label}</span>`;

      overlay.querySelector('#comp-selo-recomendacao').innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:11px; font-weight:800; color:#38bdf8; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); padding:4px 10px; border-radius:6px;">
            <i class="fa-solid fa-chart-line"></i> VIABILIDADE: ${analise.scoreViabilidade || 85}/100
          </span>
          <span style="font-size:11px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); padding:4px 10px; border-radius:6px; text-transform:uppercase;">
            <i class="fa-solid fa-check-double"></i> ${escapeHtml(analise.seloRecomendacao || 'QUICK WIN')}
          </span>
        </div>`;

      // ── ABA 1: Prós & Contras ──────────────────────────────────────────────
      const renderAbaProsCons = () => `
        <div class="comp-grid-summary">
          <div class="comp-metric-card neutral">
            <div class="val">${est.passos.base} → ${est.passos.cenario} (${deltaFormat(est.passos.delta)})</div>
            <div class="lbl">Total de Passos</div>
          </div>
          <div class="comp-metric-card ${est.handoffs.delta < 0 ? 'good' : est.handoffs.delta > 0 ? 'warning' : 'neutral'}">
            <div class="val">${est.handoffs.base} → ${est.handoffs.cenario} (${deltaFormat(est.handoffs.delta)})</div>
            <div class="lbl">Passagens de Bastão</div>
          </div>
          <div class="comp-metric-card ${est.gargalos.delta < 0 ? 'good' : est.gargalos.delta > 0 ? 'warning' : 'neutral'}">
            <div class="val">${est.gargalos.base} → ${est.gargalos.cenario} (${deltaFormat(est.gargalos.delta)})</div>
            <div class="lbl">Gargalos Totais</div>
          </div>
          <div class="comp-metric-card ${est.malhasAbertas.delta < 0 ? 'good' : 'neutral'}">
            <div class="val">${est.malhasAbertas.base} → ${est.malhasAbertas.cenario} (${deltaFormat(est.malhasAbertas.delta)})</div>
            <div class="lbl">Sem Dono / Soltos</div>
          </div>
        </div>

        <!-- STICKY NOTE EXECUTIVO AZUL (MARKDOWN IA) -->
        <div class="comp-sticky-note-azul" style="margin: 16px 0; background: linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,58,138,0.35)); border: 1.5px solid rgba(59,130,246,0.45); border-radius: 12px; padding: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(59,130,246,0.2); position:relative;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(59,130,246,0.3); padding-bottom:10px; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-note-sticky" style="color:#60a5fa; font-size:16px;"></i>
              <span style="font-weight:700; color:#93c5fd; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">Sticky Note de Comparação (Real vs Cenário)</span>
              <span style="font-size:10px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,0.15); padding:2px 6px; border-radius:4px;">GERADO POR IA</span>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="header-btn" id="btn-fixar-sticky-canvas" style="background:#2563eb; color:#fff; border-color:#3b82f6; font-size:11.5px; padding:4px 10px;" title="Fixar este sticky note azul diretamente no Canvas"><i class="fa-solid fa-thumbtack"></i> Fixar no Canvas</button>
              <button class="header-btn" id="btn-copiar-sticky-md" style="font-size:11.5px; padding:4px 10px;" title="Copiar texto do sticky note"><i class="fa-solid fa-copy"></i> Copiar</button>
            </div>
          </div>

          <div style="font-family: 'DM Sans', sans-serif; font-size:12.5px; line-height:1.6; color:#cbd5e1; max-height:280px; overflow-y:auto; padding-right:6px;">
            <div style="margin-bottom:8px; font-weight:700; color:#60a5fa; font-size:13px;">
              📌 Parecer Estratégico da Consultoria:
            </div>
            <p style="margin-bottom:12px; color:#e2e8f0;">${escapeHtml(analise.parecerConsultoria || 'Otimização com destravamento de gargalos e redução de despesas fixas.')}</p>
            
            <div style="margin-bottom:6px; font-weight:700; color:#34d399; font-size:12.5px;">
              💪 Principais Pontos Fortes (Ganhos):
            </div>
            <ul style="margin:0 0 12px 18px; padding:0;">
              ${(analise.pontosPositivos || []).map(p => `<li style="margin-bottom:4px;"><strong style="color:#f8fafc;">${escapeHtml(p.titulo)}:</strong> ${escapeHtml(p.detalhe)}</li>`).join('')}
            </ul>

            <div style="margin-bottom:6px; font-weight:700; color:#fbbf24; font-size:12.5px;">
              ⚠️ Principais Pontos Fracos & Riscos de Transição:
            </div>
            <ul style="margin:0 0 12px 18px; padding:0;">
              ${(analise.pontosNegativos || []).map(p => `<li style="margin-bottom:4px;"><strong style="color:#f8fafc;">${escapeHtml(p.titulo)}:</strong> ${escapeHtml(p.detalhe)}</li>`).join('')}
            </ul>

            <div style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); font-size:11.5px; color:#94a3b8; display:flex; justify-content:space-between; align-items:center;">
              <span><strong>Score de Viabilidade:</strong> <span style="color:#38bdf8; font-weight:800;">${analise.scoreViabilidade || 85}/100</span></span>
              <span style="color:#10b981; font-weight:700;">${escapeHtml(analise.seloRecomendacao || 'QUICK WIN')}</span>
            </div>
          </div>
        </div>

        <!-- Grid Prós vs Contras Detalhado -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin-top: 16px;">
          <!-- Coluna Verde: Ganhos -->
          <div style="background: rgba(16,185,129,0.04); border: 1px solid rgba(16,185,129,0.2); border-radius: 10px; padding: 14px;">
            <div style="font-weight:700; color:#34d399; font-size:13px; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
              <i class="fa-solid fa-circle-check"></i> PONTOS POSITIVOS & GANHOS
            </div>
            ${(analise.pontosPositivos || []).map(p => `
              <div style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="font-weight:600; color:#f8fafc; font-size:12.5px;">• ${escapeHtml(p.titulo)}</div>
                <div style="font-size:11.5px; color:#94a3b8; margin-top:2px; line-height:1.4;">${escapeHtml(p.detalhe)}</div>
              </div>`).join('')}
          </div>

          <!-- Coluna Âmbar/Vermelha: Riscos -->
          <div style="background: rgba(245,158,11,0.04); border: 1px solid rgba(245,158,11,0.2); border-radius: 10px; padding: 14px;">
            <div style="font-weight:700; color:#fbbf24; font-size:13px; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
              <i class="fa-solid fa-triangle-exclamation"></i> RISCOS & TRADE-OFFS
            </div>
            ${(analise.pontosNegativos || []).map(p => `
              <div style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="font-weight:600; color:#f8fafc; font-size:12.5px;">• ${escapeHtml(p.titulo)}</div>
                <div style="font-size:11.5px; color:#94a3b8; margin-top:2px; line-height:1.4;">${escapeHtml(p.detalhe)}</div>
              </div>`).join('')}
          </div>
        </div>
      `;

      // ── ABA 2: Diff Passo a Passo ──────────────────────────────────────────
      const renderAbaDiff = () => {
        let diffPassosHtml = '<div style="color:#94a3b8; font-size:13px; padding:12px;">Nenhum passo adicionado ou removido. Apenas regras e atributos foram ajustados.</div>';
        if (comparacao.passos.removidos.length || comparacao.passos.novos.length) {
          diffPassosHtml = `
            <table class="comp-diff-table" style="margin-top:10px;">
              <thead>
                <tr><th>Status</th><th>Nome da Etapa</th></tr>
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
            <div class="comp-section-title" style="margin-top:20px;"><i class="fa-solid fa-recycle"></i> Desperdícios Lean por Categoria</div>
            <table class="comp-diff-table" style="margin-top:10px;">
              <thead>
                <tr><th>Categoria</th><th>Processo Atual</th><th>Cenário Simulado</th><th>Variação</th></tr>
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

        return `
          <div class="comp-section-title"><i class="fa-solid fa-arrows-split-up-and-left"></i> Modificações Estruturais de Etapas</div>
          ${diffPassosHtml}
          ${leanHtml}
        `;
      };

      // ── ABA 3: Documentos Markdown ────────────────────────────────────────
      const renderAbaMarkdowns = () => `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="font-weight:700; font-size:12.5px; color:#cbd5e1;"><i class="fa-solid fa-file-lines"></i> Processo Real (As-Is.md)</span>
              <button class="arb-btn" id="btn-copiar-md-base" style="font-size:11px; padding:3px 8px;"><i class="fa-solid fa-copy"></i> Copiar</button>
            </div>
            <pre style="background:#090d16; border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px; font-size:11.5px; color:#94a3b8; max-height:360px; overflow-y:auto; white-space:pre-wrap;">${escapeHtml(analise.markdownBase || 'Markdown As-Is indisponível')}</pre>
          </div>
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="font-weight:700; font-size:12.5px; color:#60a5fa;"><i class="fa-solid fa-file-lines"></i> Cenário Simulado (To-Be.md)</span>
              <button class="arb-btn" id="btn-copiar-md-cenario" style="font-size:11px; padding:3px 8px;"><i class="fa-solid fa-copy"></i> Copiar</button>
            </div>
            <pre style="background:#090d16; border:1px solid rgba(59,130,246,0.2); border-radius:8px; padding:12px; font-size:11.5px; color:#bfdbfe; max-height:360px; overflow-y:auto; white-space:pre-wrap;">${escapeHtml(analise.markdownCenario || 'Markdown To-Be indisponível')}</pre>
          </div>
        </div>
      `;

      // Controle de Abas e Eventos
      const bodyEl = overlay.querySelector('#comp-body');
      
      const vincularEventosAbaProsCons = () => {
        bodyEl.querySelector('#btn-copiar-sticky-md')?.addEventListener('click', () => {
          const textoSticky = [
            `# 📋 COMPARAÇÃO REAL vs CENÁRIO`,
            `> **Premissa:** "${comparacao.premissa || 'Otimização'}" [${(comparacao.postura || 'realista').toUpperCase()}]`,
            `> **Score de Viabilidade:** ${analise.scoreViabilidade || 85}/100 [${analise.seloRecomendacao || 'QUICK WIN'}]`,
            '',
            `## 🏆 PARECER DA CONSULTORIA`,
            analise.parecerConsultoria || 'Otimização operacional.',
            '',
            `## 💪 PONTOS FORTES (GANHOS)`,
            ...(analise.pontosPositivos || []).map(p => `- **${p.titulo}:** ${p.detalhe}`),
            '',
            `## ⚠️ PONTOS FRACOS & RISCOS DE TRANSIÇÃO`,
            ...(analise.pontosNegativos || []).map(p => `- **${p.titulo}:** ${p.detalhe}`),
          ].join('\n');
          navigator.clipboard.writeText(textoSticky);
          alert('Markdown do Sticky Note copiado com sucesso!');
        });

        bodyEl.querySelector('#btn-fixar-sticky-canvas')?.addEventListener('click', () => {
          const textoSticky = [
            `# 📋 COMPARAÇÃO REAL vs CENÁRIO`,
            `> **Premissa:** "${comparacao.premissa || 'Otimização'}" [${(comparacao.postura || 'realista').toUpperCase()}]`,
            `> **Score:** ${analise.scoreViabilidade || 85}/100 [${analise.seloRecomendacao || 'QUICK WIN'}]`,
            '',
            `## 🏆 PARECER`,
            analise.parecerConsultoria || 'Otimização operacional.',
            '',
            `## 💪 PONTOS FORTES`,
            ...(analise.pontosPositivos || []).map(p => `- **${p.titulo}:** ${p.detalhe}`),
            '',
            `## ⚠️ PONTOS FRACOS & RISCOS`,
            ...(analise.pontosNegativos || []).map(p => `- **${p.titulo}:** ${p.detalhe}`),
          ].join('\n');

          if (window.createNote) {
            const vp = document.getElementById('canvas-viewport');
            const rect = vp ? vp.getBoundingClientRect() : { width: 800, height: 600 };
            const zoom = window.zoom || 1.0;
            const pan = window.panOffset || { x: 100, y: 100 };
            const x = (rect.width / 2 - pan.x) / zoom - 100;
            const y = (rect.height / 2 - pan.y) / zoom - 100;
            window.createNote(x, y, { text: textoSticky, color: 'blue' });
            overlay.remove();
          }
        });
      };

      bodyEl.innerHTML = renderAbaProsCons();
      vincularEventosAbaProsCons();

      overlay.querySelectorAll('.comp-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.querySelectorAll('.comp-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const tab = btn.dataset.tab;
          if (tab === 'pros-cons') {
            bodyEl.innerHTML = renderAbaProsCons();
            vincularEventosAbaProsCons();
          } else if (tab === 'diff') {
            bodyEl.innerHTML = renderAbaDiff();
          } else if (tab === 'markdowns') {
            bodyEl.innerHTML = renderAbaMarkdowns();
            bodyEl.querySelector('#btn-copiar-md-base')?.addEventListener('click', () => {
              navigator.clipboard.writeText(analise.markdownBase || '');
              alert('Markdown do Processo Original copiado!');
            });
            bodyEl.querySelector('#btn-copiar-md-cenario')?.addEventListener('click', () => {
              navigator.clipboard.writeText(analise.markdownCenario || '');
              alert('Markdown do Cenário Simulado copiado!');
            });
          }
        });
      });

      // Botão Copiar Relatório Executivo Geral
      overlay.querySelector('#btn-copiar-relatorio-comp').onclick = () => {
        const fullReport = analise.relatorioExecutivo || texto;
        navigator.clipboard.writeText(fullReport);
        alert('Dossiê Executivo completo (.md) copiado com sucesso para a área de transferência!');
      };
    } catch (err) {
      overlay.querySelector('#comp-body').innerHTML = `
        <div style="padding: 24px; color:#f87171; text-align:center;">
          <i class="fa-solid fa-triangle-exclamation fa-2x"></i>
          <p style="margin-top:12px;">Falha ao carregar comparativo de markdown: ${escapeHtml(err.message)}</p>
        </div>`;
    }
  }

  async function abrirListaCenarios(clientId, baseCanvasId) {
    document.getElementById('cenarios-lista-overlay')?.remove();

    const effClientId = (clientId && clientId !== 'undefined') ? clientId : (window.activeClientId || (window.clientOfCanvas ? window.clientOfCanvas(baseCanvasId) : null));
    const effBaseId = (baseCanvasId && baseCanvasId !== 'undefined') ? baseCanvasId : window.activeCanvasId;

    if (!effClientId || !effBaseId) {
      alert('Não foi possível identificar o cliente ou processo base.');
      return;
    }

    const ov = document.createElement('div');
    ov.id = 'cenarios-lista-overlay';
    ov.className = 'esc-overlay';
    ov.innerHTML = `
      <div class="qd-box" style="max-width:620px;">
        <div class="esc-head">
          <div>
            <b><i class="fa-solid fa-code-branch"></i> Cenários & Simulações "E Se"</b>
            <div class="agd-sub">Hipóteses operacionais derivadas do processo real</div>
          </div>
          <button class="agd-close" data-fechar-cenarios>✕</button>
        </div>
        <div class="op-lista-corpo" id="cenarios-lista-conteudo" style="max-height:60vh; overflow-y:auto; padding:16px;">
          <div style="text-align:center; padding:20px; color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Carregando cenários...</div>
        </div>
        <div class="esc-foot" style="padding:12px 16px; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
          <button class="header-btn" data-fechar-cenarios>Fechar</button>
          <button class="header-btn highlight-btn" id="btn-novo-cenario-modal"><i class="fa-solid fa-plus"></i> Novo Cenário</button>
        </div>
      </div>`;

    document.body.appendChild(ov);

    ov.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar-cenarios]') || e.target === ov) return ov.remove();
      const card = e.target.closest('[data-abrir-cenario]');
      if (card) {
        const id = card.dataset.abrirCenario;
        ov.remove();
        if (window.openCanvas) window.openCanvas(id);
      }
    });

    ov.querySelector('#btn-novo-cenario-modal').onclick = () => {
      ov.remove();
      if (window.AudasysOportunidades?.abrirModalCriarCenario) {
        window.AudasysOportunidades.abrirModalCriarCenario(null, effBaseId);
      }
    };

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
