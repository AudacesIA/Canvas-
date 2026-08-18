/**
 * Mutex em memória por chave.
 *
 * Node é single-threaded, mas `await` no meio de um read-modify-write abre
 * janela para intercalação: duas requisições PUT no mesmo canvas podem ambas
 * ler `rev: 7` antes de qualquer uma gravar, e a segunda escrita perde a
 * primeira sem que o `If-Match` perceba. Serializar por canvasId fecha isso.
 *
 * Só protege dentro deste processo — e como o daemon é único (é a razão da
 * topologia de dois processos), isso é suficiente.
 */

const queues = new Map();

export function withLock(key, fn) {
  const previous = queues.get(key) ?? Promise.resolve();

  // A cadeia continua mesmo se `fn` rejeitar; senão um erro trava a chave.
  const result = previous.then(() => fn());
  const settled = result.then(
    () => {},
    () => {},
  );

  queues.set(key, settled);
  settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });

  return result;
}
