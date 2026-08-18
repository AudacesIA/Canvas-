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
      : `<button class="op-cenario-btn" data-simular-op="${op.id}" title="Simular cenário operacional E Se"><i class="fa-solid fa-bolt"></i> Simular Cenário</button>`;

    el.innerHTML = `
      <div class="op-card-header">
        <span class="op-postura-badge" style="color:${postura.cor};background:${postura.bg}"><i class="fa-solid ${postura.icon}"></i> ${postura.label}</span>
        <span class="op-status-badge" style="color:${status.cor}">${status.label}</span>
      </div>
      <div class="op-card-titulo">${escapeHtml(op.titulo)}</div>
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
    if (!arrastando.moveu && Math.hypot(dx, dy) * zoom < 4) return;
    arrastando.moveu = true;

    arrastando.op.x = Math.round(arrastando.base.x + dx);
    arrastando.op.y = Math.round(arrastando.base.y + dy);
    arrastando.el.style.left = `${arrastando.op.x}px`;
    arrastando.el.style.top = `${arrastando.op.y}px`;
    redesenharSetas(arrastando.op.arestaId);
  });

  document.addEventListener('pointerup', () => {
    if (!arrastando) return;
    const { op, el, moveu } = arrastando;
    el.classList.remove('op-arrastando');
    arrastando = null;
    if (moveu) saveToLocalStorage();
    else abrirNotepad(op);
  });

  // ── Interação ──────────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
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

    const btnVerCenario = e.target.closest('[data-abrir-cenario]');
    if (btnVerCenario) {
      e.stopPropagation();
      const cenarioId = btnVerCenario.dataset.abrirCenario;
      if (window.openCanvas) window.openCanvas(cenarioId);
      return;
    }
  });

  /**
   * Modal de Criação / Simulação de Cenário "E Se" a partir de uma Oportunidade.
   */
  function abrirModalCriarCenario(op) {
    document.getElementById('simular-cenario-modal')?.remove();

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
          <p class="modal-subtitle">Materializa esta oportunidade de receita em um fluxo de processo alternativo comparável.</p>
        </div>
        <div class="modal-body" style="padding: 16px 0;">
          <div class="panel-section">
            <label for="sc-premissa">Premissa do Cenário (A frase-guia):</label>
            <input type="text" id="sc-premissa" value="${escapeHtml(op.titulo)}" placeholder="Ex: Terceirizar logística Sul com base em MG" style="width:100%;margin-top:6px;padding:8px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;">
          </div>
          <div class="panel-section" style="margin-top:14px;">
            <label for="sc-postura">Postura da Simulação:</label>
            <select id="sc-postura" style="width:100%;margin-top:6px;padding:8px 12px;background:rgba(15,23,42,0.9);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;">
              <option value="realista" ${op.posturaSugerida === 'realista' ? 'selected' : ''}>🟦 Realista — Ajustes em rotina e capacidade atual</option>
              <option value="otimista" ${op.posturaSugerida === 'otimista' ? 'selected' : ''}>🟩 Otimista — Eliminação direta de gargalos e handoffs</option>
              <option value="pessimista" ${op.posturaSugerida === 'pessimista' ? 'selected' : ''}>🟨 Pessimista — Restrição severa de custo ou fornecedor</option>
              <option value="exploratorio" ${op.posturaSugerida === 'exploratorio' ? 'selected' : ''}>🟪 Exploratória — Benchmarks distantes / Automação de ponta (Braço Robótico)</option>
            </select>
          </div>
          <div class="panel-section" style="margin-top:14px;">
            <label for="sc-nome">Nome do Canvas Derivado (Opcional):</label>
            <input type="text" id="sc-nome" placeholder="Cenário: ${escapeHtml(op.titulo)}" style="width:100%;margin-top:6px;padding:8px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;border-top:1px solid rgba(255,255,255,0.08);padding-top:14px;">
          <button class="header-btn" data-fechar-modal>Cancelar</button>
          <button class="audit-btn" id="btn-executar-criacao-cenario" style="margin:0;"><span class="audit-btn-inner"><i class="fa-solid fa-wand-magic-sparkles"></i> Criar e Abrir Cenário</span></button>
        </div>
      </div>`;

    document.body.appendChild(modal);

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

        const btn = modal.querySelector('#btn-executar-criacao-cenario');
        btn.disabled = true;
        btn.innerHTML = '<span class="audit-btn-inner"><i class="fa-solid fa-spinner fa-spin"></i> Criando Cenário...</span>';

        try {
          const { canvas: cenario } = await Audasys.api.criarCenario(activeClientId, activeCanvasId, {
            nome,
            premissa,
            postura,
            oportunidadeId: op.id,
          });

          op.cenarioId = cenario.id;
          op.status = 'simulado';
          op.posturaSugerida = postura;
          saveToLocalStorage();
          renderTodos();

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

  function abrirLista() {
    document.getElementById('op-lista-overlay')?.remove();
    const nome = new Map(nodes.map((n) => [n.id, n.name]));
    const ondeFica = (id) => {
      const c = connections.find((x) => x.id === id);
      return c ? `${nome.get(c.from) ?? '?'} → ${nome.get(c.to) ?? '?'}` : 'passagem removida';
    };

    const ov = document.createElement('div');
    ov.id = 'op-lista-overlay';
    ov.className = 'esc-overlay';
    ov.innerHTML = `
      <div class="qd-box">
        <div class="esc-head">
          <div><b>Hub de Oportunidades & Hipóteses</b>
            <div class="agd-sub">${oportunidades.length} oportunidade(s) mapeada(s)</div></div>
          <button class="agd-close" data-fechar-lista>✕</button>
        </div>
        <div class="op-lista">${oportunidades.map((o) => {
          const postura = POSTURA_LABELS[o.posturaSugerida || 'realista'] || POSTURA_LABELS.realista;
          const status = STATUS_LABELS[o.status || 'ideia'] || STATUS_LABELS.ideia;
          const cenarioBadge = o.cenarioId
            ? `<span class="op-status-badge" style="background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid #2563eb;padding:2px 8px;border-radius:4px;"><i class="fa-solid fa-diagram-project"></i> Cenário Ativo</span>`
            : '';
          return `
          <div class="op-lista-item" data-abrir-op="${o.id}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span class="op-postura-badge" style="color:${postura.cor};background:${postura.bg}"><i class="fa-solid ${postura.icon}"></i> ${postura.label}</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <span class="op-status-badge" style="color:${status.cor}">${status.label}</span>
                ${cenarioBadge}
              </div>
            </div>
            <div class="op-card-titulo">${escapeHtml(o.titulo)}</div>
            <div class="op-lista-onde">${escapeHtml(ondeFica(o.arestaId))}</div>
            <div class="markdown-body op-lista-corpo">${AudasysMarkdown.render(o.markdown || '_sem anotação_')}</div>
          </div>`;
        }).join('') || '<div class="qd-vazia">Nada mapeado ainda. Clique numa passagem do processo e use "Mapear oportunidade de receita".</div>'}
        </div>
      </div>`;
    document.body.appendChild(ov);

    ov.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar-lista]') || e.target === ov) return ov.remove();
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
    abrirLista();
  }

  document.getElementById('btn-oportunidades')?.addEventListener('click', toggleLista);

  window.AudasysOportunidades = { renderTodos, novaNaAresta, abrirNotepad, abrirLista, toggleLista, abrirModalCriarCenario };
})();
