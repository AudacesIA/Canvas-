import { sendJson, readJsonBody } from './router.js';
import { httpError } from '../core/canvasService.js';
import { subscribe } from '../core/events.js';
import { canvasOutline, canvasStats } from '../core/views.js';

export function registerChangesetRoutes(router, { canvasService, changesetService }) {
  // --- SSE: é por aqui que a proposta chega à tela sem F5 ---
  router.get('/api/clients/:clientId/canvases/:canvasId/events', (req, res, { canvasId }) => {
    subscribe(canvasId, res);
  });

  // --- leitura para o agente ---
  router.get('/api/clients/:clientId/canvases/:canvasId/outline', async (req, res, { clientId, canvasId }, url) => {
    const canvas = await canvasService.getCanvas(clientId, canvasId);
    const text = canvasOutline(canvas, {
      area: url.searchParams.get('area'),
      includeEdges: url.searchParams.get('edges') !== '0',
      // `into` = alias ou id de um nó com subprocesso; desce um nível.
      into: url.searchParams.get('into'),
    });
    sendJson(res, 200, { outline: text, rev: canvas.rev, stats: canvasStats(canvas) });
  });

  // --- layout: o agente descreve topologia, o servidor resolve geometria ---
  router.post('/api/clients/:clientId/canvases/:canvasId/layout', async (req, res, { clientId, canvasId }) => {
    const { scope = null, direction = 'LR', preserveManual = true } = await readJsonBody(req);
    const { computeLayout } = await import('../core/layoutService.js');
    const canvas = await canvasService.getCanvas(clientId, canvasId);
    sendJson(res, 200, computeLayout(canvas, { scope, direction, preserveManual }));
  });

  router.get('/api/clients/:clientId/canvases/:canvasId/validate', async (req, res, { clientId, canvasId }) => {
    const { diagnose } = await import('../core/views.js');
    sendJson(res, 200, { problems: diagnose(await canvasService.getCanvas(clientId, canvasId)) });
  });

  // --- changesets ---
  router.get('/api/clients/:clientId/changesets', async (req, res, { clientId }, url) => {
    const canvasId = url.searchParams.get('canvasId');
    sendJson(res, 200, { changesets: await changesetService.listPending(clientId, canvasId) });
  });

  router.get('/api/clients/:clientId/changesets/:changesetId', async (req, res, { clientId, changesetId }) => {
    sendJson(res, 200, { changeset: await changesetService.get(clientId, changesetId) });
  });

  router.post('/api/clients/:clientId/canvases/:canvasId/changesets', async (req, res, { clientId, canvasId }) => {
    const body = await readJsonBody(req);
    if (!Array.isArray(body.ops)) throw httpError(400, 'ops é obrigatório e deve ser um array');
    sendJson(res, 201, await changesetService.propose(clientId, canvasId, body));
  });

  router.post('/api/clients/:clientId/changesets/:changesetId/resolve', async (req, res, { clientId, changesetId }) => {
    const { accept = null, reject = [], acceptGroups = [], rejectGroups = [] } = await readJsonBody(req);
    sendJson(res, 200, await changesetService.resolve(clientId, changesetId, {
      accept, reject, acceptGroups, rejectGroups,
    }));
  });

  router.delete('/api/clients/:clientId/changesets/:changesetId', async (req, res, { clientId, changesetId }) => {
    sendJson(res, 200, await changesetService.cancel(clientId, changesetId));
  });

  /**
   * Pedido do agente para o navegador mostrar algo.
   *
   * Transforma a conversa em algo tangível: "olha, é deste ponto aqui que
   * estou falando". Barato de implementar e desproporcionalmente valioso.
   */
  router.post('/api/clients/:clientId/canvases/:canvasId/focus', async (req, res, { clientId, canvasId }) => {
    const { nodeIds = [], message = '' } = await readJsonBody(req);
    const { publish, subscriberCount } = await import('../core/events.js');
    publish(canvasId, 'focus', { clientId, canvasId, nodeIds, message });
    sendJson(res, 200, { watching: subscriberCount(canvasId) });
  });
}
