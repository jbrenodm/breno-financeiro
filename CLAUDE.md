# CLAUDE.md — breno-financeiro

Instruções para agentes de IA (Claude Code) que trabalham neste repositório. Leia tudo antes de alterar código.

## O projeto

PWA **mobile-first** de controle financeiro pessoal do Breno e da Jaqueline. Substitui a planilha
"Controle Financeiro Pessoal – 2026". Registra um **valor por item por mês**. Não há lançamentos
individuais com data: essa foi uma escolha do usuário.

- **Fonte de dados:** uma planilha do **Google Sheets**, lida e gravada pela Sheets API v4 direto do navegador.
  Cada pessoa entra com a própria conta Google. O acesso é controlado pelo compartilhamento da planilha (Editor).
- **Ninguém edita a planilha à mão.** Toda alteração passa pelo app (celular ou desktop). A planilha tem proteção *com aviso*.
- Sem planilha conectada, o app funciona em **modo local**, com dados só no `localStorage`.
- Idioma: **tudo em português do Brasil** (interface, mensagens, comentários, commits, documentação). Moeda BRL e `Intl` com `pt-BR`.

## Stack e restrições

- **HTML + CSS + JavaScript puro, sem build, sem framework, sem dependências em runtime.** Não adicione React, Vue,
  bundler, TypeScript nem bibliotecas de UI ou gráficos sem o usuário pedir. Gráficos são SVG feitos à mão (`barChart` e `stackedChart` em `app.js`).
- Único script externo: Google Identity Services (`https://accounts.google.com/gsi/client`), carregado sob demanda.
- Hospedagem: GitHub Pages, publicado pela pasta `app/` via `.github/workflows/ci.yml`.
  URL: `https://jbrenodm.github.io/breno-financeiro/`.
- Dependências de desenvolvimento: só `@playwright/test`.

## Mapa do código

```
app/
  index.html        estrutura (topbar, <main id="view">, tabbar, toast, <dialog>)
  styles.css        tokens de cor em :root (claro) + dark mode; layout mobile-first
  sheets.js         carregado ANTES de app.js: GAuth (login), gapi(), SheetsApi (load/writeAll/writeValues/create),
                    headerValues() (fórmulas do Resumo), formatRequests() (formatação/proteção/gráficos), Sync (motor)
  app.js            dados/normalização, calcYear(), telas (renderMes/renderAno/renderGraficos/renderAjustes), Ajustes da planilha, boot
  sw.js             cache offline (rede primeiro); CACHE é trocado pelo commit no deploy
  manifest.webmanifest, icons/
scripts/serve.mjs   servidor estático sem dependências (npm run dev)
scripts/check_formulas.*  confere as fórmulas do Resumo no LibreOffice
tests/              Playwright: calculos.spec.js, sheets-sync.spec.js, sessao.spec.js, layout.spec.js, fake-sheets.js (API do Google simulada)
docs/               decisoes.md (por que as coisas são como são), backlog.md
```

Os dois scripts são clássicos (sem `type="module"`) e compartilham o escopo global: `data`, `settings`, `ui`,
`render()`, `toast()`, etc. ficam em `app.js`, e `Sync`, `GAuth`, `SheetsApi` em `sheets.js`. Mantenha assim, ou migre
os dois para ES modules de uma vez com aprovação do usuário. Não misture.

## Ambiente configurado (estado atual)

- **Repositório público** `jbrenodm/breno-financeiro`, licença MIT. Deploy pelo GitHub Actions → GitHub Pages
  (Settings → Pages → Source: GitHub Actions). A variável de repositório `GOOGLE_CLIENT_ID` já está configurada.
- **Google Cloud:** projeto próprio do app, com a Google Sheets API ativada, OAuth em **modo Teste** e apenas
  o e-mail do Breno e o da Jaqueline como usuários de teste.
  Cliente OAuth "Aplicativo da Web" com origens autorizadas `https://jbrenodm.github.io` e `http://localhost:8080`.
  Trocou a porta do `npm run dev` ou o domínio? A origem nova precisa ser cadastrada no cliente OAuth.
- **Segurança dos dados:** o código é público de propósito. A proteção dos dados vem de (1) OAuth em modo Teste com
  usuários de teste e (2) a planilha compartilhada só entre os dois. Nunca sugira publicar o app no modo "Em produção",
  compartilhar a planilha por link ("qualquer pessoa com o link") nem guardar dados, backups ou tokens no repositório.

## Modelo de dados (no app)

```js
data = { metaPct: 30, updatedAt, years: {
  2026: {
    receitaGroup: { id, nome: 'Receitas' },                 // grupo do tipo Receita
    receitas: [{ id, nome, valores: [12 números] }],         // fontes de receita
    grupos:   [{ id, nome, investimento: bool, itens: [{ id, nome, valores: [12] }] }],
  } } }
```
- IDs são aleatórios (`uid()`), únicos globalmente e **estáveis**: é por eles que o app acha a linha na planilha.
- **Nomes de grupo são únicos por ano**, incluindo "Receitas", porque o Resumo da planilha soma por nome. Use `groupNameTaken()`.

## Formato da planilha — contrato `cfp-1` (crítico)

| Aba | Colunas |
|---|---|
| `Itens` | A `ID` (oculta) · B `Ano` · C `Grupo` (nome) · D `Item` · E..P jan..dez · Q `Total ano` (fórmula `=SUM(E:P)` por linha) |
| `Grupos` | A `ID` (oculta) · B `Ano` · C `Grupo` · D `Tipo` = `Receita` \| `Despesa` \| `Investimento` |
| `Config` | B1 = % da receita · B2 = `cfp-1` (marca de formato) · D2.. = anos existentes |
| `Resumo` | só fórmulas; B1 = ano exibido (único campo livre); linhas 4–10 totais; 13–62 por grupo (FILTER) |
| `Gráficos` | TRANSPOSE do Resumo em A1:E13 + 2 gráficos |

Regras:
- **Mudou o formato? Então é uma versão nova** (`cfp-2`): troque `FORMAT_TAG`, escreva migração de `cfp-1` e teste.
  Planilhas reais já existem. Nunca quebre a leitura de uma planilha `cfp-1` existente.
- Valores são gravados com `valueInputOption: 'RAW'` (um nome como `=x` ou `+5` não pode virar fórmula). Só fórmulas usam `USER_ENTERED`.
- Fórmulas são escritas com sintaxe en-US (vírgula como separador, nomes em inglês), mesmo com a planilha em `pt_BR`.
- Fórmulas do Resumo mudaram? Rode `npm run check:formulas`. O teste compara a planilha com `calcYear()`.

## Regras de cálculo (devem bater entre app e planilha)

- Receitas = soma dos itens dos grupos `Receita`.
- **Despesas = todos os grupos de despesa, incluindo investimentos** (igual à planilha original).
- Investimentos = grupos `Investimento`. Gasto real = Despesas − Investimentos.
- Receitas − Investimentos; Saldo = Receitas − Despesas; "X% da receita" = Receitas × `metaPct` / 100.
- **Média = total ÷ meses com lançamento** (mês com receita ou despesa ≠ 0). A planilha antiga tinha erro aqui.
- Arredondamento com `round2()` em todo total.

## Sincronização (sheets.js → `Sync`) — não quebre estas garantias

1. **Valor de um item:** `Sync.setValue(item, mês, valor)`. Entra na fila `pending` (salva no localStorage), e um flush em ~600 ms
   relê a coluna de IDs (`Itens!A2:A`) e grava **só aquela célula**. Duas pessoas lançando ao mesmo tempo não se sobrescrevem.
2. **Mudança de estrutura** (criar/renomear/excluir/reordenar grupo ou item, ano, importar): `Sync.mutate(fn)`.
   Envia os pendentes, **relê a planilha**, aplica `fn(dadosFrescos)` e regrava tudo com `writeAll`.
   A `fn` só pode usar o objeto recebido e IDs, nunca objetos antigos de `data`. Retorne `false` para cancelar.
3. `writeAll` **grava primeiro e só depois limpa as sobras**. Nunca inverta a ordem: outra pessoa poderia ler a planilha vazia.
4. Todas as chamadas passam por `run()` (fila serial). Não faça chamadas à API fora dela.
5. Login: o token dura ~1 h e só pode ser pedido **dentro de um toque do usuário** (popup). Ao abrir, `GAuth.silent()` tenta renovar com `prompt: 'none'`; se falhar, o topo mostra "Não sincronizado" e o login fica em Ajustes e no botão Publicar. "Sair" (`Sync.logout`) revoga o acesso e desliga a renovação automática.
   Em handlers de clique, chame `await needAuth()` **antes** de qualquer `await dialog(...)`. Depois de um await, o navegador bloqueia o popup.
6. Pendente/Publicado: valores ficam em `pending` até a planilha confirmar. `savePending()` dispara o evento `cfp:pending`, que atualiza a barra e as marcações da aba Mês. `Sync.publish()` envia tudo (no toque em "Publicar", o login é pedido antes, se preciso). Estrutura exige conexão (mostra erro e não altera nada).
7. `renderSafe()` não re-renderiza enquanto um campo `.money` está em foco.

Escopo OAuth: `https://www.googleapis.com/auth/spreadsheets`. Não amplie (ex.: Drive inteiro) sem perguntar.
O Client ID não é segredo (vai no front-end). O deploy injeta a variável `GOOGLE_CLIENT_ID` do repositório em `DEFAULT_CLIENT_ID`.
Nunca coloque no repositório tokens, chaves secretas nem dados financeiros reais (`.gitignore` bloqueia xlsx/json/csv de backup).

## Interface

- Mobile-first: teste em 390 px de largura, sem rolagem horizontal. Alvos de toque ≥ 36 px. `inputmode="decimal"` nos valores.
- Cores só pelos tokens CSS (`--s-rec` azul = receitas, `--s-desp` laranja = gasto real, `--s-inv` verde-água = investimentos,
  `--pos`/`--neg` = saldo). Todo token novo precisa de versão clara **e** escura.
- Diálogos pelo `dialog()`, `confirmDlg()` e `promptDlg()`. Nunca use `alert`, `confirm` ou `prompt` nativos.
- Textos para o usuário em pt-BR simples. Erros da API viram mensagens claras (ver `gapi()`).

## Comandos

```bash
npm install                      # instala @playwright/test
npx playwright install chromium  # navegador dos testes (1ª vez)
npm run dev                      # http://localhost:8080
npm run check                    # sintaxe dos JS
npm test                         # testes Playwright (mobile, API do Google simulada)
npm run check:formulas           # opcional: requer LibreOffice + python3 + openpyxl
```

## Fluxo de trabalho esperado

1. Entenda o pedido; se mexer no formato da planilha, na sincronização ou no escopo OAuth, **explique o plano e peça confirmação**.
2. Faça a mudança mínima e coerente com o estilo existente (funções pequenas, sem dependências novas).
3. **Atualize/crie testes** em `tests/` (use `FakeSheets` para tudo que envolve a API). Rode `npm run check && npm test`.
4. Para mudança visual, abra no navegador em 390 px (claro e escuro) e confira.
5. Atualize `README.md` (uso) e `docs/decisoes.md` (se for decisão de arquitetura). Mova itens concluídos em `docs/backlog.md`.
6. Commits em português, no imperativo, curtos (ex.: `Adiciona filtro por grupo no Resumo`).
   Não faça push nem crie PR sem o usuário pedir.

## O que NÃO foi validado ainda

Os testes usam uma API simulada. Ainda falta confirmar com uma conta Google real (veja `docs/backlog.md`):
criação da planilha (formatação, proteção e gráficos), as fórmulas `FILTER`/`TRANSPOSE` no Sheets em `pt_BR` e o fluxo de login no iPhone/Android.
Se o usuário relatar problema nisso, comece por `formatRequests()` e `headerValues()` em `sheets.js`.
