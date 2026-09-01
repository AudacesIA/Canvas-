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
   */
  async criarCenario(clientId, canvasId, { nome, premissa, postura = 'realista', oportunidadeId, autoPromoverMapa = true } = {}) {
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

    /**
     * Todo cenário testa UMA oportunidade de receita, e cada oportunidade tem
     * no máximo UM cenário.
     *
     * A sequência da consultoria é gargalo → oportunidade → cenário que a
     * pré-valida → comparação. Um cenário sem oportunidade é um desenho sem
     * pergunta: dá para navegar e não dá para decidir nada com ele. É também o
     * que mantém o Hub honesto: lá a contagem de cenários sai da lista de
     * oportunidades, e um cenário solto não teria linha onde aparecer.
     *
     * Vem ANTES da trava de baseline de propósito: estas três validações só
     * leem, e a de baseline escreve (auto-promove o mapa). Na ordem inversa, um
     * pedido recusado por falta de `oportunidadeId` deixaria para trás uma
     * versão de mapa que ninguém pediu.
     */
    if (!oportunidadeId) {
      throw httpError(422,
        'Cenário exige "oportunidadeId": qual oportunidade de receita ele pré-valida. '
        + `Use get_oportunidades em "${base.name}" para escolher. Um cenário sem a `
        + 'oportunidade que o originou é um desenho sem pergunta.');
    }
    const oportunidade = base.oportunidades.find((o) => o.id === oportunidadeId);
    if (!oportunidade) {
      throw httpError(422,
        `Não existe oportunidade "${oportunidadeId}" em "${base.name}". `
        + `Mapeadas: ${base.oportunidades.map((o) => `${o.id} (${o.titulo})`).join(', ') || 'nenhuma'}.`);
    }
    const existentes = await this.listarCenarios(clientId, canvasId);
    const jaTem = existentes.find((c) => c.derivadoDe?.oportunidadeId === oportunidadeId);
    if (jaTem) {
      throw httpError(409,
        `"${oportunidade.titulo}" já tem cenário: "${jaTem.name}". A regra é um cenário por `
        + 'oportunidade — é o que mantém as duas contagens iguais. Edite o cenário existente, '
        + 'ou mapeie outra oportunidade se a premissa for realmente outra.');
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
      name: nome || oportunidade.titulo || `${base.name} — ${premissa}`.slice(0, 80),
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

    /**
     * Grava a ponta de volta no canvas real, e move a oportunidade para
     * "simulado" — é o estágio que o Hub lê para saber o que já foi testado.
     *
     * Relê o canvas em vez de usar o `base` de cima: entre a leitura e aqui
     * houve uma escrita (a criação do fork) e o consultor pode ter digitado.
     *
     * `vinculoDeCenario` é obrigatório. Sem ele a guarda do `saveCanvas` relê o
     * `cenarioId` do disco e reimpõe o valor antigo por cima — a guarda existe
     * para o autosave do navegador não apagar o vínculo, e bloquearia
     * justamente a escrita que ela protege.
     */
    const atual = await this.getCanvas(clientId, canvasId);
    const doc = {
      ...atual,
      oportunidades: atual.oportunidades.map((o) => (
        o.id === oportunidadeId ? { ...o, cenarioId: cenario.id, status: 'simulado' } : o
      )),
    };
    await this.saveCanvas(clientId, canvasId, doc, { backupTag: 'cenario', vinculoDeCenario: true });

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
   * O pareamento que a tela e o agente consomem: uma linha por OPORTUNIDADE.
   *
   * A contagem de cenários não pode divergir da de oportunidades, e a forma de
   * garantir isso não é uma checagem — é não existir uma segunda lista de onde
   * um número diferente possa sair. Quem itera aqui itera `oportunidades`; o
   * cenário é um campo de cada linha, presente ou `null`.
   *
   * `orfaos` são cenários cuja oportunidade sumiu do canvas base. Não somem da
   * resposta: um canvas em disco que ninguém consegue alcançar pela tela é
   * exatamente o tipo de dado invisível que o resto do projeto recusa.
   */
  async pareamentoDeCenarios(clientId, canvasId) {
    const base = await this.getCanvas(clientId, canvasId);
    if (base.derivadoDe) {
      throw httpError(422,
        `"${base.name}" é um cenário. O pareamento vive no canvas do processo real — `
        + `peça em "${base.derivadoDe.canvasId}".`);
    }
    const cenarios = await this.listarCenarios(clientId, canvasId);
    const porOportunidade = new Map(
      cenarios.filter((c) => c.derivadoDe?.oportunidadeId)
        .map((c) => [c.derivadoDe.oportunidadeId, c]),
    );

    /**
     * Conserta a deriva do cache antes de responder.
     *
     * `op.cenarioId` é cache; a verdade é o `derivadoDe` de cada cenário. Se os
     * dois divergirem — cenário criado por uma versão antiga, escrita perdida
     * numa corrida — o estrago não é cosmético: a hidratação usa o cache para
     * decidir se uma oportunidade órfã sobrevive, e um cache vazio faz ela ser
     * descartada junto com a única ponta do vínculo.
     *
     * Reparar na leitura é o que fecha essa janela, e o mostrador é o lugar
     * certo: é a tela que o consultor abre justamente para ver o pareamento.
     * Escrita idempotente, só quando há divergência de fato.
     */
    const corrigidas = base.oportunidades.map((o) => {
      const real = porOportunidade.get(o.id)?.id ?? null;
      return real === (o.cenarioId ?? null) ? o : { ...o, cenarioId: real };
    });
    if (corrigidas.some((o, i) => o !== base.oportunidades[i])) {
      await this.saveCanvas(clientId, canvasId,
        { ...base, oportunidades: corrigidas },
        { vinculoDeCenario: true });
    }

    const linhas = corrigidas.map((oportunidade) => ({
      oportunidade,
      cenario: porOportunidade.get(oportunidade.id) ?? null,
    }));
    const conhecidas = new Set(corrigidas.map((o) => o.id));

    return {
      canvasId: base.id,
      canvasNome: base.name,
      /**
       * Lista plana, ao lado do pareamento.
       *
       * O Hub e o comparador desestruturam `{ cenarios }` desta rota. O
       * pareamento é a forma que impede a contagem de divergir, mas remover a
       * lista quebraria duas telas por um ganho nenhum — as duas saem do mesmo
       * dado, e quem precisa de contagem usa o pareamento.
       */
      cenarios,
      oportunidades: linhas,
      total: linhas.length,
      comCenario: linhas.filter((l) => l.cenario).length,
      semCenario: linhas.filter((l) => !l.cenario).length,
      orfaos: cenarios.filter((c) => !c.derivadoDe?.oportunidadeId
        || !conhecidas.has(c.derivadoDe.oportunidadeId)),
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
  async saveCanvas(clientId, canvasId, patch, { expectedRev = null, backupTag = '', vinculoDeCenario = false } = {}) {
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
       * `cenarioId` é do servidor, não do navegador.
       *
       * O autosave manda o DOCUMENTO INTEIRO. Uma aba aberta antes de o cenário
       * existir tem oportunidades sem `cenarioId` em memória, e o primeiro
       * salvamento — que pode ser só o consultor arrastando um card — apagaria o
       * vínculo do disco. Sem 409, sem log: é a mesma armadilha que o README
       * descreve para `childCanvas`, e ela custou 15 nós da última vez.
       *
       * Só quem escreve este campo é `criarCenario`, e é por isso que existe o
       * `vinculoDeCenario`: sem ele esta guarda bloquearia a própria escrita que
       * ela existe para proteger. Para todo o resto — o autosave inclusive — o
       * campo é relido de disco e reimposto por id, ignorando o que veio no corpo.
       */
      const patchCorrigido = { ...patch };
      if (!vinculoDeCenario && Array.isArray(patch?.oportunidades)) {
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
