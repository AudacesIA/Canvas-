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
import { ipDe, MAX_TENTATIVAS } from './limite.js';

const COOKIE_SENHA = 'audasys_senha_pendente';

/**
 * Extrai o código do que foi colado: URL inteira ou código puro.
 *
 * A mesma tolerância existe na tela, e o servidor repete de propósito — a tela
 * pode ser contornada, e a rota é chamada direto nos testes.
 */
function extrairCodigo(bruto) {
  const texto = String(bruto ?? '').trim().replace(/\s+/g, '');
  if (!texto) return null;
  const naUrl = texto.match(/\/e\/([A-Za-z0-9_-]{20,})/);
  if (naUrl) return naUrl[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(texto) ? texto : null;
}

/**
 * Normaliza o nome da empresa para comparação.
 *
 * "berenice shakti", "Berenice Shakti" e "  Berenice   Shakti " são a mesma
 * empresa para quem digita. Acento também cai: quem recebe o nome por WhatsApp
 * costuma redigitar sem ele, e recusar por causa de um til é transformar um
 * detalhe de teclado em chamado de suporte.
 */
const normalizarNome = (v) => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/\s+/g, ' ');

/** Atraso fixo em toda resposta de credencial: torna força bruta cara e não vaza tempo. */
const respirar = () => new Promise((r) => setTimeout(r, 400));

const iguaisEmTempoConstante = (a, b) => {
  // Sem `timingSafeEqual` aqui porque o valor comparado é a chave de admin
  // digitada por humano; o vetor prático é tentativa por força bruta, e contra
  // isso vale o atraso abaixo, não a comparação constante.
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i += 1) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
};

export function registerAcessoRoutes(router, { canvasService, limite, notificacoes }) {
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
      /**
       * A chave de admin NÃO bloqueia — decisão de produto, e com razão: a regra
       * "libera só com aprovação do admin" trancaria o próprio admin do lado de
       * fora, sem ninguém para aprovar.
       *
       * O contador existe assim mesmo, mas só para AVISAR. Sinal sem tranca:
       * você fica sabendo que alguém está tentando, e continua entrando.
       */
      const ip = ipDe(req);
      const { tentativas } = await limite.registrarFalha('admin-aviso', ip);
      if (tentativas >= MAX_TENTATIVAS) {
        await notificacoes.criar({
          tipo: 'tentativas-admin',
          titulo: 'Tentativas na chave de administrador',
          detalhe: `${tentativas} tentativas falharam. Último IP: ${ip}.`,
          ip,
          chaveDeAgrupamento: `tentativas-admin:${ip}`,
        });
      }
      throw httpError(401, 'Chave inválida.');
    }
    await limite.limpar('admin-aviso', ipDe(req));
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
    /**
     * O link NÃO entra mais sozinho: ele é só a senha.
     *
     * Enquanto o link bastava, encaminhá-lo no grupo da empresa entregava o
     * acesso junto. Agora ele preenche a senha e a empresa é o segundo fator —
     * quem recebe o link de repasse precisa saber para qual empresa ele é.
     *
     * O token vai num cookie de vida curta em vez de na URL da tela de login,
     * pelo mesmo motivo que esta rota sempre redirecionou: na barra de endereços
     * ele vazaria em print, no histórico e no `Referer` mandado aos CDNs de
     * fonte que a página carrega.
     */
    res.setHeader('Set-Cookie', [
      `${COOKIE_SENHA}=${encodeURIComponent(String(token))}`,
      'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600',
      ...(req.headers['x-forwarded-proto'] === 'https' ? ['Secure'] : []),
    ].join('; '));
    res.writeHead(302, { Location: '/login?aba=cliente' });
    res.end();
  });

  /**
   * A tela de entrada mudou de `/entrar.html` para `/login`, que é endereço de
   * verdade — curto, digitável e mandável por mensagem. Quem tiver o antigo nos
   * favoritos continua chegando.
   */
  router.get('/entrar.html', (req, res, _p, url) => {
    res.writeHead(302, { Location: `/login${url.search}` });
    res.end();
  });

  /** A senha que veio pelo link, para a tela preencher o campo. */
  router.get('/api/senha-pendente', (req, res) => {
    const bruto = req.headers.cookie ?? '';
    const parte = bruto.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE_SENHA}=`));
    sendJson(res, 200, { senha: parte ? decodeURIComponent(parte.slice(COOKIE_SENHA.length + 1)) : null });
  });

  /**
   * Login do cliente: empresa + senha.
   *
   * A empresa é conferida CONTRA o token, nunca procurada por nome. Isso importa
   * mais do que parece: sem busca por nome, a tela não tem como confirmar quais
   * empresas são clientes da consultoria. Quem chutar nomes recebe sempre a
   * mesma resposta, exista a empresa ou não.
   */
  router.post('/api/entrar-cliente', async (req, res) => {
    const ip = ipDe(req);
    const estado = await limite.estado('cliente', ip);
    if (estado.bloqueado) {
      // 429 e não 401: quem não distingue "errei a senha" de "estou bloqueado"
      // tenta de novo, e cada tentativa parece o mesmo erro de sempre.
      throw httpError(429,
        'Este acesso foi bloqueado após 5 tentativas. Peça liberação à consultoria — '
        + 'use "Esqueci o link de acesso" abaixo, que o pedido chega direto para ela.');
    }

    const { empresa, senha } = await readJsonBody(req).catch(() => ({}));
    await respirar();

    const codigo = extrairCodigo(senha);
    const achado = codigo ? await canvasService.clientePorToken(codigo) : null;
    const bate = achado && normalizarNome(achado.nome) === normalizarNome(empresa);

    if (!bate) {
      const { bloqueouAgora, tentativas } = await limite.registrarFalha('cliente', ip);
      if (bloqueouAgora) {
        await notificacoes.criar({
          tipo: 'bloqueio',
          titulo: 'Acesso bloqueado por tentativas',
          detalhe: `${tentativas} tentativas falharam a partir do IP ${ip}.`,
          ip,
          chaveDeAgrupamento: `bloqueio:${ip}`,
        });
      }
      // Mensagem única para os dois erros: dizer qual dos dois estava certo
      // entrega metade da credencial a quem está chutando.
      throw httpError(401, 'Empresa ou senha incorreta.', {
        restantes: Math.max(0, MAX_TENTATIVAS - tentativas),
      });
    }

    await limite.limpar('cliente', ip);
    gravarSessao(res, req, { papel: 'cliente', clientId: achado.clientId });
    // A senha pendente cumpriu o papel; deixá-la no navegador seria guardar
    // credencial em claro por dez minutos sem necessidade nenhuma.
    res.setHeader('Set-Cookie', [
      res.getHeader('Set-Cookie'),
      `${COOKIE_SENHA}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    ].flat());
    sendJson(res, 200, { papel: 'cliente', clientId: achado.clientId });
  });

  /**
   * "Esqueci o link de acesso".
   *
   * Responde SEMPRE igual, exista a empresa ou não. Uma resposta diferente para
   * empresa inexistente transformaria esta rota numa consulta de quem é cliente
   * da consultoria — e a lista de clientes é justamente o que o cliente não pode
   * ver do outro.
   */
  router.post('/api/recuperar', async (req, res) => {
    const ip = ipDe(req);
    const estado = await limite.estado('recuperar', ip);
    const { empresa } = await readJsonBody(req).catch(() => ({}));
    await respirar();

    const resposta = { ok: true, mensagem: 'Pedido registrado. A consultoria vai te enviar um link novo.' };
    if (estado.bloqueado) {
      sendJson(res, 200, resposta);
      return;
    }
    await limite.registrarFalha('recuperar', ip);

    const alvo = normalizarNome(empresa);
    if (alvo) {
      const clientes = await canvasService.listClients();
      const achado = clientes.find((c) => normalizarNome(c.name) === alvo);
      await notificacoes.criar({
        tipo: 'recuperacao',
        titulo: achado ? `${achado.name} pediu um link novo` : 'Pedido de acesso não identificado',
        detalhe: achado
          ? `Gere um link novo para ${achado.name}. O anterior deixa de valer.`
          : `Alguém pediu acesso como "${String(empresa).slice(0, 60)}" — não há empresa com esse nome.`,
        clientId: achado?.id ?? null,
        ip,
        chaveDeAgrupamento: achado ? `recuperacao:${achado.id}` : `recuperacao-desconhecida:${ip}`,
      });
    }
    sendJson(res, 200, resposta);
  });

  // --- sineta do administrador ---

  router.get('/api/notificacoes', async (req, res) => {
    sendJson(res, 200, { notificacoes: await notificacoes.pendentes() });
  });

  router.post('/api/notificacoes/:id/resolver', async (req, res, { id }) => {
    const n = await notificacoes.resolver(id);
    if (!n) throw httpError(404, 'Notificação não encontrada');
    sendJson(res, 200, { resolvida: n.id });
  });

  router.post('/api/notificacoes/:id/liberar-ip', async (req, res, { id }) => {
    const pendentes = await notificacoes.pendentes();
    const n = pendentes.find((x) => x.id === id);
    if (!n?.ip) throw httpError(404, 'Notificação sem IP para liberar');
    await limite.liberar(n.ip);
    await notificacoes.resolver(id);
    sendJson(res, 200, { liberado: n.ip });
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
