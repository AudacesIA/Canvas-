/**
 * Oportunidades de receita e Hub de Hipóteses com Simulação de Cenários.
 *
 * Cada oportunidade é ancorada em uma aresta (passagem de bastão) e pode
 * originar um Cenário "E Se" operacional (Realista, Otimista, Pessimista ou Exploratório).
 */
(function () {
  'use strict';

  const camada = () => document.getElementById('oportunidades-layer') || criar();
  function criar() {
    const el = document.createElement('div');
    el.id = 'oportunidades-layer';
    el.className = 'op-layer';
    document.getElementById('canvas-container').appendChild(el);
    return el;
  }

  /** Arestas abertas no momento. Estado de visualização, não persiste. */
  const abertas = new Set();

  const daAresta = (arestaId) => oportunidades.filter((o) => o.arestaId === arestaId);

  const POSTURA_LABELS = {
    realista: { label: 'Realista', cor: '#3b82f6', bg: 'rgba(59,130,246,0.15)', icon: 'fa-scale-balanced' },
    otimista: { label: 'Otimista', cor: '#10b981', bg: 'rgba(16,185,129,0.15)', icon: 'fa-arrow-trend-up' },
    pessimista: { label: 'Pessimista', cor: '#f59e0b', bg: 'rgba(245,158,11,0.15)', icon: 'fa-shield-halved' },
    exploratorio: { label: 'Exploratória (Benchmark)', cor: '#a855f7', bg: 'rgba(168,85,247,0.15)', icon: 'fa-rocket' },
  };

  const STATUS_LABELS = {
    ideia: { label: 'Ideia', cor: '#94a3b8' },
    simulado: { label: 'Simulado', cor: '#60a5fa' },
    validado: { label: 'Validado', cor: '#34d399' },
    descartado: { label: 'Descartado', cor: '#f87171' },
  };

  function posicaoAsterisco(conn) {
    return window.pontoNaAresta?.(conn, 'oportunidade') ?? null;
  }

  function renderTodos() {
    if (arrastando) return;
    camada().innerHTML = '';
    document.querySelectorAll('.op-seta').forEach((e) => e.remove());

    const porAresta = new Map();
    for (const op of oportunidades) {
      if (!porAresta.has(op.arestaId)) porAresta.set(op.arestaId, []);
      porAresta.get(op.arestaId).push(op);
    }

    for (const [arestaId, lista] of porAresta) {
      const conn = connections.find((c) => c.id === arestaId);
      if (!conn) continue;
      const pos = posicaoAsterisco(conn);
      if (!pos) continue;

      camada().appendChild(marcaAsterisco(arestaId, lista.length, pos));
      if (abertas.has(arestaId)) abrirCards(arestaId, lista, pos);
    }
  }

  function marcaAsterisco(arestaId, quantas, pos) {
    const el = document.createElement('div');
    el.className = `op-asterisco${abertas.has(arestaId) ? ' op-aberto' : ''}`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.dataset.aresta = arestaId;
    el.title = 'Oportunidades de receita nesta passagem';
    el.innerHTML = `<span class="op-glifo">✳</span>`
      + `<span class="op-contador">${quantas} oportunidade${quantas === 1 ? '' : 's'}</span>`;
    return el;
  }

  function posicaoCard(op, origem, i) {
    if (op.x != null && op.y != null) return { x: op.x, y: op.y };
    return { x: origem.x + 70, y: origem.y - 30 + i * 115 };
  }

  function abrirCards(arestaId, lista, origem) {
    lista.forEach((op, i) => {
      const pos = posicaoCard(op, origem, i);
      camada().appendChild(cardOportunidade(op, pos));
    });
    redesenharSetas(arestaId);
  }

  function redesenharSetas(arestaId) {
    document.querySelectorAll(`.op-seta[data-aresta="${arestaId}"]`).forEach((e) => e.remove());
    if (!abertas.has(arestaId)) return;
    const conn = connections.find((c) => c.id === arestaId);
    const origem = posicaoAsterisco(conn);
    if (!origem) return;
    daAresta(arestaId).forEach((op, i) => {
      desenharSeta(arestaId, origem, posicaoCard(op, origem, i));
    });
  }

  function cardOportunidade(op, pos) {
    const el = document.createElement('div');
    el.className = 'op-card';
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.dataset.op = op.id;

    const postura = POSTURA_LABELS[op.posturaSugerida || 'realista'] || POSTURA_LABELS.realista;
    const status = STATUS_LABELS[op.status || 'ideia'] || STATUS_LABELS.ideia;
    const previa = (op.markdown || '').split('\n').filter((l) => l.trim())[0] || 'Sem anotações detalhadas';

    const cenarioBtn = op.cenarioId
      ? `<button class="op-cenario-btn active" data-abrir-cenario="${op.cenarioId}" title="Abrir cenário já simulado"><i class="fa-solid fa-arrow-up-right-from-square"></i> Ver Cenário</button>`
      : `<button class="op-cenario-btn" data-simular-op="${op.id}" title="Simular cenário derivado desta oportunidade"><i class="fa-solid fa-bolt"></i> Simular</button>
         <button class="op-cenario-btn" data-copilot-op="${op.id}" style="background:rgba(96,165,250,0.15);color:#60a5fa;" title="Simular com Copilot IA"><i class="fa-solid fa-wand-magic-sparkles"></i> Copilot</button>`;

    const potReceita = op.potencialReceita
      ? `<div style="font-size:11px; color:#34d399; font-weight:700; margin: 4px 0;"><i class="fa-solid fa-sack-dollar"></i> ${escapeHtml(op.potencialReceita)}</div>`
      : '';

    el.innerHTML = `
      <div class="op-card-header">
        <span class="op-postura-badge" style="color:${postura.cor};background:${postura.bg}"><i class="fa-solid ${postura.icon}"></i> ${postura.label}</span>
        <span class="op-status-badge" style="color:${status.cor}">${status.label}</span>
      </div>
      <div class="op-card-titulo">${escapeHtml(op.titulo)}</div>
      ${potReceita}
      <div class="op-card-previa">${escapeHtml(previa.slice(0, 85))}</div>
      <div class="op-card-actions">
        ${cenarioBtn}
      </div>`;
    return el;
  }

  function desenharSeta(arestaId, de, para) {
    const linha = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    linha.setAttribute('class', 'op-seta');
    linha.setAttribute('data-aresta', arestaId);

    const alvo = { x: para.x - 4, y: para.y + 20 };
    const dx = Math.max(28, Math.abs(alvo.x - de.x) * 0.45);
    const sentido = alvo.x >= de.x ? 1 : -1;
    linha.setAttribute('d',
      `M ${de.x} ${de.y} C ${de.x + dx * sentido} ${de.y}, ${alvo.x - dx * sentido} ${alvo.y}, ${alvo.x} ${alvo.y}`);
    document.getElementById('connections-svg').appendChild(linha);
  }

  // ── Arrasto ────────────────────────────────────────────────────────────────
  let arrastando = null;

  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
    const el = e.target.closest('.op-card');
    if (!el) return;
    const op = oportunidades.find((o) => o.id === el.dataset.op);
    if (!op) return;
    e.stopPropagation();

    arrastando = {
      op, el,
      mouse: { x: e.clientX, y: e.clientY },
      base: { x: parseFloat(el.style.left), y: parseFloat(el.style.top) },
      moveu: false,
    };
    el.setPointerCapture(e.pointerId);
    el.classList.add('op-arrastando');
  });

  document.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    const dx = (e.clientX - arrastando.mouse.x) / zoom;
    const dy = (e.clientY - arrastando.mouse.y) / zoom;
    if (Math.hypot(dx, dy) > 3) arrastando.moveu = true;

    const nx = Math.round(arrastando.base.x + dx);
    const ny = Math.round(arrastando.base.y + dy);
    arrastando.el.style.left = `${nx}px`;
    arrastando.el.style.top = `${ny}px`;
    arrastando.op.x = nx;
    arrastando.op.y = ny;
    redesenharSetas(arrastando.op.arestaId);
  });

  document.addEventListener('pointerup', () => {
    if (!arrastando) return;
    if (arrastando.moveu) saveToLocalStorage();
    arrastando.el.classList.remove('op-arrastando');
    arrastando = null;
  });

  // ── Interação ──────────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.op-card');
    if (card && !e.target.closest('button') && !arrastando?.moveu) {
      const op = oportunidades.find((o) => o.id === card.dataset.op);
      if (op) abrirNotepad(op);
      return;
    }

    const ast = e.target.closest('.op-asterisco');
    if (ast) {
      e.stopPropagation();
      const id = ast.dataset.aresta;
      abertas.has(id) ? abertas.delete(id) : abertas.add(id);
      renderTodos();
      return;
    }

    const btnSimular = e.target.closest('[data-simular-op]');
    if (btnSimular) {
      e.stopPropagation();
      const op = oportunidades.find((o) => o.id === btnSimular.dataset.simularOp);
      if (op) abrirModalCriarCenario(op);
      return;
    }

    const btnCopilot = e.target.closest('[data-copilot-op]');
    if (btnCopilot) {
      e.stopPropagation();
      const op = oportunidades.find((o) => o.id === btnCopilot.dataset.copilotOp);
      if (op && window.AudasysChat) {
        const drawer = document.getElementById('chat-drawer');
        if (!drawer || !drawer.classList.contains('open')) {
          window.AudasysChat.toggleChat();
        }
        window.AudasysChat.processarMensagemUsuario(`Simular cenário para a oportunidade de receita: "${op.titulo}". Premissa: ${op.descricao || op.titulo}`);
      }
      return;
    }

    const btnVerCenario = e.target.closest('[data-abrir-cenario]');
    if (btnVerCenario) {
      e.stopPropagation();
      const cenarioId = btnVerCenario.dataset.abrirCenario;
      if (window.openCanvas) window.openCanvas(cenarioId);
      return;
    }
  });

  /**
   * Modal de Criação / Simulação de Cenário "E Se" a partir de uma Oportunidade ou Processo Real.
   */
  function abrirModalCriarCenario(op = null, baseCanvasId = null) {
    document.getElementById('simular-cenario-modal')?.remove();

    const effCanvasId = baseCanvasId || activeCanvasId || window.activeCanvasId;
    const effClientId = activeClientId || window.activeClientId || (window.clientOfCanvas ? window.clientOfCanvas(effCanvasId) : null);

    const tituloOp = op?.titulo || '';
    const posturaSugerida = op?.posturaSugerida || 'realista';

    const modal = document.createElement('div');
    modal.id = 'simular-cenario-modal';
    modal.className = 'esc-overlay modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 540px;">
        <button class="close-modal-btn" data-fechar-modal>&times;</button>
        <div class="modal-header">
          <div class="modal-title-glow" style="color:var(--accent-glow)">
            <i class="fa-solid fa-bolt"></i> SIMULAR CENÁRIO "E SE"
          </div>
          <p class="modal-subtitle">Deriva uma simulação visual (To-Be) a partir do Mapa de Processos oficial.</p>
        </div>
        <div class="modal-body" style="padding: 16px 0;">
          ${op ? '' : `
          <div class="panel-section" style="margin-bottom:14px;">
            <label for="sc-oportunidade">Oportunidade que este cenário pré-valida:</label>
            <select id="sc-oportunidade" style="width:100%;margin-top:6px;padding:8px 12px;background:rgba(15,23,42,0.9);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;">
              <option value="">Carregando oportunidades...</option>
            </select>
            <p class="modal-subtitle" style="margin-top:6px;font-size:11px;">Todo cenário testa uma oportunidade, e cada oportunidade tem no máximo um cenário.</p>
          </div>`}
          <div class="panel-section">
            <label for="sc-premissa">Premissa do Cenário (A frase-guia):</label>
            <input type="text" id="sc-premissa" value="${escapeHtml(tituloOp)}" placeholder="Ex: Terceirizar logística Sul com operador parceiro" style="width:100%;margin-top:6px;padding:8px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;">
          </div>
          <div class="panel-section" style="margin-top:14px;">
            <label for="sc-postura">Postura da Simulação:</label>
            <select id="sc-postura" style="width:100%;margin-top:6px;padding:8px 12px;background:rgba(15,23,42,0.9);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;">
              <option value="realista" ${posturaSugerida === 'realista' ? 'selected' : ''}>🟦 Realista — Ajustes em rotina e capacidade atual</option>
              <option value="otimista" ${posturaSugerida === 'otimista' ? 'selected' : ''}>🟩 Otimista — Eliminação direta de gargalos e handoffs</option>
              <option value="pessimista" ${posturaSugerida === 'pessimista' ? 'selected' : ''}>🟨 Pessimista — Restrição severa de custo ou fornecedor</option>
              <option value="exploratorio" ${posturaSugerida === 'exploratorio' ? 'selected' : ''}>🟪 Exploratória — Benchmarks distantes / Automação IA de ponta</option>
            </select>
          </div>
          <div class="panel-section" style="margin-top:14px;">
            <label for="sc-nome">Nome do Canvas Derivado (Opcional):</label>
            <input type="text" id="sc-nome" placeholder="Cenário: ${escapeHtml(tituloOp || 'Simulação')}" style="width:100%;margin-top:6px;padding:8px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;border-top:1px solid rgba(255,255,255,0.08);padding-top:14px;">
          <button class="header-btn" data-fechar-modal>Cancelar</button>
          <button class="audit-btn" id="btn-executar-criacao-cenario" style="margin:0;"><span class="audit-btn-inner"><i class="fa-solid fa-wand-magic-sparkles"></i> Criar e Abrir Cenário</span></button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    window.abrirOverlay?.(modal);

    /**
     * Preenche o seletor quando o modal foi aberto SEM oportunidade — o caminho
     * do card da Home e do comparador, que partem do Processo Real.
     *
     * O servidor exige `oportunidadeId` e recusa com 422 sem ele; até aqui esses
     * dois botões mandavam `null` e quebravam. A lista vem do pareamento, não do
     * canvas: é ela que diz quais oportunidades JÁ têm cenário, e a regra é 1:1 —
     * oferecer uma já usada só produziria um 409 depois do clique.
     */
    if (!op) {
      const seletor = modal.querySelector('#sc-oportunidade');
      const btnCriar = modal.querySelector('#btn-executar-criacao-cenario');
      Audasys.api.listarCenarios(effClientId, effCanvasId).then((pareamento) => {
        const livres = pareamento.oportunidades.filter((l) => !l.cenario);
        if (!livres.length) {
          const nenhuma = pareamento.oportunidades.length
            ? 'Todas as oportunidades já têm cenário'
            : 'Nenhuma oportunidade mapeada neste processo';
          seletor.innerHTML = `<option value="">${escapeHtml(nenhuma)}</option>`;
          btnCriar.disabled = true;
          btnCriar.title = `${nenhuma}. Mapeie uma oportunidade numa passagem de bastão para simular um cenário.`;
          return;
        }
        seletor.innerHTML = livres
          .map((l) => `<option value="${escapeHtml(l.oportunidade.id)}">${escapeHtml(l.oportunidade.titulo || l.oportunidade.id)}</option>`)
          .join('');
      }).catch((err) => {
        console.warn('[oportunidades] pareamento indisponível:', err.message);
        seletor.innerHTML = '<option value="">Não foi possível carregar</option>';
        btnCriar.disabled = true;
      });
    }

    modal.addEventListener('click', async (e) => {
      if (e.target.closest('[data-fechar-modal]') || e.target === modal) {
        modal.remove();
        return;
      }
      if (e.target.closest('#btn-executar-criacao-cenario')) {
        const premissa = modal.querySelector('#sc-premissa').value.trim();
        const postura = modal.querySelector('#sc-postura').value;
        const nome = modal.querySelector('#sc-nome').value.trim() || undefined;

        if (!premissa) {
          alert('Por favor, informe a premissa do cenário.');
          return;
        }

        const oportunidadeId = op?.id || modal.querySelector('#sc-oportunidade')?.value || '';
        if (!oportunidadeId) {
          alert('Escolha a oportunidade de receita que este cenário pré-valida.');
          return;
        }

        const btn = modal.querySelector('#btn-executar-criacao-cenario');
        btn.disabled = true;
        btn.innerHTML = '<span class="audit-btn-inner"><i class="fa-solid fa-spinner fa-spin"></i> Criando Cenário...</span>';

        try {
          /**
           * Descarrega o autosave antes de forkar.
           *
           * O fork lê o canvas EM DISCO. Uma oportunidade escrita há menos de
           * 800ms ainda está no debounce, e o servidor recusaria com "não existe
           * oportunidade" — erro que não reproduz testando devagar e acontece
           * na frente do cliente. `flush()` só resolve quando o disco tem o dado.
           */
          await Audasys.persistence.flush();

          const { canvas: cenario } = await Audasys.api.criarCenario(effClientId, effCanvasId, {
            nome,
            premissa,
            postura,
            oportunidadeId,
          });

          if (op) {
            op.cenarioId = cenario.id;
            op.status = 'simulado';
            op.posturaSugerida = postura;
            if (window.saveToLocalStorage) window.saveToLocalStorage();
            renderTodos();
          }

          modal.remove();
          if (window.openCanvas) window.openCanvas(cenario.id);
        } catch (err) {
          alert(`Falha ao criar cenário: ${err.message}`);
          btn.disabled = false;
          btn.innerHTML = '<span class="audit-btn-inner"><i class="fa-solid fa-wand-magic-sparkles"></i> Criar e Abrir Cenário</span>';
        }
      }
    });
  }

  /** O notepad expandido */
  function abrirNotepad(op) {
    if (!op) return;
    document.getElementById('op-notepad')?.remove();

    const postura = op.posturaSugerida || 'realista';
    const status = op.status || 'ideia';

    const box = document.createElement('div');
    box.id = 'op-notepad';
    box.className = 'op-notepad';
    box.innerHTML = `
      <div class="op-np-cabeca">
        <span class="op-glifo">✳</span>
        <input id="op-np-titulo" value="${escapeHtml(op.titulo)}" placeholder="Título da oportunidade">
        <button class="op-np-aba" data-aba="escrever">escrever</button>
        <button class="op-np-aba" data-aba="ler">ler</button>
        <button class="bp-pop-fechar" data-fechar-np>✕</button>
      </div>
      <div class="op-np-meta-bar" style="display:flex;gap:8px;padding:8px 14px;background:rgba(0,0,0,0.2);border-bottom:1px solid rgba(255,255,255,0.06);align-items:center;">
        <span style="font-size:11px;color:#94a3b8;">Postura:</span>
        <select id="op-np-postura" style="font-size:12px;padding:2px 8px;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;">
          <option value="realista" ${postura === 'realista' ? 'selected' : ''}>Realista</option>
          <option value="otimista" ${postura === 'otimista' ? 'selected' : ''}>Otimista</option>
          <option value="pessimista" ${postura === 'pessimista' ? 'selected' : ''}>Pessimista</option>
          <option value="exploratorio" ${postura === 'exploratorio' ? 'selected' : ''}>Exploratória (Benchmark)</option>
        </select>
        <span style="font-size:11px;color:#94a3b8;margin-left:6px;">Status:</span>
        <select id="op-np-status" style="font-size:12px;padding:2px 8px;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:4px;">
          <option value="ideia" ${status === 'ideia' ? 'selected' : ''}>Ideia</option>
          <option value="simulado" ${status === 'simulado' ? 'selected' : ''}>Simulado</option>
          <option value="validado" ${status === 'validado' ? 'selected' : ''}>Validado</option>
          <option value="descartado" ${status === 'descartado' ? 'selected' : ''}>Descartado</option>
        </select>
      </div>
      <textarea id="op-np-texto" placeholder="## Onde está o dinheiro&#10;&#10;79 pedidos/mês com endereço errado.&#10;- ticket médio **R$ 180**">${escapeHtml(op.markdown || '')}</textarea>
      <div id="op-np-previa" class="markdown-body" style="display:none"></div>
      <div class="op-np-pe">
        <button class="arb-btn danger" data-excluir-op>Excluir</button>
        <div style="display:flex;gap:6px;align-items:center;">
          ${op.cenarioId
            ? `<button class="arb-btn" style="background:#2563eb;color:#fff;" data-abrir-cenario="${op.cenarioId}"><i class="fa-solid fa-arrow-up-right-from-square"></i> Ver Cenário</button>`
            : `<button class="arb-btn" style="background:#059669;color:#fff;" data-simular-op="${op.id}"><i class="fa-solid fa-bolt"></i> Simular Cenário</button>`}
          <button class="arb-btn primary" data-salvar-np>Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    box.addEventListener('pointerdown', (e) => e.stopPropagation());

    const texto = box.querySelector('#op-np-texto');
    const previa = box.querySelector('#op-np-previa');
    const abas = box.querySelectorAll('.op-np-aba');
    abas[0].classList.add('ativa');
    texto.focus();

    const salvar = () => {
      op.titulo = box.querySelector('#op-np-titulo').value.trim() || 'Sem título';
      op.posturaSugerida = box.querySelector('#op-np-postura').value;
      op.status = box.querySelector('#op-np-status').value;
      op.markdown = texto.value;
      saveToLocalStorage();
      renderTodos();
    };

    box.addEventListener('click', (e) => {
      const aba = e.target.closest('[data-aba]')?.dataset.aba;
      if (aba) {
        const lendo = aba === 'ler';
        texto.style.display = lendo ? 'none' : '';
        previa.style.display = lendo ? '' : 'none';
        if (lendo) previa.innerHTML = AudasysMarkdown.render(texto.value);
        abas.forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
        return;
      }
      if (e.target.closest('[data-fechar-np]') || e.target.closest('[data-salvar-np]')) {
        salvar();
        box.remove();
        return;
      }
      if (e.target.closest('[data-excluir-op]')) {
        if (!confirm(`Excluir "${op.titulo}"?`)) return;
        const i = oportunidades.findIndex((o) => o.id === op.id);
        if (i !== -1) oportunidades.splice(i, 1);
        box.remove();
        saveToLocalStorage();
        renderTodos();
        return;
      }
      if (e.target.closest('[data-simular-op]')) {
        salvar();
        box.remove();
        abrirModalCriarCenario(op);
        return;
      }
      if (e.target.closest('[data-abrir-cenario]')) {
        salvar();
        box.remove();
        if (window.openCanvas) window.openCanvas(op.cenarioId);
      }
    });
  }

  function novaNaAresta(conn) {
    const nova = {
      id: `op_${Date.now()}_${oportunidades.length}`,
      arestaId: conn.id,
      titulo: 'Oportunidade de receita',
      markdown: '',
      posturaSugerida: 'realista',
      status: 'ideia',
      cenarioId: null,
      criadoEm: new Date().toISOString(),
    };
    oportunidades.push(nova);
    abertas.add(conn.id);
    saveToLocalStorage();
    renderTodos();
    abrirNotepad(nova);
  }

  /**
   * O Hub: uma linha por oportunidade, com o cenário que a pré-valida.
   *
   * ── Por que a contagem não pode divergir ────────────────────────────────────
   * A regra é um cenário por oportunidade. A forma de garantir isso não é somar
   * dos dois lados e comparar — é NÃO EXISTIR um segundo lado. Esta lista itera
   * `oportunidades` e nada mais; o cenário é um campo de cada linha, presente ou
   * ausente. Não há coleção de cenários de onde um número diferente possa sair.
   *
   * O servidor devolve o pareamento já montado (`GET …/cenarios`), resolvido
   * contra os `derivadoDe` reais — então mesmo com o cache `op.cenarioId` sujo, o
   * que aparece na tela é o que existe em disco.
   */
  async function abrirLista() {
    document.getElementById('op-lista-overlay')?.remove();
    const nome = new Map(nodes.map((n) => [n.id, n.name]));
    const ondeFica = (op) => {
      if (op.desancorada || !op.arestaId) return 'perdeu a passagem de origem';
      const c = connections.find((x) => x.id === op.arestaId);
      return c ? `${nome.get(c.from) ?? '?'} → ${nome.get(c.to) ?? '?'}` : 'passagem removida';
    };

    const ov = document.createElement('div');
    ov.id = 'op-lista-overlay';
    ov.className = 'esc-overlay';
    ov.innerHTML = `<div class="qd-box"><div class="qd-vazia">Carregando cenários…</div></div>`;
    document.body.appendChild(ov);

    /**
     * Se o daemon não responder, a lista ainda abre — sem a coluna de cenário.
     * Perder o pareamento é aceitável; perder o acesso ao que já foi escrito na
     * frente do cliente não é.
     */
    let pareamento = null;
    try {
      pareamento = await Audasys.api.listarCenarios(activeClientId, activeCanvasId);
    } catch (err) {
      console.warn('[oportunidades] pareamento indisponível:', err.message);
    }

    const linhas = pareamento
      ? pareamento.oportunidades
      : oportunidades.map((o) => ({ oportunidade: o, cenario: null }));

    const selo = (cenario, op) => {
      if (!pareamento) return '';
      if (cenario) {
        return `<button class="op-selo op-selo-tem" data-abrir-cenario="${cenario.id}"
                  title="Abrir o cenário">cenário: ${escapeHtml(cenario.name)}
                  <span class="op-postura">${escapeHtml(cenario.derivadoDe?.postura ?? '')}</span></button>`;
      }
      return `<button class="op-selo op-selo-falta" data-gerar-cenario="${op.id}"
                title="Desenhar o cenário que testa esta oportunidade">gerar cenário</button>`;
    };

    const cabecalho = pareamento
      ? `${pareamento.total} oportunidade(s) · ${pareamento.comCenario} com cenário`
      : `${oportunidades.length} mapeada(s) neste canvas`;

    const orfaos = pareamento?.orfaos?.length
      ? `<div class="op-orfaos">⚠ ${pareamento.orfaos.length} cenário(s) sem oportunidade correspondente:
           ${pareamento.orfaos.map((c) => escapeHtml(c.name)).join(', ')}. A oportunidade que os
           originou foi apagada — o desenho continua no disco, mas ninguém sabe mais que pergunta
           ele responde.</div>`
      : '';

    ov.innerHTML = `
      <div class="qd-box">
        <div class="esc-head">
          <div><b>Hub de Oportunidades de Receita</b>
            <div class="agd-sub">${cabecalho}</div></div>
          <button class="agd-close" data-fechar-lista>✕</button>
        </div>
        ${orfaos}
        <div class="op-lista">${linhas.map(({ oportunidade: o, cenario }) => {
          const postura = POSTURA_LABELS[o.posturaSugerida || 'realista'] || POSTURA_LABELS.realista;
          const status = STATUS_LABELS[o.status || 'ideia'] || STATUS_LABELS.ideia;
          return `
          <div class="op-lista-item${o.desancorada ? ' op-desancorada' : ''}">
            <div class="op-lista-topo">
              <span class="op-postura-badge" style="color:${postura.cor};background:${postura.bg}"><i class="fa-solid ${postura.icon}"></i> ${postura.label}</span>
              <span class="op-status-badge" style="color:${status.cor}">${status.label}</span>
            </div>
            <div class="op-lista-cabeca">
              <div class="op-card-titulo" data-abrir-op="${o.id}">${escapeHtml(o.titulo)}</div>
              ${selo(cenario, o)}
            </div>
            <div class="op-lista-onde" data-abrir-op="${o.id}">${escapeHtml(ondeFica(o))}</div>
            <div class="markdown-body op-lista-corpo" data-abrir-op="${o.id}">${AudasysMarkdown.render(o.markdown || '_sem anotação_')}</div>
          </div>`;
        }).join('') || '<div class="qd-vazia">Nada mapeado ainda. Clique numa passagem do processo e use "Mapear oportunidade de receita".</div>'}
        </div>
      </div>`;

    ov.addEventListener('click', async (e) => {
      if (e.target.closest('[data-fechar-lista]') || e.target === ov) return ov.remove();

      const cenarioId = e.target.closest('[data-abrir-cenario]')?.dataset.abrirCenario;
      if (cenarioId) { ov.remove(); return openCanvas(cenarioId); }

      const gerar = e.target.closest('[data-gerar-cenario]')?.dataset.gerarCenario;
      if (gerar) {
        const op = oportunidades.find((o) => o.id === gerar);
        if (op) { ov.remove(); abrirModalCriarCenario(op); }
        return;
      }

      const id = e.target.closest('[data-abrir-op]')?.dataset.abrirOp;
      if (!id) return;
      ov.remove();
      abrirNotepad(oportunidades.find((o) => o.id === id));
    });
  }

  function toggleLista() {
    const existing = document.getElementById('op-lista-overlay');
    if (existing) {
      existing.remove();
      return;
    }
    window.OverlayManager?.closeAll('oportunidades');
    abrirLista();
  }

  function limpar() {
    abertas.clear();
    const c = document.getElementById('oportunidades-layer');
    if (c) c.innerHTML = '';
    document.querySelectorAll('.op-seta').forEach((e) => e.remove());
    document.getElementById('op-lista-overlay')?.remove();
    document.getElementById('op-notepad-modal')?.remove();
    document.getElementById('op-cenario-overlay')?.remove();
  }

  document.getElementById('btn-oportunidades')?.addEventListener('click', toggleLista);

  window.AudasysOportunidades = { renderTodos, novaNaAresta, abrirNotepad, abrirLista, toggleLista, abrirModalCriarCenario, limpar };
})();
