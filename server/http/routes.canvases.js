import { sendJson, readJsonBody } from './router.js';
import { httpError } from '../core/canvasService.js';

/**
 * Rotas de cliente e canvas.
 *
 * Convenção: o cliente é sempre explícito no caminho. Não existe "cliente
 * atual" no servidor — o daemon atende vários Projects do Claude Desktop ao
 * mesmo tempo e estado de sessão global seria exatamente o bug que a topologia
 * de dois processos existe para evitar.
 */
export function registerCanvasRoutes(router, { canvasService }) {
  router.get('/api/clients', async (req, res) => {
    sendJson(res, 200, { clients: await canvasService.listClients() });
  });

  router.post('/api/clients', async (req, res) => {
    const { name } = await readJsonBody(req);
    if (!name) throw httpError(400, 'name é obrigatório');
    sendJson(res, 201, { client: await canvasService.createClient(name) });
  });

  router.patch('/api/clients/:clientId', async (req, res, { clientId }) => {
    const { name } = await readJsonBody(req);
    if (!name) throw httpError(400, 'name é obrigatório');
    const current = await canvasService.storage.readClient(clientId);
    if (!current) throw httpError(404, `Cliente ${clientId} não encontrado`);
    // O id (diretório) não muda no rename: renomear o diretório invalidaria o
    // clientId fixado na instrução do Project do Claude Desktop.
    sendJson(res, 200, { client: await canvasService.storage.writeClient(clientId, { ...current, name }) });
  });

  router.delete('/api/clients/:clientId', async (req, res, { clientId }) => {
    sendJson(res, 200, await canvasService.deleteClient(clientId));
  });

  // Áreas e taxonomia de desperdício efetivas desta empresa.
  router.get('/api/clients/:clientId/vocabulary', async (req, res, { clientId }) => {
    const { resolveVocabulary } = await import('../core/vocabulary.js');
    sendJson(res, 200, resolveVocabulary(await canvasService.storage.readClient(clientId)));
  });

  // Estrutura completa da home: um cliente com seus canvases.
  router.get('/api/clients/:clientId/home', async (req, res, { clientId }) => {
    sendJson(res, 200, await canvasService.getHome(clientId));
  });

  // Tudo o que a tela inicial precisa, numa chamada só.
  router.get('/api/home', async (req, res) => {
    sendJson(res, 200, { clients: await canvasService.getFullHome() });
  });

  router.get('/api/clients/:clientId/canvases', async (req, res, { clientId }) => {
    sendJson(res, 200, { canvases: await canvasService.listCanvases(clientId) });
  });

  router.post('/api/clients/:clientId/canvases', async (req, res, { clientId }) => {
    const { name, folderId = null, seed = null } = await readJsonBody(req);
    if (!name) throw httpError(400, 'name é obrigatório');
    const doc = await canvasService.createCanvas(clientId, { name, folderId, seed });
    sendJson(res, 201, { canvas: doc });
  });

  router.get('/api/clients/:clientId/canvases/:canvasId', async (req, res, { clientId, canvasId }) => {
    const doc = await canvasService.getCanvas(clientId, canvasId);
    res.setHeader('ETag', String(doc.rev));
    sendJson(res, 200, { canvas: doc });
  });

  /**
   * Salvamento do navegador. `If-Match` carrega o `rev` que o cliente tinha;
   * divergência devolve 409 com o `rev` atual, e o cliente recarrega em vez de
   * sobrescrever o trabalho de outra aba (ou do agente).
   */
  router.put('/api/clients/:clientId/canvases/:canvasId', async (req, res, { clientId, canvasId }) => {
    const body = await readJsonBody(req);
    const ifMatch = req.headers['if-match'];
    const expectedRev = ifMatch === undefined || ifMatch === '*' ? null : Number(String(ifMatch).replace(/"/g, ''));

    const doc = await canvasService.saveCanvas(clientId, canvasId, body, { expectedRev });
    res.setHeader('ETag', String(doc.rev));
    sendJson(res, 200, { rev: doc.rev, lastModified: doc.lastModified });
  });

  router.patch('/api/clients/:clientId/canvases/:canvasId', async (req, res, { clientId, canvasId }) => {
    const { name, folderId } = await readJsonBody(req);
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (folderId !== undefined) patch.folderId = folderId;
    if (!Object.keys(patch).length) throw httpError(400, 'nada para atualizar (name ou folderId)');
    const doc = await canvasService.saveCanvas(clientId, canvasId, patch);
    sendJson(res, 200, { rev: doc.rev, name: doc.name, folderId: doc.folderId });
  });

  router.delete('/api/clients/:clientId/canvases/:canvasId', async (req, res, { clientId, canvasId }) => {
    sendJson(res, 200, await canvasService.deleteCanvas(clientId, canvasId));
  });

  // --- cenário "e se": fork do processo real, com vínculo de volta ---
  router.post('/api/clients/:clientId/canvases/:canvasId/cenarios', async (req, res, { clientId, canvasId }) => {
    const { nome, premissa, postura, oportunidadeId } = await readJsonBody(req);
    sendJson(res, 201, {
      canvas: await canvasService.criarCenario(clientId, canvasId, {
        nome, premissa, postura, oportunidadeId,
      }),
    });
  });

  /**
   * O mostrador: uma linha por oportunidade, com o cenário dela ou `null`.
   *
   * Devolve o pareamento em vez da lista solta de cenários porque é a resposta
   * a "quantas das nossas ideias já foram desenhadas?" — e porque uma tela que
   * itera esta estrutura não consegue exibir contagens divergentes.
   */
  router.get('/api/clients/:clientId/canvases/:canvasId/cenarios', async (req, res, { clientId, canvasId }) => {
    sendJson(res, 200, await canvasService.pareamentoDeCenarios(clientId, canvasId));
  });

  router.get('/api/clients/:clientId/canvases/:canvasId/comparar', async (req, res, { clientId, canvasId }, url) => {
    const { compararCanvas, compararEmTexto } = await import('../core/comparador.js');
    const { compararProcessosMarkdown } = await import('../core/markdownComparator.js');
    const cenario = await canvasService.getCanvas(clientId, canvasId);
    if (!cenario.derivadoDe) {
      throw httpError(422, `"${cenario.name}" não é um cenário — não há do que comparar. `
        + 'Compare a partir do canvas derivado, não do processo real.');
    }
    const base = await canvasService.getCanvas(clientId, cenario.derivadoDe.canvasId);
    const client = await canvasService.storage.readClient(clientId).catch(() => null);
    const analiseMarkdown = compararProcessosMarkdown(base, cenario, { clienteNome: client?.name || clientId });
    
    sendJson(res, 200, {
      comparacao: compararCanvas(base, cenario),
      texto: compararEmTexto(base, cenario),
      analiseMarkdown,
    });
  });

  router.get('/api/clients/:clientId/canvases/:canvasId/markdown', async (req, res, { clientId, canvasId }) => {
    const { canvasParaMarkdown } = await import('../core/processoMarkdown.js');
    const canvas = await canvasService.getCanvas(clientId, canvasId);
    const client = await canvasService.storage.readClient(clientId).catch(() => null);
    const markdown = canvasParaMarkdown(canvas, { clienteNome: client?.name || clientId });
    sendJson(res, 200, { markdown, canvasId, name: canvas.name });
  });

  router.post('/api/clients/:clientId/canvases/:canvasId/salvar-mapa', async (req, res, { clientId, canvasId }) => {
    const body = await readJsonBody(req).catch(() => ({}));
    const result = await canvasService.salvarMapaProcesso(clientId, canvasId, body);
    sendJson(res, 201, result);
  });

  router.get('/api/clients/:clientId/canvases/:canvasId/versoes-mapa', async (req, res, { clientId, canvasId }) => {
    const versoes = await canvasService.listarVersoesMapa(clientId, canvasId);
    sendJson(res, 200, { versoes });
  });

  // --- entregáveis (.md) ---
  /** Regenera o mapa de processos e gargalos. Idempotente: sobrescreve. */
  router.post('/api/clients/:clientId/canvases/:canvasId/docs/mapa', async (req, res, { clientId, canvasId }) => {
    sendJson(res, 200, await canvasService.gerarMapa(clientId, canvasId));
  });

  /** `:canvasId` é o do CENÁRIO. A narrativa vem no corpo, redigida pelo agente. */
  router.post('/api/clients/:clientId/canvases/:canvasId/docs/comparacao', async (req, res, { clientId, canvasId }) => {
    const { pontosFortes, pontosFracos, veredito } = await readJsonBody(req);
    sendJson(res, 200, await canvasService.gerarComparacao(clientId, canvasId, {
      pontosFortes, pontosFracos, veredito,
    }));
  });

  router.get('/api/clients/:clientId/canvases/:canvasId/docs', async (req, res, { clientId, canvasId }) => {
    sendJson(res, 200, { docs: await canvasService.listarDocs(clientId, canvasId) });
  });

  /**
   * Devolve o Markdown cru, como texto.
   *
   * `text/markdown` e não JSON: o documento existe para ser lido fora da
   * ferramenta, e um `curl` que devolve o arquivo pronto é metade do valor dele.
   */
  router.get('/api/clients/:clientId/canvases/:canvasId/docs/:nome', async (req, res, { clientId, canvasId, nome }) => {
    const texto = await canvasService.lerDoc(clientId, canvasId, nome);
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(texto);
  });

  router.post('/api/clients/:clientId/canvases/:canvasId/duplicate', async (req, res, { clientId, canvasId }) => {
    sendJson(res, 201, { canvas: await canvasService.duplicateCanvas(clientId, canvasId) });
  });

  /** Motor Multi-Agentes Merlin */
  router.post('/api/clients/:clientId/canvases/:canvasId/merlin/simular', async (req, res, { clientId, canvasId }) => {
    const { MerlinEngine } = await import('../agents/merlinEngine.js');
    const body = await readJsonBody(req).catch(() => ({}));
    const merlin = new MerlinEngine(canvasService);
    const resultado = await merlin.simular({
      clientId,
      baseCanvasId: canvasId,
      premissa: body.premissa || 'Otimização operacional e logística',
      postura: body.postura || 'realista',
      oportunidadeId: body.oportunidadeId || null,
    });
    sendJson(res, 201, resultado);
  });

  /** Mover canvas entre clientes é copiar-e-apagar: são diretórios distintos. */
  router.post('/api/clients/:clientId/canvases/:canvasId/move', async (req, res, { clientId, canvasId }) => {
    const { toClientId } = await readJsonBody(req);
    if (!toClientId) throw httpError(400, 'toClientId é obrigatório');
    sendJson(res, 200, await canvasService.moveCanvasToClient(clientId, canvasId, toClientId));
  });
}
