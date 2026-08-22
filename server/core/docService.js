/**
 * Entregáveis de texto da consultoria.
 *
 * ── O que este arquivo é, e o que ele deliberadamente não é ──────────────────
 * O `canvasOutline` (views.js) é uma view para o AGENTE: compacta, com aliases
 * `n01`, otimizada para caber no orçamento de token. Este arquivo produz a outra
 * ponta — o documento para o HUMANO que não abre a ferramenta: o dono da
 * operação, na reunião de validação.
 *
 * São dois documentos, e eles são as duas metades da consultoria:
 *
 *   mapa.md         o processo REAL e onde ele trava hoje
 *   comparacao.md   o processo real CONTRA um cenário "e se"
 *
 * ── A regra que governa os dois ─────────────────────────────────────────────
 * Nenhum número nasce aqui. Tudo que é quantitativo vem de `canvasStats` ou do
 * `comparador`, e onde ninguém apurou, o documento DIZ que ninguém apurou em vez
 * de estimar. É a mesma regra do comparador, pelo mesmo motivo: um documento que
 * o cliente não consegue verificar é pior que um documento ausente, porque ele
 * circula com a assinatura da consultoria.
 */

import { buildAliases, canvasStats, diagnose, humanMinutes, rollupMetrics } from './views.js';

/** Markdown escapa pouca coisa; o que quebra a tabela é o pipe. */
const cel = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * O til do outline, mantido aqui pelo mesmo motivo.
 *
 * Marca o que o agente escreveu e ninguém conferiu. Sem isso, o documento
 * apresenta palpite e apuração com a mesma cara — que é exatamente o risco que
 * a camada de procedência existe para conter.
 */
function porConferir(node) {
  return Object.entries(node.fieldMeta || {}).filter(([campo, meta]) => meta.source === 'agent'
    && !meta.confirmed && ['inferred', 'assumed'].includes(meta.epistemic)
    && !['x', 'y'].includes(campo)).map(([campo]) => campo);
}

function metricaDoNo(node) {
  const m = rollupMetrics(node);
  const partes = [];
  if (m.cycleTimeMin?.value) partes.push(`trabalho ${humanMinutes(m.cycleTimeMin.value)}`);
  if (m.waitTimeMin?.value) partes.push(`espera ${humanMinutes(m.waitTimeMin.value)}`);
  if (m.volumePerMonth?.value) partes.push(`${m.volumePerMonth.value}×/mês`);
  if (m.costPerRun?.value) partes.push(`R$ ${m.costPerRun.value}/execução`);
  return partes.join(' · ') || '—';
}

/**
 * Rebaixa os títulos do texto do consultor para caberem embaixo da seção.
 *
 * A oportunidade é bloco de notas livre, e quase toda começa com `## Onde está o
 * dinheiro`. Embutida sem ajuste, essa linha vira irmã de `## 4. Oportunidades`
 * e o sumário do documento desmonta. Rebaixar dois níveis mantém a hierarquia
 * do arquivo sem pedir disciplina de formatação a quem escreve na frente do
 * cliente — que é justamente o que a camada evita cobrar.
 *
 * Só mexe em `#` de início de linha, e nunca dentro de bloco de código cercado.
 */
function rebaixarTitulos(md, niveis = 2) {
  let dentroDeCodigo = false;
  return String(md ?? '').split('\n').map((linha) => {
    if (/^\s*```/.test(linha)) { dentroDeCodigo = !dentroDeCodigo; return linha; }
    if (dentroDeCodigo) return linha;
    const m = /^(#{1,6})(\s)/.exec(linha);
    if (!m) return linha;
    return '#'.repeat(Math.min(6, m[1].length + niveis)) + linha.slice(m[1].length);
  }).join('\n');
}

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

/** Passagem de bastão: aresta em que o dono muda. Mesma definição do comparador. */
function ehHandoff(canvas, conn) {
  const dono = new Map(canvas.nodes.map((n) => [n.id, n.owner || '']));
  const de = dono.get(conn.from);
  const para = dono.get(conn.to);
  return Boolean(de && para && de !== para);
}

/**
 * O mapa de processos e gargalos.
 *
 * A ordem das seções é a da conversa que ele sustenta: primeiro o que a empresa
 * faz, depois onde trava, depois onde isso é medido (ou não é), e só então o que
 * já foi proposto. Gargalo antes de solução — invertido, a reunião vira venda.
 */
export function mapaMarkdown(canvas, { clienteNome = null } = {}) {
  const stats = canvasStats(canvas);
  const { toAlias } = buildAliases(canvas);
  const nome = new Map(canvas.nodes.map((n) => [n.id, n.name || '(sem nome)']));
  const L = [];

  L.push(`# ${canvas.name} — mapa de processos e gargalos`, '');
  if (clienteNome) L.push(`**Empresa:** ${clienteNome}  `);
  L.push(
    `**Gerado em:** ${new Date().toISOString().slice(0, 10)}  `,
    `**Versão do canvas:** rev ${canvas.rev}`,
    '',
    `${plural(stats.nodes, 'passo', 'passos')} · ${plural(stats.edges, 'passagem', 'passagens')} · `
    + `**${plural(stats.bottlenecks, 'gargalo mapeado', 'gargalos mapeados')}** · `
    + `${plural(stats.missingOwner, 'passo sem dono', 'passos sem dono')}`,
    '',
  );

  // --- 1. O processo ---
  L.push('## 1. O processo como ele é hoje', '');
  L.push('| # | Passo | Dono | Área | Números |', '|---|---|---|---|---|');
  for (const n of canvas.nodes) {
    const pend = porConferir(n);
    L.push(`| ${toAlias.get(n.id) ?? ''} | ${cel(n.name)}${pend.length ? ' ~' : ''} `
      + `| ${cel(n.owner || '—')} | ${cel(n.area || '—')} | ${cel(metricaDoNo(n))} |`);
  }
  L.push('', '`~` marca passo com campo escrito pelo agente e ainda não conferido pela consultoria.', '');

  // --- 2. Gargalos ---
  L.push('## 2. Onde o processo trava', '');
  const gargalosNo = canvas.nodes.filter((n) => n.bottleneck);
  const gargalosAresta = canvas.connections.filter((c) => c.gargalo?.texto);

  if (!gargalosNo.length && !gargalosAresta.length) {
    L.push('_Nenhum gargalo mapeado ainda._', '');
  } else {
    if (gargalosNo.length) {
      L.push('### No passo', '');
      for (const n of gargalosNo) {
        const cats = n.bottleneckCategories?.length ? n.bottleneckCategories.join(', ') : 'sem categoria';
        L.push(`- **${cel(n.name)}** _(${cel(cats)})_ — ${cel(n.bottleneck)}`);
      }
      L.push('');
    }
    /**
     * O gargalo de passagem tem seção própria, e vem depois do de passo por uma
     * razão de conteúdo: o handoff é o desperdício mais caro do vocabulário e o
     * que ninguém é dono — separá-lo é o que faz a lista virar pauta.
     */
    if (gargalosAresta.length) {
      L.push('### Na passagem de bastão', '');
      for (const c of gargalosAresta) {
        const cats = c.gargalo.categorias?.length ? c.gargalo.categorias.join(', ') : 'sem categoria';
        const marca = ehHandoff(canvas, c) ? ' **[troca de dono]**' : '';
        L.push(`- **${cel(nome.get(c.from))} → ${cel(nome.get(c.to))}**${marca} `
          + `_(${cel(cats)})_ — ${cel(c.gargalo.texto)}`);
      }
      L.push('');
    }
  }

  // --- 3. Medição ---
  L.push('## 3. Onde o processo é medido', '');
  const bps = canvas.breakpoints || [];
  if (!bps.length) {
    L.push('_Nenhum ponto de medição definido. Sem medida, a melhoria não é demonstrável._', '');
  } else {
    L.push('| Mede | Onde | Cadência | Quem recebe | Malha |', '|---|---|---|---|---|');
    for (const bp of bps) {
      const onde = bp.alvo.tipo === 'node'
        ? nome.get(bp.alvo.id) ?? '?'
        : (() => {
          const c = canvas.connections.find((x) => x.id === bp.alvo.id);
          return c ? `${nome.get(c.from)} → ${nome.get(c.to)}` : '?';
        })();
      L.push(`| ${cel(bp.oQueMede)} | ${cel(onde)} | ${cel(bp.cadencia)} `
        + `| ${cel(bp.consumidor?.quem || '—')} | ${bp.malha === 'aberta' ? '**ABERTA**' : 'fechada'} |`);
    }
    const abertas = bps.filter((b) => b.malha === 'aberta').length;
    L.push('');
    if (abertas) {
      L.push(`> **${plural(abertas, 'medição', 'medições')} em malha aberta.** O dado é coletado e não chega a ninguém`,
        '> que possa agir — é o alerta que cai num e-mail que ninguém lê. Medir assim custa e não muda nada.', '');
    }
  }

  // --- 4. Oportunidades ---
  L.push('## 4. Oportunidades de receita mapeadas', '');
  const ops = canvas.oportunidades || [];
  if (!ops.length) {
    L.push('_Nenhuma mapeada ainda._', '');
  } else {
    for (const op of ops) {
      const c = canvas.connections.find((x) => x.id === op.arestaId);
      const onde = op.desancorada || !c
        ? '_perdeu a passagem de origem_'
        : `${nome.get(c.from)} → ${nome.get(c.to)}`;
      L.push(`### ${op.titulo || '(sem título)'}`, '',
        `**Onde:** ${onde}  `,
        `**Cenário:** ${op.cenarioId ? 'desenhado' : '_ainda não desenhado_'}`, '',
        rebaixarTitulos(op.markdown).trim() || '_sem anotação_', '');
    }
  }

  // --- 5. Números ---
  L.push('## 5. Números do processo', '');
  const m = stats.metrics;
  if (!m.leadTimeMin) {
    L.push('_Nenhum tempo apurado. Os campos de métrica estão vazios ou zerados — e um número',
      'estimado aqui seria uma afirmação que a consultoria não sustenta na reunião._', '');
  } else {
    L.push(`- **Lead time:** ${humanMinutes(m.leadTimeMin)}`,
      `- Tempo trabalhado: ${humanMinutes(m.cycleTimeMin)}`,
      `- Tempo parado: ${humanMinutes(m.waitTimeMin)}`
      + (m.waitShare != null ? ` (**${Math.round(m.waitShare * 100)}%** do lead time)` : ''), '');
  }
  if (m.annualBottleneckCost) {
    L.push(`- **Custo anual dos gargalos:** R$ ${m.annualBottleneckCost.toLocaleString('pt-BR')}`, '');
    for (const b of m.costlyBottlenecks) {
      L.push(`  - ${cel(b.name)}: R$ ${b.annualCost.toLocaleString('pt-BR')}/ano`);
    }
    L.push('');
  }

  // --- 6. Qualidade do mapa ---
  const problemas = diagnose(canvas);
  if (problemas.length) {
    L.push('## 6. O que ainda falta apurar', '',
      'Lacunas do próprio mapa, não do processo do cliente:', '');
    for (const p of problemas) L.push(`- ${p}`);
    L.push('');
  }

  return L.join('\n');
}

/**
 * A comparação real × cenário.
 *
 * ── Por que o texto de IA entra por parâmetro ───────────────────────────────
 * A metade estrutural é CONTADA aqui, do canvas: passos que somem e nascem,
 * handoffs, gargalos por categoria, malhas abertas. A metade narrativa — pontos
 * fortes, pontos fracos, veredito — é redigida pelo agente e chega pronta.
 *
 * O daemon não chama LLM, e isso não é limitação de infraestrutura: é o que
 * garante que os números do documento sejam sempre os contados, nunca os
 * gerados. As duas metades ficam atribuídas no próprio arquivo, para quem lê
 * saber o que foi apurado e o que foi argumentado.
 */
export function comparacaoMarkdown(base, cenario, textoEstrutural, narrativa = {}) {
  const { pontosFortes = [], pontosFracos = [], veredito = '' } = narrativa;
  const lista = (itens) => (itens?.length
    ? itens.map((i) => `- ${String(i).trim()}`)
    : ['- _não avaliado_']);

  return [
    `# ${base.name} × ${cenario.name}`,
    '',
    `**Cenário:** ${cenario.name}  `,
    `**Postura:** ${cenario.derivadoDe?.postura ?? '—'}  `,
    `**Premissa:** ${cenario.derivadoDe?.premissa || '_não declarada_'}  `,
    `**Gerado em:** ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## O que muda na estrutura',
    '',
    'Contado dos dois canvases. Onde diz "não comparável", ninguém apurou o número.',
    '',
    '```',
    textoEstrutural,
    '```',
    '',
    '## Leitura',
    '',
    '> Análise redigida por IA a partir do quadro acima. Os números são os contados;',
    '> a interpretação é argumento, e é para ser contestada na reunião.',
    '',
    '### Pontos fortes',
    '',
    ...lista(pontosFortes),
    '',
    '### Pontos fracos',
    '',
    ...lista(pontosFracos),
    '',
    '### Veredito',
    '',
    veredito.trim() || '_não declarado_',
    '',
  ].join('\n');
}

/** Nome estável: um cenário tem uma comparação, e regerar sobrescreve. */
export const nomeDaComparacao = (cenarioId) => `comparacao-${cenarioId}.md`;
export const NOME_DO_MAPA = 'mapa.md';
