import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FsStorage } from './storage/FsStorage.js';
import { CanvasService } from './core/canvasService.js';
import { ChangesetService } from './core/changesetService.js';
import { createRouter, sendJson } from './http/router.js';
import { createStaticHandler } from './http/static.js';
import { registerCanvasRoutes } from './http/routes.canvases.js';
import { registerChangesetRoutes } from './http/routes.changesets.js';
import { registerImportRoutes } from './http/routes.import.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.AUDASYS_PORT || 8787);
const HOST = '127.0.0.1'; // nunca 0.0.0.0: sem auth, isto não sai da máquina
const DATA_DIR = process.env.AUDASYS_DATA_DIR || path.join(ROOT, 'data');

const storage = new FsStorage(DATA_DIR);
const canvasService = new CanvasService(storage);
const changesetService = new ChangesetService(storage, canvasService);

const router = createRouter();
const serveStatic = createStaticHandler({
  webDir: path.join(ROOT, 'web'),
  scriptsDir: path.join(ROOT, 'scripts'),
});

router.get('/health', (req, res) => {
  sendJson(res, 200, { ok: true, service: 'audasys-canvas', pid: process.pid, dataDir: DATA_DIR });
});

/**
 * Canal de resultado dos testes headless.
 *
 * `--dump-dom` não conclui numa página com EventSource aberto — o tempo
 * virtual do Chrome nunca assenta. Em vez de depender do dump, a página de
 * teste posta o resultado aqui. Só existe com AUDASYS_TEST=1.
 */
if (process.env.AUDASYS_TEST === '1') {
  router.post('/api/_test-report', async (req, res) => {
    const { readJsonBody } = await import('./http/router.js');
    const body = await readJsonBody(req);
    const { writeFileSync } = await import('node:fs');
    writeFileSync('/tmp/audasys-e2e-report.json', JSON.stringify(body, null, 2));
    console.log(`\n=== RELATÓRIO E2E ===\n${body.text}\n`);
    sendJson(res, 200, { ok: true });
  });
}

registerCanvasRoutes(router, { canvasService });
registerChangesetRoutes(router, { canvasService, changesetService });
registerImportRoutes(router, { canvasService });

// A API é inteiramente same-origin: o daemon serve o app e os dados juntos.
// Não há exceção de CORS em nenhuma rota.

const LOG_REQUESTS = process.env.AUDASYS_LOG !== '0';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);

  // Log de API. É o que permite confirmar que digitar 30 caracteres gera uma
  // escrita, e não trinta — a razão de existir o debounce.
  if (LOG_REQUESTS && url.pathname.startsWith('/api/')) {
    const started = Date.now();
    res.once('finish', () => {
      console.log(`${req.method} ${url.pathname} → ${res.statusCode} (${Date.now() - started}ms)`);
    });
  }

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(405).end();
      return;
    }

    const match = router.match(req.method, url.pathname);
    if (match) {
      await match.handler(req, res, match.params, url);
      return;
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (await serveStatic(req, res, url)) return;
    }

    sendJson(res, 404, { error: 'Não encontrado', path: url.pathname });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) console.error(`[erro] ${req.method} ${url.pathname}`, err);
    if (res.headersSent) {
      res.end();
      return;
    }
    // O 409 leva o rev atual para o cliente conseguir se reconciliar sozinho.
    const payload = { error: err.message || 'Erro interno' };
    if (err.currentRev !== undefined) payload.currentRev = err.currentRev;
    if (err.expectedRev !== undefined) payload.expectedRev = err.expectedRev;
    sendJson(res, status, payload);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está ocupada. Se for outro daemon do Audasys, use-o; senão libere a porta.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Audasys Canvas em http://${HOST}:${PORT}`);
  console.log(`Dados em ${DATA_DIR}`);
});
