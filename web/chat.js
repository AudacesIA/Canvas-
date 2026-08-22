/**
 * MERLIN IA — Motor Multi-Agentes de Simulação & Consultoria Estratégica.
 */
(function () {
  'use strict';

  let drawer = null;
  let isOpen = false;

  function criarDrawer() {
    if (document.getElementById('chat-drawer')) return document.getElementById('chat-drawer');

    const el = document.createElement('div');
    el.id = 'chat-drawer';
    el.className = 'chat-drawer';
    el.innerHTML = `
      <div class="chat-header">
        <div class="chat-title">
          <i class="fa-solid fa-wand-magic-sparkles" style="color:#60a5fa;"></i>
          <span>MERLIN IA</span>
          <span style="font-size:10px; font-weight:700; color:#60a5fa; background:rgba(59,130,246,0.15); padding:2px 6px; border-radius:4px;">MULTI-AGENTES</span>
        </div>
        <button class="agd-close" id="btn-close-chat">✕</button>
      </div>

      <div class="chat-messages" id="chat-messages-container">
        <!-- Mensagem de boas-vindas -->
        <div class="chat-bubble agent">
          <div class="markdown-body">
            Olá, consultor! Sou o <strong>Merlin</strong>, seu motor multi-agentes de simulação estratégica.
            <br><br>
            Ao propor uma hipótese <strong>"E Se"</strong>, acionarei uma banca especializada de agentes:
            <ul style="margin:6px 0 0 16px; font-size:11.5px; line-height:1.5;">
              <li>⚙️ <strong>Engenheiro Lean:</strong> Mapeia desperdícios e tempos.</li>
              <li>📐 <strong>Arquiteto MCP:</strong> Redesenha o fluxo e nós.</li>
              <li>🛡️ <strong>Red Teamer:</strong> Procura falhas, riscos e SLAs.</li>
              <li>📊 <strong>Financeiro:</strong> Calcula Score de Viabilidade e ROI.</li>
              <li>🏆 <strong>Sintetizador:</strong> Gera o Dossiê Executivo em Markdown.</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="chat-quick-actions">
        <button class="chat-quick-btn" data-action="rota"><i class="fa-solid fa-truck"></i> Simular Hub 3PL</button>
        <button class="chat-quick-btn" data-action="handoffs"><i class="fa-solid fa-arrows-split-up-and-left"></i> Cortar Handoffs</button>
        <button class="chat-quick-btn" data-action="robo"><i class="fa-solid fa-robot"></i> Automação IA / Robótica</button>
        <button class="chat-quick-btn" data-action="comparar"><i class="fa-solid fa-code-compare"></i> Comparar Cenário</button>
      </div>

      <div class="chat-input-container">
        <textarea id="chat-input-text" class="chat-textarea" placeholder="Ex: E se descentralizarmos o estoque com operadores 3PL no Nordeste e Sul?"></textarea>
        <button id="btn-send-chat" class="chat-send-btn" title="Simular com Banca Merlin"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    `;

    document.body.appendChild(el);
    setupEvents(el);
    return el;
  }

  function setupEvents(el) {
    el.querySelector('#btn-close-chat').onclick = toggleChat;

    const input = el.querySelector('#chat-input-text');
    const sendBtn = el.querySelector('#btn-send-chat');

    const enviar = () => {
      const texto = input.value.trim();
      if (!texto) return;
      input.value = '';
      input.style.height = 'auto';
      processarMensagemUsuario(texto);
    };

    sendBtn.onclick = enviar;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviar();
      }
    });

    el.querySelector('.chat-quick-actions').addEventListener('click', (e) => {
      const btn = e.target.closest('.chat-quick-btn');
      if (!btn) return;

      if (btn.classList.contains('op-chip')) {
        const title = btn.dataset.opTitle;
        const desc = btn.dataset.opDesc;
        input.value = `Simular cenário para a oportunidade: "${title}". Premissa: ${desc || title}`;
        enviar();
        return;
      }

      const act = btn.dataset.action;
      if (act === 'rota') {
        input.value = 'E se terceirizarmos o frete com centros de distribuição 3PL regionais?';
        enviar();
      } else if (act === 'handoffs') {
        input.value = 'Identifique os gargalos de handoff manual e simule a desburocratização das transferências.';
        enviar();
      } else if (act === 'robo') {
        input.value = 'Simule um cenário exploratório substituindo o armazenamento e separação manual por automação de ponta.';
        enviar();
      } else if (act === 'comparar') {
        if (window.AudasysComparador && activeCanvasId) {
          window.AudasysComparador.abrirModalComparador(activeClientId, activeCanvasId);
        }
      }
    });

    el.querySelector('#chat-messages-container').addEventListener('click', (e) => {
      const btnAbrir = e.target.closest('[data-chat-abrir-cenario]');
      if (btnAbrir) {
        const id = btnAbrir.dataset.chatAbrirCenario;
        if (window.openCanvas) window.openCanvas(id);
        return;
      }
      const btnComp = e.target.closest('[data-chat-comparar-cenario]');
      if (btnComp) {
        const id = btnComp.dataset.chatCompararCenario;
        if (window.AudasysComparador) window.AudasysComparador.abrirModalComparador(window.activeClientId, id);
        return;
      }
    });
  }

  function atualizarChipsOportunidades(drw) {
    const quickEl = drw.querySelector('.chat-quick-actions');
    if (!quickEl) return;
    const ops = (window.oportunidades || []);
    if (ops.length === 0) {
      quickEl.innerHTML = `
        <button class="chat-quick-btn" data-action="rota"><i class="fa-solid fa-truck"></i> Simular Hub 3PL</button>
        <button class="chat-quick-btn" data-action="handoffs"><i class="fa-solid fa-arrows-split-up-and-left"></i> Cortar Handoffs</button>
        <button class="chat-quick-btn" data-action="robo"><i class="fa-solid fa-robot"></i> Automação IA / Robótica</button>
      `;
      return;
    }

    quickEl.innerHTML = `
      <div style="width:100%; font-size:10.5px; font-weight:700; color:#94a3b8; margin-bottom:4px; text-transform:uppercase; display:flex; align-items:center; gap:5px;">
        <i class="fa-solid fa-asterisk" style="color:#60a5fa;"></i> Oportunidades Mapeadas no Processo:
      </div>
      ${ops.map(o => `
        <button class="chat-quick-btn op-chip" data-op-title="${escapeHtml(o.titulo)}" data-op-desc="${escapeHtml(o.descricao || '')}" title="Simular cenário a partir desta oportunidade">
          <i class="fa-solid fa-bolt" style="color:#fbbf24;"></i> ${escapeHtml(o.titulo.slice(0, 35))}${o.titulo.length > 35 ? '...' : ''}
        </button>
      `).join('')}
    `;
  }

  function toggleChat() {
    drawer = criarDrawer();
    isOpen = drawer.classList.contains('open');
    if (isOpen) {
      drawer.classList.remove('open');
    } else {
      window.OverlayManager?.closeAll('chat');
      atualizarChipsOportunidades(drawer);
      drawer.classList.add('open');
      setTimeout(() => drawer.querySelector('#chat-input-text')?.focus(), 200);
    }
  }

  function appendMessage(role, htmlContent) {
    drawer = criarDrawer();
    const container = drawer.querySelector('#chat-messages-container');
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.innerHTML = `<div class="markdown-body">${htmlContent}</div>`;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  }

  async function processarMensagemUsuario(texto) {
    appendMessage('user', escapeHtml(texto));

    appendMessage('agent', `
      <div style="display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-spinner fa-spin" style="color:#60a5fa;"></i>
        <span><strong>Merlin:</strong> Acionando banca multi-agentes para simular hipótese...</span>
      </div>
    `);

    const isCenario = !!(window.currentCanvasDerivadoDe);
    const premissa = texto.length > 60 ? texto.slice(0, 60) + '...' : texto;

    let postura = 'realista';
    if (texto.toLowerCase().includes('robô') || texto.toLowerCase().includes('robo') || texto.toLowerCase().includes('ia') || texto.toLowerCase().includes('visão')) {
      postura = 'exploratorio';
    } else if (texto.toLowerCase().includes('otimista') || texto.toLowerCase().includes('eliminar tudo')) {
      postura = 'otimista';
    } else if (texto.toLowerCase().includes('pessimista') || texto.toLowerCase().includes('custo alto') || texto.toLowerCase().includes('risco')) {
      postura = 'pessimista';
    }

    try {
      const curClientId = window.activeClientId || (window.clientOfCanvas ? window.clientOfCanvas(window.activeCanvasId) : 'techwear-brasil');
      const baseId = isCenario ? window.currentCanvasDerivadoDe.canvasId : window.activeCanvasId;

      const res = await Audasys.api.simularMerlin(curClientId, baseId, {
        premissa,
        postura,
      });

      const container = drawer.querySelector('#chat-messages-container');
      container.lastElementChild?.remove(); // remove spinner

      const cenario = res.cenario;
      const score = res.scoreViabilidade || 85;
      const selo = res.seloRecomendacao || 'QUICK WIN';
      const logs = res.logsDeliberacao || [];

      let logsHtml = '';
      if (logs.length > 0) {
        logsHtml = `
          <div style="margin: 8px 0; padding: 8px; background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; font-size: 11px;">
            <div style="font-weight:700; color:#94a3b8; margin-bottom:4px; text-transform:uppercase; font-size:10px;">
              <i class="fa-solid fa-users-gear" style="color:#60a5fa;"></i> Deliberação da Banca Merlin:
            </div>
            ${logs.map(l => `
              <div style="margin-bottom:3px; color:#cbd5e1;">
                <strong style="color:#60a5fa;">[${escapeHtml(l.agente)}]:</strong> ${escapeHtml(l.acao)}
              </div>
            `).join('')}
          </div>
        `;
      }

      const respostaHtml = `
        <div style="margin-bottom:6px;">
          <strong>🎯 Cenário Simulado com Sucesso!</strong><br>
          <span style="font-size:11.5px; color:#94a3b8;">Premissa: "${escapeHtml(premissa)}" [${postura.toUpperCase()}]</span>
        </div>
        ${logsHtml}
        <div style="display:flex; align-items:center; gap:8px; margin: 8px 0;">
          <span style="font-size:11px; font-weight:800; color:#38bdf8; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.3); padding:3px 8px; border-radius:5px;">
            <i class="fa-solid fa-chart-line"></i> SCORE: ${score}/100
          </span>
          <span style="font-size:11px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); padding:3px 8px; border-radius:5px;">
            <i class="fa-solid fa-check-double"></i> ${escapeHtml(selo)}
          </span>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <button class="chat-quick-btn highlight-btn" data-chat-abrir-cenario="${cenario.id}" style="background:#2563eb; color:#fff; border-color:#3b82f6;">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir Cenário no Canvas
          </button>
          <button class="chat-quick-btn" data-chat-comparar-cenario="${cenario.id}">
            <i class="fa-solid fa-code-compare"></i> Comparar Dossiê
          </button>
        </div>
      `;

      appendMessage('agent', respostaHtml);

      // Atualiza badge de cenários no topo
      if (window.Audasys?.api && activeClientId && activeCanvasId) {
        window.Audasys.api.listarCenarios(activeClientId, activeCanvasId).then(({ cenarios }) => {
          const badgeCount = document.getElementById('cenarios-count-badge');
          if (badgeCount) {
            badgeCount.textContent = cenarios.length;
            badgeCount.style.display = cenarios.length > 0 ? 'inline-block' : 'none';
          }
        }).catch(() => {});
      }
    } catch (err) {
      const container = drawer.querySelector('#chat-messages-container');
      container.lastElementChild?.remove();
      appendMessage('agent', `❌ <strong style="color:#ef4444;">Erro ao acionar a banca Merlin:</strong> ${escapeHtml(err.message || 'Falha na deliberação multi-agentes.')}`);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  window.AudasysChat = {
    toggleChat,
    processarMensagemUsuario,
  };
})();
