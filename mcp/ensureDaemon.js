import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.AUDASYS_PORT || 8787);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

async function ping(timeoutMs = 300) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.service === 'audasys-canvas';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Garante que o daemon esteja no ar.
 *
 * O servidor MCP é filho do Claude Desktop: nasce e morre com ele, e reinicia
 * a cada troca de Project. O daemon não pode ter esse ciclo de vida — dois
 * Projects abertos seriam duas instâncias disputando a mesma porta e o mesmo
 * arquivo. Por isso ele sobe destacado (`detached` + `unref`) e sobrevive à
 * morte deste processo.
 */
export async function ensureDaemon() {
  if (await ping()) return { started: false, url: BASE_URL };

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AUDASYS_LOG: '0' },
  });
  child.unref();

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await ping()) return { started: true, url: BASE_URL };
  }

  throw new Error(
    `Não consegui subir o daemon em ${BASE_URL}. ` +
    `Verifique se a porta ${PORT} está ocupada por outro processo e rode "npm start" em ${ROOT}.`,
  );
}
