/**
 * Renderizador de Markdown — subconjunto, próprio, sem dependência.
 *
 * Por que não usar `marked`: o projeto tem três dependências e é local-first —
 * o daemon roda em 127.0.0.1 e precisa funcionar com a máquina offline. Puxar
 * biblioteca por CDN trocaria isso por conveniência.
 *
 * ── SEGURANÇA ───────────────────────────────────────────────────────────────
 * O resultado vira `innerHTML`, e este é o ÚNICO ponto do projeto onde texto do
 * usuário chega ao DOM sem passar por `escapeHtml` na hora da interpolação.
 * Por isso o escape acontece PRIMEIRO, sobre o texto inteiro, antes de qualquer
 * transformação. Depois disso não existe mais `<` no material: as tags que
 * saem daqui são só as que este arquivo escreve.
 *
 * Consequência deliberada: HTML embutido no Markdown NÃO é interpretado. Quem
 * escrever `<b>` vê `<b>` na tela. É a troca certa — anotação de consultoria
 * não precisa de HTML, e a alternativa exigiria um sanitizador de verdade.
 *
 * Suporta: # ## ###, **negrito**, *itálico*, `código`, - lista, 1. lista,
 * > citação, [link](url), --- e parágrafos.
 */
(function () {
  'use strict';

  const escapar = (t) => String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /** Formatação dentro de uma linha. Roda DEPOIS do escape. */
  function inline(t) {
    return t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      // Só http(s): sem isso, `[x](javascript:…)` viraria link executável — o
      // escape não protege aqui, porque o href é atributo que nós escrevemos.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function render(texto) {
    const linhas = escapar(texto).split('\n');
    const out = [];
    let lista = null;   // 'ul' | 'ol' | null

    const fecharLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };

    for (const linha of linhas) {
      const l = linha.trim();

      if (!l) { fecharLista(); continue; }

      const titulo = l.match(/^(#{1,3})\s+(.*)$/);
      if (titulo) {
        fecharLista();
        const n = titulo[1].length + 2;   // # vira h3, ## h4, ### h5
        out.push(`<h${n}>${inline(titulo[2])}</h${n}>`);
        continue;
      }

      if (/^(---|\*\*\*)$/.test(l)) { fecharLista(); out.push('<hr>'); continue; }

      const item = l.match(/^[-*]\s+(.*)$/);
      if (item) {
        if (lista !== 'ul') { fecharLista(); out.push('<ul>'); lista = 'ul'; }
        out.push(`<li>${inline(item[1])}</li>`);
        continue;
      }

      const num = l.match(/^\d+\.\s+(.*)$/);
      if (num) {
        if (lista !== 'ol') { fecharLista(); out.push('<ol>'); lista = 'ol'; }
        out.push(`<li>${inline(num[1])}</li>`);
        continue;
      }

      const citacao = l.match(/^&gt;\s*(.*)$/);   // já escapado, então &gt;
      if (citacao) { fecharLista(); out.push(`<blockquote>${inline(citacao[1])}</blockquote>`); continue; }

      fecharLista();
      out.push(`<p>${inline(l)}</p>`);
    }
    fecharLista();
    return out.join('\n');
  }

  window.AudasysMarkdown = { render, escapar };
})();
