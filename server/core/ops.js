import { hydrateNode, hydrateConnection, hydrateRef, hydrateBreakpoint, hydrateOportunidade, markFields, isLocked, NODE_TYPES, CADENCIAS } from './schema.js';
import { DEFAULT_VOCABULARY, idsOf, invalidValueMessage } from './vocabulary.js';
import { newNodeId, newEdgeId, newBreakpointId, newOportunidadeId } from './ids.js';
import { httpError } from './canvasService.js';

/**
 * Operações de changeset: validação e aplicação.
 *
 * Duas fases separadas de propósito. `validateOps` roda quando o agente
 * propõe, para que o erro volte com a mensagem exata do que corrigir enquanto
 * ele ainda tem o contexto na cabeça — em vez de gravar dado quebrado e
 * descobrir depois. `applyOps` roda no aceite.
 */

export const OP_KINDS = [
  'addNode', 'updateNode', 'deleteNode',
  'addEdge', 'removeEdge',
  'attachRef', 'detachRef',
  'setLayout', 'addNote',
  'setSubprocessMode', 'proposeInChild',
  'addBreakpoint', 'updateBreakpoint', 'removeBreakpoint',
  'addOportunidade', 'updateOportunidade', 'removeOportunidade',
];

const WRITABLE_OP_FIELDS = new Set(['titulo', 'markdown', 'arestaId', 'x', 'y']);

/** Campos de um breakpoint que uma op pode escrever. */
const WRITABLE_BP_FIELDS = new Set(['oQueMede', 'cadencia', 'consumidor', 'evidencia', 'serie', 'alvo']);

/** Campos do nó que uma op `updateNode` pode escrever. */
const WRITABLE_NODE_FIELDS = new Set([
  'name', 'description', 'owner', 'triggerCond', 'outputCond', 'tools',
  'bottleneck', 'bottleneckCategory', 'bottleneckCategories', 'subprocesses', 'subprocessMode',
  'switchField', 'switchCases', 'outcomeType', 'waitType', 'waitDuration',
  'waitTrigger', 'scriptConditions', 'duration', 'durationMinutes',
  'frequency', 'area', 'status', 'type', 'bpmn', 'x', 'y', 'metrics',
]);

const isProposedId = (id) => typeof id === 'string' && /^(node|conn)_prop_/.test(id);

/**
 * Valida o lote inteiro contra o canvas atual.
 *
 * Retorna `{errors, warnings, conflicts, staleOps}` em vez de lançar na
 * primeira falha: o agente aprende mais recebendo os cinco problemas de uma
 * vez do que um por rodada.
 */
export function validateOps(canvas, ops, vocabulary = DEFAULT_VOCABULARY) {
  const areaIds = idsOf(vocabulary.areas);
  const wasteIds = idsOf(vocabulary.wasteCategories);
  const errors = [];
  const warnings = [];
  const conflicts = [];
  const staleOps = [];

  if (!Array.isArray(ops) || ops.length === 0) {
    return { errors: ['ops deve ser um array não vazio'], warnings, conflicts, staleOps };
  }

  const nodeIds = new Set(canvas.nodes.map((n) => n.id));
  const edgeIds = new Set(canvas.connections.map((c) => c.id));
  const bpIds = new Set((canvas.breakpoints || []).map((b) => b.id));
  const opIds = new Set((canvas.oportunidades || []).map((o) => o.id));
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const created = new Set();   // ids propostos criados dentro deste changeset
  const deleted = new Set();
  const seenOpIds = new Set();

  const exists = (id) => (nodeIds.has(id) || created.has(id)) && !deleted.has(id);

  ops.forEach((op, index) => {
    const at = `ops[${index}]`;
    if (!op || typeof op !== 'object') { errors.push(`${at}: não é um objeto`); return; }
    if (!OP_KINDS.includes(op.kind)) {
      errors.push(`${at}: kind "${op.kind}" desconhecido. Use um de: ${OP_KINDS.join(', ')}`);
      return;
    }
    if (op.opId) {
      if (seenOpIds.has(op.opId)) errors.push(`${at}: opId "${op.opId}" repetido`);
      seenOpIds.add(op.opId);
    }

    switch (op.kind) {
      case 'addNode': {
        const node = op.node;
        if (!node || typeof node !== 'object') { errors.push(`${at}: falta o objeto "node"`); break; }
        if (node.type && !NODE_TYPES.includes(node.type)) {
          errors.push(`${at}: type "${node.type}" inválido. Use: ${NODE_TYPES.join(', ')}`);
        }
        if (node.area && !areaIds.includes(node.area)) {
          errors.push(`${at}: ${invalidValueMessage('area', node.area, vocabulary.areas)}`);
        }
        const cats = node.bottleneckCategories ?? (node.bottleneckCategory ? [node.bottleneckCategory] : []);
        for (const cat of cats) {
          if (!wasteIds.includes(cat)) {
            errors.push(`${at}: ${invalidValueMessage('bottleneckCategory', cat, vocabulary.wasteCategories)}`);
          }
        }
        // Nó sem nome não é nó, é ruído — e o outline o mostra como "(sem nome)",
        // o que atrapalha justamente a conversa com o agente sobre ele.
        if (!node.name || !String(node.name).trim()) {
          errors.push(`${at}: nó precisa de "name" não vazio`);
        }
        if (node.id && !isProposedId(node.id)) {
          warnings.push(`${at}: id "${node.id}" será substituído; use o prefixo node_prop_ para referenciar dentro do changeset`);
        }
        if (node.id) created.add(node.id);
        break;
      }

      case 'updateNode': {
        if (!exists(op.nodeId)) { errors.push(`${at}: nó "${op.nodeId}" não existe neste canvas`); break; }
        if (!op.set || typeof op.set !== 'object' || !Object.keys(op.set).length) {
          errors.push(`${at}: falta "set" com ao menos um campo`); break;
        }
        for (const field of Object.keys(op.set)) {
          if (!WRITABLE_NODE_FIELDS.has(field)) {
            errors.push(`${at}: campo "${field}" não é editável. Editáveis: ${[...WRITABLE_NODE_FIELDS].join(', ')}`);
          }
        }
        if ('name' in op.set && !String(op.set.name ?? '').trim()) {
          errors.push(`${at}: não é possível apagar o nome de um nó`);
        }
        const target = byId.get(op.nodeId);
        if (target) {
          // Pré-condição por campo: se o valor mudou desde que o agente leu,
          // a op fica obsoleta em vez de atropelar a edição de quem mexeu.
          for (const [field, expected] of Object.entries(op.expect || {})) {
            if (JSON.stringify(target[field] ?? '') !== JSON.stringify(expected ?? '')) {
              staleOps.push({ opId: op.opId ?? at, field, expected, actual: target[field] });
            }
          }
          // Campo tocado pelo usuário não bloqueia a proposta — vira conflito
          // visível, em vermelho e pré-marcado para rejeitar.
          for (const field of Object.keys(op.set)) {
            if (isLocked(target, field)) conflicts.push({ opId: op.opId ?? at, nodeId: op.nodeId, field });
          }
        }
        break;
      }

      case 'deleteNode': {
        if (!exists(op.nodeId)) { errors.push(`${at}: nó "${op.nodeId}" não existe`); break; }
        deleted.add(op.nodeId);
        break;
      }

      case 'addEdge': {
        const edge = op.edge;
        if (!edge || typeof edge !== 'object') { errors.push(`${at}: falta o objeto "edge"`); break; }
        // Id fantasma é o principal risco de um agente escrevendo arestas:
        // hoje não geraria erro nenhum, geraria uma linha invisível.
        if (!exists(edge.from)) errors.push(`${at}: origem "${edge.from}" não existe`);
        if (!exists(edge.to)) errors.push(`${at}: destino "${edge.to}" não existe`);
        if (edge.from && edge.from === edge.to) errors.push(`${at}: laço em si mesmo (${edge.from})`);
        if (edge.id) created.add(edge.id);
        break;
      }

      case 'removeEdge': {
        if (!edgeIds.has(op.edgeId) && !created.has(op.edgeId)) {
          errors.push(`${at}: aresta "${op.edgeId}" não existe`);
        }
        break;
      }

      case 'attachRef': {
        if (!exists(op.nodeId)) { errors.push(`${at}: nó "${op.nodeId}" não existe`); break; }
        if (!op.ref || !op.ref.label) errors.push(`${at}: ref precisa de "label"`);
        break;
      }

      case 'detachRef': {
        if (!exists(op.nodeId)) errors.push(`${at}: nó "${op.nodeId}" não existe`);
        if (!op.refId) errors.push(`${at}: falta "refId"`);
        break;
      }

      case 'setLayout': {
        if (!Array.isArray(op.positions) || !op.positions.length) {
          errors.push(`${at}: "positions" deve ser um array não vazio`); break;
        }
        for (const p of op.positions) {
          if (!exists(p.nodeId)) errors.push(`${at}: nó "${p.nodeId}" não existe`);
          if (!Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) {
            errors.push(`${at}: posição inválida para "${p.nodeId}"`);
          }
        }
        break;
      }

      case 'addNote': {
        if (!op.note || typeof op.note.text !== 'string') errors.push(`${at}: note precisa de "text"`);
        break;
      }

      case 'setSubprocessMode': {
        if (!exists(op.nodeId)) errors.push(`${at}: nó "${op.nodeId}" não existe`);
        if (!['checklist', 'canvas'].includes(op.mode)) {
          errors.push(`${at}: mode deve ser "checklist" ou "canvas"`);
        }
        break;
      }

      case 'addBreakpoint': {
        const bp = op.breakpoint;
        if (!bp || typeof bp !== 'object') { errors.push(`${at}: falta o objeto "breakpoint"`); break; }
        const tipo = bp.alvo?.tipo;
        if (!['node', 'edge'].includes(tipo)) {
          errors.push(`${at}: alvo.tipo deve ser "node" ou "edge"`); break;
        }
        // Alvo fantasma é o risco principal: viraria uma bolinha invisível, do
        // mesmo jeito que aresta órfã virava linha invisível.
        if (tipo === 'node' && !exists(bp.alvo?.id)) {
          errors.push(`${at}: nó "${bp.alvo?.id}" não existe`);
        }
        if (tipo === 'edge' && !edgeIds.has(bp.alvo?.id) && !created.has(bp.alvo?.id)) {
          errors.push(`${at}: aresta "${bp.alvo?.id}" não existe`);
        }
        if (!bp.oQueMede || !String(bp.oQueMede).trim()) {
          errors.push(`${at}: breakpoint precisa de "oQueMede" — medir o quê`);
        }
        if (bp.cadencia && !CADENCIAS.includes(bp.cadencia)) {
          errors.push(`${at}: cadencia "${bp.cadencia}" inválida. Use: ${CADENCIAS.join(', ')}`);
        }
        if (bp.id) created.add(bp.id);
        break;
      }

      case 'updateBreakpoint': {
        if (!bpIds.has(op.breakpointId) && !created.has(op.breakpointId)) {
          errors.push(`${at}: breakpoint "${op.breakpointId}" não existe`); break;
        }
        if (!op.set || typeof op.set !== 'object' || !Object.keys(op.set).length) {
          errors.push(`${at}: falta "set" com ao menos um campo`); break;
        }
        for (const campo of Object.keys(op.set)) {
          if (!WRITABLE_BP_FIELDS.has(campo)) {
            errors.push(`${at}: campo "${campo}" não é editável em breakpoint. ` +
              `Editáveis: ${[...WRITABLE_BP_FIELDS].join(', ')}. ` +
              `"malha" é derivada de consumidor.quem e não se escreve.`);
          }
        }
        if (op.set.cadencia && !CADENCIAS.includes(op.set.cadencia)) {
          errors.push(`${at}: cadencia "${op.set.cadencia}" inválida. Use: ${CADENCIAS.join(', ')}`);
        }
        break;
      }

      case 'removeBreakpoint': {
        if (!bpIds.has(op.breakpointId) && !created.has(op.breakpointId)) {
          errors.push(`${at}: breakpoint "${op.breakpointId}" não existe`);
        }
        break;
      }

      case 'proposeInChild': {
        // Um passo que concentra 63% da demanda não cabe num nó: precisa de
        // canvas próprio. O produto já suportava; faltava a superfície.
        if (!exists(op.nodeId)) { errors.push(`${at}: nó "${op.nodeId}" não existe`); break; }
        if (!Array.isArray(op.ops) || !op.ops.length) {
          errors.push(`${at}: "ops" do subprocesso deve ser um array não vazio`); break;
        }
        if (op.ops.some((o) => o.kind === 'proposeInChild')) {
          errors.push(`${at}: subprocesso dentro de subprocesso não é suportado (um nível só)`);
          break;
        }
        const parent = byId.get(op.nodeId);
        if (parent) {
          const child = { nodes: [], connections: [], ...(parent.childCanvas || {}) };
          const inner = validateOps({ ...child, notes: [] }, op.ops, vocabulary);
          for (const e of inner.errors) errors.push(`${at} (subprocesso): ${e}`);
        }
        break;
      }

      case 'addOportunidade': {
        const op2 = op.oportunidade;
        if (!op2 || typeof op2 !== 'object') { errors.push(`${at}: falta o objeto "oportunidade"`); break; }
        if (!edgeIds.has(op2.arestaId) && !created.has(op2.arestaId)) {
          errors.push(`${at}: aresta "${op2.arestaId}" não existe. ` +
            'Oportunidade de receita mora numa PASSAGEM, não num passo.');
        }
        if (!op2.titulo || !String(op2.titulo).trim()) {
          errors.push(`${at}: oportunidade precisa de "titulo" — é o que aparece antes de abrir`);
        }
        if (op2.id) created.add(op2.id);
        break;
      }

      case 'updateOportunidade': {
        if (!opIds.has(op.oportunidadeId) && !created.has(op.oportunidadeId)) {
          errors.push(`${at}: oportunidade "${op.oportunidadeId}" não existe`); break;
        }
        for (const campo of Object.keys(op.set || {})) {
          if (!WRITABLE_OP_FIELDS.has(campo)) {
            errors.push(`${at}: campo "${campo}" não é editável em oportunidade. ` +
              `Editáveis: ${[...WRITABLE_OP_FIELDS].join(', ')}`);
          }
        }
        break;
      }

      case 'removeOportunidade': {
        if (!opIds.has(op.oportunidadeId) && !created.has(op.oportunidadeId)) {
          errors.push(`${at}: oportunidade "${op.oportunidadeId}" não existe`);
        }
        break;
      }
    }
  });

  // Arestas ligadas a nós que o próprio changeset apaga.
  for (const conn of canvas.connections) {
    if (deleted.has(conn.from) || deleted.has(conn.to)) {
      warnings.push(`aresta ${conn.id} será removida junto com o nó apagado`);
    }
  }

  return { errors, warnings, conflicts, staleOps };
}

/**
 * Aplica as ops aceitas sobre o canvas e devolve o novo estado mais o patch
 * que o navegador deve aplicar incrementalmente.
 *
 * Ids propostos (`node_prop_*`) são reescritos aqui, e as referências a eles
 * dentro do mesmo lote são corrigidas — é o que permite um `addEdge` apontar
 * para um `addNode` do mesmo changeset sem uma ida e volta ao agente.
 */
export function applyOps(canvas, ops, { runId = null } = {}) {
  const nodes = canvas.nodes.map((n) => ({ ...n }));
  const connections = canvas.connections.map((c) => ({ ...c }));
  const notes = (canvas.notes || []).map((n) => ({ ...n }));
  const breakpoints = (canvas.breakpoints || []).map((b) => ({ ...b }));
  const oportunidades = (canvas.oportunidades || []).map((o) => ({ ...o }));

  const idMap = new Map();
  const resolve = (id) => idMap.get(id) ?? id;
  const patch = [];
  const at = new Date().toISOString();

  const indexOfNode = (id) => nodes.findIndex((n) => n.id === id);

  for (const op of ops) {
    switch (op.kind) {
      case 'addNode': {
        const realId = newNodeId();
        if (op.node.id) idMap.set(op.node.id, realId);
        const node = hydrateNode({ ...op.node, id: realId });
        node.provenance = { createdBy: 'agent', createdAt: at, updatedBy: 'agent', updatedAt: at, lastAgentRunId: runId };
        // Campos escritos pelo agente ficam destravados: você pode corrigir
        // por cima sem atrito, e o agente pode revisitar depois.
        const marked = markFields(node, Object.keys(op.node).filter((k) => k !== 'id'),
          { source: 'agent', runId, epistemic: op.epistemic });
        nodes.push(marked);
        patch.push({ kind: 'addNode', node: marked });
        break;
      }

      case 'updateNode': {
        const id = resolve(op.nodeId);
        const idx = indexOfNode(id);
        if (idx === -1) break;
        const updated = markFields({ ...nodes[idx], ...op.set }, Object.keys(op.set),
          { source: 'agent', runId, epistemic: op.epistemic });
        nodes[idx] = hydrateNode(updated);
        patch.push({ kind: 'updateNode', nodeId: id, set: op.set, node: nodes[idx] });
        break;
      }

      case 'deleteNode': {
        const id = resolve(op.nodeId);
        const idx = indexOfNode(id);
        if (idx === -1) break;
        nodes.splice(idx, 1);
        // Arestas incidentes saem junto, senão viram linhas fantasma.
        for (let i = connections.length - 1; i >= 0; i--) {
          if (connections[i].from === id || connections[i].to === id) {
            patch.push({ kind: 'removeEdge', edgeId: connections[i].id });
            connections.splice(i, 1);
          }
        }
        patch.push({ kind: 'deleteNode', nodeId: id });
        break;
      }

      case 'addEdge': {
        const realId = newEdgeId();
        if (op.edge.id) idMap.set(op.edge.id, realId);
        const edge = hydrateConnection({
          ...op.edge, id: realId, from: resolve(op.edge.from), to: resolve(op.edge.to),
        });
        edge.provenance = { createdBy: 'agent', createdAt: at, updatedBy: 'agent', updatedAt: at, lastAgentRunId: runId };
        const duplicate = connections.some(
          (c) => c.from === edge.from && c.to === edge.to && (c.ruleId || '') === (edge.ruleId || ''),
        );
        if (duplicate) break;
        connections.push(edge);
        patch.push({ kind: 'addEdge', edge });
        break;
      }

      case 'removeEdge': {
        const id = resolve(op.edgeId);
        const idx = connections.findIndex((c) => c.id === id);
        if (idx === -1) break;
        connections.splice(idx, 1);
        patch.push({ kind: 'removeEdge', edgeId: id });
        break;
      }

      case 'attachRef': {
        const id = resolve(op.nodeId);
        const idx = indexOfNode(id);
        if (idx === -1) break;
        const refs = [...(nodes[idx].refs || [])];
        refs.push(hydrateRef({ ...op.ref, addedBy: 'agent', addedAt: at }, refs.length));
        nodes[idx] = { ...nodes[idx], refs };
        patch.push({ kind: 'updateNode', nodeId: id, set: { refs }, node: nodes[idx] });
        break;
      }

      case 'detachRef': {
        const id = resolve(op.nodeId);
        const idx = indexOfNode(id);
        if (idx === -1) break;
        const refs = (nodes[idx].refs || []).filter((r) => r.id !== op.refId);
        nodes[idx] = { ...nodes[idx], refs };
        patch.push({ kind: 'updateNode', nodeId: id, set: { refs }, node: nodes[idx] });
        break;
      }

      case 'setLayout': {
        const moved = [];
        for (const pos of op.positions) {
          const id = resolve(pos.nodeId);
          const idx = indexOfNode(id);
          if (idx === -1) continue;
          // Layout vindo do agente não trava a posição: arrastar continua
          // sendo o que decide, e é o arrasto que trava.
          nodes[idx] = markFields(
            { ...nodes[idx], x: Math.round(Number(pos.x)), y: Math.round(Number(pos.y)) },
            ['x', 'y'], { source: 'agent', runId },
          );
          moved.push({ nodeId: id, x: nodes[idx].x, y: nodes[idx].y });
        }
        if (moved.length) patch.push({ kind: 'setLayout', positions: moved });
        break;
      }

      case 'addNote': {
        const note = { id: `note_${Date.now()}_${notes.length}`, x: 0, y: 0, color: 'yellow', ...op.note };
        notes.push(note);
        patch.push({ kind: 'addNote', note });
        break;
      }

      case 'addBreakpoint': {
        const bruto = op.breakpoint;
        const bp = hydrateBreakpoint({
          ...bruto,
          id: newBreakpointId(),
          // O alvo pode ser um nó ou aresta criados neste mesmo changeset.
          alvo: { ...bruto.alvo, id: resolve(bruto.alvo?.id) },
        }, breakpoints.length);
        if (bruto.id) idMap.set(bruto.id, bp.id);
        breakpoints.push(bp);
        patch.push({ kind: 'addBreakpoint', breakpoint: bp });
        break;
      }

      case 'updateBreakpoint': {
        const idx = breakpoints.findIndex((b) => b.id === resolve(op.breakpointId));
        if (idx === -1) break;
        // Passa pela hidratação para `malha` ser recalculada: ganhar ou perder
        // consumidor é exatamente o que abre e fecha a malha.
        breakpoints[idx] = hydrateBreakpoint({ ...breakpoints[idx], ...op.set }, idx);
        patch.push({ kind: 'updateBreakpoint', breakpoint: breakpoints[idx] });
        break;
      }

      case 'removeBreakpoint': {
        const alvo = resolve(op.breakpointId);
        const i = breakpoints.findIndex((b) => b.id === alvo);
        if (i === -1) break;
        breakpoints.splice(i, 1);
        patch.push({ kind: 'removeBreakpoint', breakpointId: alvo });
        break;
      }

      case 'setSubprocessMode': {
        const idx = indexOfNode(resolve(op.nodeId));
        if (idx === -1) break;
        nodes[idx] = markFields({ ...nodes[idx], subprocessMode: op.mode },
          ['subprocessMode'], { source: 'agent', runId });
        patch.push({ kind: 'updateNode', nodeId: nodes[idx].id, set: { subprocessMode: op.mode } });
        break;
      }

      case 'proposeInChild': {
        const idx = indexOfNode(resolve(op.nodeId));
        if (idx === -1) break;
        const parent = nodes[idx];
        const child = { nodes: [], connections: [], notes: [], nextNodeId: 1, ...(parent.childCanvas || {}) };

        // Recursão sobre o mesmo executor: o subprocesso ganha de graça a
        // reescrita de ids, a proveniência e a validação do canvas raiz.
        const inner = applyOps({ ...child, notes: child.notes ?? [] }, op.ops, { runId });

        nodes[idx] = markFields({
          ...parent,
          subprocessMode: 'canvas',
          childCanvas: {
            nodes: inner.nodes,
            connections: inner.connections,
            nextNodeId: child.nextNodeId ?? 1,
          },
        }, ['childCanvas', 'subprocessMode'], { source: 'agent', runId });

        // `childCanvas` PRECISA ir no `set`: o cliente aplica só `op.set` e
        // ignora `op.node` (web/agent.js). Sem isto o navegador fica com o
        // subprocesso vazio em memória e o primeiro autosave — que manda o
        // documento inteiro — apaga do disco os filhos recém-criados.
        patch.push({
          kind: 'updateNode', nodeId: parent.id,
          set: { subprocessMode: 'canvas', childCanvas: nodes[idx].childCanvas },
          node: nodes[idx],
        });
        break;
      }

      case 'addOportunidade': {
        const nova = hydrateOportunidade({
          ...op.oportunidade,
          id: newOportunidadeId(),
          arestaId: resolve(op.oportunidade.arestaId),
        }, oportunidades.length);
        if (op.oportunidade.id) idMap.set(op.oportunidade.id, nova.id);
        oportunidades.push(nova);
        patch.push({ kind: 'addOportunidade', oportunidade: nova });
        break;
      }

      case 'updateOportunidade': {
        const i = oportunidades.findIndex((o) => o.id === resolve(op.oportunidadeId));
        if (i === -1) break;
        oportunidades[i] = hydrateOportunidade({ ...oportunidades[i], ...op.set }, i);
        patch.push({ kind: 'updateOportunidade', oportunidade: oportunidades[i] });
        break;
      }

      case 'removeOportunidade': {
        const alvo = resolve(op.oportunidadeId);
        const i = oportunidades.findIndex((o) => o.id === alvo);
        if (i === -1) break;
        oportunidades.splice(i, 1);
        patch.push({ kind: 'removeOportunidade', oportunidadeId: alvo });
        break;
      }
    }
  }

  return { nodes, connections, notes, breakpoints, oportunidades, patch, idMap: Object.fromEntries(idMap) };
}

export { httpError };
