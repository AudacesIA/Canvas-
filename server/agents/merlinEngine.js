/**
 * MERLIN — Motor de Orquestração Multi-Agentes (MAS) de Consultoria & Simulação.
 * 
 * Agentes Especializados:
 * 1. Engenheiro Lean (Diagnóstico As-Is & Desperdícios)
 * 2. Arquiteto de Processos (Topologia & MCP Tooling)
 * 3. Consultor Financeiro (Score de Viabilidade & Destravamento de Receita)
 * 4. Red Teamer / Advogado do Diabo (Riscos, SLAs & Pontos Fracos)
 * 5. Sintetizador C-Level (Dossiê Executivo Consolidado)
 */

import { canvasParaMarkdown } from '../core/processoMarkdown.js';
import { gerarFluxoCenario } from '../core/scenarioEngine.js';
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
  async simular({ clientId, baseCanvasId, premissa, postura = 'realista', oportunidadeId = null, onProgress = () => {} }) {
    const logs = [];
    const pushLog = (agente, acao, detalhe) => {
      const entry = { agente, acao, detalhe, timestamp: new Date().toISOString() };
      logs.push(entry);
      onProgress(entry);
    };

    // ── AGENTE 1: O ENGENHEIRO LEAN (Diagnóstico do As-Is) ────────────────────
    pushLog('Engenheiro Lean', 'Lendo Mapa de Processos (processo.md)...', 'Carregando baseline e isolando cadeia de valor');
    const baseCanvas = await this.canvasService.getCanvas(clientId, baseCanvasId);
    const client = await this.canvasService.storage.readClient(clientId).catch(() => null);
    const markdownAsIs = canvasParaMarkdown(baseCanvas, { clienteNome: client?.name || clientId });

    const gargalosAsIs = (baseCanvas.nodes || []).filter(n => n.bottleneck);
    pushLog('Engenheiro Lean', `Identificados ${gargalosAsIs.length} gargalos estruturais e ${baseCanvas.connections?.length || 0} passagens de bastão`, 'Isolando nós candidatos a otimização');

    // ── AGENTE 2: O ARQUITETO DE WORKFLOW (Topologia & Diferencial de Nós) ───
    pushLog('Arquiteto de Processos', `Aplicando premissa: "${premissa}"`, 'Projetando remoções, substituições e novos nós via MCP');
    const transformado = gerarFluxoCenario(baseCanvas, { premissa, postura, oportunidadeId });

    pushLog('Arquiteto de Processos', `Topologia atualizada: -${transformado.nosRemovidos.length} removidos, 🔄${transformado.nosSubstituidos.length} modificados, +${transformado.nosAdicionados.length} adicionados`, 'Reconectando arestas e validando fluxo');

    // Criar o canvas do cenário no backend
    const novoCenario = await this.canvasService.criarCenario(clientId, baseCanvasId, {
      premissa,
      postura,
      oportunidadeId,
      nome: `Simulação: ${premissa.slice(0, 50)}`,
      autoPromoverMapa: true,
    });

    // ── AGENTE 3: O CONSULTOR FINANCEIRO (Score & Viabilidade) ─────────────────
    pushLog('Consultor Financeiro', 'Calculando Score de Viabilidade e Impacto em Caixa...', 'Cruzando redução de despesa fixa e ganho de lead time');
    const comparativo = compararProcessosMarkdown(baseCanvas, novoCenario, { clienteNome: client?.name || clientId });
    const score = comparativo.scoreViabilidade;
    pushLog('Consultor Financeiro', `Score de Viabilidade apurado: ${score}/100 [${comparativo.seloRecomendacao}]`, 'Projetando destravamento de margem');

    // ── AGENTE 4: O RED TEAMER (Advogado do Diabo / Riscos & Falhas) ──────────
    pushLog('Red Teamer (Advogado do Diabo)', 'Auditando vulnerabilidades do novo cenário...', 'Identificando dependências de terceiros e riscos de transição');
    const riscos = comparativo.pontosNegativos || [];
    pushLog('Red Teamer (Advogado do Diabo)', `Mapeados ${riscos.length} pontos de atenção críticos (SLAs e Integração)`, 'Adicionando cláusulas defensivas ao dossiê');

    // ── AGENTE 5: O SINTETIZADOR C-LEVEL (Dossiê Executivo Final) ─────────────
    pushLog('Sintetizador C-Level', 'Consolidando deliberação da banca em Dossiê Executivo...', 'Montando parecer executivo em Markdown');
    const relatorioFinal = comparativo.relatorioExecutivo;

    return {
      cenario: novoCenario,
      comparativo,
      scoreViabilidade: score,
      seloRecomendacao: comparativo.seloRecomendacao,
      relatorioExecutivo: relatorioFinal,
      logsDeliberacao: logs,
    };
  }
}
