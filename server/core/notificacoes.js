/**
 * A caixa de entrada do consultor.
 *
 * Três coisas chegam aqui, e todas exigem uma decisão humana que o sistema não
 * pode tomar sozinho:
 *
 *  - `recuperacao`      um cliente perdeu o link e pediu outro. Só o consultor
 *                       sabe se quem pediu é mesmo quem diz ser.
 *  - `bloqueio`         um IP errou cinco vezes. Pode ser o cliente atrapalhado
 *                       ou alguém tentando entrar; a diferença não está no dado.
 *  - `tentativas-admin` cinco erros na chave de administrador. Não bloqueia
 *                       nada — é sinal, não tranca, porque bloquear a porta do
 *                       admin trancaria o admin.
 *
 * Vive num arquivo só, e não num por notificação: são dezenas por ano, e um
 * diretório com dezenas de arquivos de 200 bytes é diretório para varrer sem
 * motivo.
 */

const ARQUIVO = 'notificacoes';
const LIMITE_HISTORICO = 200;

export const TIPOS = ['recuperacao', 'bloqueio', 'tentativas-admin'];

export class Notificacoes {
  /** @param {import('../storage/Storage.js').Storage} storage */
  constructor(storage) {
    this.storage = storage;
  }

  async listar() {
    const lista = (await this.storage.readAdmin(ARQUIVO)) ?? [];
    return Array.isArray(lista) ? lista : [];
  }

  /**
   * Cria, ou reaproveita a pendente equivalente.
   *
   * `chaveDeAgrupamento` impede que dez tentativas do mesmo IP virem dez linhas
   * iguais na sineta. Uma caixa de entrada que precisa ser limpa em massa é uma
   * caixa que o consultor para de abrir — e aí o pedido do cliente se perde no
   * meio do ruído que o próprio sistema gerou.
   */
  async criar({ tipo, titulo, detalhe, clientId = null, ip = null, chaveDeAgrupamento = null }) {
    const lista = await this.listar();
    const chave = chaveDeAgrupamento ?? `${tipo}:${clientId ?? ip ?? ''}`;

    const existente = lista.find((n) => n.chave === chave && !n.resolvidaEm);
    if (existente) {
      existente.ocorrencias = (existente.ocorrencias ?? 1) + 1;
      existente.atualizadaEm = new Date().toISOString();
      existente.detalhe = detalhe;
      await this.storage.writeAdmin(ARQUIVO, lista);
      return existente;
    }

    const nova = {
      id: `nt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tipo,
      chave,
      titulo,
      detalhe,
      clientId,
      ip,
      ocorrencias: 1,
      criadaEm: new Date().toISOString(),
      atualizadaEm: new Date().toISOString(),
      resolvidaEm: null,
    };
    lista.unshift(nova);
    // Corta o rabo: histórico infinito num arquivo lido inteiro a cada consulta
    // é lentidão garantida daqui a um ano, sem ninguém perceber quando começou.
    await this.storage.writeAdmin(ARQUIVO, lista.slice(0, LIMITE_HISTORICO));
    return nova;
  }

  async resolver(id) {
    const lista = await this.listar();
    const n = lista.find((x) => x.id === id);
    if (!n) return null;
    n.resolvidaEm = new Date().toISOString();
    await this.storage.writeAdmin(ARQUIVO, lista);
    return n;
  }

  async pendentes() {
    return (await this.listar()).filter((n) => !n.resolvidaEm);
  }
}
