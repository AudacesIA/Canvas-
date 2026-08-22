/**
 * Schema v2 — semântica BPMN por baixo, campos proprietários por cima.
 *
 * Como não há canvases legados para preservar, o v2 vale desde o primeiro
 * documento: não existe migração preguiçosa, nem `schemaVersion: 1` em disco.
 *
 * Três blocos além dos campos que o app já editava:
 *
 *  - `bpmn`      dá rigor ao que o `type` visual só sugere, e é o que permite
 *                exportar BPMN 2.0 e o agente raciocinar sobre gateways.
 *  - `refs`      referências metodológicas com rótulo epistêmico — a diferença
 *                entre "o cliente disse" e "eu deduzi" fica no dado, não na
 *                memória de quem leu.
 *  - `fieldMeta` quem escreveu cada campo e se está travado. É o que faz o
 *                agente propor sem atropelar, e o auto-layout respeitar
 *                posição arrastada à mão.
 */

import { DEFAULT_VOCABULARY, idsOf } from './vocabulary.js';

export const SCHEMA_VERSION = 2;

export const NODE_TYPES = ['trigger', 'action', 'wait', 'condition', 'output'];

// Listas do padrão Audasys. A validação estrita usa o vocabulário resolvido do
// cliente (server/core/vocabulary.js); estas são o fallback e o superconjunto,
// para que a hidratação nunca descarte um valor legítimo de outra empresa.
export const AREAS = idsOf(DEFAULT_VOCABULARY.areas);
export const STATUSES = ['pendente', 'mapeamento', 'concluido'];
export const FREQUENCIES = ['demanda', 'diario', 'semanal', 'mensal'];

export const LEAN_CATEGORIES = idsOf(DEFAULT_VOCABULARY.wasteCategories);

export const BPMN_ELEMENTS = [
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent',
  'task', 'userTask', 'serviceTask', 'manualTask', 'scriptTask',
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway',
  'subProcess', 'callActivity',
];

export const EVENT_DEFINITIONS = ['timer', 'message', 'signal', 'conditional', 'error', 'none'];
export const GATEWAY_DIRECTIONS = ['diverging', 'converging', 'mixed'];

/** Rótulo epistêmico: o quanto se pode confiar na afirmação anexada. */
export const EPISTEMIC = ['documented', 'observed', 'reported', 'inferred', 'assumed', 'prescribed'];
export const REF_KINDS = ['methodology', 'policy', 'sop', 'transcript', 'spreadsheet', 'screenshot', 'regulation', 'note'];

export const PROVENANCE_SOURCES = ['user', 'agent', 'import'];

/** O tipo visual determina a família BPMN; o agente refina dentro dela. */
const TYPE_TO_BPMN = {
  trigger: 'startEvent',
  action: 'task',
  wait: 'intermediateCatchEvent',
  condition: 'exclusiveGateway',
  output: 'endEvent',
};

/**
 * Família de cada elemento. Trocar `task` por `userTask` é refinamento e fica;
 * trocar `task` por `exclusiveGateway` é incoerência com o tipo visual e é
 * corrigido.
 */
const FAMILY_OF = {
  startEvent: 'start',
  endEvent: 'end',
  intermediateCatchEvent: 'intermediate',
  intermediateThrowEvent: 'intermediate',
  task: 'activity',
  userTask: 'activity',
  serviceTask: 'activity',
  manualTask: 'activity',
  scriptTask: 'activity',
  subProcess: 'activity',
  callActivity: 'activity',
  exclusiveGateway: 'gateway',
  parallelGateway: 'gateway',
  inclusiveGateway: 'gateway',
};

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * Número ou `null` — nunca zero por acidente.
 *
 * `Number(null)` é 0, e 0 é finito. Um guard escrito como
 * `Number.isFinite(Number(v)) ? Number(v) : null` transforma `null` em 0 na
 * SEGUNDA hidratação: a primeira grava null, a segunda lê null e devolve zero.
 * O efeito era um card de oportunidade nascendo colado no canto do canvas em
 * vez de empilhado no asterisco, e só aparecia depois de dois ciclos de save.
 */
const numeroOuNulo = (v) => (v === null || v === undefined || v === ''
  || !Number.isFinite(Number(v)) ? null : Number(v));

export function nodeDefaults() {
  return {
    type: 'action',
    x: 0,
    y: 0,
    name: '',
    description: '',
    owner: '',
    triggerCond: '',
    outputCond: '',
    tools: '',
    bottleneck: '',
    bottleneckCategory: '',
    bottleneckCategories: [],
    subprocesses: [],
    subprocessMode: 'checklist',
    childCanvas: { nodes: [], connections: [], nextNodeId: 1 },
    switchField: '',
    switchCases: [],
    outcomeType: 'success',
    waitType: 'tempo_fixo',
    waitDuration: '',
    waitTrigger: '',
    scriptConditions: [],
    duration: '',
    frequency: 'diario',
    area: 'geral',
    status: 'pendente',
  };
}

export function bpmnDefaults(type = 'action') {
  return {
    elementType: TYPE_TO_BPMN[type] ?? 'task',
    eventDefinition: null,
    gatewayDirection: type === 'condition' ? 'diverging' : null,
    poolId: null,
    laneId: null,
    documentation: '',
  };
}

/** Aceita subprocessos como string (formato antigo) ou {text, done}. */
export function normalizeSubprocesses(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (typeof item === 'string') return { text: item, done: false };
      if (item && typeof item === 'object') return { text: String(item.text ?? ''), done: !!item.done };
      return null;
    })
    .filter(Boolean);
}

/**
 * Métricas numéricas tipadas.
 *
 * "63% da demanda", "79 conversas de correção de endereço" e "7 a 27 dias"
 * existiam apenas como prosa dentro do campo de gargalo. Não dava para
 * filtrar, ordenar, somar lead time nem comparar antes e depois — e é a
 * comparação antes/depois que justifica o preço da consultoria.
 *
 * `cycleTime` é o tempo de trabalho; `waitTime` é o tempo parado. A distância
 * entre os dois é onde mora o desperdício, e por isso são campos separados.
 */
export const METRIC_UNITS = {
  cycleTimeMin: 'min',
  waitTimeMin: 'min',
  volumePerMonth: 'exec/mês',
  costPerRun: 'BRL',
  reworkRate: 'ratio',
};

export function hydrateMetrics(raw, legacyDurationMinutes = null) {
  const out = {};
  for (const [key, unit] of Object.entries(METRIC_UNITS)) {
    const entry = raw?.[key];
    const value = typeof entry === 'object' && entry !== null ? entry.value : entry;
    const n = Number(value);
    out[key] = Number.isFinite(n) && value !== null && value !== ''
      ? { value: key === 'reworkRate' ? Math.min(1, Math.max(0, n)) : n, unit }
      : { value: null, unit };
  }
  // `durationMinutes` era um campo fantasma: null em 18 de 18 nós, ausente do
  // MCP e da interface. Absorvido aqui para não deixar dado órfão.
  if (out.cycleTimeMin.value === null && Number.isFinite(Number(legacyDurationMinutes))) {
    out.cycleTimeMin = { value: Number(legacyDurationMinutes), unit: 'min' };
  }
  return out;
}

export function hydrateRef(raw, index = 0) {
  const kind = oneOf(raw?.kind, REF_KINDS, 'note');
  return {
    id: raw?.id ?? `nref_${index + 1}`,
    refId: raw?.refId ?? null,
    kind,
    label: String(raw?.label ?? ''),
    epistemic: oneOf(raw?.epistemic, EPISTEMIC, 'reported'),
    source: {
      type: raw?.source?.type ?? 'text',
      attachmentSha: raw?.source?.attachmentSha ?? null,
      url: raw?.source?.url ?? null,
      locator: raw?.source?.locator ?? '',
    },
    quote: String(raw?.quote ?? ''),
    confidence: typeof raw?.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : null,
    addedBy: oneOf(raw?.addedBy, PROVENANCE_SOURCES, 'agent'),
    addedAt: raw?.addedAt ?? new Date().toISOString(),
  };
}

/**
 * `fieldMeta` só guarda entradas de campos que alguém realmente escreveu —
 * um mapa com os 25 campos por nó seria puro peso morto no JSON.
 */
export function hydrateFieldMeta(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [field, meta] of Object.entries(raw)) {
    if (!meta || typeof meta !== 'object') continue;
    const source = oneOf(meta.source, PROVENANCE_SOURCES, 'agent');
    out[field] = {
      source,
      at: meta.at ?? new Date().toISOString(),
      locked: !!meta.locked,
      // Sem `epistemic` declarado, a suposição conservadora é que o agente
      // deduziu — nunca que alguém afirmou. Um mapa que passa inferência por
      // relato é o que não se sustenta na reunião de validação com o cliente.
      epistemic: oneOf(meta.epistemic, EPISTEMIC, source === 'user' ? 'documented' : 'inferred'),
      // O que o consultor digitou nasce confirmado; o que o agente escreveu, não.
      confirmed: meta.confirmed ?? source === 'user',
      confirmedAt: meta.confirmedAt ?? null,
      ...(meta.runId ? { runId: meta.runId } : {}),
    };
  }
  return out;
}

export function hydrateProvenance(raw) {
  const now = new Date().toISOString();
  return {
    createdBy: oneOf(raw?.createdBy, PROVENANCE_SOURCES, 'user'),
    createdAt: raw?.createdAt ?? now,
    updatedBy: oneOf(raw?.updatedBy, PROVENANCE_SOURCES, 'user'),
    updatedAt: raw?.updatedAt ?? now,
    lastAgentRunId: raw?.lastAgentRunId ?? null,
  };
}

/**
 * @param {object} raw
 * @param {{profundidade?: number}} opts  profundidade 1 = já estamos dentro de um
 *   subprocesso; impede descer de novo. Subprocesso aninhado é proibido na
 *   validação (ops.js), e sem esta guarda um `childCanvas` corrompido apontando
 *   para si mesmo derruba o servidor por recursão infinita.
 */
export function hydrateNode(raw, { profundidade = 0 } = {}) {
  const node = { ...nodeDefaults(), ...(raw || {}) };
  node.id = raw?.id;
  node.type = oneOf(node.type, NODE_TYPES, 'action');
  node.x = Number.isFinite(Number(node.x)) ? Math.round(Number(node.x)) : 0;
  node.y = Number.isFinite(Number(node.y)) ? Math.round(Number(node.y)) : 0;

  node.area = oneOf(node.area, AREAS, 'geral');
  node.status = oneOf(node.status, STATUSES, 'pendente');
  node.frequency = oneOf(node.frequency, FREQUENCIES, 'diario');

  /**
   * Gargalo com mais de uma causa.
   *
   * Um desperdício real raramente é de um tipo só: o reenvio prematuro da
   * Berenice é retrabalho *causado por* política errada, e forçar um valor
   * único obrigou o agente a escolher `superprod`, que não descrevia nada.
   * O singular continua aceito na escrita e vira o primeiro do array; o array
   * é a fonte de verdade daqui para frente.
   */
  const cats = Array.isArray(raw?.bottleneckCategories) && raw.bottleneckCategories.length
    ? raw.bottleneckCategories
    : (node.bottleneckCategory ? [node.bottleneckCategory] : []);
  node.bottleneckCategories = [...new Set(cats.map((c) => oneOf(c, LEAN_CATEGORIES, 'outro')))];
  node.bottleneckCategory = node.bottleneckCategories[0] ?? '';

  // Campos que o app faz .trim()/.toLowerCase() sem checar.
  for (const key of ['name', 'description', 'owner', 'triggerCond', 'outputCond',
                     'tools', 'bottleneck', 'duration', 'waitDuration', 'waitTrigger', 'switchField']) {
    if (typeof node[key] !== 'string') node[key] = String(node[key] ?? '');
  }

  node.subprocesses = normalizeSubprocesses(node.subprocesses);
  for (const key of ['switchCases', 'scriptConditions']) {
    if (!Array.isArray(node[key])) node[key] = [];
  }
  if (!node.childCanvas || typeof node.childCanvas !== 'object') {
    node.childCanvas = { nodes: [], connections: [], nextNodeId: 1 };
  }
  /**
   * Os nós do subprocesso passam pela MESMA hidratação do canvas raiz.
   *
   * Antes, `childCanvas` só era garantido como objeto e os nós de dentro
   * ficavam crus: sem `toolsList`, sem `metrics` no formato {value, unit}, sem
   * `bpmn.elementType`. Qualquer view ou soma aplicada sobre eles devolvia
   * `undefined` — foi o que impediu tanto ler quanto contabilizar o filho.
   */
  const filhos = node.childCanvas.nodes || [];
  node.childCanvas = {
    connections: [],
    nextNodeId: 1,
    ...node.childCanvas,
    // Já estando dentro de um subprocesso, NÃO desce mais — mas também não
    // mexe: devolver [] aqui apagaria dado na gravação, que é o tipo de perda
    // silenciosa que este projeto já pagou caro uma vez.
    nodes: profundidade >= 1 ? filhos : filhos.map((f) => hydrateNode(f, { profundidade: 1 })),
  };

  // `tools` continua sendo a string CSV que o painel edita; `toolsList` é a
  // forma derivada, e é ela que o agente e as estatísticas consomem.
  node.toolsList = node.tools.split(',').map((t) => t.trim()).filter(Boolean);

  node.metrics = hydrateMetrics(raw?.metrics, raw?.durationMinutes);

  const bpmn = { ...bpmnDefaults(node.type), ...(raw?.bpmn || {}) };
  bpmn.elementType = oneOf(bpmn.elementType, BPMN_ELEMENTS, TYPE_TO_BPMN[node.type] ?? 'task');

  /**
   * O elemento BPMN segue o tipo visual.
   *
   * Antes o `bpmn` gravado vencia sempre, então trocar o tipo de um nó para
   * `condition` deixava `elementType: 'task'` para trás — e o agente, que lê o
   * rótulo BPMN no outline, via "tarefa" onde havia uma decisão. Aconteceu de
   * fato no primeiro mapa real.
   *
   * A exceção é o refinamento deliberado: quando o agente escolhe `userTask`
   * em vez de `task`, ou `intermediateThrowEvent` em vez de `catch`, isso é
   * informação que o tipo visual não carrega. Nesse caso ele marca
   * `elementTypeExplicit` e a escolha é preservada.
   */
  if (!bpmn.elementTypeExplicit && FAMILY_OF[bpmn.elementType] !== FAMILY_OF[TYPE_TO_BPMN[node.type]]) {
    bpmn.elementType = TYPE_TO_BPMN[node.type] ?? 'task';
    bpmn.gatewayDirection = node.type === 'condition' ? (bpmn.gatewayDirection ?? 'diverging') : null;
  }

  bpmn.eventDefinition = bpmn.eventDefinition ? oneOf(bpmn.eventDefinition, EVENT_DEFINITIONS, null) : null;
  bpmn.gatewayDirection = bpmn.gatewayDirection ? oneOf(bpmn.gatewayDirection, GATEWAY_DIRECTIONS, null) : null;
  bpmn.documentation = String(bpmn.documentation ?? '');
  bpmn.elementTypeExplicit = !!bpmn.elementTypeExplicit;
  node.bpmn = bpmn;

  node.refs = Array.isArray(raw?.refs) ? raw.refs.map(hydrateRef) : [];
  node.fieldMeta = hydrateFieldMeta(raw?.fieldMeta);
  node.provenance = hydrateProvenance(raw?.provenance);

  delete node.rules; // formato pré-switch; não existe mais
  return node;
}

export function hydrateConnection(raw) {
  const bpmn = raw?.bpmn || {};
  return {
    id: raw?.id,
    from: raw?.from,
    to: raw?.to,
    label: typeof raw?.label === 'string' ? raw.label : '',
    ruleId: raw?.ruleId ?? '',
    midX: raw?.midX ?? null,
    midY: raw?.midY ?? null,
    bpmn: {
      flowType: oneOf(bpmn.flowType, ['sequenceFlow', 'messageFlow', 'association'], 'sequenceFlow'),
      conditionExpression: String(bpmn.conditionExpression ?? ''),
    },
    /**
     * Gargalo da PASSAGEM, espelhando `node.bottleneck`.
     *
     * O handoff é o desperdício mais caro do vocabulário Lean e não morava em
     * lugar nenhum: gargalo era campo do nó, e passagem de bastão acontece
     * ENTRE nós. Medido nesta base, 7 arestas no Canvas de Logística e 8 no
     * Projeto Berenice trocam de dono — todos handoffs sem onde ser marcados.
     *
     * Usa a MESMA taxonomia Lean do nó, de propósito: um segundo vocabulário
     * paralelo faria o consultor perguntar onde classifica o quê.
     *
     * Default seguro — canvas gravado antes deste campo abre sem quebrar.
     */
    gargalo: {
      texto: String(raw?.gargalo?.texto ?? ''),
      categorias: Array.isArray(raw?.gargalo?.categorias)
        ? [...new Set(raw.gargalo.categorias.map((c) => oneOf(c, LEAN_CATEGORIES, 'outro')))]
        : [],
    },
    provenance: hydrateProvenance(raw?.provenance),
  };
}

export function hydrateNote(raw) {
  return {
    id: raw?.id,
    x: Math.round(Number(raw?.x) || 0),
    y: Math.round(Number(raw?.y) || 0),
    text: typeof raw?.text === 'string' ? raw.text : '',
    color: raw?.color ?? 'yellow',
  };
}

export function hydratePool(raw, index = 0) {
  return { id: raw?.id ?? `pool_${index + 1}`, name: String(raw?.name ?? 'Organização'), order: Number(raw?.order) || index };
}

export function hydrateLane(raw, index = 0) {
  return {
    id: raw?.id ?? `lane_${index + 1}`,
    poolId: raw?.poolId ?? null,
    name: String(raw?.name ?? 'Raia'),
    area: oneOf(raw?.area, AREAS, 'geral'),
    order: Number(raw?.order) || index,
  };
}

export const POSTURAS = ['realista', 'otimista', 'pessimista', 'exploratorio'];

/**
 * Vínculo de cenário: este canvas é uma versão "e se" de outro.
 *
 * A consultoria mapeia o processo real e depois pergunta "e se a frota fosse
 * dividida?". O cenário precisa ser um canvas de verdade — desenhado, com os nós
 * e as passagens visíveis — mas não pode ser confundido com o processo que a
 * empresa tem hoje. O vínculo é o que separa os dois.
 *
 * `premissa` é obrigatória em espírito: um cenário sem a frase que o originou é
 * um mapa órfão que ninguém consegue contestar seis semanas depois.
 *
 * `postura` NÃO é um multiplicador. "Pessimista" não significa −8%; significa
 * uma premissa mais dura escrita por extenso — "a transportadora do Sul não
 * aceita o volume mínimo". É a diferença entre um cenário que o dono contesta na
 * reunião e um número que ele engole sem entender.
 */
export const OPORTUNIDADE_STATUS = ['ideia', 'simulado', 'validado', 'descartado'];

export function hydrateDerivadoDe(raw) {
  if (!raw || typeof raw !== 'object' || !raw.canvasId) return null;
  return {
    canvasId: String(raw.canvasId),
    premissa: String(raw.premissa ?? ''),
    postura: oneOf(raw.postura, POSTURAS, 'realista'),
    oportunidadeId: raw.oportunidadeId ? String(raw.oportunidadeId) : null,
    comparativoTexto: String(raw.comparativoTexto ?? ''),
    nosRemovidos: Array.isArray(raw.nosRemovidos) ? raw.nosRemovidos : [],
    nosSubstituidos: Array.isArray(raw.nosSubstituidos) ? raw.nosSubstituidos : [],
    nosAdicionados: Array.isArray(raw.nosAdicionados) ? raw.nosAdicionados : [],
    criadoEm: raw.criadoEm ?? new Date().toISOString(),
  };
}

export const CADENCIAS = ['continua', 'diaria', 'semanal', 'mensal', 'eventual'];

/**
 * Breakpoint: onde o processo é medido.
 *
 * Prende-se a um nó (mede o passo) ou a uma ARESTA (mede a passagem de bastão) —
 * o handoff é o desperdício mais caro e mora na aresta, não no retângulo.
 *
 * `malha` é DERIVADA, nunca digitada: sem alguém que receba o dado, a malha está
 * aberta. É a distinção que o desenho carrega no anel — fechado quando o dado
 * chega em quem age, tracejado quando ele é coletado e não vai a lugar nenhum.
 * Medir sem destinatário é o "alerta que cai num e-mail que ninguém lê", e essa
 * é a patologia que a camada de medição existe para tornar visível.
 */
export function hydrateBreakpoint(raw, index = 0) {
  const consumidor = raw?.consumidor || {};
  const quem = String(consumidor.quem ?? '').trim();
  return {
    id: raw?.id ?? `bp_${index + 1}`,
    alvo: {
      tipo: raw?.alvo?.tipo === 'edge' ? 'edge' : 'node',
      id: raw?.alvo?.id ?? null,
    },
    oQueMede: String(raw?.oQueMede ?? ''),
    cadencia: oneOf(raw?.cadencia, CADENCIAS, 'eventual'),
    consumidor: { quem, comoChega: String(consumidor.comoChega ?? '') },
    malha: quem ? 'fechada' : 'aberta',
    evidencia: oneOf(raw?.evidencia, EPISTEMIC, 'assumed'),
    serie: Array.isArray(raw?.serie)
      ? raw.serie.map((p) => ({
          em: String(p?.em ?? ''),
          valor: numeroOuNulo(p?.valor),
          unidade: String(p?.unidade ?? ''),
        }))
      : [],
  };
}


/**
 * Oportunidade de receita: onde há dinheiro na mesa, anotado em Markdown.
 *
 * Substituiu a "hipótese", que tinha enunciado, intervenção, prazo, status e
 * histórico de versões. A troca foi deliberada: rigor por liberdade de escrita.
 * Aqui é bloco de notas — o consultor escreve como quiser, na frente do cliente,
 * sem preencher formulário.
 *
 * Pende de uma ARESTA, não de um nó nem do ponto de medição: a oportunidade
 * costuma morar na passagem de bastão, que é onde o processo perde dinheiro sem
 * ninguém ser dono do prejuízo.
 */
export function hydrateOportunidade(raw, index = 0) {
  return {
    id: raw?.id ?? `op_${index + 1}`,
    arestaId: raw?.arestaId ?? null,
    titulo: String(raw?.titulo ?? ''),
    markdown: String(raw?.markdown ?? ''),
    posturaSugerida: oneOf(raw?.posturaSugerida, POSTURAS, 'realista'),
    status: oneOf(raw?.status, OPORTUNIDADE_STATUS, 'ideia'),
    cenarioId: raw?.cenarioId ? String(raw.cenarioId) : null,
    // Posição própria, arrastável como um nó. `null` = ainda não foi movida, e
    // aí o cliente empilha a partir do asterisco. Sem isto os cards ficavam
    // presos numa fila vertical que se sobrepunha ao resto do mapa.
    x: numeroOuNulo(raw?.x) === null ? null : Math.round(numeroOuNulo(raw.x)),
    y: numeroOuNulo(raw?.y) === null ? null : Math.round(numeroOuNulo(raw.y)),
    criadoEm: raw?.criadoEm ?? new Date().toISOString(),
  };
}

export function hydrateCanvas(raw, { id, clientId } = {}) {
  const doc = raw || {};
  const nodes = Array.isArray(doc.nodes) ? doc.nodes.map(hydrateNode) : [];
  const connections = Array.isArray(doc.connections) ? doc.connections.map(hydrateConnection) : [];

  // Aresta apontando para nó inexistente vira linha invisível e lixo silencioso
  // no JSON — o app simplesmente não a desenha e nunca reclama. Descartar aqui.
  const known = new Set(nodes.map((n) => n.id));
  const edges = connections.filter((c) => known.has(c.from) && known.has(c.to));

  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id ?? doc.id,
    clientId: clientId ?? doc.clientId ?? null,
    name: doc.name ?? 'Sem nome',
    folderId: doc.folderId ?? null,
    // Cenário "e se": null num canvas de processo real.
    derivadoDe: hydrateDerivadoDe(doc.derivadoDe),
    createdAt: doc.createdAt ?? now,
    lastModified: doc.lastModified ?? now,
    rev: Number.isInteger(doc.rev) ? doc.rev : 0,
    pools: Array.isArray(doc.pools) ? doc.pools.map(hydratePool) : [],
    lanes: Array.isArray(doc.lanes) ? doc.lanes.map(hydrateLane) : [],
    nodes,
    connections: edges,
    notes: Array.isArray(doc.notes) ? doc.notes.map(hydrateNote) : [],
    // Camada de Medição. Breakpoint órfão (alvo apagado) é descartado pelo mesmo
    // motivo das arestas órfãs acima: vira bolinha invisível e lixo silencioso.
    breakpoints: (() => {
      const bps = (Array.isArray(doc.breakpoints) ? doc.breakpoints.map(hydrateBreakpoint) : [])
        .filter((bp) => (bp.alvo.tipo === 'node' ? known.has(bp.alvo.id) : edges.some((e) => e.id === bp.alvo.id)));
      return bps;
    })(),
    /**
     * Oportunidades de receita, ancoradas em arestas.
     *
     * Órfã é DESCARTADA, ao contrário do que a hipótese fazia. A hipótese
     * sobrevivia ao breakpoint apagado no servidor, mas na tela o card sumia em
     * silêncio, porque a posição dependia da âncora existir. Dado invisível é
     * pior que dado ausente: ninguém conserta o que não vê.
     */
    oportunidades: (Array.isArray(doc.oportunidades) ? doc.oportunidades.map(hydrateOportunidade) : [])
      .filter((op) => edges.some((e) => e.id === op.arestaId)),
    versoesMapa: Array.isArray(doc.versoesMapa) ? doc.versoesMapa : [],
    mapaProcessoAtual: doc.mapaProcessoAtual && typeof doc.mapaProcessoAtual === 'object' ? doc.mapaProcessoAtual : null,
    zoom: Number(doc.zoom) || 1,
    panOffset: doc.panOffset && typeof doc.panOffset === 'object' ? doc.panOffset : { x: 100, y: 100 },
    nextNodeId: Number.isInteger(doc.nextNodeId) ? doc.nextNodeId : 1,
    nextNoteId: Number.isInteger(doc.nextNoteId) ? doc.nextNoteId : 1,
    _droppedEdges: connections.length - edges.length,
  };
}

export function emptyCanvas({ id, clientId, name, folderId = null }) {
  const now = new Date().toISOString();
  return hydrateCanvas({ id, clientId, name, folderId, createdAt: now, lastModified: now, rev: 0 }, { id, clientId });
}

/**
 * Marca campos como escritos por alguém. A trava é automática: o toque do
 * usuário trava, a escrita do agente não. Não existe cadeado para clicar.
 */
export function markFields(node, fields, { source = 'user', runId = null, epistemic = null } = {}) {
  const at = new Date().toISOString();
  const fieldMeta = { ...node.fieldMeta };
  for (const field of fields) {
    // `epistemic` pode vir por campo (mapa) ou uniforme (string).
    const declared = epistemic && typeof epistemic === 'object' ? epistemic[field] : epistemic;
    fieldMeta[field] = {
      source,
      at,
      locked: source === 'user',
      epistemic: EPISTEMIC.includes(declared) ? declared : (source === 'user' ? 'documented' : 'inferred'),
      confirmed: source === 'user',
      confirmedAt: source === 'user' ? at : null,
      ...(runId ? { runId } : {}),
    };
  }
  return {
    ...node,
    fieldMeta,
    provenance: { ...node.provenance, updatedBy: source, updatedAt: at, ...(runId ? { lastAgentRunId: runId } : {}) },
  };
}

export const isLocked = (node, field) => !!node?.fieldMeta?.[field]?.locked;
