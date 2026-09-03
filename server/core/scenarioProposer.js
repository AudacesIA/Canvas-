/**
 * Remontagem do cenário por IA — a peça que substitui o `scenarioEngine`.
 *
 * ── O que ela existe para corrigir ───────────────────────────────────────────
 * O gerador anterior não lia a premissa: fazia `premissa.includes('hub')`,
 * `includes('frota')`, e escolhia entre três roteiros de logística cravados no
 * código. O que não casasse com as 12 palavras da lista caía num galho que
 * apagava todos os gargalos do mapa. Junto vinha um parecer executivo literal,
 * com score fixo de 88/100, gravado dentro do `derivadoDe` do cenário — ou seja,
 * em disco, no documento que vai para a reunião com o cliente.
 *
 * O defeito não era a ausência de IA. Era o sistema não admitir a ausência:
 * em vez de recusar, ele fabricava conteúdo com aparência de análise e devolvia
 * 201. Um erro que quebra alto custa cinco minutos; um que grava em silêncio
 * chega à reunião.
 *
 * ── A regra desta peça ───────────────────────────────────────────────────────
 * NÃO EXISTE FALLBACK. Sem credencial, sem rede ou com resposta ilegível, ela
 * levanta erro dizendo QUAL das três coisas falhou. O cenário continua existindo
 * como clone fiel do processo real — que é uma resposta honesta — e nenhuma
 * mudança inventada entra no mapa.
 *
 * ── Por que devolve `ops` e não um canvas ────────────────────────────────────
 * A saída é uma lista de operações no formato que `validateOps` já conhece, para
 * virar um changeset. Assim a proposta passa pela mesma validação de qualquer
 * escrita do agente, aparece como fantasma sobre o mapa e é aceita item a item.
 * Um canvas devolvido pronto pela IA seria escrita direta sem revisão — e o
 * consultor perderia a chance de discordar antes de virar registro.
 */

import { canvasOutline } from './views.js';
import { NODE_TYPES } from './schema.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELO_PADRAO = 'gemini-flash-latest';

/** Erro com status HTTP e uma `causa` legível, para a rota não ter que adivinhar. */
function erroDeGeracao(status, causa, mensagem, extra = {}) {
  return Object.assign(new Error(mensagem), { status, causa, ...extra });
}

/**
 * Só o subconjunto que remonta um processo.
 *
 * `attachRef`, `addBreakpoint` e companhia existem no vocabulário de ops, mas
 * pedir tudo de uma vez aumenta a chance de resposta inválida sem aumentar o que
 * o cenário precisa: um "e se" mexe em passos e passagens.
 */
const SCHEMA_DA_RESPOSTA = {
  type: 'object',
  properties: {
    raciocinio: {
      type: 'string',
      description: 'Uma frase dizendo o que muda no processo sob esta premissa, e por quê.',
    },
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['addNode', 'updateNode', 'deleteNode', 'addEdge', 'removeEdge'] },
          motivo: { type: 'string', description: 'Por que esta mudança específica decorre da premissa.' },
          nodeId: { type: 'string', description: 'Alias do nó existente (n01, n04…). Só para updateNode e deleteNode.' },
          node: {
            type: 'object',
            description: 'Só para addNode.',
            properties: {
              id: { type: 'string', description: 'Sempre com prefixo node_prop_ (ex.: node_prop_1).' },
              name: { type: 'string' },
              type: { type: 'string', enum: NODE_TYPES },
              description: { type: 'string' },
              owner: { type: 'string' },
              tools: { type: 'string' },
            },
            required: ['id', 'name', 'type'],
          },
          set: {
            type: 'object',
            description: 'Só para updateNode: os campos que mudam.',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              owner: { type: 'string' },
              tools: { type: 'string' },
              bottleneck: { type: 'string' },
              duration: { type: 'string' },
            },
          },
          edge: {
            type: 'object',
            description: 'Só para addEdge.',
            properties: {
              from: { type: 'string', description: 'Alias existente (n03) ou id proposto (node_prop_1).' },
              to: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['from', 'to'],
          },
          edgeId: { type: 'string', description: 'Só para removeEdge: id real da aresta.' },
        },
        required: ['kind', 'motivo'],
      },
    },
  },
  required: ['raciocinio', 'ops'],
};

function montarPrompt(canvas, { premissa, postura }) {
  const outline = canvasOutline(canvas);
  return `Você é um consultor de processos remontando um cenário "e se" sobre um mapa BPM real.

O PROCESSO ATUAL (as-is), em formato de outline:
${outline}

Como ler o outline: cada linha começa com o ALIAS do nó (n01, n02…) — use esse alias em
"nodeId", "from" e "to". "!gargalo(...)" marca um gargalo mapeado pelo consultor.
"×23/mês" é volume. "dono:" é quem executa.

A PREMISSA DO CENÁRIO: "${premissa}"
POSTURA: ${postura}

Postura não é multiplicador. "otimista" não significa cortar 8% de nada — significa assumir
que a mudança funciona bem; "pessimista" assume atrito real (fornecedor que não aceita,
equipe que resiste); "exploratorio" admite um salto distante que hoje não é viável.

Sua tarefa: propor as mudanças ESTRUTURAIS que este processo sofreria SE a premissa fosse
verdade. Não reescreva o processo inteiro — o cenário já é uma cópia fiel do as-is, e você
propõe apenas o DELTA.

Regras:
- Só proponha o que decorre da premissa. Se a premissa não afeta um passo, não mexa nele.
- Ao remover um nó do meio do fluxo, RELIGUE o que sobrou com addEdge, senão o mapa quebra.
- Nós novos usam id com prefixo "node_prop_" e são referenciados por esse id em addEdge.
- Se a premissa elimina um gargalo, prefira updateNode limpando "bottleneck" a apagar o nó:
  o passo pode continuar existindo sem ser gargalo.
- Cada op precisa de "motivo": uma frase ligando a mudança à premissa. É o que o consultor
  lê para aceitar ou rejeitar item a item.
- Entre 2 e 12 ops. Se a premissa não implicar nenhuma mudança estrutural, devolva ops vazio
  e explique no "raciocinio" por que o processo não muda.`;
}

/**
 * @returns {Promise<{ops: object[], raciocinio: string, modelo: string}>}
 * @throws  erro com `.causa`: 'credencial' | 'api' | 'resposta'
 */
export async function proporRemontagem(canvas, { premissa, postura = 'realista' } = {}) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) {
    throw erroDeGeracao(503, 'credencial',
      'Falta GEMINI_API_KEY. A remontagem do cenário é feita por IA e não tem substituto '
      + 'local — o gerador antigo, que inventava as mudanças a partir de palavras-chave, foi '
      + 'removido de propósito. Ponha a chave no .env (que já está no .gitignore) e refaça. '
      + 'O cenário continua criado como cópia fiel do processo real.');
  }

  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;
  let resposta;
  try {
    resposta = await fetch(`${ENDPOINT}/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': chave },
      body: JSON.stringify({
        contents: [{ parts: [{ text: montarPrompt(canvas, { premissa, postura }) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA_DA_RESPOSTA,
          temperature: 0.4,
        },
      }),
    });
  } catch (err) {
    throw erroDeGeracao(502, 'api',
      `Não foi possível falar com a API do Gemini: ${err.message}. `
      + 'Sem rede não há remontagem — e inventar as mudanças localmente é exatamente o que '
      + 'esta peça existe para não fazer.');
  }

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const detalhe = corpo?.error?.message ?? `HTTP ${resposta.status}`;
    throw erroDeGeracao(502, 'api',
      `A API do Gemini recusou a chamada: ${detalhe}`,
      { httpDaApi: resposta.status });
  }

  const texto = corpo?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) {
    // Resposta 200 sem conteúdo costuma ser corte por filtro de segurança ou
    // por limite de tokens; o motivo vem em `finishReason`.
    const motivo = corpo?.candidates?.[0]?.finishReason ?? 'sem finishReason';
    throw erroDeGeracao(502, 'resposta',
      `O modelo respondeu sem conteúdo (${motivo}). Nada foi aplicado ao cenário.`);
  }

  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    throw erroDeGeracao(502, 'resposta',
      'O modelo devolveu algo que não é JSON válido, apesar do schema. Nada foi aplicado.');
  }

  const ops = Array.isArray(dados.ops) ? dados.ops : [];
  // `motivo` é do consultor, não do validador de ops: sai daqui e vira o
  // `rationale` do changeset, senão `validateOps` recusa o campo desconhecido.
  const motivos = ops.map((op) => op.motivo).filter(Boolean);
  const limpas = ops.map(({ motivo, ...op }) => op);

  return {
    ops: limpas,
    raciocinio: String(dados.raciocinio ?? ''),
    motivos,
    modelo,
  };
}
