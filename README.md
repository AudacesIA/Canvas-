# Audasys Canvas

Canvas de BPM dirigido por agente. Um daemon HTTP local é a fonte da verdade
(arquivos, validação, layout); um servidor MCP stdio, cliente fino sobre ele,
é o que o agente cérebro do Claude Desktop usa para propor alterações.

```
Claude Desktop ──stdio──▶ mcp/server.js ──HTTP──▶ server/index.js ──▶ data/clients/…
                                                       │
                    navegador ◀── estáticos + SSE ─────┘
```

## Rodar

```bash
npm start          # daemon em http://127.0.0.1:8787
npm run dev        # idem, com --watch
```

O daemon serve o app **e** a API na mesma origem — sem CORS, sem proxy para o
SSE. O antigo `python -m http.server 8085` não é mais necessário.

## Por que dois processos

O servidor MCP é filho do Claude Desktop: morre quando ele fecha e reinicia a
cada troca de Project. Se ele também servisse HTTP, **dois Projects abertos
seriam duas instâncias disputando a mesma porta e o mesmo arquivo JSON** — e
atender vários clientes é o caso de uso. Separado, o canvas continua no ar com
o Claude fechado, e trocar `FsStorage` por `SupabaseStorage` não toca em `mcp/`.

## Estrutura

| Caminho | Papel |
|---|---|
| `server/core/` | Toda a lógica: canvas, changesets, schema, ids, locks, layout |
| `server/storage/` | `Storage.js` é o contrato; `FsStorage` implementa em arquivo |
| `server/http/` | Roteador mínimo, estáticos, rotas. Sem Express |
| `mcp/` | Tradução tool→HTTP. Nunca toca em arquivo |
| `web/` | O app. `app.js` ainda é o monólito; vira módulos ES na F4 |
| `data/clients/<id>/` | `client.json`, `folders.json`, `canvases/`, `changesets/`, `docs/` |

**Não existe arquivo de índice de canvases.** A home é derivada de um listing
de `canvases/*.json` mais o cabeçalho de cada um. O `audaces_home` do
localStorage guardava nome e pasta em dois lugares e eles divergiam.

## Subprocesso (canvas filho)

Um nó pode conter um fluxo inteiro. Não é outro canvas em disco: vive **embutido
no JSON do nó pai**, em `node.childCanvas = { nodes, connections, nextNodeId }`,
com `node.subprocessMode = 'canvas'`. Um nível só — subprocesso dentro de
subprocesso é rejeitado na validação.

O agente cria pela op `proposeInChild` dentro de `propose_changeset`:

```json
{ "kind": "proposeInChild", "nodeId": "<id do pai>", "ops": [ "addNode, addEdge…" ] }
```

`applyOps` recursa sobre si mesmo com o `childCanvas` como se fosse um canvas —
o subprocesso ganha de graça reescrita de ids, proveniência e validação.

Na tela, o filho é revelado **dentro** do pai (`web/expand.js`): o card cresce,
mostra a miniatura e empurra os vizinhos. Editar continua sendo no canvas
dedicado, pelo painel de propriedades.

⚠️ **Armadilha que já custou 15 nós.** O patch SSE precisa levar `childCanvas`
dentro de `set`, não só em `node`: o cliente aplica apenas `op.set`
(`web/agent.js`). Sem isso o navegador fica com o subprocesso vazio em memória e
o primeiro autosave — que manda o documento inteiro — apaga os filhos do disco.
Sem 409, sem log, sem aviso. Vale para qualquer campo novo que um patch escreva.

## Camada de Medição: breakpoints

O canvas modela o processo; o breakpoint modela **onde ele é medido**. Vive em
`canvas.breakpoints`, ao lado de `nodes` e `connections` — não dentro do nó,
porque um breakpoint pode medir uma **aresta**, e aresta não tem dono. Medir a
passagem de bastão importa: é onde costuma estar o tempo parado.

```jsonc
{ "id": "bp_…", "alvo": { "tipo": "node" | "edge", "id": "…" },
  "oQueMede": "tempo entre embalar e coletar", "cadencia": "diaria",
  "consumidor": { "quem": "Coordenador", "comoChega": "painel" },
  "malha": "fechada",              // DERIVADA — nunca escrita
  "evidencia": "observed", "serie": [{ "em": "…", "valor": 27, "unidade": "dias" }] }
```

**`malha` é derivada de `consumidor.quem` e recusa escrita direta.** Sem alguém
que receba, a malha está aberta: o dado é coletado e não vai a lugar nenhum. É a
patologia que a camada existe para tornar visível — o alerta que cai num e-mail
que ninguém lê. `diagnose` acusa, e no mapa o **anel da bolinha fica tracejado**,
sem precisar de legenda.

A bolinha diz duas coisas sem ser aberta: o anel (malha fecha ou não) e o
preenchimento (força da evidência, mesma regra do resto do mapa). Clicar abre o
popover — a visão de reunião — e de lá se edita o que mede, a cadência e quem
recebe.

Ops: `addBreakpoint` · `updateBreakpoint` · `removeBreakpoint`.
Leitura: **`get_breakpoints`**, entregue no mesmo passo da escrita. O subprocesso
e os `refs` nasceram cegos e ficaram assim por meses; não se repete.

## Oportunidade de receita

`canvas.oportunidades`, ancoradas numa **aresta** — a receita que se perde mora
na passagem de bastão, onde ninguém é dono do prejuízo. Cada uma é
`{ titulo, markdown }`: bloco de notas livre, não formulário.

```jsonc
{ "id": "op_…", "arestaId": "conn_…", "titulo": "Reenvio proativo",
  "markdown": "## Onde está o dinheiro\n79 pedidos/mês…" }
```

No mapa o que se vê é um **asterisco verde** com "N oportunidades de receita"
embaixo. Clicar revela os cards, ligados a ele por setas verdes; clicar num card
abre o **bloco de notas**, com abas escrever/ler. Escondido por padrão porque
quatro camadas desenhando ao mesmo tempo viram árvore de Natal.

O card **se move como um nó**, e as setas acompanham. `x`/`y` em `null` significa
"nunca foi movido" — aí o card empilha a partir do asterisco; do primeiro arrasto
em diante, quem manda é o consultor. O mesmo gesto abre o bloco e move o card,
separados por distância: abaixo de 4px é clique.

Órfã é descartada na hidratação quando a passagem some. O modelo anterior
sobrevivia no dado e sumia da tela, porque a posição dependia da âncora existir —
dado invisível é pior que dado ausente.

**Markdown** é renderizado por `web/markdown.js`, ~90 linhas, sem dependência:
o projeto é local-first e uma biblioteca por CDN quebraria o uso offline. O
escape de HTML roda ANTES de qualquer transformação — é o único ponto do projeto
onde texto do usuário vira `innerHTML`. Consequência deliberada: HTML embutido
no Markdown não é interpretado. Link só aceita `http(s)`.

Ops: `addOportunidade` · `updateOportunidade` · `removeOportunidade`.
Leitura: **`get_oportunidades`**, com o corpo inteiro (o outline traz só títulos,
para não estourar o orçamento de token que justifica a existência dele).

`cenarioId` **não** é editável por op: quem o escreve é `criarCenario`, e o
autosave do navegador é impedido de apagá-lo em `saveCanvas`. Uma aba aberta
antes do cenário existir tem a oportunidade sem o vínculo em memória, e ela manda
o documento inteiro — é a mesma armadilha do `childCanvas`, e desta vez a guarda
está no servidor.

### Quatro marcas, uma aresta

Rótulo, barra de gargalo, bolinha de medição e asterisco disputam o ponto médio.
`pontoNaAresta()` (`web/app.js`) é o único lugar que decide o deslocamento de
cada faixa — três arquivos decidindo separadamente foi como todas acabaram
empilhadas no mesmo pixel.

## Gargalo na passagem

`connection.gargalo = { texto, categorias[] }`, espelhando `node.bottleneck` e
usando a **mesma taxonomia Lean**. Existe porque o handoff — o desperdício mais
caro do vocabulário — acontece ENTRE nós, e gargalo era campo do nó. Nesta base,
7 arestas no Canvas de Logística e 8 no Projeto Berenice trocam de dono.

No mapa é uma **barra vermelha inclinada** cruzando a linha, como se
interrompesse o fluxo. **Não interrompe nada**: a aresta continua ligando os dois
nós e nenhuma lógica muda. É sinalizador, e a leitura de "aqui trava" é o que se
quer numa reunião, sem legenda.

Clicar numa aresta abre um **menu**: medir a passagem, mapear o gargalo, editar o
rótulo. Antes o clique abria o rótulo direto — custa um clique a mais, e é o
preço de o elemento ter deixado de fazer uma coisa só.

O agente **lê** o gargalo da passagem no outline, mas não propõe: não existe op
`updateEdge`. Assimetria consciente.

## As duas etapas da consultoria

O consultor mapeia o processo real e seus gargalos; depois desenha, para cada
oportunidade de receita, o cenário que a testa. As duas etapas viviam em ilhas
separadas — oportunidade na tela, cenário só no MCP, sem nada ligando as duas.

```
gargalo ──▶ oportunidade de receita ──1:1──▶ cenário "e se" ──▶ comparação
 (nó ou      (asterisco na aresta)          (fork navegável)     (documento)
  aresta)
```

**Um cenário por oportunidade.** `derivadoDe.oportunidadeId` diz o que o cenário
pré-valida; `oportunidade.cenarioId` é a ponta de volta. Um segundo cenário para a
mesma oportunidade é **409**, e cenário sem `oportunidadeId` é **422** — um
desenho sem a pergunta que o originou não decide nada.

A contagem não pode divergir porque **não há uma segunda lista**. O mostrador
(`GET …/cenarios`) devolve uma linha por OPORTUNIDADE, com o cenário dela ou
`null`; quem itera aquilo não consegue exibir números diferentes. Cenário cuja
oportunidade foi apagada não some: sai em `orfaos`, porque um canvas em disco que
a tela não alcança é o mesmo dado invisível que o resto do projeto recusa.

O fork **já nasce idêntico** ao processo real (`seed`). O agente não redesenha o
cenário do zero — propõe só o que muda sob a premissa. Reconstruí-lo a partir do
Markdown seria um round-trip que perde `fieldMeta`, `metrics`, `childCanvas` e
procedência: **o documento é saída, nunca entrada.**

### Órfã com cenário sobrevive

A oportunidade cuja aresta some é descartada na hidratação — menos quando tem
cenário. Aí ela fica com `arestaId: null` e `desancorada: true`, e aparece no
mostrador marcada. Apagar uma aresta leva meio segundo; destruir o vínculo de um
canvas inteiro não pode ser efeito colateral silencioso disso.

Como a hidratação enxerga um canvas por vez, ela decide pelo cache `cenarioId`. O
mostrador **conserta a deriva** que encontrar, na leitura: a verdade é o
`derivadoDe` de cada cenário, e é contra ele que a tela resolve.

## Entregáveis em Markdown

Dois documentos, em `data/clients/<c>/docs/<canvasId>/`:

| Arquivo | O quê |
|---|---|
| `mapa.md` | O processo real: passos, gargalos de passo e de passagem, medições e malhas abertas, oportunidades, números apurados |
| `comparacao-<cenarioId>.md` | Real × cenário |

Ficam **fora do JSON do canvas**: são grandes, a tela não os desenha, e no
autosave e no patch SSE só custariam banda. Em arquivo são diffáveis entre
semanas — que é como a consultoria mostra o próprio avanço.

`GET …/docs/<nome>.md` devolve `text/markdown` cru, não JSON: o documento existe
para ser lido fora da ferramenta.

**A comparação tem dois autores, declarados no próprio arquivo.** A estrutura é
CONTADA pelo servidor (`comparador.js`); a leitura — pontos fortes, fracos,
veredito — é redigida pelo agente e chega por parâmetro. O daemon não fala com
nenhum LLM, e isso não é limitação de infraestrutura: é o que garante que todo
número do documento seja contado e nenhum seja gerado. Onde o comparador diz
"não comparável", o documento repete — dizer isso é informação.

Ops: nenhuma. Tools: **`gerar_mapa_gargalos`** · **`gerar_comparacao`**.

## Geometria é do servidor

O agente descreve topologia; `server/core/layoutService.js` (dagre) resolve x/y.
Posição vinda em `addNode` é **descartada** — o LLM posiciona sem enxergar o
resultado, e o mapa saía emaranhado. Na interface, o botão **Organizar** chama
`POST /api/clients/:c/canvases/:id/layout` e aplica o resultado; só no clique.

## Empresa = cliente = diretório

A "Empresa" da interface, o "cliente" do backend e o diretório em
`data/clients/` são a mesma coisa. Criar uma empresa cria um diretório; excluir
manda para `data/.trash/`. É esse `clientId` que a instrução do Project do
Claude Desktop fixa.

Não há migração do localStorage: os canvases antigos ficaram para trás por
decisão, e todo documento novo já nasce em schema v2.

## O agente

Registrado em `~/Library/Application Support/Claude/claude_desktop_config.json`
como `audasys-canvas`. O servidor MCP sobe o daemon sozinho se ele não estiver
no ar (`ensureDaemon`), destacado, para sobreviver ao fechamento do Desktop.

Dezesseis tools:

| | |
|---|---|
| `list_canvases` | empresas e canvases, com selo de proposta pendente |
| `get_canvas_outline` | o mapa em texto compacto (~1.5k tokens para 60 nós) |
| `get_vocabulary` | áreas e tipos de desperdício **desta** empresa |
| `get_canvas_stats` | lead time, tempo parado, custo anual do gargalo |
| `propose_changeset` | propõe alterações em blocos revisáveis |
| `suggest_layout` | calcula posições; não aplica |
| `get_breakpoints` | onde o processo é medido, e o que está em malha aberta |
| `get_oportunidades` | onde há dinheiro na mesa, com as notas inteiras |
| `criar_cenario` | forka o processo real para testar UMA oportunidade |
| `get_cenarios` | o pareamento: uma linha por oportunidade, com cenário ou sem |
| `comparar_cenario` | o que muda entre real e cenário, em estrutura |
| `gerar_mapa_gargalos` | escreve `mapa.md` |
| `gerar_comparacao` | escreve `comparacao-<cenarioId>.md` |
| `validate_canvas` | checagens estruturais e de legibilidade |
| `list_pending_proposals` | o que ficou esperando revisão |
| `focus_canvas` | destaca nós na tela do consultor |

A ordem em que elas se encadeiam é a da consultoria, e `get_cenarios` é o pivô:
ele diz o que já foi desenhado e o que falta.

```
get_canvas_outline → (mapear gargalos) → gerar_mapa_gargalos
                          ↓
                   get_oportunidades
                          ↓
   get_cenarios ──▶ criar_cenario ──▶ propose_changeset (no cenário)
                                              ↓
                            comparar_cenario ──▶ gerar_comparacao
```

**A metodologia não mora no MCP** — ela vive no Project do Claude Desktop. O MCP
é só a superfície de manipulação.

O ciclo: o agente lê o outline (texto compacto com aliases `n01`, ~1.5k tokens
para 60 nós) → propõe um changeset → o SSE entrega ao navegador → o card aparece
tracejado em verde → você aceita ou rejeita, no todo ou operação a operação.
**O canvas em disco não muda até o aceite.** Aplicados vão para
`changesets/archive/` com o `rationale` e a resolução de cada op — de onde veio
cada nó fica registrado.

Um nó criado pelo agente nasce **destravado**: você corrige por cima sem atrito.
Um campo que *você* tocou fica travado, e uma proposta sobre ele vem em vermelho,
pré-marcada para rejeitar — "Aceitar tudo" não atropela o que você escreveu.

## Teste ponta a ponta

```bash
AUDASYS_TEST=1 npm start
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  http://127.0.0.1:8787/scripts/e2e.html
# resultado em /tmp/audasys-e2e-report.json e no log do daemon
```

Carrega o app real num iframe e percorre o caminho inteiro: propor → SSE →
fantasma na tela → aceitar → nó sólido → persistido com id definitivo. Depois
cobre procedência, métricas tipadas, layout, `validate_canvas` e subprocesso.
**95 verificações.** Cria e apaga um cliente temporário.

O Chrome headless não encerra sozinho ao terminar; o resultado sai em
`/tmp/audasys-e2e-report.json` e no log do daemon antes disso.

## Teste de fumaça

```bash
npm start
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --dump-dom http://127.0.0.1:8787/scripts/selftest.html
```

O `<title>` da saída é `TUDO-OK` ou `FALHOU(n)`. Cobre unicidade de ids,
debounce (30 saves → 1 PUT), hidratação, derivação BPMN e detecção de conflito
por `rev`. Cria e apaga um cliente temporário.

## API

| Método | Rota |
|---|---|
| `GET` | `/health` |
| `GET` `POST` | `/api/clients` |
| `PATCH` `DELETE` | `/api/clients/:c` |
| `GET` | `/api/home` — tudo o que a tela inicial precisa |
| `GET` `POST` | `/api/clients/:c/canvases` |
| `GET` `PUT` `PATCH` `DELETE` | `/api/clients/:c/canvases/:id` |
| `POST` | `/api/clients/:c/canvases/:id/duplicate` · `/move` |
| `POST` | `/api/import` — semear canvas a partir de um JSON |
| `POST` `GET` | `/api/clients/:c/canvases/:id/cenarios` — criar · pareamento |
| `GET` | `/api/clients/:c/canvases/:id/comparar` — do CENÁRIO |
| `POST` | `/api/clients/:c/canvases/:id/docs/mapa` · `/docs/comparacao` |
| `GET` | `/api/clients/:c/canvases/:id/docs` · `/docs/:nome` (`text/markdown`) |

`GET` de canvas devolve `ETag: <rev>`; `PUT` aceita `If-Match: <rev>` e responde
**409** com `currentRev` se o canvas mudou. Duas abas, ou o agente escrevendo
enquanto você digita, recarregam em vez de sobrescrever.

Salvaguardas na leitura: campos ausentes são hidratados (o app fazia
`.trim()`/`.toLowerCase()` sem checar e quebrava a auditoria com JSON
importado) e arestas apontando para nós inexistentes são descartadas em vez de
virar linha invisível.

## Procedência: o que separa relato de inferência

O risco central da ferramenta não é técnico. Um mapa que mistura o que o
cliente disse com o que o agente deduziu, sem distinguir na tela, vira uma
afirmação sobre a operação que a consultoria não sustenta na reunião de
validação.

Por isso **cada campo** carrega quem escreveu (`source`), com que confiança
(`epistemic`) e se já foi conferido (`confirmed`). A regra:

- Você digita no painel → `user`, travado, confirmado.
- O agente escreve → `agent`, destravado. Sem `epistemic` declarado, vale
  **`inferred`** — a suposição conservadora é que ele deduziu.
- O agente propõe sobre campo que você tocou → conflito vermelho,
  pré-marcado para rejeitar. "Aceitar tudo" não atropela o que você escreveu.

### Preenchimento = evidência

A procedência não é um contador de texto: é como o mapa **parece**. Regra única,
válida para todo elemento — quanto mais sólido, mais forte a evidência. A escala
de 6 níveis do schema colapsa em 3 estados, porque a decisão do consultor é
ternária: dá para afirmar, dá para citar, ou é palpite.

| `epistemic` | Desenho |
|---|---|
| `documented`, `observed` | sólido |
| `reported` | meio tom |
| `inferred`, `assumed`, `prescribed` | contorno tracejado |

O efeito é o entregável: um canvas novo abre pálido e ganha densidade conforme a
consultoria apura. A captura da semana 1 ao lado da semana 12 explica o método
sem uma palavra.

**Confirmar é um gesto no campo**, não uma tela à parte — ritual em tela separada
ninguém cumpre. Ao lado do rótulo de um campo escrito pelo agente aparece
`conferir`; clicar marca `fieldMeta.confirmed` e o campo ganha densidade na hora.
Não muda o valor **nem a autoria**: a autoria continua sendo do agente, o que
muda é você ter conferido. Não existe rota para isso — `fieldMeta` viaja dentro
do nó e o autosave persiste.

O outline marca o não confirmado com `~`, para o agente parar de reler o próprio
palpite como fato apurado.

## Estado

G0–G7 concluídos. **95/95 no e2e.**

> A suíte ficou abortando na metade por um tempo: ela chamava `GET …/validation`,
> rota removida junto com o antigo modal de validação, e o `catch` único engolia
> a exceção. As ~25 checagens seguintes — métricas, layout, `validate_canvas` e
> subprocesso — nunca rodavam, e o número no README não batia com a execução.

Ver o plano de correção em `~/.claude/plans/o-que-eu-queria-shiny-rossum.md`.

Pendentes do plano original: modularização ES do `app.js` e undo/redo.
