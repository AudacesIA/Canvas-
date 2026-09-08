/**
 * Limite de tentativas por IP, persistido em disco.
 *
 * ── Por que em disco e não em memória ────────────────────────────────────────
 * Um Map em memória some no primeiro `npm start`, e reiniciar o servidor é a
 * primeira coisa que qualquer um faz sem pensar. Um bloqueio que se apaga assim
 * não é bloqueio, é aviso.
 *
 * ── Por que só o login de cliente ────────────────────────────────────────────
 * A chave de admin NÃO bloqueia, por decisão de produto: a regra "libera só com
 * aprovação do admin" trancaria o próprio admin do lado de fora, sem ninguém
 * para aprovar. A porta dele continua protegida pelo atraso fixo em cada
 * tentativa, e cinco erros seguidos viram notificação na sineta — sinal sem
 * tranca.
 *
 * ── Sobre o IP ───────────────────────────────────────────────────────────────
 * Atrás de um proxy reverso, `remoteAddress` é o proxy: todo mundo vira o mesmo
 * IP e um bloqueio derruba todos. `X-Forwarded-For` resolve, mas só vale se
 * alguém garantidamente o reescreve — senão qualquer um escolhe o próprio IP e
 * escapa do limite mandando um cabeçalho. Daí a chave explícita.
 */

const MAX_TENTATIVAS = 5;

/** @param {import('node:http').IncomingMessage} req */
export function ipDe(req) {
  if (process.env.AUDASYS_TRUST_PROXY === '1') {
    const encaminhado = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (encaminhado) return encaminhado;
  }
  return req.socket?.remoteAddress ?? 'desconhecido';
}

export class LimiteDeTentativas {
  /** @param {import('../storage/Storage.js').Storage} storage */
  constructor(storage) {
    this.storage = storage;
    this.cache = null;
  }

  async #ler() {
    if (!this.cache) this.cache = (await this.storage.readAdmin('bloqueios')) ?? {};
    return this.cache;
  }

  async #gravar(estado) {
    this.cache = estado;
    await this.storage.writeAdmin('bloqueios', estado);
  }

  /**
   * @param {string} escopo  contadores independentes: errar a senha não gasta as
   *   tentativas de recuperação, e vice-versa. Um só balde faria o pedido de
   *   ajuda travar justamente quem já está com problema.
   */
  async estado(escopo, ip) {
    const tudo = await this.#ler();
    const reg = tudo[`${escopo}:${ip}`];
    return {
      tentativas: reg?.tentativas ?? 0,
      bloqueado: !!reg?.bloqueadoEm,
      bloqueadoEm: reg?.bloqueadoEm ?? null,
      restantes: Math.max(0, MAX_TENTATIVAS - (reg?.tentativas ?? 0)),
    };
  }

  /** @returns {Promise<{bloqueouAgora:boolean, tentativas:number}>} */
  async registrarFalha(escopo, ip) {
    const tudo = await this.#ler();
    const chave = `${escopo}:${ip}`;
    const reg = tudo[chave] ?? { tentativas: 0, bloqueadoEm: null };
    reg.tentativas += 1;
    reg.ultimaEm = new Date().toISOString();
    const bloqueouAgora = reg.tentativas >= MAX_TENTATIVAS && !reg.bloqueadoEm;
    if (bloqueouAgora) reg.bloqueadoEm = reg.ultimaEm;
    tudo[chave] = reg;
    await this.#gravar(tudo);
    return { bloqueouAgora, tentativas: reg.tentativas };
  }

  /** Acerto zera: quem entrou provou que não era ataque. */
  async limpar(escopo, ip) {
    const tudo = await this.#ler();
    delete tudo[`${escopo}:${ip}`];
    await this.#gravar(tudo);
  }

  /** Liberação pelo admin, a partir da sineta. */
  async liberar(ip) {
    const tudo = await this.#ler();
    for (const chave of Object.keys(tudo)) {
      if (chave.endsWith(`:${ip}`)) delete tudo[chave];
    }
    await this.#gravar(tudo);
    return { liberado: ip };
  }
}

export { MAX_TENTATIVAS };
