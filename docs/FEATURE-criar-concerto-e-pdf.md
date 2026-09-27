# Criar concerto a partir do que a banda já tem + PDFs para palco

Pedido (dono da app): *"quando se vai criar concerto, uma das primeiras opções devia ser importar —
PDF, imagem ou texto; também escolher do repertório, ou copiar de um concerto anterior / playlist.
E os PDFs estão horríveis: o de repertório serve para quem ainda não está à vontade com a app fazer
scroll durante os concertos."*

Visual: segue sempre `docs/DESIGN-v2.md` (tokens, mono labels, numeração 01, um só primário laranja).

---

## Parte A — Criar concerto

### Diagnóstico do atual
- "Novo concerto" cria logo uma setlist vazia chamada "Novo Concerto" em 5 sítios diferentes
  (Palco, Concertos, Calendário, Dashboard do projeto, picker da Pesquisa) e depois abre a biblioteca.
  Palco e Calendário criam concertos **pessoais** (sem banda) — errado para uma banda.
- A importação só existe dentro de um concerto já criado, só aceita PDF, e **baralha a ordem**: as
  músicas já na biblioteca entram primeiro e as que é preciso procurar online vão para o fim.

### Novo fluxo: página `/concertos/novo` (dentro do Layout)
Query params opcionais de pré-preenchimento: `project=<bandId>`, `date=YYYY-MM-DD`.
Todos os pontos de entrada "Novo concerto" (Palco, Concertos, Calendário, Dashboard) navegam para aqui
(o picker da Pesquisa, que cria um concerto só para lá meter uma música, fica como está).

**Passo 1 — "COMO QUERES COMEÇAR?"** (é o primeiro ecrã: fontes grandes, importar primeiro)
- Topo: seletor "PARA: [Projeto ▾]" (projetos do utilizador + "Pessoal"); por defeito o `project` do
  URL, senão o único projeto, senão o último usado (localStorage `gigio-last-project`).
- Cartões de origem (grelha 2×2 em tablet, lista em telemóvel), por esta ordem:
  1. **IMPORTAR LISTA** — destacado (é o caminho mais comum). Três sub-ações lado a lado:
     `PDF` · `FOTO` (tirar foto — `capture="environment"` — ou escolher imagem/screenshot) · `TEXTO`
     (colar). Dica mono: "FOTO DE PAPEL, SCREENSHOT DE PLAYLIST OU MENSAGEM — UMA MÚSICA POR LINHA".
  2. **COPIAR CONCERTO** — "De um concerto anterior": lista dos concertos visíveis (do projeto escolhido
     primeiro, mais recentes primeiro) com data, nº de músicas; ao escolher, pré-visualiza 01–05.
     Opção (ligada por defeito): "Copiar também tom e notas de cada música".
  3. **DO REPERTÓRIO** — "Escolher músicas da banda": lista com pesquisa, multi-seleção; a ordem de
     seleção define a ordem (mostra o número 01, 02… no item selecionado).
  4. **COMEÇAR VAZIO** — link discreto.

**Passo 2 — "REVER E CRIAR"** (comum a todas as origens)
- Detalhes: Nome (obrigatório; pré-preenchido com o nome do ficheiro PDF/imagem sem extensão, ou
  "<concerto copiado> (cópia)"), Data (pré-preenchida do URL), Local (opcional).
- Lista numerada 01…N na ORDEM ORIGINAL, cada linha com estado:
  - `BIBLIOTECA` (verde) — encontrada no repertório (mostra o título da biblioteca se for diferente).
  - `NOVA · LETRA` (acento) — não está na biblioteca; melhor candidato online encontrado automaticamente
    em segundo plano (concorrência 3); mostra "Título — Artista" + fonte (LRCLIB/SYNC/GENIUS).
  - `A PROCURAR…` — pesquisa a decorrer.
  - `NOVA · SEM LETRA` (aviso) — sem resultados; será criada vazia (letra adiciona-se depois).
  - `SEM LIGAÇÃO` — pesquisa falhou por rede; idem, com "tentar de novo".
  Ações por linha: tocar abre um seletor para trocar a correspondência (outra música da biblioteca,
  outro resultado online, ou "criar vazia"); editar o nome (re-pesquisa); remover; subir/descer.
  Medleys ("A / B") viram linhas consecutivas marcadas `MEDLEY`.
- Primário: **CRIAR CONCERTO · 18 MÚSICAS**. Ao carregar: cria a setlist
  (`name, date, venue, band_id, owner_id, is_shared: !!band_id, status: 'draft'`), cria as músicas novas
  (com letra/sync quando escolhidas; vazias caso contrário; `project_id` = banda), e insere TODAS as
  `setlist_songs` com `position` 0…N-1 na ordem da lista (um insert em lote). Progresso "A CRIAR 07/18".
  Falhas individuais não param o resto; no fim toast com resumo e navega para `/setlist/:id`.

### Importar dentro de um concerto existente
O botão "Importar" da página do concerto usa o MESMO importador (PDF/Foto/Texto + a mesma revisão),
mas acrescenta ao fim do concerto, mantendo a ordem da lista importada.

### Motor de importação (`src/lib/setlistImport/`)
- `parseSetlistText(text) → Entry[]`: uma entrada por linha útil; remove numeração ("1.", "01)", "#3",
  "1 -"), durações ("3:45"), marcadores ("•", "-", "*"), tons entre parênteses/colchetes no fim
  ("(G)", "[Am]"), "(ao vivo)", emojis; ignora cabeçalhos (linhas curtas em maiúsculas tipo "SET 1",
  "INTERVALO", "ENCORE", datas, nomes de sala); separa medleys por " / " ou " + "; aceita
  "Título – Artista" e "Artista - Título" (guarda os dois lados para pesquisa).
- PDF: texto por linhas (pdf.js — reutilizar `extractSetlistFromPdf`, mas passando por `parseSetlistText`).
- Foto: OCR com `tesseract.js` carregado dinamicamente (`por+eng`), imagem reduzida a ≤2000px e em
  tons de cinzento antes do OCR, progresso visível; offline → erro claro ("precisa de internet").
  Letra manuscrita tem limites — dizer isso na dica.
- Correspondência: `normalizeTitle` + comparação por título (e artista quando existe) contra o
  repertório do projeto (ou pessoal); pesquisa online com `searchLrclib`/`searchGenius` + `matchScore`.
- Criação de músicas: helper partilhado (`createSongFromResult`, `createEmptySong`).

### Playlist (Spotify/YouTube)
Um link de playlist não se consegue ler só no browser (o Spotify/YouTube bloqueiam pedidos de outros
sites e exigem chave de API). Caminho já disponível: **screenshot da playlist → IMPORTAR › FOTO**.
Integração por link fica para uma Supabase Edge Function (servidor) numa próxima fase.

---

## Parte B — PDFs

### Diagnóstico do atual
HTML numa janela nova + diálogo de impressão: no iPad é desajeitado, o resultado depende do browser,
fontes de sistema, sem índice, sem navegação, letra pequena, título mal hierarquizado.

### Motor novo
- `jspdf` (carregado dinamicamente só ao exportar) + fontes estáticas da v2 embebidas
  (`src/lib/pdf/fonts/*.ttf`: Archivo Condensed ExtraBold, Archivo Regular/SemiBold, JetBrains Mono
  Medium/Bold — ~110 KB no total). A Archivo **não tem setas nem ▶** — desenhar como formas vetoriais.
- Construtor puro `buildSetlistPdf(data, options, fonts) → jsPDF` (sem React, testável em Node);
  invólucro no browser carrega as fontes e entrega o ficheiro.
- Entrega: gerar → sheet "PDF pronto" com **Partilhar** (Web Share com ficheiro — no iPad abre a folha
  de partilha: WhatsApp, Ficheiros…) e **Descarregar**; a partilha tem de ser um gesto novo do
  utilizador (o iOS recusa `share()` depois de trabalho assíncrono).
- Nomes: "<Concerto> — alinhamento.pdf", "<Concerto> — repertório.pdf".

### PDF "Alinhamento" (lista — imprimir e colar no palco / partilhar rápido)
A4 retrato. Cabeçalho: LED quadrado na cor do projeto + nome do projeto (mono), nome do concerto
(Archivo condensado 800, grande), linha mono "SÁB 28 SET 2026 · QUINTA DA RIBEIRA · 18 MÚSICAS · 1H18".
Lista numerada 01…N enorme e legível à distância: número mono, título Archivo SemiBold, tom à direita
em mono; intro/final/notas do concerto numa linha mono pequena por baixo. O tamanho da letra ajusta-se
para caber numa página até ~26 músicas (mínimo 14pt; acima disso pagina). Rodapé mono discreto.

### PDF "Repertório" (letras — para fazer scroll no tablet durante o concerto)
- **Página 1 = capa + índice**: nome do concerto, metadados; índice numerado com título, tom e página,
  **cada linha é um link** para a música. Continua nas páginas seguintes se necessário.
- **Cada música começa numa página nova**:
  - Barra de topo: "07 / 22 · Concerto" (mono) à esquerda; "↑ ÍNDICE" à direita (link para a pág. 1).
  - Título Archivo condensado 800 grande; artista; linha mono de chips TOM G · 104 BPM · CAPO 2
    (tom do concerto tem prioridade sobre o original).
  - Caixa de notas do concerto (intro / final / notas) com barra de acento à esquerda, quando existem.
  - Letra em Archivo Regular grande (Normal 16pt / Grande 20pt / Enorme 24pt), entrelinha ~1.45;
    `[Secção]` → rótulo mono maiúsculo no acento com espaço antes; linhas em branco → espaço de estrofe;
    linhas longas quebram com recuo; nunca deixar um rótulo de secção órfão no fundo da página.
  - Se continua na página seguinte: topo "07 / 22 · Título (cont.)".
  - No fim de cada música: "A SEGUIR · 08 · Título" (mono) — o cantor sabe o que vem.
- Marcadores do PDF (outline): um por música "07 · Título".
- Rodapé: "p. 12 / 48" mono.
- Opções no momento de exportar: **Tema** Claro (imprimir) / Escuro (palco — fundo preto, texto claro,
  acento laranja); **Tamanho da letra** Normal / Grande / Enorme; **Incluir acordes** (se existirem).
- Os PDFs de repertório da Biblioteca e do Projeto usam o mesmo construtor (sem dados de concerto).

### Verificação
- `scripts/pdf-shots.mjs`: gera PDFs de exemplo em Node (fixtures) e `scripts/pdf-render.mjs` converte
  páginas em PNG para revisão visual.
- `scripts/shots.sh` cobre `/concertos/novo`.
