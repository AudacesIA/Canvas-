#!/usr/bin/env bash
#
# Roda as suítes headless e devolve código de saída != 0 se alguma falhar.
#
# Cada página sobe o seu próprio daemon, numa porta e num AUDASYS_DATA_DIR
# isolados, com segredos efêmeros gerados na hora. Nunca a 8787 e nunca o data/
# de trabalho: teste que escreve no dado real é teste que você deixa de rodar.
#
# Sem --dump-dom e sem --virtual-time-budget: o EventSource do app impede o tempo
# virtual do Chrome de assentar e o dump nunca sai. O resultado vem pelo canal
# POST /api/_test-report, que só existe com AUDASYS_TEST=1.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
PORTA_BASE="${PORTA_BASE:-8890}"
SUITES=(overlays.html acesso.html cenarios.html login.html limite.html)
FALHAS=0

[ -x "$CHROME" ] || { echo "Chrome não encontrado em: $CHROME"; echo "Defina CHROME=/caminho/para/chrome"; exit 2; }

# A chave do Gemini é opcional: sem ela a remontagem por IA falha de propósito,
# e as suítes que não dependem dela continuam válidas.
[ -f "$RAIZ/.env" ] && set -a && . "$RAIZ/.env" && set +a

limpar() { rm -rf "$TMP"; }
trap limpar EXIT

espera_ms() { node -e "setTimeout(()=>process.exit(0),$1)"; }

roda_suite() {
  local pagina="$1" porta="$2"
  local chave="k$RANDOM$RANDOM"
  local relatorio="$TMP/rel-$porta.json"
  local dados="$TMP/dados-$porta"

  AUDASYS_TEST=1 \
  AUDASYS_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")" \
  AUDASYS_ADMIN_KEY="$chave" \
  AUDASYS_SERVICE_TOKEN="tok-$chave" \
  AUDASYS_RELATORIO="$relatorio" \
  GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
  AUDASYS_DATA_DIR="$dados" AUDASYS_PORT="$porta" AUDASYS_LOG=0 \
    node "$RAIZ/server/index.js" > "$TMP/servidor-$porta.log" 2>&1 &
  local spid=$!

  local i
  for i in $(seq 1 30); do
    curl -s -o /dev/null -m 1 "http://127.0.0.1:$porta/health" && break
    espera_ms 300
  done

  "$CHROME" --headless=new --disable-gpu --no-sandbox \
    --user-data-dir="$TMP/chrome-$porta" \
    "http://127.0.0.1:$porta/scripts/$pagina?k=$chave" > /dev/null 2>&1 &
  local cpid=$!

  for i in $(seq 1 75); do [ -f "$relatorio" ] && break; espera_ms 800; done
  kill "$cpid" "$spid" 2>/dev/null
  wait "$cpid" "$spid" 2>/dev/null

  echo "── $pagina ─────────────────────────────────────────"
  if [ ! -f "$relatorio" ]; then
    echo "  SEM RELATÓRIO — a página não concluiu. Log do servidor:"
    tail -5 "$TMP/servidor-$porta.log" | sed 's/^/    /'
    return 1
  fi
  local texto
  texto="$(node -e "process.stdout.write(require('$relatorio').text)")"
  echo "$texto" | sed 's/^/  /'
  echo "$texto" | grep -q '^FALHA' && return 1
  return 0
}

porta=$PORTA_BASE
for s in "${SUITES[@]}"; do
  [ -f "$RAIZ/scripts/$s" ] || { echo "── $s ── (ausente, pulando)"; porta=$((porta+1)); continue; }
  roda_suite "$s" "$porta" || FALHAS=$((FALHAS+1))
  porta=$((porta+1))
  echo
done

if [ "$FALHAS" -gt 0 ]; then
  echo "✗ $FALHAS suíte(s) com falha"
  exit 1
fi
echo "✓ todas as suítes passaram"
