/**
 * Vocabulário por cliente.
 *
 * O enum fixo de 7 áreas não tinha `suporte` nem `atendimento`, e no primeiro
 * mapa real os dois nós da atendente foram parar em `operacoes` junto com todo
 * o resto. O efeito colateral é pior que a imprecisão: a fronteira entre áreas
 * some, e é exatamente ali que mora o gargalo de handoff. O agente contornou
 * escrevendo a área dentro do nome do dono — "Thayse — suporte".
 *
 * A taxonomia Lean tem o mesmo problema por outro caminho: os 8 desperdícios
 * foram desenhados para chão de fábrica. O reenvio prematuro da Berenice virou
 * `superprod` por falta de opção, quando é retrabalho causado por política.
 *
 * Cada empresa tem seu organograma e seus modos de desperdiçar. O padrão
 * Audasys é herdado; o cliente estende.
 */

/** Áreas do padrão Audasys — o enum antigo mais o que faltou no uso real. */
export const DEFAULT_AREAS = [
  { id: 'geral', label: 'Geral' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'atendimento', label: 'Atendimento' },
  { id: 'suporte', label: 'Suporte' },
  { id: 'operacoes', label: 'Operações' },
  { id: 'logistica', label: 'Logística' },
  { id: 'compras', label: 'Compras' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'rh', label: 'RH' },
  { id: 'administrativo', label: 'Administrativo' },
];

/**
 * Os 8 desperdícios Lean adaptados a processo administrativo, mais dois que o
 * uso real exigiu: `defeito` (o trabalho sai errado) e `politica` (a regra é
 * que está errada, não a execução).
 */
export const DEFAULT_WASTE = [
  { id: 'espera', label: 'Espera', hint: 'o trabalho fica parado aguardando algo' },
  { id: 'retrabalho', label: 'Retrabalho', hint: 'refazer o que já tinha sido feito' },
  { id: 'defeito', label: 'Defeito de processo', hint: 'o resultado sai errado e alguém precisa corrigir' },
  { id: 'politica', label: 'Política errada', hint: 'a regra em vigor causa o desperdício' },
  { id: 'handoff', label: 'Handoff', hint: 'passagem de bastão entre pessoas ou áreas' },
  { id: 'superprocessamento', label: 'Superprocessamento', hint: 'mais esforço do que o necessário' },
  { id: 'estoque', label: 'Acúmulo / Fila', hint: 'trabalho empilhado esperando processamento' },
  { id: 'movimento', label: 'Movimento', hint: 'deslocamento físico ou entre sistemas' },
  { id: 'superprod', label: 'Superprodução', hint: 'produzir antes ou mais do que se precisa' },
  { id: 'talento', label: 'Talento subutilizado', hint: 'gente qualificada em trabalho que não exige' },
  { id: 'outro', label: 'Outro' },
];

export const DEFAULT_VOCABULARY = { areas: DEFAULT_AREAS, wasteCategories: DEFAULT_WASTE };

/** Junta padrão e extensões, sem duplicar id e preservando a ordem do padrão. */
function merge(base, extra) {
  const out = [...base];
  const seen = new Set(base.map((x) => x.id));
  for (const item of extra || []) {
    if (!item?.id) continue;
    if (seen.has(item.id)) {
      // Redefinir um id do padrão troca só o rótulo — o valor gravado no
      // canvas continua o mesmo, então nada quebra retroativamente.
      const i = out.findIndex((x) => x.id === item.id);
      out[i] = { ...out[i], ...item };
    } else {
      out.push(item);
      seen.add(item.id);
    }
  }
  return out;
}

/**
 * Vocabulário efetivo de um cliente.
 * @param {object|null} client  conteúdo de client.json
 */
export function resolveVocabulary(client) {
  const v = client?.vocabulary ?? {};
  const inheritsDefault = v.inherits !== false;
  return {
    areas: inheritsDefault ? merge(DEFAULT_AREAS, v.areas) : (v.areas ?? DEFAULT_AREAS),
    wasteCategories: inheritsDefault
      ? merge(DEFAULT_WASTE, v.wasteCategories)
      : (v.wasteCategories ?? DEFAULT_WASTE),
  };
}

export const idsOf = (list) => list.map((x) => x.id);

/** Mensagem de erro que ensina em vez de só recusar. */
export function invalidValueMessage(kind, value, list) {
  return `${kind} "${value}" não existe neste cliente. Válidos: ${idsOf(list).join(', ')}. ` +
    `Para acrescentar, edite "vocabulary" no client.json da empresa.`;
}
