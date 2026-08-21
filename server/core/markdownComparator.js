/**
 * Comparador Semântico e Estrutural Baseado em Markdown.
 * 
 * Compara dois arquivos de processo (As-Is vs To-Be) e extrai Prós, Contras, Riscos e Recomendações.
 */

import { canvasParaMarkdown } from './processoMarkdown.js';
import { compararCanvas } from './comparador.js';

export function compararProcessosMarkdown(baseCanvas, cenarioCanvas, { clienteNome = '' } = {}) {
  const mdBase = canvasParaMarkdown(baseCanvas, { clienteNome });
  const mdCenario = canvasParaMarkdown(cenarioCanvas, { clienteNome });
  const compEstrutural = compararCanvas(baseCanvas, cenarioCanvas);

  const postura = cenarioCanvas.derivadoDe?.postura || 'realista';
  const premissa = cenarioCanvas.derivadoDe?.premissa || 'Otimização operacional';

  // 1. Extração de Pontos Positivos (Ganhos)
  const pontosPositivos = [];
  const est = compEstrutural.estrutura;

  if (est.gargalos.delta < 0) {
    pontosPositivos.push({
      tipo: 'gargalo',
      titulo: `Eliminação de ${Math.abs(est.gargalos.delta)} gargalo(s) operacional(is)`,
      detalhe: 'Redução direta do tempo de espera e eliminação de retrabalhos críticos identificados no processo real.',
    });
  }

  if (est.handoffs.delta < 0) {
    pontosPositivos.push({
      tipo: 'handoff',
      titulo: `Redução de ${Math.abs(est.handoffs.delta)} passagem(ns) de bastão (handoffs)`,
      detalhe: 'Menor troca de contexto entre equipes, diminuindo atrito e risco de desalinhamento na passagem de tarefas.',
    });
  }

  if (compEstrutural.passos.removidos.length > 0) {
    pontosPositivos.push({
      tipo: 'desburocratizacao',
      titulo: `Desburocratização: ${compEstrutural.passos.removidos.length} etapa(s) dispensável(is) removida(s)`,
      detalhe: `Etapas eliminadas: ${compEstrutural.passos.removidos.map(p => `"${p}"`).join(', ')}.`,
    });
  }

  if (compEstrutural.passos.novos.some(p => p.toLowerCase().includes('automa') || p.toLowerCase().includes('tms') || p.toLowerCase().includes('ia') || p.toLowerCase().includes('sistema'))) {
    pontosPositivos.push({
      tipo: 'automacao',
      titulo: 'Substituição de rotinas manuais por sistemas/automação',
      detalhe: 'Ganho em escalabilidade operacional e padronização das entregas sem elevar o headcount na mesma proporção.',
    });
  }

  if (pontosPositivos.length === 0) {
    pontosPositivos.push({
      tipo: 'continuidade',
      titulo: 'Preservação da cadeia de valor principal',
      detalhe: 'O cenário mantém a integridade do processo sem rupturas abruptas de rotina.',
    });
  }

  // 2. Extração de Pontos Negativos / Riscos / Trade-offs
  const pontosNegativos = [];

  if (est.handoffs.delta > 0) {
    pontosNegativos.push({
      tipo: 'risco_handoff',
      severidade: 'media',
      titulo: `Acréscimo de ${est.handoffs.delta} nova(s) passagem(ns) de bastão`,
      detalhe: 'Novos pontos de contato entre diferentes áreas ou parceiros que exigem SLAs bem definidos.',
    });
  }

  if (compEstrutural.passos.novos.length > 0) {
    pontosNegativos.push({
      tipo: 'esforco_implantacao',
      severidade: 'baixa',
      titulo: `Curva de aprendizado e implantação (${compEstrutural.passos.novos.length} novas etapas)`,
      detalhe: `Exige treinamento operacional e configuração nas etapas: ${compEstrutural.passos.novos.map(p => `"${p}"`).join(', ')}.`,
    });
  }

  if (postura === 'exploratorio') {
    pontosNegativos.push({
      tipo: 'capex_investimento',
      severidade: 'alta',
      titulo: 'Investimento em tecnologia / complexidade de integração',
      detalhe: 'Cenários exploratórios dependem de ferramentas avançadas ou parceiros especializados que exigem orçamento prévio.',
    });
  } else if (postura === 'pessimista') {
    pontosNegativos.push({
      tipo: 'contingencia',
      severidade: 'media',
      titulo: 'Custo de redundância operacional',
      detalhe: 'Medidas defensivas reduzem riscos, mas podem introduzir camadas adicionais de validação.',
    });
  }

  if (pontosNegativos.length === 0) {
    pontosNegativos.push({
      tipo: 'baixo_risco',
      severidade: 'baixa',
      titulo: 'Risco de implantação negligenciável',
      detalhe: 'Mudança predominantemente de regras de negócio, sem custo de ferramentas ou contratações.',
    });
  }

  // 3. Recomendação Estratégica da Consultoria
  let parecerConsultoria = '';
  let seloRecomendacao = 'QUICK WIN';

  if (est.gargalos.delta < 0 && est.handoffs.delta <= 0) {
    seloRecomendacao = 'RECOMENDAÇÃO IMEDIATA (QUICK WIN)';
    parecerConsultoria = `O cenário apresenta alto ganho de eficiência com baixo atrito de implantação. A eliminação de ${Math.abs(est.gargalos.delta)} gargalo(s) destrava fluxo de caixa e reduz tempo de resposta ao cliente final.`;
  } else if (postura === 'exploratorio') {
    seloRecomendacao = 'PROJETO ESTRATÉGICO DE MÉDIO PRAZO';
    parecerConsultoria = 'Recomendado para a fase de expansão ou novo ciclo orçamentário. O ganho de escala é substancial, justificando a contratação/integração tecnológica.';
  } else {
    seloRecomendacao = 'OPÇÃO TÁTICA / CONTINGÊNCIA';
    parecerConsultoria = 'Cenário viável para testes pontuais ou mitigação de riscos específicos. Avaliar a aceitação da equipe antes do rollout definitivo.';
  }

  // 4. Montar Relatório Executivo em Markdown
  const relatorioMd = [
    `# 📊 DOSSIÊ EXECUTIVO DE COMPARAÇÃO DE PROCESSOS`,
    `> **Processo Original (As-Is):** ${baseCanvas.name || 'Processo Base'}`,
    `> **Cenário Simulado (To-Be):** ${cenarioCanvas.name || 'Cenário'} [${postura.toUpperCase()}]`,
    `> **Premissa Testada:** "${premissa}"`,
    '',
    `## 🏆 1. PARECER DA CONSULTORIA: ${seloRecomendacao}`,
    parecerConsultoria,
    '',
    '## 📈 2. QUADRO RESUMO ESTRUTURAL',
    '| Indicador | Processo Real (As-Is) | Cenário Simulado (To-Be) | Variação (Delta) |',
    '| :--- | :---: | :---: | :---: |',
    `| **Total de Etapas** | ${est.passos.base} | ${est.passos.cenario} | ${est.passos.delta >= 0 ? '+' : ''}${est.passos.delta} |`,
    `| **Passagens de Bastão (Handoffs)** | ${est.handoffs.base} | ${est.handoffs.cenario} | ${est.handoffs.delta >= 0 ? '+' : ''}${est.handoffs.delta} |`,
    `| **Gargalos Operacionais** | ${est.gargalos.base} | ${est.gargalos.cenario} | ${est.gargalos.delta >= 0 ? '+' : ''}${est.gargalos.delta} |`,
    `| **Etapas Sem Responsável Definido** | ${est.semDono.base} | ${est.semDono.cenario} | ${est.semDono.delta >= 0 ? '+' : ''}${est.semDono.delta} |`,
    '',
    '## 🟢 3. PONTOS POSITIVOS & GANHOS OPERACIONAIS',
    ...pontosPositivos.map((p, i) => `### ${i + 1}. ${p.titulo}\n${p.detalhe}\n`),
    '## 🔴 4. PONTOS DE ATENÇÃO, RISCOS & TRADE-OFFS',
    ...pontosNegativos.map((p, i) => `### ${i + 1}. [Risco ${p.severidade.toUpperCase()}] ${p.titulo}\n${p.detalhe}\n`),
    '## 📋 5. TRANSFORMAÇÃO ETAPA POR ETAPA',
    compEstrutural.passos.removidos.length > 0 ? `**Passos Eliminados:**\n${compEstrutural.passos.removidos.map(p => `- ❌ ~~${p}~~`).join('\n')}\n` : '',
    compEstrutural.passos.novos.length > 0 ? `**Novos Passos Introduzidos:**\n${compEstrutural.passos.novos.map(p => `- ✨ **${p}**`).join('\n')}\n` : '',
  ].filter(Boolean).join('\n');

  return {
    postura,
    premissa,
    seloRecomendacao,
    parecerConsultoria,
    pontosPositivos,
    pontosNegativos,
    compEstrutural,
    markdownBase: mdBase,
    markdownCenario: mdCenario,
    relatorioExecutivo: relatorioMd,
  };
}
