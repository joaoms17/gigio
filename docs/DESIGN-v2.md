# Gigio v2.0 — linguagem visual "Hardware / setlist impresso"

A v1 era rosa→roxo, arredondada e "almofadada" (blocos cinzentos cheios, pílulas por todo o lado).
A v2 inspira-se em **equipamento de palco** e na **setlist impressa colada ao chão**:

- **Alumínio + tinta + UM laranja de sinal.** Nada de gradientes decorativos. Nada de rosa, nada de roxo.
- **Painéis brancos com hairlines** sobre fundo alumínio (claro) / preto (escuro). Plano, quase sem sombras.
- **Cantos secos**: 4 / 6 / 8 / 10 / 14px — nunca 16–24px, nunca pílulas (exceto avatares circulares).
- **Tipografia de cartaz**: Archivo condensado 800 nos títulos; Archivo normal no corpo;
  **JetBrains Mono** em micro-rótulos, números, durações, tons, datas.
- **Numeração de setlist** grande e tabular (`01`, `02`…) — a assinatura visual da app.

Todos os valores vivem em tokens em `src/index.css`. **Nunca** escrever hex da paleta à mão
(exceto cores de banda/projeto que vêm dos dados). **Nunca** `color-mix()` (iPadOS antigo) — usar os tokens `*-soft`.

---

## 1. Tokens (ver `src/index.css`)

| Papel | Token |
|---|---|
| Fundo da app | `--bg` (alumínio #ECEBE6 / preto #0B0B0C) |
| Painel, cartão, input, modal | `--surface` |
| Hover, linha selecionada, inset | `--surface-2` |
| Pressed, trilho, skeleton | `--surface-3` |
| Hairline / contorno forte | `--border` / `--border2` |
| Texto / secundário / terciário | `--text` / `--text2` / `--text3` |
| Acento (preenchimento) | `--accent` (+ `--accent-hover`) |
| Texto SOBRE acento | `--on-accent` (#111 — **nunca branco**) |
| Acento como texto | `--accent-text` |
| Fundo tintado de acento | `--accent-soft` |
| Anel de foco | `--ring` |
| Estados | `--danger` `--danger-soft` `--success-fg` `--success-soft` `--warn-fg` `--warn-soft` |

Aliases v1 (`--gig`, `--io`, `--amber`, `--bg2`, `--bg3`) existem só para compatibilidade — **substituir** ao tocar num ficheiro:
`--gig` como texto → `--accent-text`; `--gig` como preenchimento → `--accent` + `color: var(--on-accent)`;
`--io` → neutro (`--text2`) ou acento conforme o caso; `--bg2` → `--surface`; `--bg3` → `--surface-2`.

## 2. Tipografia

```css
/* Título de página (destino de navegação: "CONCERTOS", "REPERTÓRIO", "PALCO") */
.pageTitle { font-family: var(--font-display); font-stretch: 75%; font-weight: 800;
  font-size: clamp(34px, 6vw, 52px); line-height: 0.95; text-transform: uppercase; letter-spacing: -0.005em; }

/* Nome de entidade (concerto, música, projeto) — condensado, SEM maiúsculas forçadas */
.entityTitle { font-family: var(--font-display); font-stretch: 75%; font-weight: 800;
  font-size: clamp(28px, 4.5vw, 44px); line-height: 1; }

/* Micro-rótulo (secções, metadados, contagens) — a voz "hardware" */
.label { font-family: var(--font-mono); font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--text3); }

/* Número de setlist */
.num { font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--text3);
  font-variant-numeric: tabular-nums; }   /* renderizar sempre com 2 dígitos: 01, 02… */
```

- Corpo: 15–16px (17px em tablet), `--font-body`, peso 400/500; títulos de linha 600.
- Durações, tons (G, Em), datas curtas, contagens → `--font-mono`.
- Texto útil nunca < 12px; micro-rótulos mono ≥ 10px.

## 3. Componentes (receitas)

**Botão primário** — a ação principal do ecrã, no máximo 1–2 por ecrã
```css
background: var(--accent); color: var(--on-accent); border: none;
border-radius: var(--radius-btn); min-height: var(--btn-lg); padding: 0 22px;
font-weight: 700; font-size: 16px; letter-spacing: 0.01em;
/* hover: var(--accent-hover). SEM gradiente, SEM sombra colorida. */
```
A ação "Iniciar concerto" usa o primário com ícone ▶ SVG e pode ter `text-transform: uppercase` + `font-stretch: 85%`.

**Botão secundário**
```css
background: var(--surface); color: var(--text); border: 1px solid var(--border2);
border-radius: var(--radius-btn); min-height: var(--btn); padding: 0 16px; font-weight: 600; font-size: 14px;
/* hover: background var(--surface-2); border-color var(--text3) */
```

**Botão fantasma / ícone** — `background: transparent; color: var(--text2); border-radius: var(--radius-btn);`
44×44 mínimo; hover `var(--surface-2)`; ativo/selecionado `color: var(--text)` + fundo `var(--surface-3)`.

**Destrutivo** — nunca na "parede" de ações; texto `var(--danger)`, fantasma; confirmação sempre.

**Input**
```css
background: var(--surface); border: 1px solid var(--border2); border-radius: var(--radius-btn);
min-height: var(--input-h); padding: 0 14px; color: var(--text);
/* focus: border-color var(--text); box-shadow: 0 0 0 3px var(--ring); outline: none */
```

**Painel / cartão**
```css
background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
/* sem sombra; hover (se clicável): border-color var(--border2); active: background var(--surface-2) */
```

**Lista dentro de painel** (setlist, resultados, membros): linhas separadas por hairline
`border-top: 1px solid var(--border)` (primeira sem), **não** um cartão por linha.

**Chip / badge** — mono, seco
```css
font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
padding: 3px 6px; border-radius: var(--radius-xs);
/* neutro: background var(--surface-3); color var(--text2)
   tom musical: background transparent; border: 1px solid var(--border2); color var(--text) (sem uppercase no valor)
   sucesso/sync: background var(--success-soft); color var(--success-fg)
   aviso/rascunho/preparação: background var(--warn-soft); color var(--warn-fg)
   acento: background var(--accent-soft); color var(--accent-text) */
```

**Tabs / segmented** — trilho `var(--surface-3)` radius 8, opção ativa `var(--surface)` + texto `var(--text)`;
rótulos em mono 11px uppercase. Sem pílulas.

**Indicador de cor de banda/projeto** — quadrado 8–10px com `border-radius: 2px` (LED), nunca círculo.

**"Ao vivo"** — tag mono `● AO VIVO` com o quadrado em `var(--accent)` e `animation: livePulse 1.6s infinite`.

**Modal / sheet** — `--surface`, radius `--radius-lg`, borda `--border`, `--shadow-lg`; overlay `rgba(0,0,0,0.5)`;
título `.entityTitle` a 24–28px; botão fechar 44×44 fantasma com ✕ SVG.

**Empty state** — ícone SVG 28px em `--text3`, título condensado 22px, texto 15px `--text2`, 1 CTA.

**Skeleton** — classe global `.skeleton` (já em `--surface-2/3`).

## 4. Assinaturas (usar!)

1. **Numeração 01/02/03** em mono nas setlists (lista, painel, modo palco, PDF não).
2. **Micro-rótulos mono** por cima de cada secção: `ALINHAMENTO · 22 MÚSICAS · 1H18`.
3. **Linha de metadados mono** em vez de chips cheios: `28 SET · QUINTA DA RIBEIRA · 22 MÚS · 1H18`.
4. **Laranja só onde há ação ou estado vivo**: botão primário, item de navegação ativo (barra/quadrado),
   linha ativa no palco, foco, "ao vivo". Nunca como decoração de fundo.
5. **Marca** — componente `src/components/Wordmark.tsx`: `<Wordmark />` desenha "gigio" condensado 800 com os
   pontos dos dois "i" como **LEDs quadrados** `--accent`; `<BrandMark />` é o símbolo compacto "gi" em tile
   (tinta/invertido), igual ao ícone da app. Usar sempre os componentes — nunca redesenhar a marca à mão.
6. **Cores de projeto** — `mapLegacyProjectColor()` (`src/lib/projectColor.ts`) em qualquer LED/tile de banda;
   remapeia a paleta v1 guardada nos dados. Tema de concerto: `normalizeConcertTheme()` (`src/lib/concertTheme.ts`).

## 5. Navegação

- Rail (≥641px): fundo `--surface`, hairline à direita; itens 76×64 com ícone SVG + rótulo mono 10px uppercase;
  ativo = texto `--text` + barra vertical 3px `--accent` à esquerda do item. Marca no topo: `<BrandMark size={40} />`.
- Tab bar (≤640px): `--surface`, hairline em cima; ativo = ícone `--text` + traço 3px `--accent` por cima do ícone; rótulos mono 10px.

## 6. Modo palco (concerto)

Tema escuro próprio (o `concert_theme` do utilizador manda nas cores da letra). Defaults v2:
`bg #0B0B0C`, `active_color #F2F1EC`, `accent_color #FF6A26`.
Swatches sugeridos: `#FF6A26 #FFC24B #3DDC97 #4CC9F0 #F2F1EC`.
Header e footer em `--font-mono` para rótulos; contador `07 / 22`; tag `● AO VIVO`.

## 7. Regras de ouro

- Uma ação primária laranja por ecrã. O resto é secundário/fantasma.
- Se estás a pôr um fundo cinzento cheio num botão/input: pára — é `--surface` com hairline.
- Se estás a usar radius > 14px: pára.
- Se estás a escrever `#FF4D6D`, `#7C3AED`, `linear-gradient` decorativo ou `color-mix`: pára.
- Alvos de toque ≥ 44px. Contraste de texto ≥ 4.5:1 nos dois temas.
