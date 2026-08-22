import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Storage } from './Storage.js';

const MAX_BACKUPS = 20;

/** Impede que um clientId/canvasId vindo da rede escape do diretório de dados. */
function safeSegment(value, label) {
  const s = String(value ?? '');
  if (!/^[A-Za-z0-9._-]+$/.test(s) || s === '.' || s === '..') {
    throw Object.assign(new Error(`${label} inválido: ${JSON.stringify(s)}`), { status: 400 });
  }
  return s;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    if (err instanceof SyntaxError) {
      throw Object.assign(new Error(`JSON corrompido em ${file}: ${err.message}`), { status: 500 });
    }
    throw err;
  }
}

/**
 * Escrita atômica: grava em `.tmp` no mesmo diretório e renomeia.
 * O rename é atômico dentro do mesmo filesystem, então um leitor concorrente
 * vê ou a versão antiga inteira ou a nova inteira — nunca meio arquivo.
 */
async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/** Mesma garantia do `writeJsonAtomic`, para texto puro. */
async function writeTextAtomic(file, texto) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, texto, 'utf8');
  await fs.rename(tmp, file);
}

async function listJsonIds(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.includes('.tmp'))
      .map((e) => e.name.slice(0, -5))
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export class FsStorage extends Storage {
  /** @param {string} dataDir */
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
  }

  // --- caminhos ---

  clientDir(clientId) {
    return path.join(this.dataDir, 'clients', safeSegment(clientId, 'clientId'));
  }

  canvasFile(clientId, canvasId) {
    return path.join(this.clientDir(clientId), 'canvases', `${safeSegment(canvasId, 'canvasId')}.json`);
  }

  changesetFile(clientId, changesetId, archived = false) {
    const base = path.join(this.clientDir(clientId), 'changesets');
    const dir = archived ? path.join(base, 'archive') : base;
    return path.join(dir, `${safeSegment(changesetId, 'changesetId')}.json`);
  }

  // --- clientes ---

  async listClients() {
    const root = path.join(this.dataDir, 'clients');
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const meta = await this.readClient(entry.name);
      out.push(meta ?? this.#defaultClientMeta(entry.name));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  #defaultClientMeta(clientId) {
    return {
      id: clientId,
      name: clientId,
      createdAt: new Date().toISOString(),
      settings: { autoApply: false },
    };
  }

  async readClient(clientId) {
    return readJson(path.join(this.clientDir(clientId), 'client.json'));
  }

  async writeClient(clientId, meta) {
    const full = { ...this.#defaultClientMeta(clientId), ...meta, id: safeSegment(clientId, 'clientId') };
    await writeJsonAtomic(path.join(this.clientDir(clientId), 'client.json'), full);
    // Garante o esqueleto de diretórios do cliente já na criação.
    for (const sub of ['canvases', 'changesets/archive', 'refs', 'attachments']) {
      await fs.mkdir(path.join(this.clientDir(clientId), sub), { recursive: true });
    }
    return full;
  }

  async deleteClient(clientId) {
    const src = this.clientDir(clientId);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.dataDir, '.trash', `${safeSegment(clientId, 'clientId')}.${stamp}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.rename(src, dest);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  // --- pastas (subdivisão dentro de um cliente; ainda não usada pela UI) ---

  async readFolders(clientId) {
    return (await readJson(path.join(this.clientDir(clientId), 'folders.json'))) ?? [];
  }

  async writeFolders(clientId, folders) {
    await writeJsonAtomic(path.join(this.clientDir(clientId), 'folders.json'), folders);
  }

  // --- canvases ---

  async listCanvasIds(clientId) {
    return listJsonIds(path.join(this.clientDir(clientId), 'canvases'));
  }

  async readCanvas(clientId, canvasId) {
    return readJson(this.canvasFile(clientId, canvasId));
  }

  async writeCanvas(clientId, canvasId, doc) {
    await writeJsonAtomic(this.canvasFile(clientId, canvasId), doc);
  }

  async deleteCanvas(clientId, canvasId) {
    const src = this.canvasFile(clientId, canvasId);
    const doc = await readJson(src);
    if (!doc) return false;
    // Lixeira em vez de unlink: perder o mapa de um cliente por um clique
    // errado não é um risco que vale economizar 4 linhas.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.dataDir, '.trash', safeSegment(clientId, 'clientId'), `${canvasId}.${stamp}.json`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    return true;
  }

  async backupCanvas(clientId, canvasId, doc, tag = '') {
    const dir = path.join(this.dataDir, '.backups', safeSegment(clientId, 'clientId'), safeSegment(canvasId, 'canvasId'));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = tag ? `.${safeSegment(tag, 'tag')}` : '';
    await writeJsonAtomic(path.join(dir, `${stamp}${suffix}.json`), doc);

    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json') && !f.includes('.tmp')).sort();
    for (const stale of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
      await fs.rm(path.join(dir, stale), { force: true });
    }
  }

  // --- changesets ---

  // --- documentos (.md) ---

  docsDir(clientId, canvasId) {
    return path.join(this.clientDir(clientId), 'docs', safeSegment(canvasId, 'canvasId'));
  }

  /**
   * `safeSegment` no nome também, não só no id.
   *
   * O nome do arquivo é o único destes três segmentos que chega composto pelo
   * servidor (`comparacao-<cenarioId>.md`) — e um cenárioId vindo da rede entra
   * nele. Sem a checagem, `..%2F..%2Fclient.json` escreveria fora do diretório.
   */
  #docFile(clientId, canvasId, nome) {
    const base = String(nome ?? '');
    if (!base.endsWith('.md')) {
      throw Object.assign(new Error(`documento precisa terminar em .md: ${JSON.stringify(base)}`), { status: 400 });
    }
    safeSegment(base, 'nome do documento');
    return path.join(this.docsDir(clientId, canvasId), base);
  }

  async readDoc(clientId, canvasId, nome) {
    try {
      return await fs.readFile(this.#docFile(clientId, canvasId, nome), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeDoc(clientId, canvasId, nome, texto) {
    const file = this.#docFile(clientId, canvasId, nome);
    await writeTextAtomic(file, String(texto ?? ''));
    return { nome, caminho: file, bytes: Buffer.byteLength(String(texto ?? ''), 'utf8') };
  }

  async listDocs(clientId, canvasId) {
    const dir = this.docsDir(clientId, canvasId);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md') || e.name.includes('.tmp')) continue;
      const st = await fs.stat(path.join(dir, e.name));
      out.push({ nome: e.name, bytes: st.size, modificadoEm: st.mtime.toISOString() });
    }
    return out.sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async listChangesets(clientId, scope = 'pending') {
    const base = path.join(this.clientDir(clientId), 'changesets');
    const dir = scope === 'archive' ? path.join(base, 'archive') : base;
    const ids = await listJsonIds(dir);
    const docs = await Promise.all(ids.map((id) => readJson(path.join(dir, `${id}.json`))));
    return docs.filter(Boolean);
  }

  async readChangeset(clientId, changesetId) {
    return (
      (await readJson(this.changesetFile(clientId, changesetId))) ??
      (await readJson(this.changesetFile(clientId, changesetId, true)))
    );
  }

  async writeChangeset(clientId, changesetId, doc) {
    await writeJsonAtomic(this.changesetFile(clientId, changesetId), doc);
  }

  async archiveChangeset(clientId, changesetId) {
    const src = this.changesetFile(clientId, changesetId);
    const dest = this.changesetFile(clientId, changesetId, true);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.rename(src, dest);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }
}
