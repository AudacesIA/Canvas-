/**
 * Copilot de Simulação Operacional e Chat da Consultoria Audaces.
 */
(function () {
  'use strict';

  let drawer = null;
  let isOpen = false;
  const messages = [];

  function criarDrawer() {
    if (document.getElementById('chat-drawer')) return document.getElementById('chat-drawer');

    const el = document.createElement('div');
    el.id = 'chat-drawer';
    el.className = 'chat-drawer';
    el.innerHTML = `
      <div class="chat-header">
        <div class="chat-title">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          <span>AUDACES COPILOT</span>
          <span style="font-size:10px; font-weight:700; color:#60a5fa; background:rgba(59,130,246,0.15); padding:2px 6px; border-radius:4px;">SIMULAÇÃO</span>
        </div>
        <button class="agd-close" id="btn-close-chat">✕</button>
      </div>

      <div class="chat-messages" id="chat-messages-container">
        <!-- Mensagem de boas-vindas -->
        <div class="chat-bubble agent">
          <div class="markdown-body">
            Olá, consultor! Estou pronto para simular cenários operacionais <strong>"E Se"</strong> a partir do mapeamento deste canvas.
            <br><br>
            Você pode pedir para criar um cenário alternativo, avaliar rotas, eliminar passagens manuais ou simular benchmarks externos.
          </div>
        </div>
      </div>

      <div class="chat-quick-actions">
        <button class="chat-quick-btn" data-action="rota">⚡ Rota Alternativa</button>
        <button class="chat-quick-btn" data-action="handoffs">🤝 Eliminar Handoffs</button>
        <button class="chat-quick-btn" data-action="robo">🤖 Braço Robótico / Automação</button>
        <button class="chat-quick-btn" data-action="comparar">📊 Comparar Cenário</button>
      </div>

      <div class="chat-input-container">
        <textarea id="chat-input-text" class="chat-textarea" placeholder="Ex: E se dividirmos a frota entre BA e Sul terceirizado?"></textarea>
        <button id="btn-send-chat" class="chat-send-btn"><i class="fa-solid fa-paper-plane"></i></button>
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
      const act = btn.dataset.action;
      if (act === 'rota') {
        input.value = 'Como a operação ficaria se criássemos uma rota alternativa dividindo a frota entre BA e Sul terceirizado?';
        enviar();
      } else if (act === 'handoffs') {
        input.value = 'Identifique os principais gargalos de handoff e simule a eliminação das transferências manuais.';
        enviar();
      } else if (act === 'robo') {
        input.value = 'Simule um cenário exploratório de benchmark internacional substituindo o manuseio manual por automação de ponta.';
        enviar();
      } else if (act === 'comparar') {
        if (window.AudasysComparador && activeCanvasId) {
          window.AudasysComparador.abrirModalComparador(activeClientId, activeCanvasId);
        }
      }
    });
  }

  function toggleChat() {
    drawer = criarDrawer();
    isOpen = !isOpen;
    drawer.classList.toggle('open', isOpen);
    if (isOpen) {
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

    appendMessage('agent', `<i class="fa-solid fa-spinner fa-spin"></i> Analisando estrutura do canvas e simulando hipótese...`);

    // Pequeno delay para processar simulação interativa
    setTimeout(async () => {
      const container = drawer.querySelector('#chat-messages-container');
      container.lastElementChild?.remove(); // remove spinner

      const isCenario = !!(window.currentCanvasDerivadoDe);
      const premissa = texto.length > 50 ? texto.slice(0, 50) + '...' : texto;

      let postura = 'realista';
      if (texto.toLowerCase().includes('robô') || texto.toLowerCase().includes('robo') || texto.toLowerCase().includes('ia') || texto.toLowerCase().includes('japão')) {
        postura = 'exploratorio';
      } else if (texto.toLowerCase().includes('otimista') || texto.toLowerCase().includes('eliminar tudo')) {
        postura = 'otimista';
      } else if (texto.toLowerCase().includes('pessimista') || texto.toLowerCase().includes('custo alto')) {
        postura = 'pessimista';
      }

      try {
        const baseId = isCenario ? window.currentCanvasDerivadoDe.canvasId : activeCanvasId;
        const res = await Audasys.api.criarCenario(activeClientId, baseId, {
          premissa,
          postura,
          nome: `Simulação: ${premissa}`,
        });

        const novoCenario = res.canvas;

        const htmlResposta = `
          <strong>🎯 Simulação Gerada [Postura: ${postura.toUpperCase()}]:</strong>
          <br><br>
          Criamos o cenário <em>"${escapeHtml(novoCenario.name)}"</em> derivado da operação real.
          <br><br>
          <strong>Premissa testada:</strong> "${escapeHtml(premissa)}"
          <br><br>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="arb-btn primary" onclick="window.openCanvas('${novoCenario.id}')"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir Cenário</button>
            <button class="arb-btn" onclick="window.AudasysComparador.abrirModalComparador('${activeClientId}', '${novoCenario.id}')"><i class="fa-solid fa-code-compare"></i> Comparar Impacto</button>
          </div>
        `;
        appendMessage('agent', htmlResposta);
      } catch (err) {
        appendMessage('agent', `Falha ao processar simulação: ${escapeHtml(err.message)}`);
      }
    }, 600);
  }

  document.getElementById('btn-chat-toggle')?.addEventListener('click', toggleChat);

  window.AudasysChat = { toggleChat, processarMensagemUsuario };
})();
