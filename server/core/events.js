/**
 * Barramento de eventos → SSE.
 *
 * É por aqui que a proposta do agente chega ao navegador sem F5. Um canal por
 * canvas; um navegador pode ter várias abas assinando o mesmo.
 */

const channels = new Map(); // canvasId -> Set<res>

export function subscribe(canvasId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': conectado\n\n');

  if (!channels.has(canvasId)) channels.set(canvasId, new Set());
  channels.get(canvasId).add(res);

  // Proxies e o próprio navegador derrubam conexões ociosas; o comentário
  // periódico mantém o canal vivo sem poluir o fluxo de eventos.
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* fechado */ }
  }, 25000);

  const cleanup = () => {
    clearInterval(ping);
    channels.get(canvasId)?.delete(res);
    if (!channels.get(canvasId)?.size) channels.delete(canvasId);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function publish(canvasId, type, payload) {
  const subscribers = channels.get(canvasId);
  if (!subscribers?.size) return 0;

  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  let delivered = 0;
  for (const res of subscribers) {
    try { res.write(frame); delivered++; } catch { subscribers.delete(res); }
  }
  return delivered;
}

/**
 * Quantos navegadores estão de fato olhando este canvas.
 *
 * O agente usa isso para saber se deve dizer "veja o card verde na tela" ou
 * "salvei a proposta, abra o canvas para revisar" — a diferença entre uma
 * instrução útil e uma que aponta para uma tela que ninguém está vendo.
 */
export function subscriberCount(canvasId) {
  return channels.get(canvasId)?.size ?? 0;
}
