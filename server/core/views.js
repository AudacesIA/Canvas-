import { LEAN_CATEGORIES } from './schema.js';
import { findOverlaps, findCrossings } from './layoutService.js';

/**
 * Views de leitura para o agente.
 *
 * Nenhuma devolve o canvas inteiro em JSON. Um canvas de 60 nós em v2 completo
 * passa de 90k tokens — duas leituras estouram a conversa. O mesmo canvas em
 * outline fica em torno de 1.5k, e carrega tudo de que o agente precisa para
 * raciocinar: quem faz, onde trava, o que liga em quê.
 */

/**
 * O outline imprime os valores canônicos, sem abreviar.
 *
 * Antes havia um mapa que exibia `estoque` como "fila" e `superprocessamento`
 * como "superproc". O problema não era estético: `fila` não é valor aceito na
 * escrita, então o agente que reenviasse o que tinha lido via o campo virar
 * `outro` em silêncio. E `canvasStats` usava o valor cru, de modo que outline e
 * estatísticas falavam idiomas diferentes sobre o mesmo nó.
 *
 * Três caracteres economizados não pagam um round-trip que corrompe dado.
 */

const BPMN_SHORT = {
  startEvent: 'início', endEvent: 'fim', task: 'tarefa', userTask: 'tarefa-humana',
  serviceTask: 'tarefa-sistema', manualTask: 'tarefa-manual', scriptTask: 'script',
  exclusiveGateway: 'decisão-xor', parallelGateway: 'paralelo-and', inclusiveGateway: 'decisão-or',
  intermediateCatchEvent: 'espera', intermediateThrowEvent: 'sinal',
  subProcess: 'subprocesso', callActivity: 'chamada',
};

/**
 * Aliases curtos e estáveis por posição (n01, n02…).
 *
 * Um id real tem ~28 caracteres; num canvas de 60 nós com 80 arestas, repetir
 * ids no outline custa mais tokens do que o conteúdo. O agente pode usar o
 * alias em qualquer tool e o servidor resolve.
 */
export function buildAliases(canvas) {
  const toId = new Map();
  const toAlias = new Map();
  canvas.nodes.forEach((node, i) => {
    const alias = `n${String(i + 1).padStart(2, '0')}`;
    toId.set(alias, node.id);
    toAlias.set(node.id, alias);
  });
  return { toId, toAlias };
}

/** Aceita alias (`n04`) ou id real e devolve sempre o id real. */
export function resolveNodeRef(canvas, ref) {
  if (!ref) return ref;
  const { toId } = buildAliases(canvas);
  return toId.get(ref) ?? ref;
}

/** "n02→n05" para uma aresta, que não tem alias próprio. */
function rotuloDaAresta(canvas, toAlias, edgeId) {
  const e = (canvas.connections || []).find((c) => c.id === edgeId);
  if (!e) return edgeId;
  return `${toAlias.get(e.from) ?? e.from}→${toAlias.get(e.to) ?? e.to}`;
}

/**
 * Outline do canvas FILHO de um nó.
 *
 * O subprocesso é um canvas de verdade embutido no nó (`node.childCanvas`), sem
 * id nem arquivo próprio. Aqui ele ganha um cabeçalho que diz de quem é filho, e
 * os aliases internos são prefixados pelo alias do pai (`n02.1`, `n02.2`) — sem
 * isso o agente teria dois `n01` na mesma conversa, um em cada nível, e proporia
 * alteração no nó errado.
 */
function outlineDoFilho(canvas, into, { area, includeEdges }) {
  const { toAlias } = buildAliases(canvas);
  const idPai = resolveNodeRef(canvas, into);
  const pai = canvas.nodes.find((n) => n.id === idPai);

  if (!pai) {
    return `Nó "${into}" não existe neste canvas. Use o alias que aparece no outline (ex: n02).`;
  }
  const filhos = pai.childCanvas?.nodes || [];
  if (!filhos.length) {
    return `"${pai.name}" está marcado como subprocesso mas ainda não tem nenhum nó dentro.\n`
      + 'Use proposeInChild com esse nodeId para montar o fluxo interno.';
  }

  const prefixo = toAlias.get(pai.id) ?? pai.id;
  const filho = {
    // Sem alias no id: a reescrita de prefixo abaixo é textual e morderia o
    // próprio cabeçalho, transformando "cv_x#n02" em "cv_x#n02.2".
    id: `${canvas.id}#sub`,
    name: `${pai.name} — subprocesso`,
    rev: canvas.rev,
    nodes: filhos,
    connections: pai.childCanvas.connections || [],
    notes: [],
  };

  const corpo = canvasOutline(filho, { area, includeEdges });
  // Reescreve os aliases locais (n01) para o formato endereçável (n02.1).
  const comPrefixo = corpo.replace(/\bn(\d{2})\b/g, (_, num) => `${prefixo}.${Number(num)}`);

  return `SUBPROCESSO de ${prefixo} "${pai.name}"\n`
    + `(um nível abaixo de ${canvas.id}; para voltar, chame sem nodeId)\n\n`
    + comPrefixo;
}

/**
 * @param {object} canvas
 * @param {{area?: string|null, includeEdges?: boolean, into?: string|null}} opts
 *   `into` = alias (`n02`) ou id de um nó com subprocesso. Faz o outline descer
 *   um nível e descrever o canvas FILHO em vez do raiz.
 *
 *   Sem isto, o agente escrevia dentro do subprocesso pela op `proposeInChild` e
 *   nunca conseguia reler o que escreveu — o outline mostrava `filho↓7` e parava.
 *   Ajustar um passo lá dentro virava adivinhação, e uma sessão nova começava
 *   sem nenhuma informação sobre metade do mapa.
 */
export function canvasOutline(canvas, { area = null, includeEdges = true, into = null } = {}) {
  if (into) return outlineDoFilho(canvas, into, { area, includeEdges });

  const { toAlias } = buildAliases(canvas);
  const lines = [];

  lines.push(`${canvas.id} "${canvas.name}"  rev=${canvas.rev}  ${canvas.nodes.length} nós, ${canvas.connections.length} arestas`);
  if (canvas.lanes?.length) {
    lines.push('RAIAS: ' + canvas.lanes.map((l) => `${l.id}=${l.name}`).join('  '));
  }
  lines.push('');

  const visible = area ? canvas.nodes.filter((n) => n.area === area) : canvas.nodes;
  if (!visible.length) {
    lines.push('(canvas vazio)');
    return lines.join('\n');
  }

  const width = Math.max(...visible.map((n) => (BPMN_SHORT[n.bpmn?.elementType] ?? n.type).length));

  for (const node of visible) {
    const alias = toAlias.get(node.id);
    const kind = (BPMN_SHORT[node.bpmn?.elementType] ?? node.type).padEnd(width);
    const flags = [];

    flags.push(node.owner ? `dono:${node.owner}` : 'dono:—');
    if (node.area && node.area !== 'geral') flags.push(`[${node.area}]`);
    if (node.duration) flags.push(`tempo:${node.duration}`);
    if (node.bottleneck) {
      const cats = node.bottleneckCategories?.length ? node.bottleneckCategories : ['sem-categoria'];
      flags.push(`!gargalo(${cats.join('+')})`);
    }
    const m = node.metrics ?? {};
    if (m.cycleTimeMin?.value || m.waitTimeMin?.value) {
      flags.push(`⏱${humanMinutes(m.cycleTimeMin?.value)}/${humanMinutes(m.waitTimeMin?.value)}`);
    }
    if (m.volumePerMonth?.value) flags.push(`×${m.volumePerMonth.value}/mês`);
    if (m.costPerRun?.value) flags.push(`R$${m.costPerRun.value}`);
    if (m.reworkRate?.value) flags.push(`↻${Math.round(m.reworkRate.value * 100)}%`);

    if (node.tools) flags.push(`ferr:${node.toolsList?.join('/') ?? node.tools}`);
    if (node.subprocesses?.length) flags.push(`sub:${node.subprocesses.length}`);
    if (node.refs?.length) flags.push(`refs:${node.refs.length}`);
    // Diz COMO descer, não só que dá. O agente lê o outline e descobre a
    // ferramenta sozinho, sem precisar que a descrição da tool ensine.
    if (node.childCanvas?.nodes?.length) {
      flags.push(`filho↓${node.childCanvas.nodes.length} (nodeId=${alias})`);
    }
    if (node.status && node.status !== 'pendente') flags.push(node.status);

    // O til marca o que o agente inferiu e o consultor ainda não conferiu.
    // Sem isso, o agente relê o próprio palpite como se fosse fato apurado.
    const unconfirmed = Object.entries(node.fieldMeta || {})
      .filter(([f, m]) => m.source === 'agent' && !m.confirmed
        && ['inferred', 'assumed'].includes(m.epistemic) && !['x', 'y'].includes(f))
      .map(([f]) => f);
    const mark = unconfirmed.length ? `  ~${unconfirmed.length} a confirmar` : '';

    lines.push(`${alias} ${kind}  "${node.name || '(sem nome)'}"  ${flags.join('  ')}${mark}`);
  }

  if (includeEdges && canvas.connections.length) {
    lines.push('');
    for (const conn of canvas.connections) {
      const from = toAlias.get(conn.from) ?? conn.from;
      const to = toAlias.get(conn.to) ?? conn.to;
      // Gargalo da passagem entra na linha da aresta. Sem isto o campo nasceria
      // cego — o erro que este projeto já cometeu com o subprocesso e os refs.
      const g = conn.gargalo?.texto
        ? `  !gargalo(${conn.gargalo.categorias.join('+') || 'sem-categoria'}): ${conn.gargalo.texto}`
        : '';
      lines.push(`${from} -> ${to}${conn.label ? `  "${conn.label}"` : ''}${g}`);
    }
  }

  // ── Camada de Medição ──
  // Nasce legível de propósito. O subprocesso e os `refs` foram escritos pelo
  // agente e ficaram ilegíveis para ele por meses; breakpoint não repete isso.
  const bps = canvas.breakpoints || [];
  if (bps.length) {
    lines.push('');
    lines.push('MEDIÇÃO:');
    for (const bp of bps) {
      const onde = bp.alvo.tipo === 'node'
        ? (toAlias.get(bp.alvo.id) ?? bp.alvo.id)
        : `aresta ${rotuloDaAresta(canvas, toAlias, bp.alvo.id)}`;
      const malha = bp.malha === 'fechada'
        ? `→ ${bp.consumidor.quem}${bp.consumidor.comoChega ? ` (${bp.consumidor.comoChega})` : ''}`
        : '⚠ MALHA ABERTA: ninguém recebe';
      const ultimo = bp.serie.at(-1);
      const medida = ultimo?.valor != null ? `  último: ${ultimo.valor}${ultimo.unidade}` : '';
      lines.push(`  ${bp.id} em ${onde}  "${bp.oQueMede}"  ${bp.cadencia}  ${malha}  [${bp.evidencia}]${medida}`);
    }
  }

  // ── Oportunidades de receita ──
  // Agrupadas por aresta, porque é da passagem que elas pendem. O corpo em
  // Markdown NÃO entra aqui: um outline de 60 nós já custa ~1.5k tokens, e
  // despejar o texto de cada anotação estouraria o orçamento que justifica a
  // existência desta view. Quem quiser o conteúdo chama get_oportunidades.
  const ops = canvas.oportunidades || [];
  if (ops.length) {
    lines.push('');
    lines.push('OPORTUNIDADES DE RECEITA:');
    const porAresta = new Map();
    for (const op of ops) {
      if (!porAresta.has(op.arestaId)) porAresta.set(op.arestaId, []);
      porAresta.get(op.arestaId).push(op);
    }
    for (const [arestaId, lista] of porAresta) {
      lines.push(`  em ${rotuloDaAresta(canvas, toAlias, arestaId)}:`);
      for (const op of lista) {
        const linhas = op.markdown ? ` (${op.markdown.split('\n').length} linha(s) de nota)` : ' (sem nota)';
        lines.push(`    ${op.id}  "${op.titulo}"${linhas}`);
      }
    }
  }

  // O que o agente precisa saber antes de propor, sem ter que deduzir.
  const problems = diagnose(canvas, toAlias);
  if (problems.length) {
    lines.push('');
    lines.push('ATENÇÃO:');
    for (const p of problems) lines.push('  · ' + p);
  }

  return lines.join('\n');
}

/** Problemas estruturais óbvios, calculados — não opinião. */
export function diagnose(canvas, toAlias = buildAliases(canvas).toAlias) {
  const out = [];
  if (!canvas.nodes.length) return out;

  const a = (id) => toAlias.get(id) ?? id;

  const starts = canvas.nodes.filter((n) => n.bpmn?.elementType === 'startEvent');
  const ends = canvas.nodes.filter((n) => n.bpmn?.elementType === 'endEvent');
  if (!starts.length) out.push('nenhum evento de início');
  if (!ends.length) out.push('nenhum evento de fim');
  if (starts.length > 1) {
    out.push(`${starts.length} eventos de início (${starts.map((n) => a(n.id)).join(', ')}) — ` +
      `são processos distintos no mesmo canvas? considere separar ou usar subprocesso`);
  }

  const touched = new Set();
  for (const c of canvas.connections) { touched.add(c.from); touched.add(c.to); }
  const isolated = canvas.nodes.filter((n) => !touched.has(n.id));
  if (isolated.length) {
    out.push(`nós soltos (sem nenhuma conexão): ${isolated.map((n) => a(n.id)).join(', ')}`);
  }

  // Tipo visual e elemento BPMN divergentes: o agente lê o rótulo BPMN, então
  // uma decisão marcada como tarefa some do raciocínio dele.
  const FAMILY = { trigger: 'start', action: 'activity', wait: 'intermediate', condition: 'gateway', output: 'end' };
  const OF = {
    startEvent: 'start', endEvent: 'end', intermediateCatchEvent: 'intermediate',
    intermediateThrowEvent: 'intermediate', task: 'activity', userTask: 'activity',
    serviceTask: 'activity', manualTask: 'activity', scriptTask: 'activity',
    subProcess: 'activity', callActivity: 'activity', exclusiveGateway: 'gateway',
    parallelGateway: 'gateway', inclusiveGateway: 'gateway',
  };
  const mismatched = canvas.nodes.filter((n) => OF[n.bpmn?.elementType] !== FAMILY[n.type]);
  if (mismatched.length) {
    out.push(`tipo visual e elemento BPMN divergem: ${mismatched.map((n) => `${a(n.id)} (${n.type}/${n.bpmn?.elementType})`).join(', ')}`);
  }

  // Decisão que não decide.
  const outDegree = new Map();
  const inDegree = new Map();
  for (const c of canvas.connections) {
    outDegree.set(c.from, (outDegree.get(c.from) ?? 0) + 1);
    inDegree.set(c.to, (inDegree.get(c.to) ?? 0) + 1);
  }
  const deadGateways = canvas.nodes.filter(
    (n) => OF[n.bpmn?.elementType] === 'gateway' && (outDegree.get(n.id) ?? 0) < 2,
  );
  if (deadGateways.length) {
    out.push(`decisão com menos de duas saídas: ${deadGateways.map((n) => a(n.id)).join(', ')}`);
  }

  // Nomes iguais tornam a conversa com o agente ambígua.
  const byName = {};
  for (const n of canvas.nodes) (byName[n.name.trim().toLowerCase()] ??= []).push(n.id);
  const dupes = Object.entries(byName).filter(([k, v]) => k && v.length > 1);
  if (dupes.length) {
    out.push(`nomes repetidos: ${dupes.map(([k, v]) => `"${k}" (${v.map(a).join(', ')})`).join('; ')}`);
  }

  // Fim inalcançável: processo que não termina.
  if (starts.length && ends.length) {
    const adj = new Map();
    for (const c of canvas.connections) {
      if (!adj.has(c.from)) adj.set(c.from, []);
      adj.get(c.from).push(c.to);
    }
    const seen = new Set();
    const stack = starts.map((n) => n.id);
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of adj.get(id) ?? []) stack.push(next);
    }
    const unreachableEnds = ends.filter((n) => !seen.has(n.id));
    if (unreachableEnds.length) {
      out.push(`fim inalcançável a partir do início: ${unreachableEnds.map((n) => a(n.id)).join(', ')}`);
    }
    const unreachable = canvas.nodes.filter((n) => !seen.has(n.id) && touched.has(n.id));
    if (unreachable.length) {
      out.push(`nós inalcançáveis a partir do início: ${unreachable.map((n) => a(n.id)).join(', ')}`);
    }
  }

  // Gargalo sem número não sustenta o diagnóstico na frente do cliente.
  const semMetrica = canvas.nodes.filter(
    (n) => n.bottleneck && !n.metrics?.volumePerMonth?.value && !n.metrics?.cycleTimeMin?.value,
  );
  if (semMetrica.length) {
    out.push(`gargalo sem métrica (volume ou tempo): ${semMetrica.map((n) => a(n.id)).join(', ')} — ` +
      `sem número não dá para dimensionar nem comparar depois`);
  }

  // Legibilidade: o agente não tem olhos para ver que fez um emaranhado.
  const overlaps = findOverlaps(canvas);
  if (overlaps.length) {
    out.push(`cards sobrepostos: ${overlaps.slice(0, 5).map(([x, y]) => `${a(x)}↔${a(y)}`).join(', ')}` +
      `${overlaps.length > 5 ? ` e mais ${overlaps.length - 5}` : ''} — use suggest_layout`);
  }
  const crossings = findCrossings(canvas);
  if (crossings.length > 2) {
    out.push(`${crossings.length} cruzamentos de aresta — o desenho está ilegível; ` +
      `chame suggest_layout e proponha o setLayout resultante`);
  }

  const noOwner = canvas.nodes.filter((n) => !n.owner);
  if (noOwner.length) {
    out.push(`sem dono definido: ${noOwner.map((n) => toAlias.get(n.id)).join(', ')}`);
  }

  const pending = canvas.nodes.reduce((acc, n) => acc + Object.entries(n.fieldMeta || {})
    .filter(([f, m]) => m.source === 'agent' && !m.confirmed
      && ['inferred', 'assumed'].includes(m.epistemic) && !['x', 'y'].includes(f)).length, 0);
  if (pending) {
    out.push(`${pending} campo(s) inferidos ainda não confirmados pelo consultor — ` +
      `marcados com ~ acima. Não afirme esses pontos como fato apurado.`);
  }

  // ── Medição ───────────────────────────────────────────────────────────────
  const bps = canvas.breakpoints || [];
  const abertos = bps.filter((b) => b.malha === 'aberta');
  if (abertos.length) {
    out.push(
      `${abertos.length} ponto(s) de medição em MALHA ABERTA: ` +
      abertos.map((b) => `${b.id} ("${b.oQueMede}")`).join(', ') +
      ' — o dado é coletado e não chega em ninguém que possa agir. ' +
      'Medir sem destinatário não corrige processo, só produz relatório.',
    );
  }

  // ── Oportunidade de receita ───────────────────────────────────────────────
  // Mantém a cobrança que o par achado/hipótese fazia, na gramática nova: não
  // basta apontar onde trava, tem que dizer onde está o dinheiro.
  const opsRec = canvas.oportunidades || [];
  const gargalosDeAresta = (canvas.connections || []).filter((c) => c.gargalo?.texto);
  const semOportunidade = gargalosDeAresta.filter((c) => !opsRec.some((o) => o.arestaId === c.id));
  if (semOportunidade.length) {
    out.push(`${semOportunidade.length} gargalo(s) de passagem sem oportunidade de receita mapeada: ` +
      semOportunidade.map((c) => rotuloDaAresta(canvas, toAlias, c.id)).join(', ') +
      ' — apontar onde trava é diagnóstico; o cliente aprova o projeto pelo que se ganha ao destravar');
  }

  // Gargalo declarado e nunca medido é opinião com aparência de diagnóstico.
  const gargalosSemMedicao = canvas.nodes.filter((n) => n.bottleneck
    && !bps.some((b) => b.alvo.tipo === 'node' && b.alvo.id === n.id));
  if (gargalosSemMedicao.length && bps.length) {
    out.push(`gargalo sem ponto de medição: ${gargalosSemMedicao.map((n) => a(n.id)).join(', ')} — ` +
      'sem medir, não dá para provar que a intervenção funcionou');
  }

  // ── Subprocessos ──────────────────────────────────────────────────────────
  for (const node of canvas.nodes) {
    const div = divergenciaSubprocesso(node);
    if (div) {
      const sinal = div.desvio > 0 ? '+' : '';
      out.push(
        `${a(node.id)} "${node.name}": ${humanMinutes(div.declarado)} declarado no nó contra ` +
        `${humanMinutes(div.somado)} somados nos ${div.filhos} passos do subprocesso ` +
        `(${sinal}${Math.round(div.desvio * 100)}%). O número usado nas estatísticas é o somado. ` +
        `Confira: ou o nó pai está desatualizado, ou a soma está contando ramos que se excluem ` +
        `(o "sim" e o "não" de uma decisão) ou espera em paralelo.`,
      );
    }

    // Estrutura do filho: hoje um subprocesso sem início/fim ou com nó solto
    // passava 100% invisível pelo validate_canvas.
    const filhos = node.childCanvas?.nodes || [];
    if (!filhos.length) continue;
    const problemasFilho = diagnoseEstrutura({
      nodes: filhos,
      connections: node.childCanvas.connections || [],
    });
    for (const p of problemasFilho) {
      out.push(`dentro do subprocesso de ${a(node.id)} "${node.name}": ${p}`);
    }
  }

  return out;
}

/**
 * Checagens estruturais mínimas, reaproveitáveis em qualquer canvas — inclusive
 * no filho, que não tem aliases próprios nem passa pelo `diagnose` completo
 * (rodar o diagnóstico inteiro lá dentro repetiria avisos de layout e de campos
 * a confirmar que já aparecem no nível de cima).
 */
function diagnoseEstrutura(canvas) {
  const out = [];
  const nome = (n) => `"${n.name || '(sem nome)'}"`;

  const starts = canvas.nodes.filter((n) => n.type === 'trigger');
  const ends = canvas.nodes.filter((n) => n.type === 'output');
  if (canvas.nodes.length && !starts.length) out.push('nenhum passo de início');
  if (canvas.nodes.length && !ends.length) out.push('nenhum passo de fim');

  const ligados = new Set();
  for (const c of canvas.connections) { ligados.add(c.from); ligados.add(c.to); }
  const soltos = canvas.nodes.filter((n) => !ligados.has(n.id));
  if (soltos.length && canvas.nodes.length > 1) {
    out.push(`passo(s) sem nenhuma conexão: ${soltos.map(nome).join(', ')}`);
  }

  const semDono = canvas.nodes.filter((n) => !n.owner);
  if (semDono.length) out.push(`sem dono: ${semDono.map(nome).join(', ')}`);

  return out;
}

/**
 * Métricas EFETIVAS de um nó: quando ele é um subprocesso (`mode=canvas`) com
 * filhos que têm números, o que vale é a soma dos filhos.
 *
 * Por que somar: o pai era preenchido à mão e ninguém conferia contra o
 * detalhamento. Um pai declarando 12min sobre filhos que somam 17 fazia o número
 * comercial contradizer o próprio mapa, em silêncio — e é esse número que
 * sustenta o "antes e depois" da consultoria.
 *
 * Por que NÃO gravar em disco: o valor do pai pode ter vindo de cronômetro na
 * operação, e os filhos serem estimativa. Calcular na leitura entrega o mesmo
 * comportamento sem destruir a medição. A divergência vira aviso no `diagnose`.
 *
 * LIMITE CONHECIDO, herdado do lead time do canvas raiz: a soma ignora a
 * topologia. Ramos que se excluem (o "sim" e o "não" de uma decisão) são somados
 * como se fossem sequenciais, então o total superestima quando há caminho
 * alternativo. É por isso que o diagnóstico sugere conferir em vez de mandar
 * corrigir.
 */
export function rollupMetrics(node) {
  const proprias = node.metrics ?? {};
  if (node.subprocessMode !== 'canvas') return proprias;

  const filhos = node.childCanvas?.nodes || [];
  if (!filhos.length) return proprias;

  const soma = (campo) => filhos.reduce((t, f) => t + (f.metrics?.[campo]?.value ?? 0), 0);
  const cycle = soma('cycleTimeMin');
  const wait = soma('waitTimeMin');
  if (!cycle && !wait) return proprias;   // filhos sem número não apagam o pai

  return {
    ...proprias,
    cycleTimeMin: { value: cycle, unit: 'min', deSubprocesso: true },
    waitTimeMin: { value: wait, unit: 'min', deSubprocesso: true },
  };
}

/** Soma declarada vs. calculada, para o diagnóstico de divergência. */
export function divergenciaSubprocesso(node) {
  if (node.subprocessMode !== 'canvas') return null;
  const filhos = node.childCanvas?.nodes || [];
  if (!filhos.length) return null;

  const declarado = (node.metrics?.cycleTimeMin?.value ?? 0) + (node.metrics?.waitTimeMin?.value ?? 0);
  const somado = filhos.reduce(
    (t, f) => t + (f.metrics?.cycleTimeMin?.value ?? 0) + (f.metrics?.waitTimeMin?.value ?? 0), 0,
  );
  if (!declarado || !somado) return null;

  const desvio = (somado - declarado) / declarado;
  if (Math.abs(desvio) <= 0.1) return null;   // 10% de tolerância
  return { declarado, somado, desvio, filhos: filhos.length };
}

/** Contagens baratas — substituem uma leitura completa. */
export function canvasStats(canvas) {
  const byType = {};
  const byArea = {};
  const byLean = {};
  let missingOwner = 0;
  let bottlenecks = 0;
  const tools = new Set();

  // Quantos nós tiveram o tempo somado a partir do subprocesso — é o que permite
  // ao agente dizer de onde veio o número em vez de afirmá-lo cru.
  let comSubprocesso = 0;
  let cycleTotal = 0;
  let waitTotal = 0;
  let annualCost = 0;
  const costlyBottlenecks = [];

  for (const node of canvas.nodes) {
    byType[node.type] = (byType[node.type] ?? 0) + 1;
    byArea[node.area] = (byArea[node.area] ?? 0) + 1;
    if (!node.owner) missingOwner++;
    if (node.bottleneck) {
      bottlenecks++;
      for (const cat of node.bottleneckCategories?.length ? node.bottleneckCategories : ['outro']) {
        byLean[cat] = (byLean[cat] ?? 0) + 1;
      }
    }
    for (const t of node.toolsList ?? []) tools.add(t.toLowerCase());

    // Métrica EFETIVA: num nó com subprocesso, vale a soma dos filhos. O escopo
    // segue sendo a camada de cima — os filhos entram pelo pai, contados uma vez
    // só, sem dupla contagem.
    const m = rollupMetrics(node);
    if (m.cycleTimeMin?.deSubprocesso) comSubprocesso++;
    cycleTotal += m.cycleTimeMin?.value ?? 0;
    waitTotal += m.waitTimeMin?.value ?? 0;

    /**
     * Custo anual do gargalo.
     *
     * volume × 12 × custo por execução × taxa de retrabalho. É a frase que faz
     * o cliente aprovar o projeto — "este handoff custa R$ 84 mil por ano" —
     * e o número que permite comparar o antes e o depois da consultoria.
     */
    const vol = m.volumePerMonth?.value;
    const cost = m.costPerRun?.value;
    const rate = m.reworkRate?.value;
    if (vol && cost) {
      const custo = vol * 12 * cost * (node.bottleneck ? (rate ?? 1) : 1);
      if (node.bottleneck) {
        annualCost += custo;
        costlyBottlenecks.push({ nodeId: node.id, name: node.name, annualCost: Math.round(custo) });
      }
    }
  }

  costlyBottlenecks.sort((a, b) => b.annualCost - a.annualCost);

  const pendingValidation = canvas.nodes.reduce((acc, n) => acc + Object.entries(n.fieldMeta || {})
    .filter(([f, meta]) => meta.source === 'agent' && !meta.confirmed
      && ['inferred', 'assumed'].includes(meta.epistemic) && !['x', 'y'].includes(f)).length, 0);

  return {
    nodes: canvas.nodes.length,
    edges: canvas.connections.length,
    byType, byArea, byLean,
    missingOwner, bottlenecks,
    distinctTools: tools.size,
    rev: canvas.rev,
    pendingValidation,
    metrics: {
      cycleTimeMin: cycleTotal,
      waitTimeMin: waitTotal,
      leadTimeMin: cycleTotal + waitTotal,
      // A razão entre parado e total é o indicador mais direto de desperdício.
      waitShare: cycleTotal + waitTotal > 0 ? waitTotal / (cycleTotal + waitTotal) : null,
      annualBottleneckCost: Math.round(annualCost),
      costlyBottlenecks: costlyBottlenecks.slice(0, 5),
      nosComTempoDeSubprocesso: comSubprocesso,
    },
  };
}

/** Minutos em algo legível: 90 → "1h30", 2880 → "2d". */
export function humanMinutes(min) {
  if (!min) return '—';
  if (min < 60) return `${Math.round(min)}min`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  const d = min / (60 * 24);
  return `${d % 1 === 0 ? d : d.toFixed(1)}d`;
}
