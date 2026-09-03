/**
 * Camada de agente no navegador.
 *
 * Carregada depois de `app.js` — depende das primitivas de render dele
 * (`renderNodeDOM`, `updateNodePreviewDetails`, `updateConnections`…), que
 * são bindings de script global.
 *
 * Três responsabilidades:
 *  1. Assinar o SSE do canvas aberto.
 *  2. Segurar patches enquanto o usuário está digitando ou arrastando — um
 *     re-render no meio de uma edição destrói foco, caret e arrasto.
 *  3. Desenhar a proposta como fantasma e oferecer aceitar/rejeitar.
 */
(function () {
  'use strict';

  let source = null;
  let pending = null;          // changeset pendente em revisão
  const queue = [];            // patches adiados

  // ── Fila de patches ────────────────────────────────────────────────────────

  function canApplyNow() {
    return activeNodeId === null
      && draggingConnection === null
      && childContext === null   // dentro de um filho, `nodes` é do filho
      && !isEditingForm()
      && !document.hidden;
  }

  function enqueue(patch) {
    queue.push(patch);
    flushQueue();
  }

  function flushQueue() {
    while (queue.length && canApplyNow()) applyPatch(queue.shift());
    updateQueueBadge();
  }

  function updateQueueBadge() {
    let badge = document.getElementById('agent-queue-badge');
    if (!queue.length) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'agent-queue-badge';
      badge.className = 'agent-queue-badge';
      // Sem este aviso o usuário digita dois minutos e acha que o agente
      // não fez nada.
      badge.onclick = () => { document.activeElement?.blur?.(); deselectAll(); flushQueue(); };
      document.body.appendChild(badge);
    }
    badge.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> ${queue.length} atualização(ões) do agente aguardando`;
  }

  setInterval(flushQueue, 400);
  document.addEventListener('mouseup', () => setTimeout(flushQueue, 50));

  // ── Aplicação incremental ──────────────────────────────────────────────────

  /** Campos cuja mudança exige recriar o card (mudam portas e badges). */
  // `childCanvas` é estrutural: ganhar (ou perder) um subprocesso muda o badge
  // do card, e o badge é a única pista na tela de que existe fluxo ali dentro.
  const STRUCTURAL = ['type', 'switchCases', 'outcomeType', 'waitType', 'switchField', 'childCanvas'];

  /**
   * Rede de segurança contra perda silenciosa de subprocesso.
   *
   * O autosave manda o documento INTEIRO. Se a cópia em memória do navegador
   * estiver com o `childCanvas` desatualizado, o save seguinte apaga do disco os
   * filhos que o agente acabou de criar — sem 409, sem log, sem aviso. Foi
   * exatamente o que aconteceu no teste dos dois subprocessos.
   *
   * Corrigir o `set` no servidor resolve ESTE caso. Isto aqui protege contra o
   * próximo campo que alguém esquecer, relendo a verdade do disco antes que o
   * autosave escreva por cima dela. Só toca `childCanvas`: recarregar o canvas
   * inteiro mexeria na tela embaixo do usuário.
   */
  async function ressincronizarSubprocessos() {
    try {
      const { canvas } = await Audasys.api.getCanvas(activeClientId, activeCanvasId);
      const doDisco = new Map((canvas?.nodes || []).map(n => [n.id, n.childCanvas]));
      for (const node of nodes) {
        const filho = doDisco.get(node.id);
        if (!filho) continue;
        const antes = (node.childCanvas?.nodes || []).length;
        node.childCanvas = filho;
        if (antes !== (filho.nodes || []).length) updateNodePreviewDetails(node);
      }
      window.AudasysExpand?.marcarExpansiveis?.();
    } catch (err) {
      console.warn('Falha ao ressincronizar subprocessos', err);
    }
  }

  function applyPatch(ops) {
    // Fantasmas passam pela mesma fila que os patches reais: os dois mexem no
    // DOM e os dois precisam esperar você largar o teclado.
    if (ops.length === 1 && ops[0].kind === '__ghosts') { renderGhosts(ops[0].changeset); return; }

    let touchedLayout = false;

    for (const op of ops) {
      switch (op.kind) {
        case 'addNode': {
          if (nodes.some(n => n.id === op.node.id)) break;
          const node = hydrateNodeDefaults({ ...op.node });
          nodes.push(node);
          renderNodeDOM(node);
          break;
        }
        case 'updateNode': {
          const idx = nodes.findIndex(n => n.id === op.nodeId);
          if (idx === -1) break;
          const structural = Object.keys(op.set).some(k => STRUCTURAL.includes(k));
          nodes[idx] = hydrateNodeDefaults({ ...nodes[idx], ...op.set });
          const el = document.getElementById(op.nodeId);
          if (structural) {
            el?.remove();
            renderNodeDOM(nodes[idx]);
            touchedLayout = true;
          } else {
            if ('x' in op.set || 'y' in op.set) {
              el.style.left = `${nodes[idx].x}px`;
              el.style.top = `${nodes[idx].y}px`;
              touchedLayout = true;
            }
            if ('name' in op.set) updateNodeDOMTitle(op.nodeId, nodes[idx].name);
            updateNodePreviewDetails(nodes[idx]);
          }
          if (selectedNodeId === op.nodeId && !isEditingForm()) selectNode(op.nodeId);
          break;
        }
        case 'deleteNode': {
          removeNodeSilently(op.nodeId);
          touchedLayout = true;
          break;
        }
        case 'addEdge': {
          if (connections.some(c => c.id === op.edge.id)) break;
          connections.push(op.edge);
          renderConnectionDOM(op.edge);
          touchedLayout = true;
          break;
        }
        case 'removeEdge': {
          removeEdgeSilently(op.edgeId);
          break;
        }
        case 'setLayout': {
          for (const pos of op.positions) {
            const node = nodes.find(n => n.id === pos.nodeId);
            if (!node) continue;
            node.x = pos.x; node.y = pos.y;
            const el = document.getElementById(node.id);
            if (el) { el.style.left = `${pos.x}px`; el.style.top = `${pos.y}px`; }
          }
          touchedLayout = true;
          break;
        }
        // Sem estes três, proposta do agente sobre oportunidade não aparecia na
        // tela — o patch caía no switch sem case e sumia até o F5. Foi o que
        // aconteceu com hipótese e achado durante toda a vida deles.
        case 'addOportunidade': {
          if (!oportunidades.some(o => o.id === op.oportunidade.id)) oportunidades.push(op.oportunidade);
          window.AudasysOportunidades?.renderTodos?.();
          break;
        }
        case 'updateOportunidade': {
          const i = oportunidades.findIndex(o => o.id === op.oportunidade.id);
          if (i !== -1) oportunidades[i] = op.oportunidade;
          window.AudasysOportunidades?.renderTodos?.();
          break;
        }
        case 'removeOportunidade': {
          const i = oportunidades.findIndex(o => o.id === op.oportunidadeId);
          if (i !== -1) oportunidades.splice(i, 1);
          window.AudasysOportunidades?.renderTodos?.();
          break;
        }
        case 'addNote': {
          notes.push(op.note);
          renderNoteDOM(op.note);
          break;
        }
      }
    }

    if (touchedLayout) updateConnections();
    applyAreaFilter();
  }

  /** Remove nó sem confirmação e sem salvar — o save vem uma vez no fim do lote. */
  function removeNodeSilently(nodeId) {
    document.getElementById(nodeId)?.remove();
    for (let i = connections.length - 1; i >= 0; i--) {
      if (connections[i].from === nodeId || connections[i].to === nodeId) {
        removeEdgeSilently(connections[i].id);
      }
    }
    const idx = nodes.findIndex(n => n.id === nodeId);
    if (idx !== -1) nodes.splice(idx, 1);
    if (selectedNodeId === nodeId) deselectAll();
  }

  function removeEdgeSilently(edgeId) {
    document.getElementById(edgeId)?.remove();
    document.getElementById(`label-${edgeId}`)?.remove();
    document.querySelectorAll(`[data-conn="${edgeId}"]`).forEach(el => el.remove());
    const idx = connections.findIndex(c => c.id === edgeId);
    if (idx !== -1) connections.splice(idx, 1);
  }

  // ── Fantasmas da proposta ──────────────────────────────────────────────────

  function renderGhosts(changeset) {
    clearGhosts();
    pending = changeset;

    for (const op of changeset.ops) {
      switch (op.kind) {
        case 'addNode': {
          // O fantasma entra no array e passa pelo render normal: reusa drag,
          // seleção e painel. Você pode até arrastá-lo antes de aceitar.
          const node = hydrateNodeDefaults({ ...op.node, id: op.node.id || `node_prop_${op.opId}` });
          node._pending = 'add';
          node._opId = op.opId;
          nodes.push(node);
          renderNodeDOM(node);
          document.getElementById(node.id)?.classList.add('pending-add');
          break;
        }
        case 'addEdge': {
          const edge = { ...op.edge, id: op.edge.id || `conn_prop_${op.opId}`, _pending: 'add', _opId: op.opId };
          if (!nodes.some(n => n.id === edge.from) || !nodes.some(n => n.id === edge.to)) break;
          connections.push(edge);
          renderConnectionDOM(edge);
          document.getElementById(edge.id)?.classList.add('pending-edge');
          break;
        }
        case 'updateNode': {
          const node = nodes.find(n => n.id === op.nodeId);
          if (!node) break;
          node._proposed = op.set;
          node._opId = op.opId;
          node._conflict = !!op.conflict;
          const el = document.getElementById(op.nodeId);
          el?.classList.add(op.conflict ? 'pending-conflict' : 'pending-update');
          markBadge(el, Object.keys(op.set).length, op.conflict);
          break;
        }
        case 'deleteNode': {
          const node = nodes.find(n => n.id === op.nodeId);
          if (!node) break;
          node._pending = 'delete';
          node._opId = op.opId;
          document.getElementById(op.nodeId)?.classList.add('pending-delete');
          break;
        }
      }
    }

    updateConnections();
    showReviewBar(changeset);
  }

  function markBadge(el, count, conflict) {
    if (!el) return;
    el.querySelector('.pending-badge')?.remove();
    const badge = document.createElement('div');
    badge.className = 'pending-badge' + (conflict ? ' conflict' : '');
    badge.textContent = conflict ? '!' : String(count);
    badge.title = conflict
      ? 'O agente propõe mudar um campo que você editou à mão'
      : `${count} campo(s) sugerido(s) pelo agente`;
    el.appendChild(badge);
  }

  function clearGhosts() {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node._pending === 'add') {
        document.getElementById(node.id)?.remove();
        nodes.splice(i, 1);
        continue;
      }
      delete node._pending; delete node._proposed; delete node._opId; delete node._conflict;
      const el = document.getElementById(node.id);
      el?.classList.remove('pending-add', 'pending-update', 'pending-delete', 'pending-conflict');
      el?.querySelector('.pending-badge')?.remove();
    }
    for (let i = connections.length - 1; i >= 0; i--) {
      if (connections[i]._pending === 'add') {
        removeEdgeSilently(connections[i].id);
      } else {
        delete connections[i]._pending; delete connections[i]._opId;
        document.getElementById(connections[i].id)?.classList.remove('pending-edge');
      }
    }
    document.getElementById('agent-review-bar')?.remove();
    pending = null;
    updateConnections();
  }

  // ── Barra de revisão ───────────────────────────────────────────────────────

  function showReviewBar(changeset) {
    document.getElementById('agent-review-bar')?.remove();

    const counts = { addNode: 0, updateNode: 0, deleteNode: 0, addEdge: 0, conflict: 0 };
    // Ops de subprocesso não têm fantasma no canvas (o filho não está na tela),
    // então a contagem é a ÚNICA pista de que elas existem. Sem isto o consultor
    // aprovava 30 operações invisíveis achando que aprovava 18.
    let subNos = 0;
    let subprocessos = 0;
    for (const op of changeset.ops) {
      if (op.conflict) counts.conflict++;
      if (counts[op.kind] !== undefined) counts[op.kind]++;
      if (op.kind === 'proposeInChild') {
        subprocessos++;
        subNos += (op.ops || []).filter((o) => o.kind === 'addNode').length;
      }
    }

    const parts = [];
    if (counts.addNode) parts.push(`<b>${counts.addNode}</b> novo(s)`);
    if (counts.updateNode) parts.push(`<b>${counts.updateNode}</b> alterado(s)`);
    if (counts.deleteNode) parts.push(`<b>${counts.deleteNode}</b> removido(s)`);
    if (counts.addEdge) parts.push(`<b>${counts.addEdge}</b> conexão(ões)`);
    if (subNos) {
      parts.push(
        `<b>${subNos}</b> nó(s) em <b>${subprocessos}</b> subprocesso(s)` +
        ' <i class="fa-solid fa-circle-info" title="Fica dentro do nó pai — não aparece como prévia no canvas"></i>',
      );
    }
    if (counts.conflict) parts.push(`<b class="conflict-text">${counts.conflict}</b> conflito(s)`);

    const bar = document.createElement('div');
    bar.id = 'agent-review-bar';
    bar.className = 'agent-review-bar';
    bar.innerHTML = `
      <div class="arb-main">
        <div class="arb-title"><i class="fa-solid fa-wand-magic-sparkles"></i> ${escapeHtml(changeset.title)}</div>
        <div class="arb-counts">${parts.join(' · ')}</div>
      </div>
      <div class="arb-actions">
        ${changeset.rationale ? '<button class="arb-btn ghost" data-act="why">Ver o porquê</button>' : ''}
        <button class="arb-btn ghost" data-act="review">Revisar…</button>
        <button class="arb-btn danger" data-act="reject">Rejeitar tudo</button>
        <button class="arb-btn primary" data-act="accept">Aceitar tudo</button>
      </div>`;
    document.body.appendChild(bar);

    bar.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'why') { alert(changeset.rationale); return; }
      if (act === 'review') { openReviewDrawer(changeset); return; }
      // Conflitos já vêm pré-marcados para rejeitar: o que você editou à mão
      // não é sobrescrito por um clique em "Aceitar tudo".
      const reject = act === 'reject'
        ? changeset.ops.map(o => o.opId)
        : changeset.ops.filter(o => o.conflict).map(o => o.opId);
      await resolve(changeset, null, reject);
    });
  }

  function openReviewDrawer(changeset) {
    document.getElementById('agent-drawer')?.remove();
    const rejected = new Set(changeset.ops.filter(o => o.conflict).map(o => o.opId));

    const describe = (op) => {
      const nodeName = (id) => escapeHtml(nodes.find(n => n.id === id)?.name || id);
      switch (op.kind) {
        case 'addNode': return `Criar <b>${escapeHtml(op.node.name || 'nó sem nome')}</b>`;
        case 'updateNode': return `Alterar ${Object.keys(op.set).map(k => `<code>${escapeHtml(k)}</code>`).join(', ')} em <b>${nodeName(op.nodeId)}</b>`;
        case 'deleteNode': return `Remover <b>${nodeName(op.nodeId)}</b>`;
        case 'addEdge': return `Conectar <b>${nodeName(op.edge.from)}</b> → <b>${nodeName(op.edge.to)}</b>`;
        case 'removeEdge': return 'Remover uma conexão';
        case 'attachRef': return `Anexar referência “${escapeHtml(op.ref?.label || '')}” a <b>${nodeName(op.nodeId)}</b>`;
        case 'addOportunidade': return `Mapear oportunidade de receita: "${op.oportunidade?.titulo ?? ''}"`;
        case 'updateOportunidade': return 'Alterar uma oportunidade de receita';
        case 'removeOportunidade': return 'Remover uma oportunidade de receita';
        case 'setLayout': return `Reposicionar ${op.positions.length} nó(s)`;
        default: return op.kind;
      }
    };

    const renderOp = (op) => `
      <div class="agd-op${op.conflict ? ' conflict' : ''}" data-op="${op.opId}">
        <label><input type="checkbox" ${rejected.has(op.opId) ? '' : 'checked'} data-check="${op.opId}">
          <span>${describe(op)}</span></label>
        ${op.conflict ? '<div class="agd-reason conflict-text">Você editou este campo à mão — por isso vem desmarcado</div>' : ''}
        ${op.reason ? `<div class="agd-reason">${escapeHtml(op.reason)}</div>` : ''}
        ${op.nodeId ? `<button class="agd-focus" data-focus="${op.nodeId}">focar</button>` : ''}
      </div>`;

    // Uma proposta de 41 operações numa lista plana é irrevisável: não dá para
    // saber quais pertencem ao mesmo subprocesso nem aceitar um bloco inteiro.
    const groups = changeset.groups?.length ? changeset.groups : null;
    const body = groups
      ? groups.map(g => {
          const ops = g.opIds.map(id => changeset.ops.find(o => o.opId === id)).filter(Boolean);
          const conflicts = ops.filter(o => o.conflict).length;
          return `
            <section class="agd-group" data-group="${g.id}">
              <header class="agd-group-head">
                <button class="agd-group-toggle" data-toggle="${g.id}">▾</button>
                <div class="agd-group-title">${escapeHtml(g.title)}
                  <span class="agd-group-count">${ops.length} op(s)${conflicts ? ` · ${conflicts} conflito(s)` : ''}</span>
                </div>
                <button class="agd-group-accept" data-accept-group="${g.id}">aceitar bloco</button>
              </header>
              ${g.rationale ? `<div class="agd-reason agd-group-why">${escapeHtml(g.rationale)}</div>` : ''}
              <div class="agd-group-body">${ops.map(renderOp).join('')}</div>
            </section>`;
        }).join('')
      : changeset.ops.map(renderOp).join('');

    const drawer = document.createElement('div');
    drawer.id = 'agent-drawer';
    drawer.className = 'agent-drawer';
    drawer.innerHTML = `
      <div class="agd-head">
        <div><b>${escapeHtml(changeset.title)}</b>
          <div class="agd-sub">${changeset.ops.length} operação(ões)${groups ? ` em ${groups.length} bloco(s)` : ''}</div>
        </div>
        <button class="agd-close" data-close>✕</button>
      </div>
      ${changeset.rationale ? `<div class="agd-rationale">${escapeHtml(changeset.rationale)}</div>` : ''}
      <div class="agd-list">${body}</div>
      <div class="agd-foot">
        <button class="arb-btn ghost" data-close>Cancelar</button>
        <button class="arb-btn primary" data-apply>Aplicar seleção</button>
      </div>`;
    document.body.appendChild(drawer);

    drawer.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) { drawer.remove(); return; }

      const focusId = e.target.closest('[data-focus]')?.dataset.focus;
      if (focusId) { focusNode(focusId); return; }

      const toggleId = e.target.closest('[data-toggle]')?.dataset.toggle;
      if (toggleId) {
        const section = drawer.querySelector(`[data-group="${toggleId}"]`);
        section.classList.toggle('collapsed');
        e.target.textContent = section.classList.contains('collapsed') ? '▸' : '▾';
        return;
      }

      // Aceitar um bloco marca só as ops dele e aplica na hora — é o atalho que
      // torna uma proposta grande revisável por partes.
      const groupId = e.target.closest('[data-accept-group]')?.dataset.acceptGroup;
      if (groupId) {
        const accept = (changeset.groups.find(g => g.id === groupId)?.opIds ?? [])
          .filter(id => !changeset.ops.find(o => o.opId === id)?.conflict);
        drawer.remove();
        await resolve(changeset, accept, changeset.ops.map(o => o.opId).filter(id => !accept.includes(id)));
        return;
      }

      if (e.target.closest('[data-apply]')) {
        const accept = [...drawer.querySelectorAll('[data-check]')].filter(c => c.checked).map(c => c.dataset.check);
        const reject = changeset.ops.map(o => o.opId).filter(id => !accept.includes(id));
        drawer.remove();
        await resolve(changeset, accept, reject);
      }
    });
  }

  async function resolve(changeset, accept, reject) {
    try {
      await fetch(`/api/clients/${Audasys.persistence.clientId}/changesets/${changeset.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept, reject }),
      });
      // O SSE devolve `changeset.resolved` com o patch real; é ele que
      // materializa os fantasmas com ids definitivos.
    } catch (err) {
      alert(`Não consegui registrar sua decisão: ${err.message}`);
    }
  }

  // ── Foco vindo do agente ───────────────────────────────────────────────────

  function focusNode(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const vp = document.getElementById('canvas-viewport').getBoundingClientRect();
    panOffset.x = vp.width / 2 - (node.x + 110) * zoom;
    panOffset.y = vp.height / 2 - (node.y + 60) * zoom;
    updateViewport();
    const el = document.getElementById(nodeId);
    el?.classList.add('agent-pulse');
    setTimeout(() => el?.classList.remove('agent-pulse'), 2200);
  }

  function toast(message) {
    if (!message) return;
    const el = document.createElement('div');
    el.className = 'agent-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  // ── SSE ────────────────────────────────────────────────────────────────────

  function attach(clientId, canvasId) {
    detach();
    source = new EventSource(`/api/clients/${clientId}/canvases/${canvasId}/events`);

    source.addEventListener('changeset.proposed', (e) => {
      const { changeset } = JSON.parse(e.data);
      // Fantasmas alteram o DOM: se o usuário está digitando, espera.
      if (canApplyNow()) renderGhosts(changeset);
      else enqueueGhosts(changeset);
    });

    source.addEventListener('changeset.resolved', (e) => {
      const data = JSON.parse(e.data);
      clearGhosts();
      if (data.patch?.length) enqueue(data.patch);
      // O rev mudou no servidor; sem sincronizar, o próximo save leva 409.
      if (data.rev !== undefined) Audasys.persistence.attach(activeClientId, activeCanvasId, data.rev);
      if (data.patch?.some(op => op.set && 'childCanvas' in op.set)) ressincronizarSubprocessos();
      if (data.status === 'applied' || data.status === 'partial') {
        toast(`Proposta aplicada: ${data.title}`);
      }
    });

    source.addEventListener('focus', (e) => {
      const { nodeIds = [], message } = JSON.parse(e.data);
      if (nodeIds.length) focusNode(nodeIds[0]);
      for (const id of nodeIds.slice(1)) {
        const el = document.getElementById(id);
        el?.classList.add('agent-pulse');
        setTimeout(() => el?.classList.remove('agent-pulse'), 2200);
      }
      toast(message);
    });

    source.onerror = () => { /* EventSource reconecta sozinho */ };

    // Proposta feita com o navegador fechado continua esperando em disco.
    loadPendingChangesets(clientId, canvasId);
  }

  function enqueueGhosts(changeset) {
    queue.push([{ kind: '__ghosts', changeset }]);
    updateQueueBadge();
  }

  async function loadPendingChangesets(clientId, canvasId) {
    try {
      const res = await fetch(`/api/clients/${clientId}/changesets?canvasId=${encodeURIComponent(canvasId)}`);
      const { changesets } = await res.json();
      if (changesets?.length) renderGhosts(changesets[0]);
    } catch { /* sem pendências */ }
  }

  function detach() {
    source?.close();
    source = null;
    queue.length = 0;
    updateQueueBadge();
    document.getElementById('agent-review-bar')?.remove();
    document.getElementById('agent-drawer')?.remove();
    pending = null;
  }

  window.AudasysAgent = {
    attach, detach, focusNode, clearGhosts, toast,
    get pending() { return pending; },
    // O SSE leva um round-trip para abrir. Uma proposta feita nesse intervalo
    // é gravada mas não chega à tela — e o agente recebe watching=0.
    get connected() { return source?.readyState === 1; },
  };
})();
