import { promises as fs } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Serve `web/` e `scripts/`. Sem cache em dev: um `.js` cacheado depois de uma
 * edição é meia hora de depuração de um bug que não existe.
 */
export function createStaticHandler({ webDir, scriptsDir }) {
  return async function serveStatic(req, res, url) {
    let baseDir = webDir;
    let rel = url.pathname;

    if (rel.startsWith('/scripts/')) {
      baseDir = scriptsDir;
      rel = rel.slice('/scripts'.length);
    }
    if (rel === '/' || rel === '') rel = '/index.html';

    // Normaliza e confirma que o resultado não escapou do diretório servido.
    const filePath = path.join(baseDir, path.normalize(rel));
    if (!filePath.startsWith(path.resolve(baseDir) + path.sep) && filePath !== path.resolve(baseDir)) {
      res.writeHead(403).end('Forbidden');
      return true;
    }

    /**
     * Caminho sem extensão tenta `.html` antes de desistir.
     *
     * `/login` é um endereço que se digita e se manda por mensagem; `/login.html`
     * é um arquivo. Sem esta tentativa, todo redirect interno precisa lembrar da
     * extensão — e o dia em que alguém esquece, o usuário leva um 404 cru. Já
     * aconteceu: `/e/<token>` inválido mandava para `/entrar`, que não existia.
     */
    const candidatos = path.extname(filePath) ? [filePath] : [filePath, `${filePath}.html`];

    let data;
    let servido = null;
    for (const candidato of candidatos) {
      try {
        data = await fs.readFile(candidato);
        servido = candidato;
        break;
      } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'EISDIR') throw err;
      }
    }
    if (!servido) return false;

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(servido).toLowerCase()] ?? 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(data);
    return true;
  };
}
