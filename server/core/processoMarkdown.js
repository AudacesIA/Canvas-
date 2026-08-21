/**
 * Serialização de Canvas para Markdown Estruturado (processo.md).
 * 
 * Fonte da verdade semântica para raciocínio de IA, auditorias e relatórios executivos.
 */

import { LEAN_CATEGORIES } from './schema.js';

/**
 * Ordena os nós de forma lógica do gatilho inicial até o fim.
 */
function ordenarPassos(canvas) {
  const nodes = [...(canvas.nodes || [])];
  const connections = canvas.connections || [];
  
  if (nodes.length === 0) return [];

  // Mapear adjacências
  const inDegree = new Map(nodes.map(n => [n.id, 0]));
  const adj = new Map(nodes.map(n => [n.id, []]));

  for (const c of connections) {
    if (inDegree.has(c.to)) {
      inDegree.set(c.to, (inDegree.get(c.to) || 0) + 1);
    }
    if (adj.has(c.from)) {
      adj.get(c.from).push(c.to);
    }
  }

  // Identificar gatilhos ou nós com inDegree == 0
  const queue = nodes.filter(n => (inDegree.get(n.id) === 0) || n.type === 'trigger')
                     .sort((a, b) => (a.x || 0) - (b.x || 0));

  const visitados = new Set();
  const ordenados = [];

  while (queue.length > 0) {
    const curr = queue.shift();
    if (visitados.has(curr.id)) continue;
    visitados.add(curr.id);
    ordenados.push(curr);

    const vizinhos = adj.get(curr.id) || [];
    for (const vizId of vizinhos) {
      const vizNode = nodes.find(n => n.id === vizId);
      if (vizNode && !visitados.has(vizId)) {
        queue.push(vizNode);
      }
    }
  }

  // Adicionar nós órfãos ou desconexos ordenados por posição X
  for (const n of nodes) {
    if (!visitados.has(n.id)) {
      ordenados.push(n);
    }
  }

  return ordenados;
}

/**
 * Converte um Canvas completo em documento Markdown executivo.
 */
export function canvasParaMarkdown(canvas, { clienteNome = '' } = {}) {
  const isCenario = !!(canvas.derivadoDe);
  const statusTipo = isCenario ? `Cenário Simulado (${(canvas.derivadoDe.postura || 'realista').toUpperCase()})` : 'Operação Real (As-Is)';
  
  const passosOrdenados = ordenarPassos(canvas);
  const conns = canvas.connections || [];
  const bps = canvas.breakpoints || [];
  const ops = canvas.oportunidades || [];

  // Calcular métricas
  const donoMap = new Map((canvas.nodes || []).map(n => [n.id, n.owner || 'Sem dono']));
  const handoffsList = conns.filter(c => {
    const de = donoMap.get(c.from);
    const para = donoMap.get(c.to);
    return de && para && de !== para && de !== 'Sem dono' && para !== 'Sem dono';
  });

  const gargalos = (canvas.nodes || []).filter(n => n.bottleneck || (n.bottleneckCategories && n.bottleneckCategories.length > 0));

  const md = [];

  // 1. Cabeçalho
  md.push(`# MAPEAMENTO DE PROCESSO: ${canvas.name || 'Processo Sem Título'}`);
  if (clienteNome) md.push(`> **Empresa:** ${clienteNome}`);
  md.push(`> **Status:** ${statusTipo} | **Revisão:** rev.${canvas.rev || 1}`);
  if (isCenario && canvas.derivadoDe.premissa) {
    md.push(`> **Premissa do Cenário:** "${canvas.derivadoDe.premissa}"`);
  }
  md.push('');

  // 2. Visão Geral Estrutural
  md.push('## 1. VISÃO GERAL DA OPERAÇÃO');
  md.push(`- **Total de Etapas/Passos:** ${passosOrdenados.length}`);
  md.push(`- **Passagens de Bastão (Handoffs):** ${handoffsList.length} transferências entre áreas/cargos`);
  md.push(`- **Gargalos Ativos Identificados:** ${gargalos.length}`);
  md.push(`- **Oportunidades de Receita Registradas:** ${ops.length}`);
  md.push(`- **Pontos de Medição / Breakpoints:** ${bps.length}`);
  md.push('');

  // 3. Sequência Cronológica das Etapas
  md.push('## 2. ETAPAS DETALHADAS DO FLUXO');
  if (passosOrdenados.length === 0) {
    md.push('*(Nenhuma etapa desenhada no fluxo até o momento)*\n');
  } else {
    passosOrdenados.forEach((n, idx) => {
      const tipoIcon = {
        trigger: '▶ Gatilho',
        action: '⚙ Ação/Processo',
        wait: '⏳ Espera/Pausa',
        condition: '⑂ Decisão/Filtro',
        output: '🏁 Fim/Resultado',
      }[n.type] || 'Etapa';

      md.push(`### ${idx + 1}. [${tipoIcon}] ${n.name || 'Sem nome'}`);
      md.push(`- **Responsável (Owner):** ${n.owner || 'Não definido'}`);
      if (n.area && n.area !== 'geral') md.push(`- **Área:** ${n.area}`);
      if (n.tools) md.push(`- **Sistemas / Ferramentas:** ${n.tools}`);
      if (n.duration) md.push(`- **Duração Estimada:** ${n.duration}`);
      if (n.frequency) md.push(`- **Frequência:** ${n.frequency}`);
      if (n.description) md.push(`- **Descrição Operacional:** ${n.description}`);

      if (n.bottleneck) {
        const cat = n.bottleneckCategory ? ` (${n.bottleneckCategory})` : '';
        md.push(`- ⚠️ **Gargalo / Fricção:** ${n.bottleneck}${cat}`);
      }

      md.push('');
    });
  }

  // 4. Tabela de Handoffs (Passagens de Bastão)
  md.push('## 3. MATRIZ DE PASSAGENS DE BASTÃO (HANDOFFS)');
  if (handoffsList.length === 0) {
    md.push('*(Nenhuma passagem de bastão crítica entre diferentes responsáveis detectada)*\n');
  } else {
    md.push('| De (Origem) | Para (Destino) | Regra / Transição |');
    md.push('| :--- | :--- | :--- |');
    handoffsList.forEach(c => {
      const deNode = (canvas.nodes || []).find(n => n.id === c.from);
      const paraNode = (canvas.nodes || []).find(n => n.id === c.to);
      const deStr = `${deNode?.owner || 'Sem dono'} (*${deNode?.name || c.from}*)`;
      const paraStr = `${paraNode?.owner || 'Sem dono'} (*${paraNode?.name || c.to}*)`;
      const regra = c.label ? `"${c.label}"` : 'Transição direta';
      md.push(`| ${deStr} | ${paraStr} | ${regra} |`);
    });
    md.push('');
  }

  // 5. Diagnóstico Lean & Desperdícios
  md.push('## 4. MAPA DE DESPERDÍCIOS & GARGALOS (LEAN)');
  if (gargalos.length === 0) {
    md.push('*(Nenhum gargalo estrutural apontado explicitamente neste fluxo)*\n');
  } else {
    gargalos.forEach((n, i) => {
      md.push(`${i + 1}. **Passo "${n.name}":** ${n.bottleneck}`);
      if (n.bottleneckCategory) md.push(`   - *Categoria de Desperdício:* ${n.bottleneckCategory}`);
    });
    md.push('');
  }

  // 6. Oportunidades & Hipóteses
  if (ops.length > 0) {
    md.push('## 5. OPORTUNIDADES DE RECEITA IDENTIFICADAS');
    ops.forEach((op, i) => {
      md.push(`### Oportunidade #${i + 1}: ${op.titulo || 'Sem título'}`);
      if (op.premissa) md.push(`- **Premissa:** ${op.premissa}`);
      if (op.impactoEstimado) md.push(`- **Impacto Financeiro/Operacional:** ${op.impactoEstimado}`);
      if (op.acoesSugeridas && op.acoesSugeridas.length) {
        md.push('- **Ações Recomendadas:**');
        op.acoesSugeridas.forEach(a => md.push(`  - ${a}`));
      }
      md.push('');
    });
  }

  return md.join('\n');
}
