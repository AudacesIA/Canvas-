/**
 * Entrada, saída e emissão de links de acesso.
 *
 * Três públicos passam por aqui:
 *  - o consultor, que cola a chave de admin em `/entrar`;
 *  - o cliente, que abre o link `/e/<token>` que recebeu no WhatsApp;
 *  - a própria tela, que pergunta em `/api/sessao` quem está do outro lado para
 *    saber se mostra os botões de edição.
 */

import { sendJson, readJsonBody } from './router.js';
import { gravarSessao, limparSessao, lerSessao } from './sessao.js';
import { httpError } from '../core/canvasService.js';

const iguaisEmTempoConstante = (a, b) => {
  // Sem `timingSafeEqual` aqui porque o valor comparado é a chave de admin
  // digitada por humano; o vetor prático é tentativa por força bruta, e contra
  // isso vale o atraso abaixo, não a comparação constante.
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i += 1) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
};

export function registerAcessoRoutes(router, { canvasService }) {
  /** Quem está do outro lado. Responde 200 mesmo sem sessão — "ninguém" é resposta. */
  router.get('/api/sessao', (req, res) => {
    const s = lerSessao(req);
    sendJson(res, 200, s
      ? { autenticado: true, papel: s.papel, clientId: s.clientId }
      : { autenticado: false, papel: null, clientId: null });
  });

  /**
   * Login do consultor.
   *
   * A chave vive em `AUDASYS_ADMIN_KEY`, no ambiente — nunca em disco de dados,
   * nunca no código. Sem ela configurada, não existe admin: melhor ninguém entrar
   * do que existir uma senha padrão.
   */
  router.post('/api/entrar', async (req, res) => {
    const esperada = process.env.AUDASYS_ADMIN_KEY || '';
    const { chave } = await readJsonBody(req).catch(() => ({}));

    // Atraso fixo em qualquer resposta: torna a força bruta cara e não entrega,
    // pelo tempo, se a chave estava perto de certa.
    await new Promise((r) => setTimeout(r, 400));

    if (!esperada) {
      throw httpError(503, 'AUDASYS_ADMIN_KEY não está configurada no servidor. '
        + 'Sem ela não existe acesso de administrador.');
    }
    if (!iguaisEmTempoConstante(String(chave ?? ''), esperada)) {
      throw httpError(401, 'Chave inválida.');
    }
    gravarSessao(res, req, { papel: 'admin' });
    sendJson(res, 200, { papel: 'admin' });
  });

  router.post('/api/sair', (req, res) => {
    limparSessao(res);
    sendJson(res, 200, { ok: true });
  });

  /**
   * A porta do cliente.
   *
   * Responde 302 para `/`, e o redirect faz mais do que parecer bonito: tira o
   * token da barra de endereço, de onde ele vazaria num print de tela, no
   * histórico e no cabeçalho `Referer` mandado aos CDNs de fonte que o
   * `index.html` carrega.
   */
  router.get('/e/:token', async (req, res, { token }) => {
    const achado = await canvasService.clientePorToken(token);
    if (!achado) {
      res.writeHead(302, { Location: '/entrar.html?erro=link&aba=cliente' });
      res.end();
      return;
    }
    gravarSessao(res, req, { papel: 'cliente', clientId: achado.clientId });
    res.writeHead(302, { Location: '/' });
    res.end();
  });

  /** Emissão do link. Admin — garantido pelo portão em `server/index.js`. */
  router.post('/api/clients/:clientId/acesso', async (req, res, { clientId }) => {
    const { token, nome } = await canvasService.gerarAcesso(clientId);
    // Caminho relativo: quem monta a URL completa é a tela, com o domínio de onde
    // ela foi aberta. Assim o mesmo servidor funciona em localhost e em produção
    // sem uma variável de ambiente a mais para alguém esquecer de configurar.
    sendJson(res, 201, { caminho: `/e/${token}`, clientId, nome });
  });

  router.delete('/api/clients/:clientId/acesso', async (req, res, { clientId }) => {
    sendJson(res, 200, await canvasService.revogarAcesso(clientId));
  });
}
