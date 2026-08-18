import dagre from '@dagrejs/dagre';

/**
 * Auto-layout.
 *
 * O agente posicionava às cegas: no primeiro mapa real, uma aresta atravessava
 * toda a largura do desenho (n08 em x=2303 voltando para n09 em x=212) e um nó
 * ficou isolado 670px acima dos vizinhos. Ele não tinha como avaliar a
 * legibilidade do que produzia, e a revisão humana começava arrumando bagunça
 * visual em vez de discutir conteúdo.
 *
 * Agora o agente descreve topologia e o servidor resolve geometria.
 */

const CARD_W = 220;
const CARD_H = 120;   // piso, não medida — ver estimarAltura()
const SNAP = 20;

const snap = (v) => Math.round(v / SNAP) * SNAP;

/**
 * Altura aproximada do card, em px.
 *
 * O card tem largura FIXA (220px) e altura LIVRE. Enquanto o layout tratou todo
 * nó como 120px, o dagre reservava espaço de menos: um `condition` com 4 casos
 * passa de 300px, e o resultado eram cards sobrepostos com as arestas cruzando
 * por dentro deles. Pior: `findOverlaps` usava a mesma constante, então o
 * detector de bagunça também mentia.
 *
 * É estimativa, não medição — o servidor não tem DOM. Erra para MAIS de
 * propósito: sobra de espaço só afasta os cards, falta de espaço os sobrepõe.
 */
export function estimarAltura(node) {
  let h = 92;                                    // cabeçalho + título + respiro
  const desc = (node?.description || '').length;
  if (desc) h += Math.min(Math.ceil(desc / 34), 4) * 16;
  if (node?.owner) h += 30;
  if (node?.duration || node?.frequency) h += 22;
  if (node?.bottleneck) h += 62;                 // o bloco vermelho é alto
  const tools = Array.isArray(node?.tools) ? node.tools.length : (node?.tools ? 1 : 0);
  if (tools) h += 28;
  if (node?.type === 'condition') {
    h += 34;                                     // linha do campo avaliado
    h += ((node.switchCases || []).length + 1) * 30;   // +1 = a linha "senão"
  }
  return Math.max(CARD_H, h);
}

/** Posição travada = você arrastou. Layout nenhum pode mexer nisso. */
const isAnchored = (node) => node?.fieldMeta?.x?.locked === true || node?.fieldMeta?.y?.locked === true;

/**
 * @param {object} canvas
 * @param {{scope?: string[]|null, direction?: 'LR'|'TB', preserveManual?: boolean}} opts
 * @returns {{positions: {nodeId,x,y}[], moved: number, anchored: number}}
 */
export function computeLayout(canvas, { scope = null, direction = 'LR', preserveManual = true } = {}) {
  if (!canvas.nodes.length) return { positions: [], moved: 0, anchored: 0 };

  /**
   * No modo `scope`, tudo o que está fora dele vira âncora — é o caminho normal
   * quando o agente acabou de criar 6 nós e quer encaixá-los sem tocar no que
   * já estava desenhado.
   */
  const inScope = scope?.length ? new Set(scope) : null;
  const anchored = new Set(
    canvas.nodes
      .filter((n) => (inScope ? !inScope.has(n.id) : preserveManual && isAnchored(n)))
      .map((n) => n.id),
  );

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 140, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const alturas = new Map(canvas.nodes.map((n) => [n.id, estimarAltura(n)]));
  for (const node of canvas.nodes) g.setNode(node.id, { width: CARD_W, height: alturas.get(node.id) });
  for (const conn of canvas.connections) {
    if (g.hasNode(conn.from) && g.hasNode(conn.to)) g.setEdge(conn.from, conn.to);
  }

  dagre.layout(g);

  const laid = new Map();
  for (const id of g.nodes()) {
    const { x, y } = g.node(id);
    // dagre devolve o CENTRO; o canvas trabalha com o canto superior esquerdo.
    laid.set(id, { x: x - CARD_W / 2, y: y - (alturas.get(id) ?? CARD_H) / 2 });
  }

  // dagre não fixa posição, então alinhamos o resultado pelo centroide das
  // âncoras: o bloco novo aterrissa perto de onde o desenho já está.
  const anchorIds = [...anchored].filter((id) => laid.has(id));
  let dx = 0;
  let dy = 0;
  if (anchorIds.length) {
    const real = anchorIds.map((id) => canvas.nodes.find((n) => n.id === id));
    const avg = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
    dx = avg(real, (n) => n.x) - avg(anchorIds, (id) => laid.get(id).x);
    dy = avg(real, (n) => n.y) - avg(anchorIds, (id) => laid.get(id).y);
  }

  const free = canvas.nodes.filter((n) => !anchored.has(n.id));
  let positions = free.map((n) => ({
    nodeId: n.id,
    x: snap(laid.get(n.id).x + dx),
    y: snap(laid.get(n.id).y + dy),
  }));

  // Se o bloco recém-posicionado cair em cima do que já existe, ele desliza
  // inteiro — nunca ao contrário.
  const anchoredBoxes = canvas.nodes.filter((n) => anchored.has(n.id)).map((n) => ({ x: n.x, y: n.y }));
  if (anchoredBoxes.length && positions.length) {
    const axis = direction === 'LR' ? 'x' : 'y';
    let guard = 0;
    while (overlapsAny(positions, anchoredBoxes) && guard++ < 400) {
      positions = positions.map((p) => ({ ...p, [axis]: p[axis] + 40 }));
    }
  }

  return {
    positions: positions.filter((p) => {
      const node = canvas.nodes.find((n) => n.id === p.nodeId);
      return node.x !== p.x || node.y !== p.y;
    }),
    moved: positions.length,
    anchored: anchored.size,
  };
}

const boxesOverlap = (a, b) =>
  Math.abs(a.x - b.x) < CARD_W + 40 && Math.abs(a.y - b.y) < CARD_H + 40;

const overlapsAny = (list, others) => list.some((p) => others.some((o) => boxesOverlap(p, o)));

/** Cards sobrepostos: dois nós ocupando o mesmo espaço. */
export function findOverlaps(canvas) {
  const out = [];
  const ns = canvas.nodes;
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      // Retângulo real de cada um: com CARD_H fixo, dois cards altos sobrepostos
      // passavam despercebidos e o agente achava que o desenho estava limpo.
      const hi = estimarAltura(ns[i]);
      const hj = estimarAltura(ns[j]);
      const cruzaX = Math.abs(ns[i].x - ns[j].x) < CARD_W;
      const cruzaY = ns[i].y < ns[j].y + hj && ns[j].y < ns[i].y + hi;
      if (cruzaX && cruzaY) out.push([ns[i].id, ns[j].id]);
    }
  }
  return out;
}

/**
 * Arestas que se cruzam.
 *
 * O agente não tem olhos: sem isto, ele não sabe que produziu um desenho
 * ilegível. Segmento a segmento, ignorando pares que compartilham nó.
 */
export function findCrossings(canvas) {
  const pos = new Map(canvas.nodes.map((n) => [n.id, { x: n.x + CARD_W / 2, y: n.y + CARD_H / 2 }]));
  const segs = canvas.connections
    .filter((c) => pos.has(c.from) && pos.has(c.to))
    .map((c) => ({ id: c.id, from: c.from, to: c.to, a: pos.get(c.from), b: pos.get(c.to) }));

  const out = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.from === t.from || s.from === t.to || s.to === t.from || s.to === t.to) continue;
      if (segmentsIntersect(s.a, s.b, t.a, t.b)) out.push([s.id, t.id]);
    }
  }
  return out;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
