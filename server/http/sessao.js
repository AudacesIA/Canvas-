/**
 * Sessão assinada por cookie, sem biblioteca.
 *
 * O projeto tem três dependências e a disciplina de não crescer sem motivo.
 * `node:crypto` já traz HMAC, bytes aleatórios e comparação em tempo constante —
 * que é tudo o que dois papéis e dois usuários exigem. Uma biblioteca de sessão
 * aqui traria mil linhas para resolver um problema de trinta.
 *
 * ── O formato ────────────────────────────────────────────────────────────────
 *   papel|clientId|expiraEm.assinatura
 *
 * A assinatura é HMAC-SHA256 do trecho à esquerda do ponto, com `AUDASYS_SECRET`.
 * O cookie carrega o dado em claro de propósito: não há segredo nele — dizer
 * "sou o cliente berenice-shakti" só vale alguma coisa acompanhado da assinatura,
 * e forjar a assinatura exige o segredo do servidor.
 *
 * ── Por que não guardar sessões em disco ─────────────────────────────────────
 * Sessão assinada não precisa de armazenamento: o servidor confere a assinatura e
 * confia no conteúdo. O preço é não conseguir invalidar uma sessão específica
 * antes de ela expirar. Para revogar um cliente existe o caminho certo, que é
 * apagar o hash do token dele — o cookie continua válido até expirar, mas ele não
 * consegue outro quando esse vencer. Se um dia precisar de corte imediato, o jeito
 * é trocar o `AUDASYS_SECRET`, o que derruba todas as sessões de uma vez.
 */

import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const COOKIE = 'audasys_sessao';
const DURACAO_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

/**
 * Sem segredo o servidor não sobe.
 *
 * A tentação é gerar um segredo aleatório quando falta. Não serve: ele mudaria a
 * cada reinício, derrubando todas as sessões, e — pior — daria a impressão de
 * estar configurado. Um valor-padrão fixo seria ainda pior, porque estaria no
 * código, público, e assinaria cookies que qualquer um poderia forjar.
 */
export function exigirSegredo() {
  const s = process.env.AUDASYS_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'AUDASYS_SECRET ausente ou curto demais (mínimo 32 caracteres). É o que assina os '
      + 'cookies de sessão; sem ele qualquer um forja um cookie de admin.\n'
      + 'Gere um com:  node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"\n'
      + 'e ponha no .env (que já está no .gitignore).');
  }
  return s;
}

const assinar = (dados) => createHmac('sha256', exigirSegredo()).update(dados).digest('base64url');

/** Comparação em tempo constante: sem isso, dá para descobrir a assinatura byte a byte. */
function iguais(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Token de acesso do cliente: 32 bytes aleatórios, o que vai no link. */
export const novoToken = () => randomBytes(32).toString('base64url');

/**
 * O que fica gravado em `client.json`.
 *
 * SHA-256 puro, sem sal: o token já é 32 bytes aleatórios, então não há dicionário
 * a montar nem senha fraca a adivinhar — sal e KDF lento existem para proteger
 * segredo escolhido por humano, e este não é.
 */
export const hashDoToken = (token) => createHash('sha256').update(String(token)).digest('hex');

export function tokenConfere(token, hashGravado) {
  if (!token || !hashGravado) return false;
  return iguais(hashDoToken(token), hashGravado);
}

/** @returns {{papel:'admin'|'cliente', clientId:string|null}|null} */
export function lerSessao(req) {
  const bruto = req.headers.cookie ?? '';
  const parte = bruto.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!parte) return null;

  const valor = decodeURIComponent(parte.slice(COOKIE.length + 1));
  const corte = valor.lastIndexOf('.');
  if (corte < 1) return null;

  const dados = valor.slice(0, corte);
  if (!iguais(valor.slice(corte + 1), assinar(dados))) return null;

  const [papel, clientId, expira] = dados.split('|');
  if (!['admin', 'cliente'].includes(papel)) return null;
  if (!Number(expira) || Number(expira) < Date.now()) return null;

  return { papel, clientId: clientId || null };
}

export function gravarSessao(res, req, { papel, clientId = '' }) {
  const dados = `${papel}|${clientId}|${Date.now() + DURACAO_MS}`;
  const valor = encodeURIComponent(`${dados}.${assinar(dados)}`);
  // `Secure` só quando a conexão de fato é https, senão o cookie não gruda em
  // desenvolvimento — e um cookie que não gruda vira uma hora de depuração.
  const https = req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', [
    `${COOKIE}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DURACAO_MS / 1000)}`,
    ...(https ? ['Secure'] : []),
  ].join('; '));
}

export function limparSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * A regra de autorização inteira, num lugar só.
 *
 * É de MÉTODO e PREFIXO, não uma lista de rotas permitidas. São 38 rotas hoje e
 * vão ser mais amanhã: uma lista precisa ser lembrada a cada rota nova, e o dia
 * em que alguém esquecer, a rota nasce aberta. Assim ela nasce fechada.
 *
 * @returns {{ok:true} | {ok:false, status:number, motivo:string}}
 */
export function podeAcessar(sessao, method, pathname) {
  if (!sessao) {
    return { ok: false, status: 401, motivo: 'Sem sessão. Abra o link de acesso que você recebeu.' };
  }
  if (sessao.papel === 'admin') return { ok: true };

  // Daqui para baixo é cliente: só leitura, só a própria pasta.
  if (method !== 'GET') {
    return { ok: false, status: 403, motivo: 'Seu acesso é de leitura: o mapa é mantido pela consultoria.' };
  }
  if (!pathname.startsWith(`/api/clients/${sessao.clientId}/`)) {
    return { ok: false, status: 403, motivo: 'Este canvas não pertence ao seu acesso.' };
  }
  return { ok: true };
}
