/**
 * Comparação entre o processo real e um cenário "e se".
 *
 * ── A regra que governa este arquivo ────────────────────────────────────────
 * ELE CONTA ESTRUTURA, NÃO DINHEIRO.
 *
 * O motivo não é preferência técnica, é o estado do dado. Medido nos canvases
 * reais desta base: 16 nós no Canvas de Logística com 14 gargalos mapeados e
 * ZERO com tempo ou custo preenchido; 13 nós no Berenice com 9 gargalos e zero
 * métrica. A camada qualitativa é rica, a quantitativa está vazia.
 *
 * Um comparador que produzisse "+15% de eficiência" a partir disso estaria
 * inventando — e inventando de um jeito que o cliente não consegue verificar,
 * que é a pior espécie. O que dá para afirmar com honestidade é o que está
 * desenhado: quantos passos, quantas passagens de bastão, quantos gargalos e de
 * que tipo, quantas medições sem destinatário.
 *
 * Número em dinheiro só aparece quando OS DOIS lados têm o número. Nunca
 * extrapolado, nunca estimado. Se faltar de um lado, o campo sai como
 * `incomparavel` — e dizer "não dá para comparar" é informação, não falha.
 */

import { LEAN_CATEGORIES } from './schema.js';

/** Passagem de bastão: aresta em que o dono muda. É o desperdício mais caro. */
function handoffs(canvas) {
  const dono = new Map(canvas.nodes.map((n) => [n.id, n.owner || '']));
  return canvas.connections.filter((c) => {
    const de = dono.get(c.from);
    const para = dono.get(c.to);
    return de && para && de !== para;
  });
}

function gargalosPorCategoria(canvas) {
  const out = {};
  const conta = (cats) => {
    for (const cat of (cats?.length ? cats : ['sem-categoria'])) {
      out[cat] = (out[cat] ?? 0) + 1;
    }
  };
  for (const n of canvas.nodes) if (n.bottleneck) conta(n.bottleneckCategories);
  for (const c of canvas.connections) if (c.gargalo?.texto) conta(c.gargalo.categorias);
  return out;
}

/** Retrato do que está desenhado. Tudo aqui é contável sem nenhuma métrica. */
function retrato(canvas) {
  const bps = canvas.breakpoints || [];
  return {
    passos: canvas.nodes.length,
    passagens: canvas.connections.length,
    handoffs: handoffs(canvas).length,
    gargalos: gargalosPorCategoria(canvas),
    totalGargalos: canvas.nodes.filter((n) => n.bottleneck).length
      + canvas.connections.filter((c) => c.gargalo?.texto).length,
    medicoes: bps.length,
    malhasAbertas: bps.filter((b) => b.malha === 'aberta').length,
    oportunidades: (canvas.oportunidades || []).length,
    semDono: canvas.nodes.filter((n) => !n.owner).length,
  };
}

/**
 * Soma uma métrica dos dois lados, ou declara que não dá para comparar.
 *
 * O `null` aqui é deliberado e não é um caso de erro: é a ferramenta dizendo
 * "ninguém apurou isso". Preencher com zero faria a comparação mentir para
 * baixo, e estimar faria mentir para cima.
 */
function metricaComparavel(base, cenario, campo) {
  const soma = (c) => c.nodes.reduce((t, n) => {
    const v = n.metrics?.[campo]?.value;
    return v == null ? t : t + v;
  }, 0);
  /**
   * "Tem número" exige valor DIFERENTE DE ZERO em algum passo.
   *
   * Não é preciosismo: no Canvas de Logística os 16 nós têm `cycleTimeMin: 0`
   * gravado — alguém escreveu zero, e zero não é `null`. Com um teste de
   * `!= null`, a comparação saía como "0 → 0 (=)", que parece medição e é
   * ausência de medição. Um total zerado é indistinguível de campo não
   * preenchido, e apresentar isso como comparação é o começo da mentira.
   */
  const temNumero = (c) => c.nodes.some((n) => (n.metrics?.[campo]?.value ?? 0) !== 0);
  const temBase = temNumero(base);
  const temCen = temNumero(cenario);
  if (!temBase || !temCen) {
    const zeradoDosDois = !temBase && !temCen;
    return { comparavel: false, motivo: zeradoDosDois
      ? 'ninguém apurou este número (os campos estão vazios ou zerados)'
      : `só ${temBase ? 'o processo atual' : 'o cenário'} tem este número apurado` };
  }
  const a = soma(base);
  const b = soma(cenario);
  return { comparavel: true, base: a, cenario: b, diferenca: b - a };
}

/** Nós que aparecem só de um lado, casados por NOME (o id muda no fork). */
function diferencaDePassos(base, cenario) {
  const nomes = (c) => new Set(c.nodes.map((n) => (n.name || '').trim().toLowerCase()).filter(Boolean));
  const nb = nomes(base);
  const nc = nomes(cenario);
  return {
    removidos: base.nodes.filter((n) => n.name && !nc.has(n.name.trim().toLowerCase())).map((n) => n.name),
    novos: cenario.nodes.filter((n) => n.name && !nb.has(n.name.trim().toLowerCase())).map((n) => n.name),
  };
}

export function compararCanvas(base, cenario) {
  const rb = retrato(base);
  const rc = retrato(cenario);
  const passos = diferencaDePassos(base, cenario);

  const gargalosResolvidos = {};
  for (const cat of new Set([...Object.keys(rb.gargalos), ...Object.keys(rc.gargalos)])) {
    const antes = rb.gargalos[cat] ?? 0;
    const depois = rc.gargalos[cat] ?? 0;
    if (antes !== depois) gargalosResolvidos[cat] = { antes, depois, delta: depois - antes };
  }

  return {
    premissa: cenario.derivadoDe?.premissa ?? null,
    postura: cenario.derivadoDe?.postura ?? null,
    estrutura: {
      passos: { base: rb.passos, cenario: rc.passos, delta: rc.passos - rb.passos },
      handoffs: { base: rb.handoffs, cenario: rc.handoffs, delta: rc.handoffs - rb.handoffs },
      gargalos: { base: rb.totalGargalos, cenario: rc.totalGargalos, delta: rc.totalGargalos - rb.totalGargalos },
      malhasAbertas: { base: rb.malhasAbertas, cenario: rc.malhasAbertas, delta: rc.malhasAbertas - rb.malhasAbertas },
      semDono: { base: rb.semDono, cenario: rc.semDono, delta: rc.semDono - rb.semDono },
    },
    passos,
    porCategoriaLean: gargalosResolvidos,
    metricas: {
      cycleTimeMin: metricaComparavel(base, cenario, 'cycleTimeMin'),
      waitTimeMin: metricaComparavel(base, cenario, 'waitTimeMin'),
      costPerRun: metricaComparavel(base, cenario, 'costPerRun'),
    },
  };
}

/** Texto para o agente e para a tela. O sinal importa mais que o número. */
export function compararEmTexto(base, cenario) {
  const r = compararCanvas(base, cenario);
  const seta = (d) => (d === 0 ? '=' : d < 0 ? `−${Math.abs(d)}` : `+${d}`);
  const linhas = [
    `CENÁRIO: "${cenario.name}"  [${r.postura}]`,
    r.premissa ? `Premissa: ${r.premissa}` : '(sem premissa declarada)',
    '',
    'ESTRUTURA (atual → cenário)',
    `  passos ......... ${r.estrutura.passos.base} → ${r.estrutura.passos.cenario}  (${seta(r.estrutura.passos.delta)})`,
    `  handoffs ....... ${r.estrutura.handoffs.base} → ${r.estrutura.handoffs.cenario}  (${seta(r.estrutura.handoffs.delta)})`,
    `  gargalos ....... ${r.estrutura.gargalos.base} → ${r.estrutura.gargalos.cenario}  (${seta(r.estrutura.gargalos.delta)})`,
    `  malhas abertas . ${r.estrutura.malhasAbertas.base} → ${r.estrutura.malhasAbertas.cenario}  (${seta(r.estrutura.malhasAbertas.delta)})`,
  ];

  if (r.passos.removidos.length) linhas.push('', `PASSOS QUE SOMEM: ${r.passos.removidos.join(', ')}`);
  if (r.passos.novos.length) linhas.push(`PASSOS QUE NASCEM: ${r.passos.novos.join(', ')}`);

  const cats = Object.entries(r.porCategoriaLean);
  if (cats.length) {
    linhas.push('', 'DESPERDÍCIO POR CATEGORIA');
    for (const [cat, v] of cats) linhas.push(`  ${cat}: ${v.antes} → ${v.depois}  (${seta(v.delta)})`);
  }

  linhas.push('', 'NÚMEROS');
  for (const [campo, m] of Object.entries(r.metricas)) {
    linhas.push(m.comparavel
      ? `  ${campo}: ${m.base} → ${m.cenario}  (${seta(m.diferenca)})`
      : `  ${campo}: não comparável — ${m.motivo}`);
  }
  linhas.push('',
    'A comparação conta o que está DESENHADO. Onde diz "não comparável", ninguém apurou o',
    'número — e inventar um aqui seria afirmar ao cliente o que a consultoria não sustenta.');

  return linhas.join('\n');
}
