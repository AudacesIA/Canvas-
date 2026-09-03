/**
 * MERLIN — a esteira completa de simulação, numa chamada só.
 *
 * ── O que ele era, e por que mudou ───────────────────────────────────────────
 * Este arquivo se anunciava como "orquestração multi-agentes" com uma banca de 5
 * especialistas. Não havia banca: os cinco agentes eram linhas de `pushLog` em
 * volta de três chamadas de função. `pushLog` só empurra texto num array que a
 * tela exibe em sequência, dando a impressão de deliberação.
 *
 * Pior, a peça que fazia o trabalho de verdade era o `gerarFluxoCenario`, que
 * decidia as mudanças por match de palavra-chave na premissa e devolvia um
 * roteiro de logística cravado no código.
 *
 * Agora os passos são reais e os rótulos dizem o que cada um faz. O que sobrou
 * do Merlin é o que ele sempre deveria ter sido: um atalho que encadeia criar o
 * cenário, remontá-lo pela IA e comparar — cada etapa reportando progresso de
 * verdade, porque a remontagem leva ~10s e o consultor precisa ver que anda.
 */

import { compararProcessosMarkdown } from '../core/markdownComparator.js';

export class MerlinEngine {
  constructor(canvasService) {
    this.canvasService = canvasService;
  }

  /**
   * Executa a deliberação completa do enxame multi-agentes.
   * 
   * @param {string} clientId
   * @param {string} baseCanvasId
   * @param {object} params { premissa, postura, oportunidadeId, onProgress }
   */
  async simular({ clientId, baseCanvasId, premissa, postura = 'realista', oportunidadeId = null, changesetService = null, onProgress = () => {} }) {
    const logs = [];
    const pushLog = (agente, acao, detalhe) => {
      const entry = { agente, acao, detalhe, timestamp: new Date().toISOString() };
      logs.push(entry);
      onProgress(entry);
    };

    // ── 1. Leitura do processo real ───────────────────────────────────────────
    pushLog('Leitura', 'Carregando o Mapa de Processos oficial…', 'Baseline e cadeia de valor');
    const baseCanvas = await this.canvasService.getCanvas(clientId, baseCanvasId);
    const client = await this.canvasService.storage.readClient(clientId).catch(() => null);

    const gargalosAsIs = (baseCanvas.nodes || []).filter(n => n.bottleneck);
    pushLog('Leitura', `${gargalosAsIs.length} gargalos e ${baseCanvas.connections?.length || 0} passagens de bastão no processo real`, 'Nós candidatos isolados');

    // ── 2. Clone fiel ─────────────────────────────────────────────────────────
    pushLog('Clone', 'Copiando o processo real, passo a passo…', 'O cenário nasce idêntico; toda diferença vem depois, revisável');
    const novoCenario = await this.canvasService.criarCenario(clientId, baseCanvasId, {
      premissa,
      postura,
      oportunidadeId,
      nome: `Simulação: ${premissa.slice(0, 50)}`,
      autoPromoverMapa: true,
    });
    pushLog('Clone', `Cenário ${novoCenario.id} criado com ${novoCenario.nodes.length} passos`, 'Cópia fiel do mapa oficial');

    // ── 3. Remontagem pela IA ─────────────────────────────────────────────────
    pushLog('Remontagem (IA)', `Lendo o mapa e aplicando a premissa: "${premissa}"`, 'Etapa demorada — a IA percorre o outline inteiro');
    let remontagem = null;
    try {
      remontagem = await this.canvasService.remontarCenario(clientId, novoCenario.id, changesetService);
      pushLog('Remontagem (IA)', `${remontagem.ops} mudança(s) propostas para revisão`, remontagem.raciocinio);
    } catch (err) {
      // Falhar aqui não desfaz o cenário: o clone fiel continua sendo uma
      // resposta honesta, e dizer que a remontagem não saiu é melhor que
      // inventar as mudanças — que é exatamente o que este motor fazia antes.
      pushLog('Remontagem (IA)', `Não foi possível remontar (${err.causa ?? 'erro'})`, err.message);
    }

    // ── 4. Comparação estrutural ──────────────────────────────────────────────
    pushLog('Comparação', 'Medindo a diferença estrutural contra o processo real…', 'Gargalos, handoffs e passos');
    const comparativo = compararProcessosMarkdown(baseCanvas, novoCenario, { clienteNome: client?.name || clientId });
    const score = comparativo.scoreViabilidade;
    // O score sai de deltas reais (gargalos, handoffs, passos removidos) — os
    // pesos são arbitrários, o cálculo não. Enquanto a remontagem não for aceita,
    // o cenário é idêntico ao pai e o score reflete isso: nenhuma diferença.
    pushLog('Comparação', `Score de viabilidade: ${score}/100 [${comparativo.seloRecomendacao}]`,
      remontagem?.changeset
        ? 'Calculado sobre o cenário ATUAL; aceite as mudanças propostas e recompare'
        : 'Cenário ainda idêntico ao processo real');
    const riscos = comparativo.pontosNegativos || [];
    pushLog('Comparação', `${riscos.length} ponto(s) de atenção`, 'Riscos de transição do cenário');
    const relatorioFinal = comparativo.relatorioExecutivo;

    return {
      cenario: novoCenario,
      changeset: remontagem?.changeset ?? null,
      remontagem: remontagem ? { ops: remontagem.ops, raciocinio: remontagem.raciocinio, modelo: remontagem.modelo } : null,
      comparativo,
      scoreViabilidade: score,
      seloRecomendacao: comparativo.seloRecomendacao,
      relatorioExecutivo: relatorioFinal,
      logsDeliberacao: logs,
    };
  }
}
