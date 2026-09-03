import { BASE_URL } from './ensureDaemon.js';

/**
 * Cliente HTTP do daemon.
 *
 * Toda a lógica (validação, ids, locks, layout) vive em `server/core`. Este
 * módulo não decide nada — é o que permite trocar o backend de arquivo por
 * Supabase sem abrir a pasta `mcp/`.
 */
/**
 * O daemon passou a exigir sessão, e este cliente não tem navegador nem cookie.
 * `AUDASYS_SERVICE_TOKEN` é a credencial de serviço: o portão em `server/index.js`
 * a trata como admin. Sem ela, as 19 ferramentas do Claude Desktop levam 401 na
 * primeira chamada — e o erro que volta diz exatamente isso.
 */
const SERVICE_TOKEN = process.env.AUDASYS_SERVICE_TOKEN || '';

async function request(method, path, body) {
  const headers = {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(SERVICE_TOKEN ? { 'X-Audasys-Token': SERVICE_TOKEN } : {}),
  };
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* sem corpo */ }

  if (!res.ok) {
    // A mensagem do servidor é escrita para o agente conseguir se corrigir
    // sozinho na volta; preservá-la inteira importa mais que padronizar.
    if (res.status === 401 && !SERVICE_TOKEN) {
      throw Object.assign(new Error(
        'O daemon exige credencial e AUDASYS_SERVICE_TOKEN não está definida para o servidor MCP. '
        + 'Acrescente-a ao ambiente do Claude Desktop (mesmo valor do .env do daemon).'), { status: 401 });
    }
    const err = new Error(payload?.error || `${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export const client = {
  home: () => request('GET', '/api/home'),
  canvases: (clientId) => request('GET', `/api/clients/${clientId}/canvases`),
  outline: (clientId, canvasId, params = '') =>
    request('GET', `/api/clients/${clientId}/canvases/${canvasId}/outline${params}`),
  // Documento inteiro. Caro em tokens (é o motivo de o outline existir), então
  // só para o que o outline não carrega — hoje, a camada de medição.
  canvas: (clientId, canvasId) =>
    request('GET', `/api/clients/${clientId}/canvases/${canvasId}`),
  criarCenario: (clientId, canvasId, body) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/cenarios`, body),
  cenarios: (clientId, canvasId) =>
    request('GET', `/api/clients/${clientId}/canvases/${canvasId}/cenarios`),
  comparar: (clientId, canvasId) =>
    request('GET', `/api/clients/${clientId}/canvases/${canvasId}/comparar`),
  propose: (clientId, canvasId, body) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/changesets`, body),
  listChangesets: (clientId, canvasId) =>
    request('GET', `/api/clients/${clientId}/changesets?canvasId=${encodeURIComponent(canvasId)}`),
  cancelChangeset: (clientId, changesetId) =>
    request('DELETE', `/api/clients/${clientId}/changesets/${changesetId}`),
  resolveChangeset: (clientId, changesetId, body) =>
    request('POST', `/api/clients/${clientId}/changesets/${changesetId}/resolve`, body),
  focus: (clientId, canvasId, body) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/focus`, body),
  createCanvas: (clientId, name) =>
    request('POST', `/api/clients/${clientId}/canvases`, { name }),
  vocabulary: (clientId) => request('GET', `/api/clients/${clientId}/vocabulary`),
  layout: (clientId, canvasId, body) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/layout`, body),
  validate: (clientId, canvasId) =>
    request('GET', `/api/clients/${clientId}/canvases/${canvasId}/validate`),
  // Mapa de Processos versionado dentro do canvas.
  salvarMapa: (clientId, canvasId, body) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/salvar-mapa`, body),
  versoesMapa: (clientId, canvasId) =>
    request('GET', `/api/clients/${clientId}/canvases/${canvasId}/versoes-mapa`),
  markdown: (clientId, canvasId) =>
    request('GET', `/api/clients/${clientId}/canvases/${canvasId}/markdown`),
  // Entregáveis .md gravados como arquivo (docService.js).
  gerarMapa: (clientId, canvasId) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/docs/mapa`),
  gerarComparacao: (clientId, canvasId, body) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/docs/comparacao`, body),
};
