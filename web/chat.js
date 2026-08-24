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

  function toggleChat() {
    drawer = criarDrawer();
    isOpen = drawer.classList.contains('open');
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
        const curClientId = window.activeClientId || (window.clientOfCanvas ? window.clientOfCanvas(window.activeCanvasId) : 'cafe-vendas');
        const baseId = isCenario ? window.currentCanvasDerivadoDe.canvasId : window.activeCanvasId;
        const res = await Audasys.api.criarCenario(curClientId, baseId, {
          premissa,
          postura,
          nome: `Simulação: ${premissa}`,
        });

        const novoCenario = res.canvas;

        // Se houver nós no cenário, aplicamos alterações estruturais coerentes com a hipótese
        if (novoCenario.nodes && novoCenario.nodes.length > 0) {
          const nodesCopy = JSON.parse(JSON.stringify(novoCenario.nodes));
          const connsCopy = JSON.parse(JSON.stringify(novoCenario.connections));

          // Resolvemos gargalos existentes
          nodesCopy.forEach((n) => {
            if (n.bottleneck) {
              n.bottleneck = '';
              n.bottleneckCategory = '';
              n.bottleneckCategories = [];
            }
          });

          // Se a hipótese for rota/terceirização/divisão
          if (texto.toLowerCase().includes('rota') || texto.toLowerCase().includes('sul') || texto.toLowerCase().includes('terceiriz')) {
            const lastNode = nodesCopy[nodesCopy.length - 1];
            const maxId = Math.max(...nodesCopy.map((n) => parseInt(n.id.replace(/\D/g, '')) || 0), 10);
            const newNodeId = `node_${maxId + 1}`;
            nodesCopy.push({
              id: newNodeId,
              type: 'action',
              name: 'Expedição Terceirizada (Rota Sul)',
              owner: 'Operador Logístico Parceiro',
              tools: 'TMS Integrado',
              area: 'geral',
              x: (lastNode?.x || 500) - 100,
              y: (lastNode?.y || 200) + 120,
            });
            if (lastNode) {
              connsCopy.push({
                id: `conn_sim_${Date.now()}`,
                from: newNodeId,
                to: lastNode.id,
                label: 'Entrega confirmada',
              });
            }
          } else if (postura === 'exploratorio') {
            // Benchmark / Robô / IA
            nodesCopy.forEach((n) => {
              if (n.type === 'action') {
                n.tools = (n.tools ? n.tools + ', ' : '') + 'Automação IA / Robótica';
              }
            });
          }

          // Salvamos o cenário transformado
          await fetch(`/api/clients/${curClientId}/canvases/${novoCenario.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'If-Match': String(novoCenario.rev) },
            body: JSON.stringify({ nodes: nodesCopy, connections: connsCopy }),
          });
        }

        // Buscamos o comparativo estrutural
        let diffResumo = '';
        try {
          const compData = await Audasys.api.compararCenario(curClientId, novoCenario.id);
          const est = compData.comparacao.estrutura;
          diffResumo = `
            <div style="margin: 10px 0; padding: 10px 12px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; font-size: 12px;">
              <div style="font-weight:700; color:#cbd5e1; margin-bottom:4px;"><i class="fa-solid fa-chart-simple"></i> Impacto Estrutural Calculado:</div>
              <div>• <strong>Passos:</strong> ${est.passos.base} → ${est.passos.cenario} (${est.passos.delta >= 0 ? '+' : ''}${est.passos.delta})</div>
              <div>• <strong>Handoffs:</strong> ${est.handoffs.base} → ${est.handoffs.cenario} (${est.handoffs.delta >= 0 ? '+' : ''}${est.handoffs.delta})</div>
              <div>• <strong>Gargalos:</strong> ${est.gargalos.base} → ${est.gargalos.cenario} (${est.gargalos.delta >= 0 ? '+' : ''}${est.gargalos.delta})</div>
            </div>`;
        } catch (e) {
          console.warn('Comparativo simplificado no chat indisponível:', e);
        }

        const htmlResposta = `
          <strong>🎯 Simulação Gerada [Postura: ${postura.toUpperCase()}]:</strong>
          <br><br>
          Criamos o cenário <em>"${escapeHtml(novoCenario.name)}"</em> derivado da operação real.
          <br><br>
          <strong>Premissa testada:</strong> "${escapeHtml(premissa)}"
          ${diffResumo}
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="arb-btn primary" data-chat-abrir-cenario="${novoCenario.id}"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir Cenário</button>
            <button class="arb-btn" data-chat-comparar-cenario="${novoCenario.id}"><i class="fa-solid fa-code-compare"></i> Comparar Detalhes</button>
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
