/**
 * Contrato de storage.
 *
 * Esta é a fronteira que decide se trocar arquivo por Supabase (F10) é um
 * arquivo novo ou um refactor. Nada acima desta camada pode saber que existe
 * sistema de arquivos: `server/core/*` fala só com estes métodos.
 *
 * Regras que toda implementação deve respeitar:
 *  - Escrita é atômica. Um leitor nunca enxerga meio documento.
 *  - `readCanvas` devolve o documento como está em disco, sem migrar. Quem
 *    migra é `core/canvasService` (migração preguiçosa), para que a lógica de
 *    schema não se duplique por backend.
 *  - Ausência devolve `null`, não lança. Erro de I/O real lança.
 *  - Nenhum método muta o objeto que recebe.
 *
 * @typedef {object} ClientMeta
 * @property {string} id
 * @property {string} name
 * @property {string} createdAt
 * @property {{autoApply: boolean}} settings
 *
 * @typedef {object} FolderMeta
 * @property {string} id
 * @property {string} name
 * @property {number} order
 */

/* eslint-disable no-unused-vars */

export class Storage {
  // --- clientes ---

  /** @returns {Promise<ClientMeta[]>} */
  async listClients() { throw new Error('not implemented'); }

  /** @returns {Promise<ClientMeta|null>} */
  async readClient(clientId) { throw new Error('not implemented'); }

  /** @param {ClientMeta} meta @returns {Promise<ClientMeta>} */
  async writeClient(clientId, meta) { throw new Error('not implemented'); }

  // --- pastas (só nome e ordem; a lista de canvases é derivada) ---

  /** @returns {Promise<FolderMeta[]>} */
  async readFolders(clientId) { throw new Error('not implemented'); }

  /** @param {FolderMeta[]} folders */
  async writeFolders(clientId, folders) { throw new Error('not implemented'); }

  // --- canvases ---

  /**
   * Ids de todos os canvases do cliente, derivados de um listing.
   * Não existe arquivo de índice — é isso que elimina a dessincronia que o
   * `audaces_home` do localStorage tinha.
   * @returns {Promise<string[]>}
   */
  async listCanvasIds(clientId) { throw new Error('not implemented'); }

  /** @returns {Promise<object|null>} documento cru, sem migração */
  async readCanvas(clientId, canvasId) { throw new Error('not implemented'); }

  /** Escrita atômica. @returns {Promise<void>} */
  async writeCanvas(clientId, canvasId, doc) { throw new Error('not implemented'); }

  /** Move para a lixeira em vez de apagar. @returns {Promise<boolean>} */
  async deleteCanvas(clientId, canvasId) { throw new Error('not implemented'); }

  /** Cópia de segurança rotativa (últimas N versões). */
  async backupCanvas(clientId, canvasId, doc, tag) { throw new Error('not implemented'); }

  // --- changesets ---

  /** @param {'pending'|'archive'} [scope] @returns {Promise<object[]>} */
  async listChangesets(clientId, scope) { throw new Error('not implemented'); }

  /** @returns {Promise<object|null>} */
  async readChangeset(clientId, changesetId) { throw new Error('not implemented'); }

  async writeChangeset(clientId, changesetId, doc) { throw new Error('not implemented'); }

  /** Move de `changesets/` para `changesets/archive/`. */
  async archiveChangeset(clientId, changesetId) { throw new Error('not implemented'); }
}
