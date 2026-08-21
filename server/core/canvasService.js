import { hydrateCanvas, emptyCanvas } from './schema.js';
import { newCanvasId, slugify } from './ids.js';
import { withLock } from './locks.js';
import { gerarFluxoCenario } from './scenarioEngine.js';
import { canvasParaMarkdown } from './processoMarkdown.js';

/** Erro com status HTTP, para as rotas traduzirem sem inventar mapeamento. */
export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

/**
 * Serviço de canvas: leitura hidratada, escrita com `rev` e concorrência
 * otimista. É o único lugar que sabe como um canvas nasce, muda e é contado.
 */
export class CanvasService {
  /** @param {import('../storage/Storage.js').Storage} storage */
  constructor(storage) {
    this.storage = storage;
  }

  // --- clientes ---

  async listClients() {
    const clients = await this.storage.listClients();
    return Promise.all(
      clients.map(async (c) => {
        const ids = await this.storage.listCanvasIds(c.id);
        return { ...c, canvasCount: ids.length };
      }),
    );
  }

  async ensureClient(clientId, name = null) {
    const existing = await this.storage.readClient(clientId);
    if (existing) return existing;
    return this.storage.writeClient(clientId, {
      id: clientId,
      name: name ?? clientId,
      createdAt: new Date().toISOString(),
      settings: { autoApply: false },
    });
  }

  async createClient(name) {
    const id = slugify(name);
    if (await this.storage.readClient(id)) throw httpError(409, `Cliente "${id}" já existe`);
    return this.storage.writeClient(id, { id, name, createdAt: new Date().toISOString(), settings: { autoApply: false } });
  }

  // --- listagem derivada (substitui a chave `audaces_home`) ---

  /**
   * A árvore de pastas e canvases é derivada do listing de arquivos mais o
   * cabeçalho de cada um. Não existe índice para desincronizar — que era
   * exatamente o problema do `audaces_home`, onde o nome de um canvas vivia
   * em dois lugares e podia divergir.
   */
  async listCanvases(clientId) {
    const ids = await this.storage.listCanvasIds(clientId);
    const docs = await Promise.all(ids.map((id) => this.storage.readCanvas(clientId, id)));

    // Uma proposta feita com o navegador fechado fica esperando alguém lembrar
    // de abrir o canvas. Contar aqui é o que permite mostrar o selo na home e
    // avisar o agente na listagem.
    const pending = await this.storage.listChangesets(clientId, 'pending');
    const pendingByCanvas = {};
    for (const cs of pending) {
      if (cs.status === 'pending') pendingByCanvas[cs.canvasId] = (pendingByCanvas[cs.canvasId] ?? 0) + 1;
    }

    return docs
      .filter(Boolean)
      .map((doc) => ({
        pendingChangesets: pendingByCanvas[doc.id] ?? 0,
        id: doc.id,
        name: doc.name ?? 'Sem nome',
        folderId: doc.folderId ?? null,
        createdAt: doc.createdAt,
        lastModified: doc.lastModified,
        rev: doc.rev ?? 0,
        nodeCount: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
        edgeCount: Array.isArray(doc.connections) ? doc.connections.length : 0,
        // Sem isto na projeção, a home e o agente não conseguem distinguir o
        // processo real do cenário — e distinguir é o ponto do recurso.
        derivadoDe: doc.derivadoDe ?? null,
      }))
      .sort((a, b) => String(b.lastModified).localeCompare(String(a.lastModified)));
  }

  async getHome(clientId) {
    const [client, canvases] = await Promise.all([
      this.storage.readClient(clientId),
      this.listCanvases(clientId),
    ]);
    if (!client) throw httpError(404, `Cliente ${clientId} não encontrado`);
    return { client, canvases };
  }

  /**
   * A tela inicial inteira numa chamada.
   *
   * A "Empresa" da interface e o "cliente" do plano são a mesma coisa — um
   * diretório em disco. Mantê-los como conceitos separados criaria uma
   * hierarquia paralela para migrar depois, sem ganho nenhum.
   */
  async getFullHome() {
    const clients = await this.storage.listClients();
    return Promise.all(
      clients.map(async (client) => ({ ...client, canvases: await this.listCanvases(client.id) })),
    );
  }

  async deleteClient(clientId) {
    const ids = await this.storage.listCanvasIds(clientId);
    for (const id of ids) await this.storage.deleteCanvas(clientId, id);
    await this.storage.deleteClient(clientId);
    return { deleted: clientId, canvases: ids.length };
  }

  async duplicateCanvas(clientId, canvasId) {
    const source = await this.getCanvas(clientId, canvasId);
    return this.createCanvas(clientId, {
      name: `${source.name} (Cópia)`,
      folderId: source.folderId,
      seed: strip(source),
    });
  }

  /**
   * Cenário "e se": um fork do processo real, com vínculo de volta.
   *
   * É duplicação, mas não é cópia solta. A diferença entre os dois está no
   * `derivadoDe`, e ela é o que impede o pior risco deste recurso: um cenário
   * aceito por engano virar "o processo que a empresa tem".
   *
   * Cenário de cenário é recusado. Um fork de fork perde a referência ao que a
   * operação realmente faz, e a comparação deixa de significar alguma coisa.
   */
  async criarCenario(clientId, canvasId, { nome, premissa, postura = 'realista', oportunidadeId = null } = {}) {
    const base = await this.getCanvas(clientId, canvasId);
    if (base.derivadoDe) {
      throw httpError(409,
        `"${base.name}" já é um cenário de outro canvas. Crie o novo cenário a partir do `
        + 'processo real, senão a comparação perde a referência do que a operação faz hoje.');
    }
    if (!premissa || !String(premissa).trim()) {
      throw httpError(422,
        'Cenário exige "premissa": a frase que o originou. Sem ela, daqui a seis semanas '
        + 'ninguém consegue contestar o desenho — nem lembrar por que ele existe.');
    }

    // Gera o fluxo transformado com base no mapa de processos original e na premissa
    const transformado = gerarFluxoCenario(base, { premissa, postura });
    const seed = {
      ...strip(base),
      nodes: transformado.nodes,
      connections: transformado.connections,
    };

    const cenario = await this.createCanvas(clientId, {
      name: nome || `${base.name} — ${premissa}`.slice(0, 80),
      folderId: base.folderId,
      seed,
      derivadoDe: {
        canvasId: base.id,
        premissa: String(premissa).trim(),
        postura,
        oportunidadeId: oportunidadeId ? String(oportunidadeId) : null,
      },
    });

    // Se nasceu de uma oportunidade de receita, amarra de volta no canvas base
    if (oportunidadeId && Array.isArray(base.oportunidades)) {
      const idx = base.oportunidades.findIndex((o) => o.id === oportunidadeId);
      if (idx !== -1) {
        const opsAtualizadas = [...base.oportunidades];
        opsAtualizadas[idx] = {
          ...opsAtualizadas[idx],
          cenarioId: cenario.id,
          status: 'simulado',
        };
        await this.saveCanvas(clientId, base.id, { oportunidades: opsAtualizadas });
      }
    }

    return cenario;
  }

  /** Salva e versiona o Canvas como um "Mapa de Processos" em Markdown. */
  async salvarMapaProcesso(clientId, canvasId, { autor = 'Consultor', nota = '' } = {}) {
    const canvas = await this.getCanvas(clientId, canvasId);
    const client = await this.storage.readClient(clientId).catch(() => null);
    const markdown = canvasParaMarkdown(canvas, { clienteNome: client?.name || clientId });
    
    const versoesMapa = Array.isArray(canvas.versoesMapa) ? [...canvas.versoesMapa] : [];
    const novaVersao = {
      versao: versoesMapa.length + 1,
      criadoEm: new Date().toISOString(),
      rev: canvas.rev,
      nodeCount: (canvas.nodes || []).length,
      edgeCount: (canvas.connections || []).length,
      bottleneckCount: (canvas.nodes || []).filter(n => n.bottleneck).length,
      autor,
      nota: nota || `Versão ${versoesMapa.length + 1} do Mapa de Processos`,
      markdown,
    };

    versoesMapa.push(novaVersao);

    const updated = await this.saveCanvas(clientId, canvasId, {
      versoesMapa,
      mapaProcessoAtual: novaVersao,
    });

    return { versao: novaVersao, totalVersoes: versoesMapa.length, canvas: updated };
  }

  async listarVersoesMapa(clientId, canvasId) {
    const canvas = await this.getCanvas(clientId, canvasId);
    return canvas.versoesMapa || [];
  }

  /** Cenários derivados de um canvas. */
  async listarCenarios(clientId, canvasId) {
    const todos = await this.listCanvases(clientId);
    return todos.filter((c) => c.derivadoDe?.canvasId === canvasId);
  }

  async moveCanvasToClient(fromClientId, canvasId, toClientId) {
    const source = await this.getCanvas(fromClientId, canvasId);
    await this.ensureClient(toClientId);
    // Copia primeiro, apaga depois: se a escrita falhar, nada se perde.
    const created = await this.createCanvas(toClientId, { name: source.name, seed: strip(source) });
    await this.storage.deleteCanvas(fromClientId, canvasId);
    return { canvasId: created.id, clientId: toClientId };
  }

  // --- canvas ---

  async getCanvas(clientId, canvasId) {
    const raw = await this.storage.readCanvas(clientId, canvasId);
    if (!raw) throw httpError(404, `Canvas ${canvasId} não encontrado`);
    const doc = hydrateCanvas(raw, { id: canvasId, clientId });
    if (doc._droppedEdges > 0) {
      console.warn(`[canvas] ${canvasId}: ${doc._droppedEdges} aresta(s) órfã(s) descartada(s) na leitura`);
    }
    return doc;
  }

  async createCanvas(clientId, { name, folderId = null, seed = null, derivadoDe = null }) {
    await this.ensureClient(clientId);
    const id = newCanvasId();
    const doc = seed
      ? hydrateCanvas({ ...seed, id, clientId, name, folderId, rev: 0, derivadoDe }, { id, clientId })
      : emptyCanvas({ id, clientId, name, folderId });
    await this.storage.writeCanvas(clientId, id, strip(doc));
    return doc;
  }

  /**
   * Escrita com concorrência otimista.
   *
   * `expectedRev` vem do header `If-Match` do navegador. Duas abas abertas no
   * mesmo canvas, ou o agente aplicando um changeset enquanto você digita,
   * levam a segunda escrita a um 409 em vez de sobrescrever silenciosamente.
   * O cliente responde ao 409 recarregando o estado — mais barato que CRDT e
   * suficiente para um único usuário.
   */
  async saveCanvas(clientId, canvasId, patch, { expectedRev = null, backupTag = '' } = {}) {
    return withLock(`${clientId}/${canvasId}`, async () => {
      const current = await this.storage.readCanvas(clientId, canvasId);
      if (!current) throw httpError(404, `Canvas ${canvasId} não encontrado`);

      const currentRev = current.rev ?? 0;
      if (expectedRev !== null && Number(expectedRev) !== currentRev) {
        throw httpError(409, 'O canvas mudou desde a última leitura', {
          currentRev,
          expectedRev: Number(expectedRev),
        });
      }

      if (backupTag) await this.storage.backupCanvas(clientId, canvasId, current, backupTag);

      const merged = hydrateCanvas(
        {
          ...current,
          ...patch,
          id: canvasId,
          clientId,
          createdAt: current.createdAt,
          rev: currentRev + 1,
          lastModified: new Date().toISOString(),
        },
        { id: canvasId, clientId },
      );

      await this.storage.writeCanvas(clientId, canvasId, strip(merged));
      return merged;
    });
  }

  async renameCanvas(clientId, canvasId, name) {
    return this.saveCanvas(clientId, canvasId, { name });
  }

  async moveCanvas(clientId, canvasId, folderId) {
    return this.saveCanvas(clientId, canvasId, { folderId });
  }

  async deleteCanvas(clientId, canvasId) {
    return withLock(`${clientId}/${canvasId}`, async () => {
      const ok = await this.storage.deleteCanvas(clientId, canvasId);
      if (!ok) throw httpError(404, `Canvas ${canvasId} não encontrado`);
      return { deleted: canvasId };
    });
  }
}

/** Remove os campos derivados que não devem ir para o disco. */
function strip(doc) {
  const out = { ...doc };
  for (const key of Object.keys(out)) {
    if (key.startsWith('_')) delete out[key];
  }
  return out;
}
