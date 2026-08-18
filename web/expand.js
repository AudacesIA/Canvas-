/**
 * Expansão no lugar do canvas filho.
 *
 * O modelo antigo (`navigateToChildCanvas`) TROCA de tela: limpa o DOM, põe os
 * nós do filho no lugar dos do pai e mostra um breadcrumb. Você perde o contexto
 * de onde estava — que é justamente o que o mapa serve para dar.
 *
 * Aqui o filho é revelado DENTRO do pai: o nó cresce até caber o subprocesso em
 * escala reduzida e os vizinhos são empurrados para abrir espaço. Nada some da
 * tela; o detalhe aparece no lugar onde ele acontece.
 *
 * A expansão é estado de VISUALIZAÇÃO, não dado: não é persistida no canvas.
 * Recarregar a página volta tudo recolhido, e é o comportamento desejado — dois
 * consultores abrindo o mesmo mapa não deveriam herdar o zoom mental um do outro.
 *
 * O deslocamento dos vizinhos é registrado nó a nó e desfeito exatamente na
 * ordem inversa ao recolher. Recalcular por layout automático no colapso moveria
 * nós que o usuário tinha posicionado à mão.
 */
(function () {
  'use strict';

  const ESCALA = 0.4;      // o filho cabe em ~40% — legível sem virar outro mapa
  const PAD = 14;          // respiro interno da moldura
  const FILHO_W = 220;     // largura de um nó (igual à do canvas real)
  const FILHO_H = 120;     // altura estimada — os nós reais variam, isto é o teto usual
  const GAP = 28;          // folga entre o pai expandido e o vizinho empurrado

  /** nodeId -> { deslocados: [{id, dx, dy}] } */
  const expandidos = new Map();

  const el = (id) => document.getElementById(id);
  const qtdFilhos = (node) => (node?.childCanvas?.nodes || []).length;
  /**
   * Expansível é quem está em modo Canvas — MESMO com zero filhos.
   *
   * Exigir filhos escondia o recurso justamente de quem mais precisava dele: o
   * nó marcado como subprocesso e ainda vazio ficava idêntico a um nó comum, e
   * não havia nada na tela dizendo que existia um canvas ali dentro esperando
   * ser montado.
   */
  const ehExpansivel = (node) => !!node && node.subprocessMode === 'canvas';

  function limites(filhos) {
    const xs = filhos.map(n => n.x), ys = filhos.map(n => n.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return {
      minX, minY,
      w: Math.max(...xs) + FILHO_W - minX,
      h: Math.max(...ys) + FILHO_H - minY,
    };
  }

  /** Moldura vazia: o subprocesso existe como intenção, mas ninguém o mapeou. */
  function montarVazio() {
    const wrap = document.createElement('div');
    wrap.className = 'child-canvas-inline vazio';
    wrap.innerHTML = `
      <div class="cci-vazio">
        <i class="fa-solid fa-diagram-project"></i>
        <p>Subprocesso ainda não mapeado.</p>
        <button class="cci-montar" type="button">Montar subprocesso</button>
      </div>`;
    return { wrap, largura: 240, altura: 0 };
  }

  /** Miniatura do subprocesso: cards simplificados + arestas, sem interação. */
  function montarInterior(node) {
    const filhos = node.childCanvas?.nodes || [];
    if (!filhos.length) return montarVazio();
    const arestas = node.childCanvas.connections || [];
    const b = limites(filhos);
    const largura = b.w * ESCALA;
    const altura = b.h * ESCALA;

    const pos = new Map(filhos.map(f => [f.id, {
      x: (f.x - b.minX) * ESCALA,
      y: (f.y - b.minY) * ESCALA,
    }]));

    const linhas = arestas.map(c => {
      const a = pos.get(c.from), z = pos.get(c.to);
      if (!a || !z) return '';
      const x1 = a.x + FILHO_W * ESCALA, y1 = a.y + (FILHO_H * ESCALA) / 2;
      const x2 = z.x, y2 = z.y + (FILHO_H * ESCALA) / 2;
      const dx = Math.abs(x2 - x1) * 0.5;
      return `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" />`;
    }).join('');

    const cards = filhos.map(f => {
      const p = pos.get(f.id);
      return `<div class="cci-node" data-type="${f.type || 'action'}"
        style="left:${p.x}px; top:${p.y}px; width:${FILHO_W * ESCALA}px; height:${FILHO_H * ESCALA}px;">
        <span class="cci-nome">${escapeHtml(f.name || 'sem nome')}</span>
      </div>`;
    }).join('');

    const wrap = document.createElement('div');
    wrap.className = 'child-canvas-inline';
    wrap.style.width = `${largura}px`;
    wrap.style.height = `${altura}px`;
    wrap.innerHTML = `<svg class="cci-svg" width="${largura}" height="${altura}">${linhas}</svg>${cards}`;
    return { wrap, largura, altura };
  }

  /** Empurra quem está à direita/abaixo, só quando há sobreposição no outro eixo. */
  function empurrarVizinhos(node, dW, dH, alturaAntiga, larguraAntiga) {
    const deslocados = [];
    if (dW <= 0 && dH <= 0) return deslocados;

    for (const outro of nodes) {
      if (outro.id === node.id) continue;
      const oEl = el(outro.id);
      const oW = oEl ? oEl.offsetWidth : FILHO_W;
      const oH = oEl ? oEl.offsetHeight : FILHO_H;

      // Sobreposição vertical → é vizinho "de lado", empurra para a direita.
      const cruzaV = !(outro.y + oH <= node.y || outro.y >= node.y + alturaAntiga);
      // Sobreposição horizontal → é vizinho "de baixo", empurra para baixo.
      const cruzaH = !(outro.x + oW <= node.x || outro.x >= node.x + larguraAntiga);

      let dx = 0, dy = 0;
      if (dW > 0 && cruzaV && outro.x >= node.x + larguraAntiga) dx = dW + GAP;
      if (dH > 0 && cruzaH && outro.y >= node.y + alturaAntiga) dy = dH + GAP;
      if (!dx && !dy) continue;

      outro.x += dx;
      outro.y += dy;
      if (oEl) { oEl.style.left = `${outro.x}px`; oEl.style.top = `${outro.y}px`; }
      deslocados.push({ id: outro.id, dx, dy });
    }
    return deslocados;
  }

  function expandir(node) {
    if (!ehExpansivel(node) || expandidos.has(node.id)) return;
    const nEl = el(node.id);
    if (!nEl) return;

    const larguraAntiga = nEl.offsetWidth;
    const alturaAntiga = nEl.offsetHeight;

    const { wrap, largura } = montarInterior(node);
    nEl.appendChild(wrap);
    nEl.classList.add('expandido');
    nEl.style.width = `${Math.max(larguraAntiga, largura + PAD * 2)}px`;

    const dW = nEl.offsetWidth - larguraAntiga;
    const dH = nEl.offsetHeight - alturaAntiga;

    const deslocados = empurrarVizinhos(node, dW, dH, alturaAntiga, larguraAntiga);
    expandidos.set(node.id, { deslocados });

    atualizarAfordancia(node);
    updateConnections();
    if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
  }

  function recolher(node) {
    const estado = expandidos.get(node.id);
    if (!estado) return;
    const nEl = el(node.id);

    if (nEl) {
      nEl.querySelector('.child-canvas-inline')?.remove();
      nEl.classList.remove('expandido');
      nEl.style.width = '';
    }

    // Desfaz o deslocamento exatamente como foi aplicado.
    for (const d of estado.deslocados) {
      const alvo = nodes.find(n => n.id === d.id);
      if (!alvo) continue;
      alvo.x -= d.dx;
      alvo.y -= d.dy;
      const aEl = el(alvo.id);
      if (aEl) { aEl.style.left = `${alvo.x}px`; aEl.style.top = `${alvo.y}px`; }
    }

    expandidos.delete(node.id);
    atualizarAfordancia(node);
    updateConnections();
    if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
  }

  function alternar(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!ehExpansivel(node)) return;
    expandidos.has(nodeId) ? recolher(node) : expandir(node);
  }

  /** O badge vira o botão de abrir/fechar, com seta indicando o estado. */
  function atualizarAfordancia(node) {
    const ind = el(node.id)?.querySelector('.node-status-indicator');
    if (!ind || !ehExpansivel(node)) return;
    const aberto = expandidos.has(node.id);
    const n = qtdFilhos(node);
    ind.style.display = 'flex';   // app.js esconde o badge quando não há filhos
    ind.classList.add('is-child-toggle');
    ind.classList.toggle('aberto', aberto);
    ind.classList.toggle('vazio', n === 0);
    ind.innerHTML =
      `<i class="fa-solid fa-diagram-project"></i> ` +
      `<span class="sub-count">${n ? `${n} nodes` : 'vazio'}</span>` +
      `<i class="fa-solid ${aberto ? 'fa-chevron-up' : 'fa-chevron-down'} cci-seta"></i>`;
  }

  /** Marca todos os nós em modo Canvas (roda após render em massa). */
  function marcarExpansiveis() {
    for (const n of nodes) if (ehExpansivel(n)) atualizarAfordancia(n);
  }

  // ── gatilhos ───────────────────────────────────────────────────────────────
  // Delegação no container: os nós são recriados o tempo todo, então listener
  // por elemento vazaria a cada re-render.

  document.getElementById('nodes-container').addEventListener('click', (e) => {
    // Moldura vazia → abre o canvas filho para edição de verdade. A expansão é
    // leitura; construir o subprocesso continua sendo no canvas dedicado.
    const montar = e.target.closest('.cci-montar');
    if (montar) {
      const alvo = montar.closest('.canvas-node');
      const node = nodes.find(n => n.id === alvo?.id);
      e.stopPropagation();
      if (node) { recolher(node); navigateToChildCanvas(node); }
      return;
    }

    const ind = e.target.closest('.node-status-indicator.is-child-toggle');
    if (!ind) return;
    const nodeEl = ind.closest('.canvas-node');
    if (!nodeEl) return;
    e.stopPropagation();   // não deixa o clique virar seleção do nó
    alternar(nodeEl.id);
  });

  // Duplo clique no nó: atalho principal. Clique simples continua selecionando
  // e arrastando — disputar com ele quebraria a manipulação do mapa.
  document.getElementById('nodes-container').addEventListener('dblclick', (e) => {
    if (e.target.closest('.child-canvas-inline')) return;   // dentro do filho, não
    if (e.target.closest('[contenteditable]')) return;      // editando texto, não
    const nodeEl = e.target.closest('.canvas-node');
    if (!nodeEl) return;
    e.preventDefault();
    alternar(nodeEl.id);
  });

  window.AudasysExpand = { alternar, expandir, recolher, marcarExpansiveis, expandidos };
})();

/**
 * Botão "Organizar".
 *
 * O layout em camadas (dagre) já existia no servidor, o endpoint `/layout` já
 * existia e o front já sabia APLICAR um `setLayout` — faltava alguém PEDIR.
 * Não havia um único fetch para /layout em toda a pasta web/.
 *
 * Roda só no clique, nunca sozinho: reposicionar o mapa embaixo do consultor no
 * meio de uma entrevista seria pior que o emaranhado.
 */
(function () {
  'use strict';

  const btn = document.getElementById('btn-organizar');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!activeCanvasId) return;
    const rotulo = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Organizando…';

    try {
      const res = await fetch(`/api/clients/${activeClientId}/canvases/${activeCanvasId}/layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // preserveManual:false — o clique é uma ordem explícita de arrumar TUDO.
        // Respeitar posição travada aqui deixaria o mapa meio arrumado, que é o
        // pior dos dois mundos.
        body: JSON.stringify({ direction: 'LR', preserveManual: false }),
      });
      if (!res.ok) throw new Error(`servidor respondeu ${res.status}`);
      const { positions = [] } = await res.json();

      if (!positions.length) {
        alert('O mapa já está organizado — nenhum bloco precisou sair do lugar.');
        return;
      }

      for (const p of positions) {
        const node = nodes.find(n => n.id === p.nodeId);
        if (!node) continue;
        node.x = p.x;
        node.y = p.y;
        const el = document.getElementById(node.id);
        if (el) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
        // Arrastar trava x/y (fieldMeta). Organizar é decisão do consultor
        // também, então a nova posição vale como manual — senão o próximo
        // layout desfaz o que ele acabou de pedir.
        window.AudasysFieldMeta?.touchFields?.(node, ['x', 'y']);
      }

      updateConnections();
      saveToLocalStorage();
    } catch (err) {
      alert(`Não consegui organizar: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = rotulo;
    }
  });
})();
