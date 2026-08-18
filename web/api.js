/**
 * Camada de persistência do cliente.
 *
 * Carregado antes de `app.js` e exposto em `window.Audasys`. Quando o app for
 * quebrado em módulos ES (F4) isto vira `js/persistence.js` sem mudar de forma.
 *
 * O ponto central: `saveToLocalStorage()` era chamado a cada evento `input` de
 * campo de texto — uma escrita por tecla. Contra localStorage isso passava
 * despercebido; contra HTTP seria uma requisição por caractere. Por isso a
 * escrita é agendada com debounce e os 46 call-sites do app continuam
 * chamando a mesma função de sempre, sem saber que agora há rede no caminho.
 */
(function () {
  'use strict';

  const SAVE_DEBOUNCE_MS = 800;
  const MIRROR_PREFIX = 'audasys_mirror_';

  // --- ids ---------------------------------------------------------------

  let idCounter = 0;

  /**
   * O app antigo usava `conn_${Date.now()}` para conexões, sem contador: um
   * lote de arestas criado no mesmo milissegundo gerava ids idênticos, e o
   * dedup por (from,to,ruleId) não pega isso. Mesmo algoritmo do servidor.
   */
  function genId(prefix) {
    idCounter = (idCounter + 1) % 100000;
    return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).slice(2, 6)}`;
  }

  // --- HTTP ---------------------------------------------------------------

  async function request(method, path, { body, headers = {} } = {}) {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload = null;
    try { payload = await res.json(); } catch { /* 204 e afins */ }

    if (!res.ok) {
      const err = new Error(payload?.error || `${method} ${path} falhou (${res.status})`);
      err.status = res.status;
      err.currentRev = payload?.currentRev;
      throw err;
    }
    return payload;
  }

  const api = {
    health: () => request('GET', '/health'),
    fullHome: () => request('GET', '/api/home'),
    vocabulary: (clientId) => request('GET', `/api/clients/${clientId}/vocabulary`),

    createClient: (name) => request('POST', '/api/clients', { body: { name } }),
    renameClient: (clientId, name) => request('PATCH', `/api/clients/${clientId}`, { body: { name } }),
    deleteClient: (clientId) => request('DELETE', `/api/clients/${clientId}`),

    createCanvas: (clientId, name) =>
      request('POST', `/api/clients/${clientId}/canvases`, { body: { name } }),
    getCanvas: (clientId, canvasId) =>
      request('GET', `/api/clients/${clientId}/canvases/${canvasId}`),
    patchCanvas: (clientId, canvasId, patch) =>
      request('PATCH', `/api/clients/${clientId}/canvases/${canvasId}`, { body: patch }),
    deleteCanvas: (clientId, canvasId) =>
      request('DELETE', `/api/clients/${clientId}/canvases/${canvasId}`),
    duplicateCanvas: (clientId, canvasId) =>
      request('POST', `/api/clients/${clientId}/canvases/${canvasId}/duplicate`),
    moveCanvas: (clientId, canvasId, toClientId) =>
      request('POST', `/api/clients/${clientId}/canvases/${canvasId}/move`, { body: { toClientId } }),

    putCanvas: (clientId, canvasId, data, rev) =>
      request('PUT', `/api/clients/${clientId}/canvases/${canvasId}`, {
        body: data,
        headers: rev === null || rev === undefined ? {} : { 'If-Match': String(rev) },
      }),

    criarCenario: (clientId, canvasId, { nome, premissa, postura, oportunidadeId }) =>
      request('POST', `/api/clients/${clientId}/canvases/${canvasId}/cenarios`, {
        body: { nome, premissa, postura, oportunidadeId },
      }),
    listarCenarios: (clientId, canvasId) =>
      request('GET', `/api/clients/${clientId}/canvases/${canvasId}/cenarios`),
    compararCenario: (clientId, canvasId) =>
      request('GET', `/api/clients/${clientId}/canvases/${canvasId}/comparar`),
  };

  // --- estado da sessão de escrita ---------------------------------------

  const session = {
    clientId: null,
    canvasId: null,
    rev: null,
    pending: null,     // último snapshot ainda não gravado
    timer: null,
    inFlight: false,
    dirtySinceFlight: false,
    listeners: new Set(),
  };

  function emit(state, detail) {
    for (const fn of session.listeners) {
      try { fn(state, detail); } catch (err) { console.error(err); }
    }
  }

  /** Espelho local: se o daemon cair no meio de uma reunião, nada se perde. */
  function mirror(data) {
    try {
      localStorage.setItem(MIRROR_PREFIX + session.canvasId, JSON.stringify({ savedAt: Date.now(), data }));
    } catch { /* cota estourada: o espelho é conveniência, não garantia */ }
  }

  function clearMirror(canvasId) {
    try { localStorage.removeItem(MIRROR_PREFIX + canvasId); } catch { /* ignore */ }
  }

  function readMirror(canvasId) {
    try { return JSON.parse(localStorage.getItem(MIRROR_PREFIX + canvasId) || 'null'); } catch { return null; }
  }

  async function flush() {
    if (session.timer) { clearTimeout(session.timer); session.timer = null; }
    if (!session.pending || !session.canvasId) return;
    if (session.inFlight) { session.dirtySinceFlight = true; return; }

    const data = session.pending;
    session.pending = null;
    session.inFlight = true;
    emit('saving');

    try {
      const out = await api.putCanvas(session.clientId, session.canvasId, data, session.rev);
      session.rev = out.rev;
      clearMirror(session.canvasId);
      emit('saved', { rev: out.rev });
    } catch (err) {
      mirror(data);
      if (err.status === 409) {
        // Outra aba (ou o agente) escreveu primeiro. Sobrescrever cegamente
        // apagaria o trabalho do outro lado; quem resolve é o app.
        session.rev = err.currentRev ?? session.rev;
        emit('conflict', { currentRev: err.currentRev });
      } else {
        emit('error', { message: err.message });
        console.error('[persistência] falha ao salvar', err);
      }
    } finally {
      session.inFlight = false;
      if (session.dirtySinceFlight || session.pending) {
        session.dirtySinceFlight = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  const persistence = {
    /** Chamado ao abrir um canvas: fixa a sessão de escrita. */
    attach(clientId, canvasId, rev) {
      session.clientId = clientId;
      session.canvasId = canvasId;
      session.rev = rev;
      session.pending = null;
      session.dirtySinceFlight = false;
      if (session.timer) { clearTimeout(session.timer); session.timer = null; }
    },

    detach() {
      session.clientId = null;
      session.canvasId = null;
      session.rev = null;
      session.pending = null;
    },

    /** O que os 46 call-sites acabam chamando. Barato: só agenda. */
    save(data) {
      if (!session.canvasId) return;
      session.pending = data;
      emit('dirty');
      schedule();
    },

    flush,

    /** Última chance antes da aba fechar — `fetch` normal não sobrevive. */
    flushBeacon() {
      if (!session.pending || !session.canvasId) return;
      const url = `/api/clients/${session.clientId}/canvases/${session.canvasId}`;
      const blob = new Blob([JSON.stringify(session.pending)], { type: 'application/json' });
      // sendBeacon não manda If-Match; é o caminho de emergência, e perder a
      // checagem de concorrência aqui é melhor do que perder a edição.
      if (navigator.sendBeacon && navigator.sendBeacon(url + '?beacon=1', blob)) {
        session.pending = null;
      }
    },

    onState(fn) { session.listeners.add(fn); return () => session.listeners.delete(fn); },
    get rev() { return session.rev; },
    get canvasId() { return session.canvasId; },
    get clientId() { return session.clientId; },
    get hasPending() { return session.pending !== null; },
    readMirror,
    clearMirror,
  };

  // Gatilhos de descarga: sair do campo, trocar de aba, fechar.
  document.addEventListener('blur', (e) => {
    if (e.target && e.target.matches?.('input, textarea, [contenteditable="true"]')) flush();
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', () => persistence.flushBeacon());
  window.addEventListener('beforeunload', () => persistence.flushBeacon());

  /**
   * O app monta cards com innerHTML em ~50 lugares. Enquanto o texto vinha só
   * do teclado do usuário isso era feio; com o agente escrevendo, um nome com
   * `<` quebra o card em silêncio — e um `<img onerror>` num JSON de terceiro
   * executa. Aplicado nos campos que recebem texto livre.
   */
  window.escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  window.Audasys = { api, persistence, genId, escapeHtml: window.escapeHtml };
})();
