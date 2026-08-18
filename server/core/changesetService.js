import { newChangesetId } from './ids.js';
import { validateOps, applyOps } from './ops.js';
import { httpError } from './canvasService.js';
import { withLock } from './locks.js';
import { publish, subscriberCount } from './events.js';
import { canvasOutline, resolveNodeRef } from './views.js';
import { resolveVocabulary } from './vocabulary.js';
import { computeLayout } from './layoutService.js';

const MAX_OPS_WITHOUT_WARNING = 15;

/** Todo nó que uma proposta cria, altera, apaga ou conecta. */
function touchedNodesOf(ops) {
  const set = new Set();
  for (const op of ops) {
    if (op.nodeId) set.add(op.nodeId);
    if (op.node?.id) set.add(op.node.id);
    if (op.edge) { set.add(op.edge.from); set.add(op.edge.to); }
    for (const pos of op.positions || []) set.add(pos.nodeId);
  }
  set.delete(undefined);
  return set;
}

const intersects = (a, b) => [...a].some((x) => b.has(x));

/**
 * Ciclo de vida da proposta.
 *
 * O canvas em disco **não muda** até o aceite. Aplicados vão para
 * `changesets/archive/`, o que dá trilha de auditoria de graça: dá para
 * responder "de onde veio esse nó" lendo o arquivo.
 */
export class ChangesetService {
  constructor(storage, canvasService) {
    this.storage = storage;
    this.canvasService = canvasService;
  }

  async listPending(clientId, canvasId = null) {
    const all = await this.storage.listChangesets(clientId, 'pending');
    return all.filter((cs) => cs.status === 'pending' && (!canvasId || cs.canvasId === canvasId));
  }

  async get(clientId, changesetId) {
    const cs = await this.storage.readChangeset(clientId, changesetId);
    if (!cs) throw httpError(404, `Changeset ${changesetId} não encontrado`);
    return cs;
  }

  /**
   * Cria uma proposta. Valida contra o canvas atual e devolve ao agente o que
   * precisa corrigir — inclusive um preview do resultado, para ele conferir o
   * próprio trabalho sem pagar uma segunda leitura.
   */
  async propose(clientId, canvasId, { title, rationale = '', ops, groups = [], runId = null, replace = false }) {
    return withLock(`cs/${clientId}/${canvasId}`, async () => {
      const canvas = await this.canvasService.getCanvas(clientId, canvasId);

      // Aliases (n04) são para o agente; daqui para dentro tudo é id real.
      const normalized = this.#resolveAliases(canvas, ops);

      const vocabulary = resolveVocabulary(await this.storage.readClient(clientId));
      const { errors, warnings, conflicts, staleOps } = validateOps(canvas, normalized, vocabulary);
      if (errors.length) {
        throw httpError(422, `A proposta tem ${errors.length} problema(s):\n- ${errors.join('\n- ')}`, { errors, warnings });
      }

      const withIds = normalized.map((op, i) => ({ opId: op.opId ?? `op_${i + 1}`, ...op }));
      const touchedNodes = touchedNodesOf(withIds);

      /**
       * Propostas concorrentes são permitidas quando não se cruzam.
       *
       * O bloqueio anterior era incondicional e forçava serialização mesmo
       * entre trabalhos independentes — mapear o fluxo de insumos não tem por
       * que esperar a revisão do fluxo do pedido. O que não pode é duas
       * propostas mexendo no mesmo nó: aí a segunda a ser aceita opera sobre
       * um canvas que já não é o que ela leu.
       */
      const pending = await this.listPending(clientId, canvasId);
      const colliding = pending.filter((cs) => intersects(touchedNodes, new Set(cs.touchedNodes || [])));

      if (colliding.length && !replace) {
        throw httpError(409,
          `Já existe uma proposta pendente tocando os mesmos nós ("${colliding[0].title}", ` +
          `${colliding[0].ops.length} ops). Resolva-a na tela, proponha em outra região do canvas, ` +
          `ou reenvie com replace=true para substituí-la.`,
          { pendingChangesetId: colliding[0].id });
      }
      for (const old of colliding) await this.#discard(clientId, old, 'replaced');

      // Nó sem posição não pode nascer empilhado em 0,0: o servidor calcula.
      // É o que permite o agente descrever topologia e ignorar geometria.
      this.#positionNewNodes(canvas, withIds);

      const normalizedGroups = this.#normalizeGroups(groups, withIds);

      if (withIds.length > MAX_OPS_WITHOUT_WARNING && normalizedGroups.length <= 1) {
        warnings.push(
          `${withIds.length} operações numa lista plana é muito para revisar. ` +
          `Use "groups" para agrupar por subprocesso ou por fluxo — o consultor ` +
          `passa a poder aceitar um bloco inteiro de uma vez.`);
      }

      const changeset = {
        id: newChangesetId(),
        clientId, canvasId,
        createdAt: new Date().toISOString(),
        createdBy: 'agent',
        agentRunId: runId,
        title: title || 'Proposta do agente',
        rationale,
        baseRev: canvas.rev,
        status: 'pending',
        touchedNodes: [...touchedNodes],
        groups: normalizedGroups,
        ops: withIds.map((op) => ({
          ...op,
          groupId: normalizedGroups.find((g) => g.opIds.includes(op.opId))?.id ?? null,
          conflict: conflicts.some((c) => (c.opId === op.opId) || (c.nodeId && c.nodeId === op.nodeId)),
        })),
        conflicts,
        staleOps,
        resolution: {},
      };

      await this.storage.writeChangeset(clientId, changeset.id, changeset);

      // Preview: como o canvas ficaria se tudo fosse aceito.
      const simulated = applyOps(canvas, changeset.ops, { runId });
      const preview = canvasOutline({ ...canvas, ...simulated, rev: canvas.rev + 1 });

      const watching = subscriberCount(canvasId);
      publish(canvasId, 'changeset.proposed', { changeset });

      return { changeset, warnings, conflicts, staleOps, preview, watching };
    });
  }

  /**
   * Aceita e/ou rejeita operações. Aceite parcial é o caso normal.
   */
  async resolve(clientId, changesetId, { accept = null, reject = [], acceptGroups = [], rejectGroups = [] } = {}) {
    const cs = await this.get(clientId, changesetId);
    if (cs.status !== 'pending') throw httpError(409, `Changeset já resolvido (${cs.status})`);

    return withLock(`cs/${clientId}/${cs.canvasId}`, async () => {
      const canvas = await this.canvasService.getCanvas(clientId, cs.canvasId);

      // Grupos são atalho para conjuntos de opIds; expandidos aqui, o resto do
      // caminho continua raciocinando em operações individuais.
      const opsOfGroup = (gid) => (cs.groups || []).find((g) => g.id === gid)?.opIds ?? [];
      const fromAcceptGroups = acceptGroups.flatMap(opsOfGroup);
      const fromRejectGroups = rejectGroups.flatMap(opsOfGroup);

      const rejected = new Set([...reject, ...fromRejectGroups]);
      const explicitAccept = accept === null && !acceptGroups.length
        ? null
        : [...(accept ?? []), ...fromAcceptGroups];

      const acceptIds = explicitAccept === null
        ? cs.ops.filter((op) => !rejected.has(op.opId)).map((op) => op.opId)
        : explicitAccept.filter((id) => !rejected.has(id));
      const accepted = cs.ops.filter((op) => acceptIds.includes(op.opId));

      let result = null;
      if (accepted.length) {
        // Revalida no momento do aceite: o canvas pode ter mudado desde a
        // proposta, e aplicar cegamente aqui é o que apagaria a sua edição.
        const { errors } = validateOps(canvas, accepted, resolveVocabulary(await this.storage.readClient(clientId)));
        if (errors.length) {
          throw httpError(409,
            `O canvas mudou desde a proposta e ela não se aplica mais:\n- ${errors.join('\n- ')}`, { errors });
        }
        result = applyOps(canvas, accepted, { runId: cs.agentRunId });
        await this.canvasService.saveCanvas(clientId, cs.canvasId, {
          nodes: result.nodes, connections: result.connections, notes: result.notes,
          breakpoints: result.breakpoints, oportunidades: result.oportunidades,
        }, { backupTag: 'changeset' });
      }

      cs.status = acceptIds.length === cs.ops.length ? 'applied'
        : acceptIds.length === 0 ? 'rejected' : 'partial';
      cs.resolvedAt = new Date().toISOString();
      cs.resolution = Object.fromEntries(cs.ops.map((op) => [op.opId, acceptIds.includes(op.opId) ? 'accepted' : 'rejected']));

      await this.storage.writeChangeset(clientId, changesetId, cs);
      await this.storage.archiveChangeset(clientId, changesetId);

      const fresh = await this.canvasService.getCanvas(clientId, cs.canvasId);
      publish(cs.canvasId, 'changeset.resolved', {
        changesetId, status: cs.status, patch: result?.patch ?? [], rev: fresh.rev, title: cs.title,
      });

      return { status: cs.status, accepted: acceptIds.length, rejected: cs.ops.length - acceptIds.length, rev: fresh.rev };
    });
  }

  async cancel(clientId, changesetId) {
    const cs = await this.get(clientId, changesetId);
    if (cs.status !== 'pending') throw httpError(409, `Changeset já resolvido (${cs.status})`);
    await this.#discard(clientId, cs, 'cancelled');
    publish(cs.canvasId, 'changeset.resolved', { changesetId, status: 'cancelled', patch: [], title: cs.title });
    return { status: 'cancelled' };
  }

  async #discard(clientId, cs, status) {
    cs.status = status;
    cs.resolvedAt = new Date().toISOString();
    await this.storage.writeChangeset(clientId, cs.id, cs);
    await this.storage.archiveChangeset(clientId, cs.id);
  }

  /** Preenche x,y dos nós novos que vieram sem posição. */
  #positionNewNodes(canvas, ops) {
    // Subprocessos primeiro: as ops de dentro do `proposeInChild` nunca eram
    // varridas, então os nós filhos nasciam TODOS em (0,0), empilhados num ponto
    // só. O subprocesso existia no dado e parecia um nó único na tela.
    for (const op of ops) {
      if (op.kind === 'proposeInChild' && Array.isArray(op.ops)) {
        const pai = canvas.nodes.find((n) => n.id === op.nodeId);
        const filho = { nodes: [], connections: [], notes: [], ...(pai?.childCanvas || {}) };
        this.#positionNewNodes(filho, op.ops);
      }
    }

    // GEOMETRIA É DO SERVIDOR, não do agente. Antes, bastava o LLM mandar x/y
    // para o layout inteiro ser pulado — e ele posiciona no escuro, sem enxergar
    // o resultado. Descartamos a posição proposta e recalculamos sempre.
    const novosNos = ops.filter((op) => op.kind === 'addNode');
    for (const op of novosNos) { delete op.node.x; delete op.node.y; }

    const semPos = novosNos;
    if (!semPos.length) return;

    // Simula o canvas com os nós novos para o layout enxergar as arestas.
    const simulated = applyOps(canvas, ops, {});
    const novos = new Set(
      semPos.map((op) => simulated.idMap[op.node.id] ?? null).filter(Boolean),
    );
    if (!novos.size) return;

    const { positions } = computeLayout(
      { ...canvas, nodes: simulated.nodes, connections: simulated.connections },
      { scope: [...novos] },
    );

    const byReal = new Map(positions.map((p) => [p.nodeId, p]));
    for (const op of semPos) {
      const real = simulated.idMap[op.node.id];
      const pos = byReal.get(real);
      if (pos) { op.node.x = pos.x; op.node.y = pos.y; }
      else { op.node.x = op.node.x ?? 0; op.node.y = op.node.y ?? 0; }
    }
  }

  /**
   * Normaliza os grupos: descarta opIds inexistentes, garante que uma op
   * pertença a no máximo um grupo, e junta o que sobrou num "Outros" — assim a
   * revisão nunca esconde uma operação por ela não ter sido agrupada.
   */
  #normalizeGroups(groups, ops) {
    const allIds = new Set(ops.map((o) => o.opId));
    const claimed = new Set();
    const out = [];

    for (const [i, group] of (Array.isArray(groups) ? groups : []).entries()) {
      const opIds = (group.opIds || []).filter((id) => allIds.has(id) && !claimed.has(id));
      if (!opIds.length) continue;
      opIds.forEach((id) => claimed.add(id));
      out.push({
        id: group.id || `g${i + 1}`,
        title: group.title || `Grupo ${i + 1}`,
        rationale: group.rationale || '',
        opIds,
      });
    }

    const orphans = ops.map((o) => o.opId).filter((id) => !claimed.has(id));
    if (orphans.length && out.length) {
      out.push({ id: 'g_outros', title: 'Outros', rationale: '', opIds: orphans });
    }
    return out;
  }

  /** Troca `n04` por id real em todo campo que referencia nó. */
  #resolveAliases(canvas, ops) {
    const r = (id) => resolveNodeRef(canvas, id);
    return (Array.isArray(ops) ? ops : []).map((op) => {
      const out = { ...op };
      if (out.nodeId) out.nodeId = r(out.nodeId);
      if (out.edge) out.edge = { ...out.edge, from: r(out.edge.from), to: r(out.edge.to) };
      if (Array.isArray(out.positions)) out.positions = out.positions.map((p) => ({ ...p, nodeId: r(p.nodeId) }));
      return out;
    });
  }
}
