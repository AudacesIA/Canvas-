#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { ensureDaemon } from './ensureDaemon.js';
import { client } from './apiClient.js';

/**
 * Servidor MCP do Audasys Canvas.
 *
 * A metodologia NÃO mora aqui — ela vive no Project do Claude Desktop. Este
 * servidor é apenas a superfície de manipulação: ler o canvas de forma barata
 * e propor alterações que o consultor aceita ou rejeita na tela.
 *
 * Princípio de economia: nenhuma tool devolve o canvas inteiro em JSON. Um
 * canvas de 60 nós em JSON completo passa de 90k tokens; em outline, ~1.5k.
 */

const server = new McpServer({ name: 'audasys-canvas', version: '0.1.0' });

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (s) => ({ content: [{ type: 'text', text: s }], isError: true });

/** Erro do daemon já vem redigido para o agente se corrigir; repasse inteiro. */
const guard = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (err) {
    return fail(err.message);
  }
};

// ── Leitura ──────────────────────────────────────────────────────────────────

server.registerTool(
  'list_canvases',
  {
    title: 'Listar canvases',
    description:
      'Lista as empresas (clientes) e seus canvases de processo, com contagem de nós e arestas. ' +
      'Use no começo da conversa para descobrir em qual canvas trabalhar.',
    inputSchema: {},
  },
  guard(async () => {
    const { clients } = await client.home();
    if (!clients.length) {
      return text('Nenhuma empresa cadastrada ainda. Crie uma na tela inicial do canvas (http://127.0.0.1:8787).');
    }
    const lines = [];
    for (const c of clients) {
      lines.push(`${c.name}  (clientId: ${c.id})`);
      if (!c.canvases.length) lines.push('   (sem canvases)');
      for (const cv of c.canvases) {
        const pend = cv.pendingChangesets
          ? `  ⚠ ${cv.pendingChangesets} proposta(s) aguardando revisão`
          : '';
        lines.push(`   ${cv.id}  "${cv.name}"  ${cv.nodeCount} nós, ${cv.edgeCount} arestas  rev=${cv.rev}${pend}`);
      }
    }
    return text(lines.join('\n'));
  }),
);

server.registerTool(
  'get_canvas_outline',
  {
    title: 'Ler o canvas',
    description:
      'Devolve o mapa do processo em texto compacto: cada nó com alias curto (n01, n02…), tipo BPMN, ' +
      'dono, tempo, gargalo Lean, ferramentas e referências, mais todas as arestas e os problemas ' +
      'estruturais detectados. É a forma padrão de ler um canvas — sempre chame isto antes de propor ' +
      'qualquer alteração. Os aliases podem ser usados no lugar dos ids em propose_changeset. ' +
      'Um nó marcado com "filho↓N" contém um subprocesso: chame de novo passando `nodeId` para ' +
      'ler o fluxo de dentro. NUNCA proponha alteração dentro de um subprocesso sem lê-lo antes.',
    inputSchema: {
      clientId: z.string().describe('Id da empresa, como aparece em list_canvases'),
      canvasId: z.string().describe('Id do canvas'),
      area: z.string().optional().describe('Filtra os nós de uma única área (ver get_vocabulary)'),
      nodeId: z.string().optional().describe(
        'Alias (n02) ou id de um nó com subprocesso. Desce um nível e lê o canvas FILHO desse nó ' +
        'em vez do canvas raiz. Os nós de dentro aparecem com alias prefixado (n02.1, n02.2…). ' +
        'Um nível apenas — subprocesso dentro de subprocesso não existe.'),
    },
  },
  guard(async ({ clientId, canvasId, area, nodeId }) => {
    const q = [];
    if (area) q.push(`area=${encodeURIComponent(area)}`);
    if (nodeId) q.push(`into=${encodeURIComponent(nodeId)}`);
    const params = q.length ? `?${q.join('&')}` : '';
    const { outline, stats } = await client.outline(clientId, canvasId, params);
    // Descendo no filho, o RESUMO do canvas raiz seria enganoso: ele contaria os
    // nós de cima enquanto o texto acima descreve os de baixo.
    if (nodeId) return text(outline);
    const resumo = `\n\nRESUMO: ${stats.nodes} nós · ${stats.edges} arestas · ` +
      `${stats.bottlenecks} gargalo(s) · ${stats.missingOwner} sem dono · ${stats.distinctTools} ferramenta(s)`;
    return text(outline + resumo);
  }),
);

server.registerTool(
  'get_vocabulary',
  {
    title: 'Áreas e tipos de desperdício desta empresa',
    description:
      'Devolve as áreas e as categorias de gargalo válidas para este cliente. Cada empresa tem ' +
      'seu organograma, então o vocabulário é por cliente e estende um padrão. Consulte antes de ' +
      'propor, em vez de adivinhar — usar um valor inexistente é erro.',
    inputSchema: { clientId: z.string() },
  },
  guard(async ({ clientId }) => {
    const v = await client.vocabulary(clientId);
    const fmt = (list) => list.map((x) => `  ${x.id}${x.label ? ` — ${x.label}` : ''}${x.hint ? ` (${x.hint})` : ''}`).join('\n');
    return text(`ÁREAS\n${fmt(v.areas)}\n\nCATEGORIAS DE GARGALO\n${fmt(v.wasteCategories)}`);
  }),
);

server.registerTool(
  'get_canvas_stats',
  {
    title: 'Números do processo',
    description:
      'Lead time total, tempo parado vs. trabalhado, custo anual dos gargalos e distribuição ' +
      'por área e por tipo de desperdício. É o que sustenta a comparação antes/depois da ' +
      'consultoria — e o que transforma "esse handoff é ruim" em "custa R$ X por ano".',
    inputSchema: { clientId: z.string(), canvasId: z.string() },
  },
  guard(async ({ clientId, canvasId }) => {
    const { stats } = await client.outline(clientId, canvasId, '?edges=0');
    const m = stats.metrics;
    const hm = (min) => (!min ? '—' : min < 60 ? `${Math.round(min)}min`
      : min < 1440 ? `${(min / 60).toFixed(1)}h` : `${(min / 1440).toFixed(1)}d`);

    const lines = [
      `${stats.nodes} nós · ${stats.edges} arestas · rev ${stats.rev}`,
      '',
      'TEMPO',
      `  trabalhado: ${hm(m.cycleTimeMin)}   parado: ${hm(m.waitTimeMin)}   lead time: ${hm(m.leadTimeMin)}`,
      m.waitShare !== null ? `  ${Math.round(m.waitShare * 100)}% do lead time é espera` : '  (sem métricas de tempo preenchidas)',
      // Procedência do número: sem isto o agente reporta o total como se todo ele
      // tivesse sido declarado nó a nó, e não sabe explicar de onde veio.
      m.nosComTempoDeSubprocesso
        ? `  ⓘ ${m.nosComTempoDeSubprocesso} nó(s) tiveram o tempo somado a partir do subprocesso;\n` +
          '    a soma ignora ramos que se excluem, então confira o que validate_canvas apontar'
        : null,
      '',
      'CUSTO',
      m.annualBottleneckCost
        ? `  gargalos custam R$ ${m.annualBottleneckCost.toLocaleString('pt-BR')}/ano\n` +
          m.costlyBottlenecks.map((b) => `    ${b.name}: R$ ${b.annualCost.toLocaleString('pt-BR')}`).join('\n')
        : '  (preencha volumePerMonth e costPerRun nos nós de gargalo para calcular)',
      '',
      'QUALIDADE DO MAPA',
      `  ${stats.bottlenecks} gargalo(s) · ${stats.missingOwner} nó(s) sem dono · ${stats.distinctTools} ferramenta(s)`,
      stats.pendingValidation
        ? `  ⚠ ${stats.pendingValidation} campo(s) inferidos aguardando confirmação do consultor`
        : '  ✓ nenhuma inferência pendente de confirmação',
      '',
      'DESPERDÍCIOS',
      Object.entries(stats.byLean).map(([k, v]) => `  ${k}: ${v}`).join('\n') || '  (nenhum classificado)',
      '',
      'ÁREAS',
      Object.entries(stats.byArea).map(([k, v]) => `  ${k}: ${v}`).join('\n'),
    ];
    // `null` marca linha condicional ausente; sem o filtro vira linha em branco.
    return text(lines.filter((l) => l !== null).join('\n'));
  }),
);

// ── Escrita ──────────────────────────────────────────────────────────────────

const nodeShape = z.object({
  id: z.string().optional().describe('Use o prefixo node_prop_ (ex.: node_prop_1) para referenciar este nó numa aresta do mesmo changeset'),
  type: z.enum(['trigger', 'action', 'wait', 'condition', 'output']).optional(),
  name: z.string().describe('Nome do passo, no imperativo: "Conferir pedido"'),
  description: z.string().optional(),
  owner: z.string().optional().describe('Cargo ou função que executa'),
  area: z.string().optional().describe('Id da área — consulte get_vocabulary; varia por empresa'),
  duration: z.string().optional().describe('Tempo em texto livre: "2 dias"'),
  frequency: z.enum(['demanda', 'diario', 'semanal', 'mensal']).optional(),
  tools: z.string().optional().describe('Sistemas separados por vírgula: "Bling, Omie"'),
  bottleneck: z.string().optional().describe('Onde este passo costuma travar'),
  bottleneckCategory: z.string().optional().describe('Categoria principal do desperdício (ver get_vocabulary)'),
  bottleneckCategories: z.array(z.string()).optional().describe('Um gargalo pode ter mais de uma causa: ["retrabalho","politica"]'),
  metrics: z.object({
    cycleTimeMin: z.number().optional().describe('Minutos de trabalho efetivo neste passo'),
    waitTimeMin: z.number().optional().describe('Minutos parado em fila — a distância para o cycleTime é o desperdício'),
    volumePerMonth: z.number().optional().describe('Quantas vezes o passo roda por mês'),
    costPerRun: z.number().optional().describe('Custo em reais de cada execução'),
    reworkRate: z.number().optional().describe('Fração de execuções que voltam (0 a 1)'),
  }).optional().describe(
    'Números tipados. Prefira isto a escrever "63% da demanda" dentro do campo de gargalo: ' +
    'só assim dá para filtrar, somar lead time e calcular o custo anual do gargalo.'),
  x: z.number().optional().describe('Posição. Passo horizontal idiomático: 320px'),
  y: z.number().optional(),
}).passthrough();

const opShape = z.object({
  opId: z.string().optional(),
  kind: z.enum(['addNode', 'updateNode', 'deleteNode', 'addEdge', 'removeEdge', 'attachRef',
    'detachRef', 'setLayout', 'addNote', 'setSubprocessMode', 'proposeInChild',
    'addBreakpoint', 'updateBreakpoint', 'removeBreakpoint',
    'addOportunidade', 'updateOportunidade', 'removeOportunidade']),
  reason: z.string().optional().describe('Por que esta operação — aparece na revisão'),
  epistemic: z.record(z.enum(['documented', 'observed', 'reported', 'inferred', 'assumed', 'prescribed']))
    .optional().describe(
      'Procedência POR CAMPO: {"owner":"reported","bottleneck":"inferred"}. ' +
      'reported = alguém disse na entrevista; inferred = você deduziu; observed = você viu acontecer; ' +
      'documented exige documento. Campo sem declaração é tratado como inferido e entra na fila de ' +
      'validação do consultor. Declare com honestidade: é isto que impede o mapa de afirmar como ' +
      'fato apurado aquilo que foi dedução sua.'),
  node: nodeShape.optional(),
  nodeId: z.string().optional().describe('Id real ou alias (n04)'),
  set: z.record(z.any()).optional().describe('Campos a alterar em updateNode'),
  expect: z.record(z.any()).optional().describe('Valores esperados antes da alteração; se não baterem, a op fica obsoleta em vez de atropelar'),
  edge: z.object({
    id: z.string().optional(), from: z.string(), to: z.string(),
    label: z.string().optional(), ruleId: z.string().optional(),
  }).optional(),
  edgeId: z.string().optional(),
  ref: z.object({
    kind: z.enum(['methodology', 'policy', 'sop', 'transcript', 'spreadsheet', 'screenshot', 'regulation', 'note']).optional(),
    label: z.string(),
    epistemic: z.enum(['documented', 'observed', 'reported', 'inferred', 'assumed', 'prescribed']).optional()
      .describe('Honestidade da fonte: reported = o cliente disse; inferred = você deduziu; documented exige documento'),
    quote: z.string().optional(),
    source: z.record(z.any()).optional(),
  }).optional(),
  refId: z.string().optional(),
  positions: z.array(z.object({ nodeId: z.string(), x: z.number(), y: z.number() })).optional(),
  note: z.record(z.any()).optional(),
  mode: z.enum(['checklist', 'canvas']).optional()
    .describe('setSubprocessMode: "canvas" dá ao nó um fluxo próprio; "checklist" é uma lista simples'),
  ops: z.array(z.any()).optional().describe(
    'proposeInChild: operações a aplicar DENTRO do subprocesso deste nó. Use quando um passo é ' +
    'grande demais para caber num nó — um que concentra boa parte da demanda e tem triagem, ' +
    'decisão e caminhos próprios merece canvas próprio em vez de virar um gateway. ' +
    'Um nível de profundidade apenas.'),
  breakpoint: z.object({
    id: z.string().optional(),
    alvo: z.object({
      tipo: z.enum(['node', 'edge']),
      id: z.string().describe('Id ou alias do nó (n04), ou id da aresta'),
    }).describe('Onde se mede. Na ARESTA quando o que importa é a passagem de bastão: ' +
      'o tempo entre um passo e o próximo é onde costuma estar o desperdício mais caro.'),
    oQueMede: z.string().describe('O indicador em uma frase: "tempo entre embalar e coletar"'),
    cadencia: z.enum(['continua', 'diaria', 'semanal', 'mensal', 'eventual']).optional(),
    consumidor: z.object({
      quem: z.string().describe('Pessoa ou papel que RECEBE o dado e pode agir sobre ele'),
      comoChega: z.string().optional().describe('Planilha, painel, e-mail, reunião…'),
    }).optional().describe(
      'Sem consumidor a MALHA fica ABERTA: o dado é coletado e não vai a lugar nenhum. ' +
      'Não invente um destinatário para "fechar" a malha — malha aberta é um achado, ' +
      'não um defeito do preenchimento.'),
    evidencia: z.enum(['documented', 'observed', 'reported', 'inferred', 'assumed', 'prescribed'])
      .optional().describe('Força da evidência de que essa medição existe de fato'),
    serie: z.array(z.object({ em: z.string(), valor: z.number(), unidade: z.string() })).optional(),
  }).optional().describe('addBreakpoint: ponto de medição do processo'),
  breakpointId: z.string().optional(),

  oportunidade: z.object({
    id: z.string().optional(),
    arestaId: z.string().describe(
      'Id da ARESTA onde a oportunidade mora. Não é um nó: a receita que se perde costuma estar '
      + 'na passagem de bastão, onde ninguém é dono do prejuízo.'),
    titulo: z.string().describe('Uma linha, é o que aparece no mapa antes de abrir'),
    markdown: z.string().optional().describe(
      'O corpo, em Markdown. Bloco de notas livre: números, contas, links, o que sustentar a '
      + 'oportunidade. Escreva como escreveria para o cliente ler.'),
  }).optional().describe('addOportunidade: onde há dinheiro na mesa'),
  oportunidadeId: z.string().optional(),
}).passthrough();

server.registerTool(
  'propose_changeset',
  {
    title: 'Propor alterações no canvas',
    description:
      'Propõe alterações no canvas. NÃO aplica: as mudanças aparecem na tela do consultor destacadas ' +
      '(verde=novo, âmbar=alterado, vermelho=conflito) e ele aceita ou rejeita operação por operação. ' +
      'Só pode existir uma proposta pendente por canvas. Sempre leia com get_canvas_outline antes, ' +
      'e escreva um rationale citando a fonte (transcrição, planilha, POP). ' +
      'Para criar um nó e já ligá-lo, dê ao nó um id "node_prop_1" e use esse id no addEdge do mesmo lote.',
    inputSchema: {
      clientId: z.string(),
      canvasId: z.string(),
      title: z.string().describe('Título curto da proposta, como o consultor vai vê-la'),
      rationale: z.string().optional().describe('Por que esta proposta, citando a fonte'),
      ops: z.array(opShape).min(1).describe('Operações do lote'),
      groups: z.array(z.object({
        id: z.string().optional(),
        title: z.string().describe('Nome do bloco, como o consultor vai vê-lo: "Fluxo de insumos"'),
        rationale: z.string().optional(),
        opIds: z.array(z.string()).describe('opIds que pertencem a este bloco'),
      })).optional().describe(
        'Agrupa as operações em blocos revisáveis. Acima de ~15 operações é praticamente ' +
        'obrigatório: sem grupos o consultor revisa uma lista plana sem saber o que pertence ' +
        'ao mesmo subprocesso. Agrupe por subprocesso ou por fluxo.'),
      replace: z.boolean().optional().describe('Substituir a proposta pendente que colida com esta'),
    },
  },
  guard(async ({ clientId, canvasId, title, rationale, ops, groups, replace }) => {
    const out = await client.propose(clientId, canvasId, { title, rationale, ops, groups, replace: !!replace });

    const g = out.changeset.groups?.length ? ` em ${out.changeset.groups.length} bloco(s)` : '';
    const lines = [`Proposta criada: ${out.changeset.id} — ${out.changeset.ops.length} operação(ões)${g}.`];

    lines.push(out.watching > 0
      ? 'O consultor está com o canvas aberto e já está vendo as alterações destacadas na tela.'
      : 'ATENÇÃO: nenhuma aba está com este canvas aberto. A proposta ficou salva; avise para abrir o canvas e revisar.');

    if (out.conflicts.length) {
      lines.push(`\n${out.conflicts.length} conflito(s) com campos editados à mão — virão em vermelho e pré-marcados para rejeitar:`);
      for (const c of out.conflicts) lines.push(`  · ${c.nodeId} campo "${c.field}"`);
    }
    if (out.staleOps.length) {
      lines.push(`\n${out.staleOps.length} operação(ões) obsoleta(s): o valor mudou desde sua leitura.`);
      for (const s of out.staleOps) lines.push(`  · campo "${s.field}": esperava ${JSON.stringify(s.expected)}, está ${JSON.stringify(s.actual)}`);
    }
    if (out.warnings.length) {
      lines.push('\nAvisos:');
      for (const w of out.warnings) lines.push('  · ' + w);
    }

    lines.push('\n--- Como o canvas fica se tudo for aceito ---\n' + out.preview);
    return text(lines.join('\n'));
  }),
);

server.registerTool(
  'suggest_layout',
  {
    title: 'Calcular posições',
    description:
      'Calcula posições legíveis para os nós, em camadas. NÃO aplica: devolve as coordenadas ' +
      'para você embutir como operação setLayout no changeset, de modo que o layout também ' +
      'passe pela aprovação do consultor. Nós que o consultor arrastou à mão nunca são movidos. ' +
      'Use "scope" com os ids recém-criados para encaixá-los sem tocar no que já estava desenhado. ' +
      'Prefira isto a calcular x/y na mão: você não vê o resultado, e arestas cruzadas tornam o ' +
      'mapa inapresentável.',
    inputSchema: {
      clientId: z.string(),
      canvasId: z.string(),
      scope: z.array(z.string()).optional().describe('Ids ou aliases a posicionar; o resto vira âncora fixa'),
      direction: z.enum(['LR', 'TB']).optional().describe('LR = esquerda→direita (padrão)'),
    },
  },
  guard(async ({ clientId, canvasId, scope, direction }) => {
    const out = await client.layout(clientId, canvasId, { scope, direction });
    if (!out.positions.length) return text('Nada a reposicionar — o layout atual já está adequado.');
    return text(
      `${out.positions.length} nó(s) a mover, ${out.anchored} âncora(s) preservada(s).\n\n` +
      `Embuta como operação:\n` +
      JSON.stringify({ kind: 'setLayout', positions: out.positions }, null, 2));
  }),
);

server.registerTool(
  'get_breakpoints',
  {
    title: 'Onde o processo é medido',
    description:
      'Lista os pontos de medição do canvas: o que cada um mede, com que cadência, quem recebe o ' +
      'dado, a força da evidência e a última leitura. Marca os de MALHA ABERTA — aqueles em que ' +
      'alguém coleta o número e ele não chega em ninguém que possa agir. ' +
      'Chame antes de propor medição, para não duplicar o que já existe, e antes de afirmar que ' +
      'um gargalo melhorou: sem ponto de medição, não há como provar.',
    inputSchema: {
      clientId: z.string(),
      canvasId: z.string(),
      malha: z.enum(['aberta', 'fechada']).optional().describe('Filtra só as malhas abertas ou fechadas'),
    },
  },
  guard(async ({ clientId, canvasId, malha }) => {
    const { canvas } = await client.canvas(clientId, canvasId);
    const bps = (canvas.breakpoints || []).filter((b) => !malha || b.malha === malha);
    if (!bps.length) {
      return text(malha
        ? `Nenhum ponto de medição com malha ${malha}.`
        : 'Este canvas não tem nenhum ponto de medição.\n'
          + 'Um mapa sem medição não sustenta "antes e depois": use addBreakpoint nos gargalos.');
    }

    const nome = new Map((canvas.nodes || []).map((n) => [n.id, n.name]));
    const aresta = new Map((canvas.connections || []).map((c) =>
      [c.id, `${nome.get(c.from) ?? c.from} → ${nome.get(c.to) ?? c.to}`]));

    const linhas = bps.map((b) => {
      const onde = b.alvo.tipo === 'node' ? nome.get(b.alvo.id) ?? b.alvo.id : aresta.get(b.alvo.id) ?? b.alvo.id;
      const ultimo = b.serie.at(-1);
      return [
        `${b.id}  [${b.alvo.tipo === 'edge' ? 'passagem' : 'passo'}] ${onde}`,
        `   mede: ${b.oQueMede}   cadência: ${b.cadencia}   evidência: ${b.evidencia}`,
        b.malha === 'fechada'
          ? `   chega em: ${b.consumidor.quem}${b.consumidor.comoChega ? ` via ${b.consumidor.comoChega}` : ''}`
          : '   ⚠ MALHA ABERTA — ninguém recebe este dado',
        ultimo?.valor != null ? `   última leitura: ${ultimo.valor}${ultimo.unidade} em ${ultimo.em}` : null,
      ].filter(Boolean).join('\n');
    });

    const nAbertas = bps.filter((b) => b.malha === 'aberta').length;
    const resumo = `\n${bps.length} ponto(s) de medição`
      + (nAbertas ? ` · ${nAbertas} em malha aberta` : ' · todos fechados');
    return text(linhas.join('\n\n') + '\n' + resumo);
  }),
);

server.registerTool(
  'get_oportunidades',
  {
    title: 'Onde há dinheiro na mesa',
    description:
      'Lista as oportunidades de receita mapeadas no canvas, com o corpo em Markdown inteiro. '
      + 'Cada uma pende de uma passagem (aresta) do processo. '
      + 'Chame antes de propor qualquer intervenção comercial: repetir o que já está mapeado, '
      + 'sem saber que está, queima a confiança do consultor no que você propõe. '
      + 'O outline mostra só os títulos; o conteúdo está aqui.',
    inputSchema: { clientId: z.string(), canvasId: z.string() },
  },
  guard(async ({ clientId, canvasId }) => {
    const { canvas } = await client.canvas(clientId, canvasId);
    const ops = canvas.oportunidades || [];
    if (!ops.length) {
      return text('Nenhuma oportunidade de receita mapeada neste canvas.\n'
        + 'Elas moram nas passagens entre passos — comece pelos gargalos de handoff.');
    }

    const nome = new Map((canvas.nodes || []).map((n) => [n.id, n.name]));
    const aresta = new Map((canvas.connections || []).map((c) =>
      [c.id, `${nome.get(c.from) ?? c.from} → ${nome.get(c.to) ?? c.to}`]));

    const blocos = ops.map((o) => [
      `${o.id}  "${o.titulo}"`,
      `   na passagem: ${aresta.get(o.arestaId) ?? o.arestaId}`,
      o.markdown ? o.markdown.split('\n').map((l) => `   | ${l}`).join('\n') : '   (sem nota)',
    ].join('\n'));

    return text(`${blocos.join('\n\n')}\n\n${ops.length} oportunidade(s) de receita`);
  }),
);

server.registerTool(
  'criar_cenario',
  {
    title: 'Desenhar um "e se"',
    description:
      'Cria um CENÁRIO: uma cópia do processo real, ligada a ele, onde você desenha como a '
      + 'operação ficaria sob uma premissa diferente. É a parte da consultoria que mostra ao dono '
      + 'o processo alternativo em vez de descrevê-lo.\n'
      + 'Depois de criar, use propose_changeset NO CANVAS DO CENÁRIO para aplicar as mudanças '
      + '(remover o passo que some, ligar a passagem nova, mapear a oportunidade de receita).\n'
      + 'A postura NÃO é um multiplicador: "pessimista" não significa reduzir 8%, significa uma '
      + 'premissa mais dura escrita por extenso — algo que o dono possa contestar na reunião.',
    inputSchema: {
      clientId: z.string(),
      canvasId: z.string().describe('O canvas do processo REAL. Cenário de cenário é recusado.'),
      premissa: z.string().describe(
        'A frase que origina o cenário: "frota própria MG→BA e Sul terceirizado". '
        + 'Obrigatória — sem ela ninguém contesta o desenho seis semanas depois.'),
      postura: z.enum(['realista', 'otimista', 'pessimista', 'exploratorio']).optional()
        .describe('exploratorio = o cenário distante que serve para dar tangibilidade '
          + '(o braço robótico), mesmo sabendo que não é para agora'),
      oportunidadeId: z.string().optional().describe('Id da oportunidade de receita de onde este cenário nasceu (ex: op_1)'),
      nome: z.string().optional(),
    },
  },
  guard(async ({ clientId, canvasId, premissa, postura, oportunidadeId, nome }) => {
    const { canvas } = await client.criarCenario(clientId, canvasId, { premissa, postura, oportunidadeId, nome });
    const opRef = oportunidadeId ? ` (vinculado à oportunidade ${oportunidadeId})` : '';
    return text(`Cenário criado: ${canvas.id}  "${canvas.name}"${opRef}\n`
      + `Premissa: ${canvas.derivadoDe.premissa}  [${canvas.derivadoDe.postura}]\n`
      + `Copiou ${canvas.nodes.length} passos e ${canvas.connections.length} passagens do processo real.\n\n`
      + 'Agora proponha as alterações NESTE canvasId, e depois chame comparar_cenario.');
  }),
);

server.registerTool(
  'simular_cenario',
  {
    title: 'Simular cenário operacional completo',
    description:
      'Cria um cenário "e se", aplica imediatamente um lote de alterações propostas e devolve o comparativo '
      + 'estrutural contra o processo real. Use para responder rápido a perguntas do tipo '
      + '"como ficaria o processo se terceirizássemos o frete Sul?".',
    inputSchema: {
      clientId: z.string(),
      canvasId: z.string().describe('Id do canvas do processo REAL'),
      premissa: z.string().describe('Premissa do cenário'),
      postura: z.enum(['realista', 'otimista', 'pessimista', 'exploratorio']).optional(),
      oportunidadeId: z.string().optional(),
      nome: z.string().optional(),
      ops: z.array(opShape).optional().describe('Operações estruturais a aplicar no cenário'),
      rationale: z.string().optional().describe('Por que estas alterações'),
    },
  },
  guard(async ({ clientId, canvasId, premissa, postura = 'realista', oportunidadeId, nome, ops = [], rationale = '' }) => {
    const { canvas: cenario } = await client.criarCenario(clientId, canvasId, { premissa, postura, oportunidadeId, nome });
    let changesetInfo = '';
    if (ops.length > 0) {
      const prop = await client.propose(clientId, cenario.id, {
        title: `Simulação: ${premissa}`,
        rationale: rationale || `Aplicação automática de simulação para o cenário "${premissa}"`,
        ops,
        replace: true,
      });
      await client.resolveChangeset(clientId, prop.changeset.id, {
        accept: prop.changeset.ops.map((o) => o.opId || o.id),
      });
      changesetInfo = `\nAlterações estruturais aplicadas com sucesso (${ops.length} operações).`;
    }
    const comp = await client.comparar(clientId, cenario.id);
    return text(
      `🎯 Simulação criada com sucesso!\n`
      + `Cenário: ${cenario.id} "${cenario.name}" [${cenario.derivadoDe.postura}]\n`
      + `Premissa: ${cenario.derivadoDe.premissa}${changesetInfo}\n\n`
      + `--- IMPACTO ESTRUTURAL (Comparação As-Is vs To-Be) ---\n`
      + comp.texto
    );
  }),
);

server.registerTool(
  'get_cenarios',
  {
    title: 'Cenários de um processo',
    description:
      'Lista os cenários "e se" derivados de um canvas, com a premissa de cada um. '
      + 'Chame antes de criar: repropor um cenário que já foi desenhado queima tempo de reunião.',
    inputSchema: { clientId: z.string(), canvasId: z.string() },
  },
  guard(async ({ clientId, canvasId }) => {
    const { cenarios } = await client.cenarios(clientId, canvasId);
    if (!cenarios.length) {
      return text('Nenhum cenário desenhado a partir deste processo ainda.');
    }
    return text(cenarios.map((c) =>
      `${c.id}  "${c.name}"  [${c.derivadoDe.postura}]  ${c.nodeCount} passos\n`
      + `   premissa: ${c.derivadoDe.premissa}`).join('\n\n'));
  }),
);

server.registerTool(
  'comparar_cenario',
  {
    title: 'O que muda entre o processo real e o cenário',
    description:
      'Compara um cenário com o processo de que ele deriva: passos que somem e que nascem, '
      + 'passagens de bastão, gargalos por categoria Lean e malhas de medição abertas.\n'
      + '⚠️ A comparação conta ESTRUTURA, não dinheiro. Número em reais ou em minutos só aparece '
      + 'quando os DOIS lados têm o número apurado; onde disser "não comparável", ninguém mediu. '
      + 'NÃO preencha essa lacuna com estimativa: a ferramenta existe para separar o que a '
      + 'consultoria apurou do que ela supôs, e um percentual inventado destrói exatamente isso.',
    inputSchema: {
      clientId: z.string(),
      canvasId: z.string().describe('O canvas do CENÁRIO (o derivado), não o do processo real'),
    },
  },
  guard(async ({ clientId, canvasId }) => text((await client.comparar(clientId, canvasId)).texto)),
);

server.registerTool(
  'validate_canvas',
  {
    title: 'Conferir o mapa',
    description:
      'Roda as checagens estruturais: início e fim ausentes ou duplicados, nós soltos, decisão ' +
      'com uma saída só, fim inalcançável, nomes repetidos, tipo divergente do BPMN, gargalo sem ' +
      'métrica, cards sobrepostos e cruzamento de arestas. Chame depois de propor, para conferir ' +
      'o próprio trabalho antes de dar por encerrado.',
    inputSchema: { clientId: z.string(), canvasId: z.string() },
  },
  guard(async ({ clientId, canvasId }) => {
    const { problems } = await client.validate(clientId, canvasId);
    return text(problems.length
      ? `${problems.length} ponto(s) a resolver:\n` + problems.map((p) => '  · ' + p).join('\n')
      : 'Nenhum problema estrutural detectado.');
  }),
);

server.registerTool(
  'list_pending_proposals',
  {
    title: 'Propostas aguardando revisão',
    description:
      'Lista as propostas que ainda não foram aceitas nem rejeitadas. Uma proposta feita ' +
      'com o navegador fechado fica esperando — use isto para saber o que está pendurado ' +
      'antes de propor mais coisa no mesmo canvas.',
    inputSchema: {
      clientId: z.string(),
      canvasId: z.string().optional().describe('Se omitido, lista todas as pendências do cliente'),
    },
  },
  guard(async ({ clientId, canvasId }) => {
    const { changesets } = await client.listChangesets(clientId, canvasId ?? '');
    if (!changesets.length) return text('Nenhuma proposta pendente.');
    return text(changesets.map((cs) => {
      const groups = cs.groups?.length ? ` · ${cs.groups.length} bloco(s)` : '';
      return `${cs.id}  "${cs.title}"  ${cs.ops.length} op(s)${groups}  canvas=${cs.canvasId}` +
        `\n   toca ${(cs.touchedNodes || []).length} nó(s), desde ${cs.createdAt}` +
        (cs.rationale ? `\n   ${cs.rationale}` : '');
    }).join('\n\n'));
  }),
);

server.registerTool(
  'focus_canvas',
  {
    title: 'Destacar no canvas',
    description:
      'Faz o navegador do consultor abrir o canvas e destacar os nós citados com um pulso, ' +
      'mostrando uma mensagem. Use para apontar do que você está falando durante a conversa — ' +
      '"olha, é deste ponto aqui". Aceita aliases (n04).',
    inputSchema: {
      clientId: z.string(),
      canvasId: z.string(),
      nodeIds: z.array(z.string()).optional().describe('Nós a destacar (ids ou aliases)'),
      message: z.string().optional().describe('Mensagem curta mostrada na tela'),
    },
  },
  guard(async ({ clientId, canvasId, nodeIds = [], message = '' }) => {
    const out = await client.focus(clientId, canvasId, { nodeIds, message });
    return text(out.watching > 0
      ? `Destaquei ${nodeIds.length || 'o canvas'} na tela do consultor.`
      : 'Nenhuma aba está com este canvas aberto — não há o que destacar. Peça para abrir http://127.0.0.1:8787.');
  }),
);

// ── Boot ─────────────────────────────────────────────────────────────────────

// stdout é o canal do protocolo: qualquer print fora dele quebra a conexão.
// Todo diagnóstico vai para stderr.
const log = (msg) => process.stderr.write(`[audasys-mcp] ${msg}\n`);

try {
  const { started, url } = await ensureDaemon();
  log(started ? `daemon iniciado em ${url}` : `daemon já rodando em ${url}`);
} catch (err) {
  log(`ERRO: ${err.message}`);
  process.exit(1);
}

await server.connect(new StdioServerTransport());
log('conectado ao Claude Desktop');
