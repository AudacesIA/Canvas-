/**
 * Procedência por campo, do lado do cliente.
 *
 * O schema tem `fieldMeta` desde a v2, e o servidor usa isso para marcar
 * conflito quando o agente propõe sobre um campo travado. Só que a interface
 * nunca escrevia esse dado: nos 16 nós do primeiro mapa real, 100% dos campos
 * estavam `source:'agent'` e nenhum `'user'`. Resultado, `isLocked` era falso em
 * tudo e a proteção contra o agente sobrescrever edição humana **nunca disparou**.
 * O teste e2e passava porque forjava o `fieldMeta` no payload — provava o
 * servidor e mascarava o cliente.
 *
 * Este módulo é a metade que faltava. Espelha `markFields` do servidor
 * (server/core/schema.js).
 */
(function () {
  'use strict';

  /**
   * Marca um campo como escrito pelo consultor.
   *
   * A trava é automática: não existe cadeado para clicar, o toque é a trava.
   * E um campo que o consultor digitou não é inferência pendente de validação —
   * por isso nasce `confirmed`.
   *
   * @param {object} node
   * @param {string} field  nome do campo, ou caminho ("metrics.volumePerMonth")
   */
  function touchField(node, field, { epistemic = 'documented', confirmed = true } = {}) {
    if (!node || !field) return;
    if (!node.fieldMeta || typeof node.fieldMeta !== 'object') node.fieldMeta = {};

    node.fieldMeta[field] = {
      source: 'user',
      at: new Date().toISOString(),
      locked: true,
      epistemic,
      confirmed,
      confirmedAt: confirmed ? new Date().toISOString() : null,
    };

    node.provenance = {
      ...(node.provenance || {}),
      updatedBy: 'user',
      updatedAt: new Date().toISOString(),
    };
  }

  /** Vários campos de uma vez — usado pelo arrasto, que move x e y juntos. */
  function touchFields(node, fields, opts) {
    for (const field of fields) touchField(node, field, opts);
  }

  const isLocked = (node, field) => !!node?.fieldMeta?.[field]?.locked;

  /**
   * Confirma um campo que o agente escreveu.
   *
   * "Confirmar não muda o valor — muda o que a ferramenta pode afirmar." Por isso
   * NÃO vira `source:'user'` e NÃO trava: a autoria continua sendo do agente, o
   * que muda é você ter conferido. Trocar a autoria apagaria de quem veio o dado,
   * que é justamente o que a camada de procedência existe para preservar.
   *
   * Não há rota para isto: `fieldMeta` viaja dentro do nó e o autosave persiste.
   */
  function confirmField(node, field) {
    const meta = node?.fieldMeta?.[field];
    if (!meta || meta.confirmed) return false;
    meta.confirmed = true;
    meta.confirmedAt = new Date().toISOString();
    return true;
  }

  /** Campos escritos pelo agente que ainda não foram conferidos. */
  function pendentes(node) {
    return Object.entries(node?.fieldMeta || {})
      .filter(([campo, m]) => m.source === 'agent' && !m.confirmed
        && ['inferred', 'assumed'].includes(m.epistemic) && !['x', 'y'].includes(campo))
      .map(([campo]) => campo);
  }

  /**
   * Densidade visual de um campo: a regra única do mapa é
   * **preenchimento = evidência**.
   *
   * A escala de 6 níveis do schema colapsa em 3 estados porque o olho não
   * distingue seis tons a 40% de zoom — e a decisão que o consultor precisa
   * tomar é ternária: dá para afirmar, dá para citar, ou é palpite.
   */
  function densidade(node, field) {
    const m = node?.fieldMeta?.[field];
    if (!m) return 'solido';                      // sem procedência = veio do humano
    if (m.confirmed) return 'solido';
    if (['documented', 'observed'].includes(m.epistemic)) return 'solido';
    if (m.epistemic === 'reported') return 'meio';
    return 'fantasma';
  }

  /** Densidade do nó inteiro: manda o campo menos evidenciado que aparece no card. */
  const NO_CARD = ['name', 'owner', 'bottleneck', 'duration', 'tools', 'area'];
  function densidadeDoNo(node) {
    const estados = NO_CARD
      .filter((f) => node?.fieldMeta?.[f])
      .map((f) => densidade(node, f));
    if (!estados.length) return 'solido';
    if (estados.includes('fantasma')) return 'fantasma';
    if (estados.includes('meio')) return 'meio';
    return 'solido';
  }

  window.AudasysFieldMeta = {
    touchField, touchFields, isLocked, confirmField, pendentes, densidade, densidadeDoNo,
  };
  window.touchField = touchField;
})();
