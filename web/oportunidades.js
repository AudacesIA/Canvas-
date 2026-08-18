/**
 * Oportunidades de receita.
 *
 * Substituíram a camada de hipóteses. O que se via antes eram cards estruturados
 * (enunciado, intervenção, prazo, status, histórico de versões); o que se vê
 * agora é um asterisco verde na passagem e, dentro dele, blocos de anotação
 * livres em Markdown.
 *
 * A troca foi deliberada: rigor por velocidade de escrita. Oportunidade de
 * receita nasce na frente do cliente, no meio da frase — quem para para
 * preencher formulário perde a ideia.
 *
 * ── O que se vê ─────────────────────────────────────────────────────────────
 * Fechado: só o asterisco ✳ verde sobre a aresta, com "N oportunidades de
 * receita" embaixo. Aberto: os cards aparecem, ligados ao asterisco por setas
 * verdes. Escondido por padrão porque um mapa com quatro camadas ligadas ao
 * mesmo tempo vira árvore de Natal e não se apresenta para cliente.
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

  /**
   * Onde o asterisco fica na aresta.
   *
   * A aresta já carrega até três marcas: a barra de gargalo e a bolinha de
   * medição, ambas no ponto médio. Empilhar a terceira no mesmo pixel tornaria
   * as três ilegíveis — três das cinco medições reais deste projeto estão em
   * arestas. Por isso o asterisco fica DESLOCADO do meio.
   */
  function posicaoAsterisco(conn) {
    return window.pontoNaAresta?.(conn, 'oportunidade') ?? null;
  }

  function renderTodos() {
    if (arrastando) return;   // não recria o card debaixo do ponteiro
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

  /** O asterisco e o contador. É tudo que se vê antes de clicar. */
  function marcaAsterisco(arestaId, quantas, pos) {
    const el = document.createElement('div');
    el.className = `op-asterisco${abertas.has(arestaId) ? ' op-aberto' : ''}`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.dataset.aresta = arestaId;
    el.title = 'Oportunidades de receita nesta passagem';
    el.innerHTML = `<span class="op-glifo">✳</span>`
      + `<span class="op-contador">${quantas} oportunidade${quantas === 1 ? '' : 's'} de receita</span>`;
    return el;
  }

  /**
   * Onde o card fica.
   *
   * Posição própria quando já foi arrastado; senão, empilha a partir do
   * asterisco. O padrão existe para o card nascer em algum lugar razoável — a
   * partir do primeiro arrasto, quem manda é o consultor.
   */
  function posicaoCard(op, origem, i) {
    if (op.x != null && op.y != null) return { x: op.x, y: op.y };
    return { x: origem.x + 70, y: origem.y - 30 + i * 104 };
  }

  /** Cards revelados, ligados ao asterisco por setas verdes. */
  function abrirCards(arestaId, lista, origem) {
    lista.forEach((op, i) => {
      const pos = posicaoCard(op, origem, i);
      camada().appendChild(cardOportunidade(op, pos));
    });
    redesenharSetas(arestaId);
  }

  /**
   * Redesenha as setas de uma passagem.
   *
   * Separado do render dos cards porque durante o arrasto só as setas mudam —
   * recriar o card no meio do movimento mataria a captura do ponteiro.
   */
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
    const previa = (op.markdown || '').split('\n').filter((l) => l.trim())[0] || 'sem anotação';
    el.innerHTML = `
      <div class="op-card-titulo">${escapeHtml(op.titulo)}</div>
      <div class="op-card-previa">${escapeHtml(previa.slice(0, 90))}</div>
      <div class="op-card-pe">clique para abrir o bloco de notas</div>`;
    return el;
  }

  /**
   * Seta verde do asterisco até o card.
   *
   * Vai no mesmo `<svg>` das arestas reais, mas fora de `connections[]`: é
   * desenho, não dado. Mesmo padrão da seta de retorno do breakpoint.
   */
  function desenharSeta(arestaId, de, para) {
    const linha = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    linha.setAttribute('class', 'op-seta');
    linha.setAttribute('data-aresta', arestaId);

    // P0 é o CENTRO DO ASTERISCO, sem deslocamento. Todas as setas nascem no
    // mesmo ponto — é isso que faz o feixe ler como uma origem só em vez de
    // três linhas soltas passando perto.
    const alvo = { x: para.x - 4, y: para.y + 20 };
    const dx = Math.max(28, Math.abs(alvo.x - de.x) * 0.45);
    const sentido = alvo.x >= de.x ? 1 : -1;
    linha.setAttribute('d',
      `M ${de.x} ${de.y} C ${de.x + dx * sentido} ${de.y}, ${alvo.x - dx * sentido} ${alvo.y}, ${alvo.x} ${alvo.y}`);
    document.getElementById('connections-svg').appendChild(linha);
  }

  // ── Arrasto ────────────────────────────────────────────────────────────────
  /**
   * O card se move como um nó, e as setas acompanham.
   *
   * Precisa distinguir clique de arrasto: o mesmo gesto abre o bloco de notas e
   * move o card. O critério é distância — abaixo de 4px é clique, acima é
   * movimento. Sem isso, qualquer tremida ao clicar abriria o notepad no lugar
   * errado, ou moveria o card sem querer.
   *
   * O delta é dividido pelo zoom porque o card vive dentro do container
   * transformado: 10px de tela viram 20px de canvas a 50%.
   */
  let arrastando = null;

  document.addEventListener('pointerdown', (e) => {
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
    else abrirNotepad(op);   // não moveu: era clique
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
  });

  /**
   * O notepad.
   *
   * Duas faces: escrever (textarea cru) e ler (Markdown renderizado). A
   * pré-visualização reaproveita `.markdown-body`, que já existia no projeto
   * para o modal de auditoria — mesmo estilo de título, lista e código, sem
   * inventar uma segunda gramática visual.
   */
  function abrirNotepad(op) {
    if (!op) return;
    document.getElementById('op-notepad')?.remove();

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
      <textarea id="op-np-texto" placeholder="## Onde está o dinheiro&#10;&#10;79 pedidos/mês com endereço errado.&#10;- ticket médio **R$ 180**">${escapeHtml(op.markdown || '')}</textarea>
      <div id="op-np-previa" class="markdown-body" style="display:none"></div>
      <div class="op-np-pe">
        <button class="arb-btn danger" data-excluir-op>Excluir</button>
        <span class="op-np-dica">salva ao fechar</span>
        <button class="arb-btn primary" data-salvar-np>Salvar</button>
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
      }
    });
  }

  /** Cria a partir do menu da aresta e já abre o bloco para escrever. */
  function novaNaAresta(conn) {
    const nova = {
      id: `op_${Date.now()}_${oportunidades.length}`,
      arestaId: conn.id,
      titulo: 'Oportunidade de receita',
      markdown: '',
      criadoEm: new Date().toISOString(),
    };
    oportunidades.push(nova);
    abertas.add(conn.id);
    saveToLocalStorage();
    renderTodos();
    abrirNotepad(nova);
  }

  /** Lista de tudo que foi mapeado no canvas, sem sair para o mapa. */
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
          <div><b>Oportunidades de receita</b>
            <div class="agd-sub">${oportunidades.length} mapeada(s) neste canvas</div></div>
          <button class="agd-close" data-fechar-lista>✕</button>
        </div>
        <div class="op-lista">${oportunidades.map((o) => `
          <div class="op-lista-item" data-abrir-op="${o.id}">
            <div class="op-card-titulo">${escapeHtml(o.titulo)}</div>
            <div class="op-lista-onde">${escapeHtml(ondeFica(o.arestaId))}</div>
            <div class="markdown-body op-lista-corpo">${AudasysMarkdown.render(o.markdown || '_sem anotação_')}</div>
          </div>`).join('') || '<div class="qd-vazia">Nada mapeado ainda. Clique numa passagem do processo e use "Mapear oportunidade de receita".</div>'}
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

  document.getElementById('btn-oportunidades')?.addEventListener('click', abrirLista);

  window.AudasysOportunidades = { renderTodos, novaNaAresta, abrirNotepad, abrirLista };
})();
