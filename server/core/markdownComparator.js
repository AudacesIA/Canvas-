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

  // 3. Recomendação Estratégica & Score de Viabilidade da Consultoria
  let scoreViabilidade = 55;
  if (est.gargalos.delta < 0) scoreViabilidade += Math.abs(est.gargalos.delta) * 15;
  if (est.handoffs.delta < 0) scoreViabilidade += Math.abs(est.handoffs.delta) * 10;
  if (est.handoffs.delta > 0) scoreViabilidade -= est.handoffs.delta * 5;
  if (compEstrutural.passos.removidos.length > 0) scoreViabilidade += compEstrutural.passos.removidos.length * 5;
  if (cenarioCanvas.derivadoDe?.oportunidadeId) scoreViabilidade += 10;
  if (postura === 'otimista') scoreViabilidade += 5;
  if (postura === 'pessimista') scoreViabilidade -= 5;
  if (postura === 'exploratorio') scoreViabilidade -= 8;
  scoreViabilidade = Math.max(20, Math.min(98, scoreViabilidade));

  let parecerConsultoria = '';
  let seloRecomendacao = 'QUICK WIN';

  if (scoreViabilidade >= 80) {
    seloRecomendacao = `ALTA VIABILIDADE (SCORE ${scoreViabilidade}/100) — QUICK WIN`;
    parecerConsultoria = `O cenário apresenta altíssimo retorno operacional com baixo atrito de transição. A eliminação direta de ${Math.abs(est.gargalos.delta || 1)} gargalo(s) destrava fluxo de caixa e reduz tempo de resposta ao cliente.`;
  } else if (postura === 'exploratorio') {
    seloRecomendacao = `PROJETO ESTRATÉGICO (SCORE ${scoreViabilidade}/100)`;
    parecerConsultoria = 'Recomendado para ciclo de expansão ou novo orçamento. O ganho de escala tecnológica é substancial, justificando a contratação ou automação.';
  } else {
    seloRecomendacao = `OPÇÃO TÁTICA (SCORE ${scoreViabilidade}/100)`;
    parecerConsultoria = 'Cenário viável para testes pontuais ou mitigação de riscos de capacidade. Avaliar a aceitação da equipe antes do rollout definitivo.';
  }

  // 4. Montagem do Relatório Executivo Consolidado
  const relatorio = [];
  relatorio.push('# 📊 DOSSIÊ EXECUTIVO DE COMPARAÇÃO DE PROCESSOS');
  if (clienteNome) relatorio.push(`> **Empresa:** ${clienteNome}`);
  relatorio.push(`> **Processo Original (As-Is):** ${baseCanvas.name || 'Processo Real'}`);
  relatorio.push(`> **Cenário Simulado (To-Be):** ${cenarioCanvas.name || 'Cenário'} [${postura.toUpperCase()}]`);
  relatorio.push(`> **Premissa da Hipótese:** "${premissa}"`);
  relatorio.push(`> **Score de Viabilidade da Consultoria:** **${scoreViabilidade}/100**`);
  relatorio.push('');

  relatorio.push(`## 🏆 1. PARECER DA CONSULTORIA: ${seloRecomendacao}`);
  relatorio.push(parecerConsultoria);
  relatorio.push('');

  relatorio.push('## 📈 2. QUADRO RESUMO ESTRUTURAL');
  relatorio.push('| Indicador | Processo Real (As-Is) | Cenário Simulado (To-Be) | Variação (Delta) |');
  relatorio.push('| :--- | :---: | :---: | :---: |');
  relatorio.push(`| **Total de Etapas** | ${est.passos.base} | ${est.passos.cenario} | ${est.passos.delta >= 0 ? '+' : ''}${est.passos.delta} |`);
  relatorio.push(`| **Passagens de Bastão (Handoffs)** | ${est.handoffs.base} | ${est.handoffs.cenario} | ${est.handoffs.delta >= 0 ? '+' : ''}${est.handoffs.delta} |`);
  relatorio.push(`| **Gargalos Operacionais** | ${est.gargalos.base} | ${est.gargalos.cenario} | ${est.gargalos.delta >= 0 ? '+' : ''}${est.gargalos.delta} |`);
  relatorio.push(`| **Passos sem Responsável (Órfãos)** | ${est.malhasAbertas.base} | ${est.malhasAbertas.cenario} | ${est.malhasAbertas.delta >= 0 ? '+' : ''}${est.malhasAbertas.delta} |`);
  relatorio.push('');

  relatorio.push('## 🟢 3. PONTOS POSITIVOS & GANHOS OPERACIONAIS');
  pontosPositivos.forEach((p, i) => {
    relatorio.push(`${i + 1}. **${p.titulo}:** ${p.detalhe}`);
  });
  relatorio.push('');

  relatorio.push('## 🔴 4. PONTOS DE ATENÇÃO, RISCOS & TRADE-OFFS');
  pontosNegativos.forEach((p, i) => {
    relatorio.push(`${i + 1}. **${p.titulo}:** ${p.detalhe}`);
  });
  relatorio.push('');

  return {
    postura,
    premissa,
    seloRecomendacao,
    scoreViabilidade,
    parecerConsultoria,
    pontosPositivos,
    pontosNegativos,
    compEstrutural,
    markdownBase: mdBase,
    markdownCenario: mdCenario,
    relatorioExecutivo: relatorio.join('\n'),
  };
}
