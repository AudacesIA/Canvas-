/**
 * Preenchimento = evidência.
 *
 * A regra única do mapa: quanto mais sólido um elemento aparece, mais forte é a
 * evidência por trás dele. Nó com métrica suposta aparece fantasma; relatada,
 * meio tom; documentada ou observada, sólida.
 *
 * Por que isso importa mais do que parece: a camada epistêmica existe no dado
 * desde a v2 (`fieldMeta[campo].epistemic`, seis níveis) e nunca foi desenhada —
 * virava um contador de texto dizendo "111 campos a confirmar", que ninguém lê.
 * Como sensação visual, ela responde sozinha a pergunta que decide a reunião:
 * "isso aqui a gente pode afirmar para o cliente?".
 *
 * E o efeito de longo prazo é o entregável: um canvas novo abre pálido e vai
 * ganhando densidade conforme a consultoria apura. A captura da semana 1 ao lado
 * da semana 12 explica o método sem uma palavra.
 *
 * ── O laço ──────────────────────────────────────────────────────────────────
 * Nada disso funciona se a evidência não puder evoluir. Confirmar é um gesto no
 * próprio campo — não uma tela à parte, que é ritual e ninguém cumpre. Clicar em
 * "conferir" ao lado do rótulo marca `fieldMeta.confirmed` e o campo ganha
 * densidade na hora. Não muda o valor nem a autoria: muda o que a ferramenta
 * pode afirmar.
 */
(function () {
  'use strict';

  /** input do painel → campo do schema */
  const CAMPOS = {
    'prop-desc': 'description',
    'prop-owner': 'owner',
    'prop-dept': 'area',
    'prop-status': 'status',
    'prop-duration': 'duration',
    'prop-frequency': 'frequency',
    'prop-trigger-cond': 'triggerCond',
    'prop-output-cond': 'outputCond',
    'prop-tools': 'tools',
    'prop-bottleneck': 'bottleneck',
  };

  const fm = () => window.AudasysFieldMeta;

  /** Pinta os campos do painel e oferece o gesto de conferir onde cabe. */
  function marcarPainel(node) {
    for (const [inputId, campo] of Object.entries(CAMPOS)) {
      const input = document.getElementById(inputId);
      if (!input) continue;
      const label = document.querySelector(`label[for="${inputId}"]`);

      const estado = fm().densidade(node, campo);
      input.classList.remove('ev-fantasma', 'ev-meio');
      if (estado !== 'solido') input.classList.add(`ev-${estado}`);

      label?.querySelector('.ev-conferir')?.remove();
      label?.querySelector('.ev-selo')?.remove();
      if (!label) continue;

      const meta = node.fieldMeta?.[campo];
      if (!meta || meta.source !== 'agent') continue;

      if (meta.confirmed) {
        const selo = document.createElement('span');
        selo.className = 'ev-selo';
        selo.title = 'Escrito pelo agente e conferido por você';
        selo.textContent = '✓ conferido';
        label.appendChild(selo);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ev-conferir';
        btn.dataset.campo = campo;
        btn.title = ROTULO_EPISTEMICO[meta.epistemic] || 'Escrito pelo agente, ainda não conferido';
        btn.textContent = 'conferir';
        label.appendChild(btn);
      }
    }
  }

  const ROTULO_EPISTEMICO = {
    inferred: 'O agente DEDUZIU isto — ninguém afirmou. Confira antes de apresentar.',
    assumed: 'O agente SUPÔS isto, sem fonte declarada. Confira antes de apresentar.',
    reported: 'Alguém relatou isto ao agente. Confirme se procede.',
    prescribed: 'Isto veio de norma ou política, não da observação da operação.',
  };

  /** Densidade do card no canvas. */
  function marcarCard(node) {
    const el = document.getElementById(node.id);
    if (!el) return;
    el.classList.remove('ev-fantasma', 'ev-meio');
    const estado = fm().densidadeDoNo(node);
    if (estado !== 'solido') el.classList.add(`ev-${estado}`);
  }

  function marcarTodosOsCards() {
    for (const n of nodes) marcarCard(n);
  }

  // Delegação: o painel é reconstruído a cada seleção, listener por botão vazaria.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ev-conferir');
    if (!btn) return;
    e.preventDefault();
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;

    if (fm().confirmField(node, btn.dataset.campo)) {
      marcarPainel(node);
      marcarCard(node);
      saveToLocalStorage();
    }
  });

  window.AudasysEvidencia = { marcarPainel, marcarCard, marcarTodosOsCards };
})();
