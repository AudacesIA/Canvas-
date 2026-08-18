import { sendJson, readJsonBody } from './router.js';
import { httpError } from '../core/canvasService.js';
import { hydrateCanvas } from '../core/schema.js';
import { newCanvasId, newFolderId, slugify } from '../core/ids.js';

/**
 * Importação one-shot do localStorage.
 *
 * Não dá para ler o localStorage de fora do navegador, então a migração é uma
 * página (`scripts/migrate-localstorage.html`) que lê as chaves e faz POST
 * aqui. Idempotente por `sourceKey`: rodar duas vezes não duplica canvas.
 *
 * Corpo esperado:
 *   { clientName, home: {folders:[...]}, canvases: {<key>: <doc>}, legacy: <doc>|null }
 */
export function registerImportRoutes(router, { canvasService }) {
  router.post('/api/import', async (req, res) => {
    const body = await readJsonBody(req);
    const clientName = body.clientName || 'Padrão';
    const clientId = body.clientId ? slugify(body.clientId) : slugify(clientName);

    await canvasService.ensureClient(clientId, clientName);

    // Já importados antes? Casamos pelo sourceKey guardado no documento.
    const existing = await canvasService.listCanvases(clientId);
    const seen = new Map();
    for (const meta of existing) {
      const doc = await canvasService.storage.readCanvas(clientId, meta.id);
      if (doc?.sourceKey) seen.set(doc.sourceKey, meta.id);
    }

    // --- pastas ---
    const folderIdMap = new Map();
    const folders = [];
    // O nome e a pasta de cada canvas viviam no índice `audaces_home`, não no
    // documento — essa duplicação era justamente a fonte de dessincronia que o
    // novo formato elimina. Na importação ainda precisamos consultar o índice
    // para não perder os nomes.
    const metaByKey = new Map();
    const srcFolders = Array.isArray(body.home?.folders) ? body.home.folders : [];

    srcFolders.forEach((f, index) => {
      const id = f.id || newFolderId();
      folderIdMap.set(f.id, id);
      folders.push({ id, name: f.name || `Pasta ${index + 1}`, order: index });
      for (const cv of f.canvases || []) {
        metaByKey.set(`audaces_canvas_${cv.id}`, { name: cv.name, folderId: f.id, createdAt: cv.createdAt });
      }
    });
    if (folders.length) await canvasService.storage.writeFolders(clientId, folders);

    // --- canvases ---
    const imported = [];
    const skipped = [];
    const entries = Object.entries(body.canvases || {});

    for (const [sourceKey, raw] of entries) {
      if (!raw || typeof raw !== 'object') continue;
      if (seen.has(sourceKey)) {
        skipped.push({ sourceKey, canvasId: seen.get(sourceKey), reason: 'já importado' });
        continue;
      }

      const id = newCanvasId();
      const meta = metaByKey.get(sourceKey) ?? {};
      const doc = hydrateCanvas(
        {
          ...raw,
          id,
          clientId,
          name: raw.name || meta.name || nameFromKey(sourceKey),
          folderId: folderIdMap.get(raw.folderId ?? meta.folderId) ?? null,
          createdAt: raw.createdAt || meta.createdAt || undefined,
          rev: 0,
        },
        { id, clientId },
      );

      await canvasService.storage.writeCanvas(clientId, id, { ...strip(doc), sourceKey });
      imported.push({
        sourceKey,
        canvasId: id,
        name: doc.name,
        nodes: doc.nodes.length,
        edges: doc.connections.length,
        droppedEdges: doc._droppedEdges,
      });
    }

    // --- chave legada de canvas único ---
    if (body.legacy && typeof body.legacy === 'object' && !seen.has('audaces_canvas_data')) {
      const id = newCanvasId();
      const doc = hydrateCanvas(
        { ...body.legacy, id, clientId, name: 'Canvas (formato antigo)', rev: 0 },
        { id, clientId },
      );
      if (doc.nodes.length) {
        await canvasService.storage.writeCanvas(clientId, id, { ...strip(doc), sourceKey: 'audaces_canvas_data' });
        imported.push({ sourceKey: 'audaces_canvas_data', canvasId: id, name: doc.name, nodes: doc.nodes.length, edges: doc.connections.length, droppedEdges: doc._droppedEdges });
      }
    }

    if (!imported.length && !skipped.length) throw httpError(400, 'Nada para importar: nenhum canvas no corpo');

    sendJson(res, 200, { clientId, folders: folders.length, imported, skipped });
  });
}

function nameFromKey(key) {
  return `Canvas ${String(key).replace(/^audaces_canvas_/, '').slice(0, 12)}`;
}

function strip(doc) {
  const out = { ...doc };
  for (const key of Object.keys(out)) if (key.startsWith('_')) delete out[key];
  return out;
}
