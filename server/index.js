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
import { registerAcessoRoutes } from './http/routes.acesso.js';
import { lerSessao, podeAcessar, exigirSegredo } from './http/sessao.js';
import { LimiteDeTentativas } from './http/limite.js';
import { Notificacoes } from './core/notificacoes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.AUDASYS_PORT || 8787);
/**
 * O padrão continua sendo local. `0.0.0.0` só em produção, atrás de um proxy
 * reverso que termina o HTTPS — este processo nunca fala TLS.
 *
 * Antes havia aqui um comentário dizendo "nunca 0.0.0.0: sem auth, isto não sai
 * da máquina". A condição mudou: agora há sessão assinada e autorização por
 * papel. Mas a trava velha era boa e vale manter uma equivalente — sair da
 * interface local exige segredo configurado, e é isso que `exigirSegredo` faz
 * logo abaixo.
 */
const HOST = process.env.AUDASYS_HOST || '127.0.0.1';
const DATA_DIR = process.env.AUDASYS_DATA_DIR || path.join(ROOT, 'data');

/**
 * Falha no boot, não na primeira requisição.
 *
 * Um servidor que sobe sem segredo e só quebra quando alguém tenta entrar é um
 * servidor que parece no ar. Melhor não subir.
 */
try {
  exigirSegredo();
} catch (err) {
  console.error(`\n[audasys] ${err.message}\n`);
  process.exit(1);
}

const storage = new FsStorage(DATA_DIR);
const canvasService = new CanvasService(storage);
const changesetService = new ChangesetService(storage, canvasService);
const limite = new LimiteDeTentativas(storage);
const notificacoes = new Notificacoes(storage);

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
    // Caminho configurável para o runner poder dar um arquivo por suíte — com
    // um caminho fixo, a segunda suíte sobrescreve o relatório da primeira e o
    // script lê o resultado errado sem perceber.
    writeFileSync(process.env.AUDASYS_RELATORIO || '/tmp/audasys-e2e-report.json',
      JSON.stringify(body, null, 2));
    console.log(`\n=== RELATÓRIO E2E ===\n${body.text}\n`);
    sendJson(res, 200, { ok: true });
  });
}

registerAcessoRoutes(router, { canvasService, limite, notificacoes });
registerCanvasRoutes(router, { canvasService, changesetService });
registerChangesetRoutes(router, { canvasService, changesetService });
registerImportRoutes(router, { canvasService });

// A API é inteiramente same-origin: o daemon serve o app e os dados juntos.
// Não há exceção de CORS em nenhuma rota.

const LOG_REQUESTS = process.env.AUDASYS_LOG !== '0';
const SERVICE_TOKEN = process.env.AUDASYS_SERVICE_TOKEN || '';

/**
 * As únicas rotas de API que respondem sem sessão.
 *
 * Conjunto explícito e minúsculo: `/api/sessao` para a tela descobrir quem é
 * (e responder "ninguém"), e `/api/entrar` para o consultor mandar a chave de
 * admin. Tudo o mais nasce fechado.
 */
const ROTAS_ABERTAS = new Set([
  '/api/sessao', '/api/entrar', '/api/sair',
  // O login do cliente e o pedido de recuperação acontecem ANTES de existir
  // sessão — se o portão os exigisse, ninguém entraria nunca. Quem os protege é
  // o limite de tentativas por IP, não a sessão.
  '/api/entrar-cliente', '/api/recuperar', '/api/senha-pendente',
]);
if (process.env.AUDASYS_TEST === '1') ROTAS_ABERTAS.add('/api/_test-report');

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

    /**
     * O portão. Único ponto, antes de qualquer rota.
     *
     * Só `/api/` é guardado aqui. Os estáticos (o HTML, o JS, o CSS) ficam
     * abertos de propósito: não há segredo neles, e a tela precisa carregar para
     * conseguir dizer "seu link expirou". Quem guarda o dado é a API.
     *
     * O `X-Audasys-Token` é a porta do MCP: o servidor stdio do Claude Desktop
     * fala com este daemon por HTTP e não tem navegador para carregar cookie.
     */
    if (url.pathname.startsWith('/api/') && !ROTAS_ABERTAS.has(url.pathname)) {
      const servico = SERVICE_TOKEN && req.headers['x-audasys-token'] === SERVICE_TOKEN;
      const sessao = servico ? { papel: 'admin', clientId: null } : lerSessao(req);
      const veredito = podeAcessar(sessao, req.method, url.pathname);
      if (!veredito.ok) {
        sendJson(res, veredito.status, { error: veredito.motivo, semSessao: veredito.status === 401 });
        return;
      }
      req.sessao = sessao;
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
