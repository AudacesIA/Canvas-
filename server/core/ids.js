/**
 * Geração de ids.
 *
 * O app antigo usava `conn_${Date.now()}` para conexões (app.js:820), sem
 * contador. Um lote de arestas criado no mesmo milissegundo — exatamente o que
 * um agente faz — produzia ids idênticos, e o dedup por (from,to,ruleId) não
 * pega isso porque a tripla é diferente. O sufixo aleatório mais o contador
 * fecham a porta nos dois eixos: mesmo processo e processos distintos.
 *
 * O mesmo algoritmo roda no cliente (`web/js/util.js`) — os dois lados criam
 * ids e eles não podem colidir entre si.
 */

let counter = 0;

export function genId(prefix) {
  counter = (counter + 1) % 100000;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${Date.now()}_${counter}_${rand}`;
}

export const newClientId = (slug) => slug;
export const newCanvasId = () => genId('cv');
export const newNodeId = () => genId('node');
export const newEdgeId = () => genId('conn');
export const newNoteId = () => genId('note');
export const newBreakpointId = () => genId('bp');
export const newOportunidadeId = () => genId('op');
export const newChangesetId = () => genId('cs');
export const newFolderId = () => genId('fld');

/** Slug seguro para virar nome de diretório de cliente. */
export function slugify(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || genId('cli');
}
