/**
 * Motor Inteligente de Transformação de Cenários baseado no Mapa de Processos (Markdown).
 */

import { canvasParaMarkdown } from './processoMarkdown.js';

export function gerarFluxoCenario(baseCanvas, { premissa, postura = 'realista' }) {
  const nodes = JSON.parse(JSON.stringify(baseCanvas.nodes || []));
  const connections = JSON.parse(JSON.stringify(baseCanvas.connections || []));

  if (nodes.length === 0) {
    return { nodes, connections, transformacoes: [] };
  }

  const transformacoes = [];
  const pLower = (premissa || '').toLowerCase();
  const maxNodeNum = Math.max(...nodes.map(n => parseInt(String(n.id).replace(/\D/g, '')) || 0), 10);
  let nextId = maxNodeNum + 1;

  // 1. Tratamento por Postura e Premissa
  if (postura === 'realista' || pLower.includes('rota') || pLower.includes('terceiriz') || pLower.includes('dividir')) {
    // Elimina gargalos declarados no As-Is
    nodes.forEach(n => {
      if (n.bottleneck) {
        transformacoes.push(`Eliminado gargalo no passo "${n.name}" (${n.bottleneck})`);
        n.bottleneck = '';
        n.bottleneckCategory = '';
        n.bottleneckCategories = [];
      }
    });

    // Se for sobre rota ou logística
    if (pLower.includes('rota') || pLower.includes('sul') || pLower.includes('frete') || pLower.includes('logíst')) {
      const lastAction = [...nodes].reverse().find(n => n.type === 'action') || nodes[nodes.length - 1];
      const outputNode = nodes.find(n => n.type === 'output');

      const novoNoId = `node_${nextId++}`;
      const novoNo = {
        id: novoNoId,
        type: 'action',
        name: 'Coleta & Despacho Rota Sul (Operador Parceiro)',
        owner: 'Operador Logístico Terceirizado',
        tools: 'TMS Integrado',
        area: 'operacoes',
        duration: '2h',
        frequency: 'diario',
        x: (lastAction ? lastAction.x : 500),
        y: (lastAction ? lastAction.y + 140 : 300),
      };
      nodes.push(novoNo);
      transformacoes.push('Criada etapa de despacho dedicado para Rota Sul via parceiro');

      if (outputNode) {
        connections.push({
          id: `conn_cen_${Date.now()}_1`,
          from: novoNoId,
          to: outputNode.id,
          label: 'Entrega confirmada no Sul',
        });
      }
    }
  } else if (postura === 'exploratorio' || pLower.includes('ia') || pLower.includes('robô') || pLower.includes('robo') || pLower.includes('automa')) {
    // Substituição por automação / IA de ponta
    nodes.forEach(n => {
      if (n.type === 'action') {
        n.tools = (n.tools ? n.tools + ', ' : '') + 'Automação IA & Visão Computacional';
        n.duration = 'Segundos (Automático)';
      }
      if (n.bottleneck) {
        transformacoes.push(`Gargalo em "${n.name}" eliminado com automação`);
        n.bottleneck = '';
        n.bottleneckCategory = '';
      }
    });
    transformacoes.push('Substituição de rotinas de conferência manual por agentes e robótica');
  } else if (postura === 'otimista' || pLower.includes('eliminar') || pLower.includes('direto')) {
    // Elimina esperas e unifica responsáveis
    const mainOwner = nodes.find(n => n.owner)?.owner || 'Operação Integrada';
    nodes.forEach(n => {
      if (n.type === 'wait') {
        n.type = 'action';
        n.name = n.name.replace(/Espera|Pausa|Aguardar/gi, 'Disparo Automático');
        n.duration = 'Instantâneo';
      }
      n.bottleneck = '';
      n.bottleneckCategory = '';
      if (n.owner && n.owner !== mainOwner) {
        n.owner = mainOwner;
      }
    });
    transformacoes.push('Unificação de responsáveis e eliminação de handoffs intermediários');
  } else if (postura === 'pessimista' || pLower.includes('risco') || pLower.includes('segurança')) {
    // Insere checagem de contingência
    const lastAction = nodes.find(n => n.type === 'action');
    if (lastAction) {
      const checkNodeId = `node_${nextId++}`;
      nodes.push({
        id: checkNodeId,
        type: 'condition',
        name: 'Validação de Contingência & SLA',
        owner: 'Auditoria Interna',
        tools: 'Painel de Alertas',
        area: 'geral',
        x: lastAction.x + 160,
        y: lastAction.y + 100,
      });
      transformacoes.push('Adicionada etapa de validação de contingência para mitigação de falhas');
    }
  }

  return { nodes, connections, transformacoes };
}
