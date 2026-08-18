/**
 * Camada de Medição: onde o processo é medido.
 *
 * A bolinha precisa dizer três coisas SEM ser aberta, porque num mapa de 16 nós
 * ninguém clica em todas:
 *
 *   1. O ANEL diz se a malha fecha. Fechado = o dado chega em alguém que age.
 *      Tracejado/aberto = é coletado e não vai a lugar nenhum. O círculo aberto
 *      é a malha aberta — auto-explicativo, sem legenda, e você enxerga o
 *      "alerta que cai num e-mail que ninguém lê" atravessando a sala.
 *   2. O PREENCHIMENTO diz a força da evidência, na mesma gramática do resto do
 *      mapa: contorno = suposto, meio = relatado, sólido = medido.
 * Três profundidades, para o mapa não ficar ilegível: bolinha → popover (a visão
 * de reunião, responde sem tirar você do mapa) → painel lateral (a de trabalho).
 */
(function () {
  'use strict';

  const camada = () => document.getElementById('breakpoints-layer') || criarCamada();

  function criarCamada() {
    const el = document.createElement('div');
    el.id = 'breakpoints-layer';
    el.className = 'bp-layer';
    document.getElementById('canvas-container').appendChild(el);
    return el;
  }

  /** Mesma escala do resto do mapa: preenchimento = evidência. */
  function densidade(evidencia) {
    if (['documented', 'observed'].includes(evidencia)) return 'solido';
    if (evidencia === 'reported') return 'meio';
    return 'fantasma';
  }

  /**
   * Onde a bolinha fica.
   *
   * No nó, no canto superior direito, fora da borda — o card já é denso e o
   * miolo dele é do conteúdo. Na aresta, no ponto médio da curva, que
   * `updateConnectionLine` já calcula para posicionar o rótulo.
   */
  function posicao(bp) {
    if (bp.alvo.tipo === 'node') {
      const node = nodes.find((n) => n.id === bp.alvo.id);
      if (!node) return null;
      const el = document.getElementById(node.id);
      return { x: node.x + (el?.offsetWidth ?? 220) - 10, y: node.y - 10 };
    }
    const conn = connections.find((c) => c.id === bp.alvo.id);
    if (!conn || conn.midX == null) return null;
    return { x: conn.midX, y: conn.midY };
  }

  function render(bp) {
    document.getElementById(`bp-${bp.id}`)?.remove();
    const pos = posicao(bp);
    if (!pos) return;

    const el = document.createElement('div');
    el.id = `bp-${bp.id}`;
    el.className = `bp bp-${bp.malha} ev-${densidade(bp.evidencia)}`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.dataset.bp = bp.id;
    el.title = `${bp.oQueMede} · ${bp.cadencia}`
      + (bp.malha === 'aberta' ? ' · MALHA ABERTA: ninguém recebe este dado' : ` · vai para ${bp.consumidor.quem}`);


    camada().appendChild(el);
  }

  function renderTodos() {
    camada().innerHTML = '';
    for (const bp of breakpoints) render(bp);
    desenharRetornos();
  }

  /** Reposiciona sem recriar — chamado quando nó se move ou aresta recalcula. */
  function reposicionar() {
    for (const bp of breakpoints) {
      const el = document.getElementById(`bp-${bp.id}`);
      const pos = posicao(bp);
      if (!el || !pos) continue;
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
    }
    desenharRetornos();
  }

  // ── Seta de retorno: a malha desenhada ──────────────────────────────────────
  // Sai do breakpoint e vai até quem consome o dado. Se o consumidor for dono de
  // algum nó do mapa, a seta aponta para lá — é a volta da informação, visível.
  // Se não for (um cargo que não executa passo nenhum), vira um chip com o nome:
  // o importante é enxergar que o dado sai e vai para ALGUÉM.
  //
  // Escondida por padrão para não virar espaguete; aparece na seleção. Todas de
  // uma vez virá com o interruptor da camada Medição.
  let selecionado = null;

  function desenharRetornos() {
    document.querySelectorAll('.bp-retorno, .bp-chip').forEach((e) => e.remove());
    if (!selecionado) return;
    const bp = breakpoints.find((b) => b.id === selecionado);
    if (!bp || bp.malha !== 'fechada') return;

    const de = posicao(bp);
    if (!de) return;

    const destino = nodes.find((n) => n.owner && n.owner === bp.consumidor.quem);
    if (destino) {
      const el = document.getElementById(destino.id);
      const para = { x: destino.x + (el?.offsetWidth ?? 220) / 2, y: destino.y };
      const linha = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      linha.setAttribute('class', 'bp-retorno');
      const dx = Math.abs(para.x - de.x) * 0.4;
      linha.setAttribute('d', `M ${de.x} ${de.y} C ${de.x + dx} ${de.y - 60}, ${para.x - dx} ${para.y - 60}, ${para.x} ${para.y}`);
      document.getElementById('connections-svg').appendChild(linha);
    } else {
      const chip = document.createElement('div');
      chip.className = 'bp-chip';
      chip.style.left = `${de.x + 18}px`;
      chip.style.top = `${de.y - 26}px`;
      chip.textContent = `→ ${bp.consumidor.quem}`;
      camada().appendChild(chip);
    }
  }

  // ── Popover: a visão de reunião ────────────────────────────────────────────
  function abrirPopover(bp) {
    document.getElementById('bp-popover')?.remove();
    const pos = posicao(bp);
    if (!pos) return;

    const ultimo = bp.serie.at(-1);

    const pop = document.createElement('div');
    pop.id = 'bp-popover';
    pop.className = 'bp-popover';
    pop.style.left = `${pos.x + 16}px`;
    pop.style.top = `${pos.y + 16}px`;
    pop.innerHTML = `
      <div class="bp-pop-head">
        <b>${escapeHtml(bp.oQueMede || '(sem indicador)')}</b>
        <button class="bp-pop-fechar" data-fechar>✕</button>
      </div>
      <div class="bp-pop-linha"><span>cadência</span> ${escapeHtml(bp.cadencia)}</div>
      <div class="bp-pop-linha"><span>volta para</span> ${
        bp.malha === 'fechada'
          ? escapeHtml(bp.consumidor.quem) + (bp.consumidor.comoChega ? ` <i>(${escapeHtml(bp.consumidor.comoChega)})</i>` : '')
          : '<b class="bp-alerta">ninguém — malha aberta</b>'
      }</div>
      <div class="bp-pop-linha"><span>evidência</span> ${escapeHtml(bp.evidencia)}</div>
      ${ultimo?.valor != null ? `<div class="bp-pop-linha"><span>última leitura</span> ${ultimo.valor}${escapeHtml(ultimo.unidade)}</div>` : ''}
`;
    document.body.appendChild(pop);
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** Criação pela interface. Devolve o breakpoint para quem chamou editar. */
  function criar(alvo, oQueMede) {
    const bp = {
      id: `bp_${Date.now()}_${breakpoints.length}`,
      alvo,
      oQueMede: oQueMede || '',
      cadencia: 'eventual',
      consumidor: { quem: '', comoChega: '' },
      malha: 'aberta',      // nasce aberta: ninguém foi declarado ainda
      evidencia: 'assumed',
      serie: [],
    };
    breakpoints.push(bp);
    render(bp);
    saveToLocalStorage();
    return bp;
  }

  function remover(id) {
    const i = breakpoints.findIndex((b) => b.id === id);
    if (i === -1) return;
    breakpoints.splice(i, 1);
    document.getElementById(`bp-${id}`)?.remove();
    document.getElementById('bp-popover')?.remove();
    saveToLocalStorage();
  }

  // ── Criação ────────────────────────────────────────────────────────────────
  // Dois caminhos, porque medir passo e medir passagem de bastão são decisões
  // diferentes: o botão do painel cria no NÓ; o botão flutuante que aparece na
  // aresta selecionada cria na PASSAGEM, que é onde mora o handoff.

  /**
   * Item de menu "medir esta passagem": cria o breakpoint na aresta, ou abre o
   * que já existe. Antes era um botão flutuante próprio; virou item do menu de
   * contexto para a aresta não ter dois affordances competindo pelo mesmo pixel.
   */
  function naAresta(conn) {
    const existente = breakpoints.find((b) => b.alvo.tipo === 'edge' && b.alvo.id === conn.id);
    if (existente) return abrirPopover(existente);

    const de = nodes.find((n) => n.id === conn.from)?.name ?? '';
    const para = nodes.find((n) => n.id === conn.to)?.name ?? '';
    const bp = criar({ tipo: 'edge', id: conn.id }, `tempo entre ${de} e ${para}`);
    abrirPopover(bp);
  }

  function esconderOfertaDaAresta() {
    document.getElementById('bp-na-aresta')?.remove();
  }

  /** Lista os breakpoints do nó selecionado no painel, com edição rápida. */
  function marcarPainel(node) {
    const lista = document.getElementById('medicao-lista');
    if (!lista) return;
    const meus = breakpoints.filter((b) => b.alvo.tipo === 'node' && b.alvo.id === node.id);
    lista.innerHTML = meus.map((b) => `
      <div class="med-item ${b.malha === 'aberta' ? 'med-aberta' : ''}" data-bp="${b.id}">
        <div class="med-nome">${escapeHtml(b.oQueMede || '(sem indicador)')}</div>
        <div class="med-sub">${escapeHtml(b.cadencia)} · ${
          b.malha === 'fechada' ? `→ ${escapeHtml(b.consumidor.quem)}` : '<b>malha aberta</b>'
        }</div>
        <button class="med-abrir" data-abrir="${b.id}">abrir</button>
      </div>`).join('');
  }

  document.getElementById('btn-medir-passo')?.addEventListener('click', () => {
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    const bp = criar({ tipo: 'node', id: node.id }, `tempo de ${node.name}`);
    marcarPainel(node);
    abrirPopover(bp);
  });

  document.addEventListener('click', (e) => {
    const id = e.target.closest('[data-abrir]')?.dataset.abrir;
    if (!id) return;
    const bp = breakpoints.find((b) => b.id === id);
    if (bp) abrirPopover(bp);
  });

  window.AudasysBreakpoints = {
    render, renderTodos, reposicionar, criar, remover,
    naAresta, esconderOfertaDaAresta, abrirPopover, marcarPainel,
  };
})();
