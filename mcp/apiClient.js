import { BASE_URL } from './ensureDaemon.js';

/**
 * Cliente HTTP do daemon.
 *
 * Toda a lógica (validação, ids, locks, layout) vive em `server/core`. Este
 * módulo não decide nada — é o que permite trocar o backend de arquivo por
 * Supabase sem abrir a pasta `mcp/`.
 */
async function request(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* sem corpo */ }

  if (!res.ok) {
    // A mensagem do servidor é escrita para o agente conseguir se corrigir
    // sozinho na volta; preservá-la inteira importa mais que padronizar.
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
  gerarMapa: (clientId, canvasId) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/docs/mapa`),
  gerarComparacao: (clientId, canvasId, body) =>
    request('POST', `/api/clients/${clientId}/canvases/${canvasId}/docs/comparacao`, body),
};
