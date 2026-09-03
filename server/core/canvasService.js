import { hydrateCanvas, emptyCanvas } from './schema.js';
import { compararEmTexto } from './comparador.js';
import { mapaMarkdown, comparacaoMarkdown, nomeDaComparacao, NOME_DO_MAPA } from './docService.js';
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
        bottleneckCount: Array.isArray(doc.nodes) ? doc.nodes.filter((n) => n.bottleneck).length : 0,
        mapaProcessoAtual: doc.mapaProcessoAtual ?? null,
        versoesMapaCount: Array.isArray(doc.versoesMapa) ? doc.versoesMapa.length : 0,
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
   * Invariante de Domínio: Empresa -> Processo -> Cenário.
   * Um cenário SÓ pode ser criado se o processo pai tiver sido salvo como "Mapa de Processos".
   *
   * ── Cenário e oportunidade são coisas SEPARADAS ──────────────────────────
   * Houve uma regra de que todo cenário testava exatamente UMA oportunidade de
   * receita, e cada oportunidade tinha no máximo um cenário. Ela caiu.
   *
   * A pergunta que origina um cenário quase nunca cabe numa oportunidade
   * ancorada em aresta: "e se usássemos um aplicativo para fazer a venda"
   * questiona o processo inteiro, não uma passagem de bastão. Com a regra no
   * lugar, um processo sem oportunidade mapeada simplesmente não podia ser
   * simulado — e era o caso da maioria dos canvases em disco.
   *
   * `oportunidadeId` continua aceito e é gravado em `derivadoDe` quando vier:
   * anotar de onde a ideia saiu é útil. O que não existe mais é a EXIGÊNCIA, a
   * regra 1:1 e a escrita da ponta de volta na oportunidade.
   */
  async criarCenario(clientId, canvasId, { nome, premissa, postura = 'realista', oportunidadeId = null, autoPromoverMapa = true } = {}) {
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

    // Invariante: Processo precisa ter baseline registrado ("Mapa de Processos")
    if (!base.mapaProcessoAtual && (!base.versoesMapa || base.versoesMapa.length === 0)) {
      if (autoPromoverMapa && base.nodes && base.nodes.length > 0) {
        await this.salvarMapaProcesso(clientId, canvasId, {
          autor: 'Sistema (Auto-Baseline)',
          nota: 'Baseline oficial registrado automaticamente para criação de cenários',
        });
      } else {
        throw httpError(422,
          'Um cenário só pode ser criado a partir de um processo salvo como "Mapa de Processos". '
          + 'Salve o mapa deste processo primeiro para estabelecer a linha de base.');
      }
    }

    // Gera o fluxo transformado com base no mapa de processos original e na premissa
    const transformado = gerarFluxoCenario(base, { premissa, postura, oportunidadeId });

    const cenario = await this.createCanvas(clientId, {
      name: nome || `${base.name} — ${premissa}`.slice(0, 80),
      folderId: base.folderId,
      /**
       * O fork nasce com o fluxo TRANSFORMADO pela premissa, não com uma cópia
       * crua do processo real — é isso que faz o cenário responder à pergunta
       * que o originou em vez de ser um clone.
       *
       * E leva as oportunidades, mas não os ponteiros de cenário delas: um
       * `cenarioId` copiado apontaria, de dentro do cenário, para um irmão — e o
       * vínculo que importa aqui é o `derivadoDe`, não a herança de outro fork.
       */
      seed: strip({
        ...base,
        oportunidades: base.oportunidades.map((o) => ({ ...o, cenarioId: null, status: o.status })),
        nodes: transformado.nodes,
        connections: transformado.connections,
      }),
      derivadoDe: {
        canvasId: base.id,
        oportunidadeId,
        premissa: String(premissa).trim(),
        postura,
        comparativoTexto: transformado.comparativoTexto,
        nosRemovidos: transformado.nosRemovidos,
        nosSubstituidos: transformado.nosSubstituidos,
        nosAdicionados: transformado.nosAdicionados,
      },
    });

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

  /**
   * O que existe de cenário neste processo, para o mostrador.
   *
   * Era um PAREAMENTO: casava cada oportunidade com o seu cenário e devolvia as
   * contagens que sustentavam a regra "1 cenário : 1 oportunidade". A regra caiu,
   * e com ela some a razão de casar as duas listas.
   *
   * Some junto uma armadilha: a versão anterior CORRIGIA `op.cenarioId` em disco
   * no meio de um GET. Um GET que escreve já é surpresa em qualquer código; este
   * reintroduzia, a cada leitura do Hub, exatamente o vínculo que `criarCenario`
   * tinha acabado de parar de criar. Foi pego na validação do desacoplamento —
   * o campo reaparecia sozinho depois de uma abertura de tela.
   *
   * A chave `cenarios` fica porque quatro telas desestruturam `{ cenarios }`
   * daqui: a lista do topo, o chat, o comparador e o Hub.
   */
  async pareamentoDeCenarios(clientId, canvasId) {
    const base = await this.getCanvas(clientId, canvasId);
    if (base.derivadoDe) {
      throw httpError(422,
        `"${base.name}" é um cenário. A lista vive no canvas do processo real — `
        + `peça em "${base.derivadoDe.canvasId}".`);
    }
    const cenarios = await this.listarCenarios(clientId, canvasId);
    return {
      canvasId: base.id,
      canvasNome: base.name,
      cenarios,
      oportunidades: base.oportunidades,
      totalCenarios: cenarios.length,
      totalOportunidades: base.oportunidades.length,
    };
  }

  // --- entregáveis (.md) ---

  /**
   * Gera e grava o mapa de processos e gargalos.
   *
   * Sempre regenerado do canvas, nunca editado à mão: o documento é uma
   * PROJEÇÃO do mapa, e um `.md` divergindo do canvas que ele descreve seria a
   * pior das duas fontes de verdade — a que o cliente leva para a reunião.
   */
  async gerarMapa(clientId, canvasId) {
    const canvas = await this.getCanvas(clientId, canvasId);
    const client = await this.storage.readClient(clientId);
    const texto = mapaMarkdown(canvas, { clienteNome: client?.name ?? null });
    const info = await this.storage.writeDoc(clientId, canvasId, NOME_DO_MAPA, texto);
    return { ...info, canvasId, rev: canvas.rev, texto };
  }

  /**
   * Gera e grava a comparação real × cenário.
   *
   * `canvasId` é o do CENÁRIO — é ele que sabe de onde saiu. A narrativa chega
   * pronta do agente; a estrutura é contada aqui. Ver `docService.js` para por
   * que essa divisão não é acidental.
   */
  async gerarComparacao(clientId, canvasId, narrativa = {}) {
    const cenario = await this.getCanvas(clientId, canvasId);
    if (!cenario.derivadoDe) {
      throw httpError(422, `"${cenario.name}" não é um cenário — não há do que comparar. `
        + 'Gere a comparação a partir do canvas derivado, não do processo real.');
    }
    const base = await this.getCanvas(clientId, cenario.derivadoDe.canvasId);
    const texto = comparacaoMarkdown(base, cenario, compararEmTexto(base, cenario), narrativa);

    /**
     * Gravada sob o canvas BASE, não sob o cenário.
     *
     * A comparação é um documento do processo real — é lá que o consultor
     * procura "o que já testamos", junto do mapa. Guardá-la sob o cenário
     * espalharia os entregáveis por um diretório por fork.
     */
    const info = await this.storage.writeDoc(
      clientId, base.id, nomeDaComparacao(cenario.id), texto,
    );
    return { ...info, canvasId: base.id, cenarioId: cenario.id, texto };
  }

  async lerDoc(clientId, canvasId, nome) {
    const texto = await this.storage.readDoc(clientId, canvasId, nome);
    if (texto === null) throw httpError(404, `Documento "${nome}" não existe neste canvas.`);
    return texto;
  }

  async listarDocs(clientId, canvasId) {
    return this.storage.listDocs(clientId, canvasId);
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

      /**
       * `cenarioId` nunca vem do navegador.
       *
       * O autosave manda o DOCUMENTO INTEIRO. Uma aba aberta antes de o cenário
       * existir tem oportunidades sem `cenarioId` em memória, e o primeiro
       * salvamento — que pode ser só o consultor arrastando um card — apagaria o
       * vínculo do disco. Sem 409, sem log: é a mesma armadilha que o README
       * descreve para `childCanvas`, e ela custou 15 nós da última vez.
       *
       * O campo virou FÓSSIL quando cenário e oportunidade se separaram: ninguém
       * mais o escreve. A guarda não ficou obsoleta com isso — ficou incondicional.
       * Antes existia `vinculoDeCenario` para `criarCenario` poder furá-la e
       * gravar o vínculo; sem escritor, não há o que furar, e o único papel que
       * resta é impedir que o autosave apague o que canvases antigos já têm.
       */
      const patchCorrigido = { ...patch };
      if (Array.isArray(patch?.oportunidades)) {
        const gravado = new Map((current.oportunidades ?? []).map((o) => [o.id, o.cenarioId ?? null]));
        patchCorrigido.oportunidades = patch.oportunidades.map((o) => (
          gravado.has(o.id) ? { ...o, cenarioId: gravado.get(o.id) } : o
        ));
      }

      const merged = hydrateCanvas(
        {
          ...current,
          ...patchCorrigido,
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
