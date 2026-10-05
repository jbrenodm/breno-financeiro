# breno-financeiro — Controle Financeiro Pessoal

PWA + Google Sheets · [abrir o app](https://jbrenodm.github.io/breno-financeiro/)

App mobile-first que substitui a planilha *Controle Financeiro Pessoal – 2026*.
A **fonte dos dados é uma planilha do Google Sheets**: você e a Jaqueline lançam pelo app
(celular ou computador), cada um com a própria conta Google, e a planilha fica sempre atualizada.

## Telas

| Tela | O que faz |
|---|---|
| **Mês** | Valor de cada item no mês, agrupado como na planilha, e os totais do mês (saldo, receitas, despesas, gasto real, investimentos, 30% da receita) |
| **Resumo** | Igual à aba Resumo, mais a tabela anual de cada grupo (com total e média) |
| **Gráficos** | Receitas × gasto real × investimentos, saldo mensal e despesas por grupo |
| **Ajustes** | Grupos, itens e fontes de receita; novo ano; % da receita; conexão com a planilha; backup |

No campo de valor dá para digitar contas: `120+35,90`.

## A planilha nova (criada pelo app)

O app cria a planilha no seu Drive com 5 abas:

| Aba | Conteúdo |
|---|---|
| **Resumo** | Equivalente ao Resumo antigo, todo em fórmulas. Escolha o ano em **B1** |
| **Gráficos** | Receitas × Gasto real × Investimentos e Saldo mensal (atualizam sozinhos) |
| **Itens** | Os dados: Grupo, Item e jan…dez de cada ano (uma linha por item) + total |
| **Grupos** | Grupos de cada ano e o tipo: Receita, Despesa ou Investimento |
| **Config** | % da receita e lista de anos |

Correções em relação à planilha antiga:

- **Média** = total ÷ meses com lançamento. A antiga deixava janeiro de fora e multiplicava a média por 11 no “total”.
- **Sem limite** de 8 itens por grupo ou 7 fontes de receita. Também dá para criar grupos.
- **Todos os anos no mesmo arquivo**: você só compartilha um link, e o ano novo é criado pelo app.
- **Investimento é um tipo de grupo**, não uma linha fixa. Qualquer grupo pode ser marcado e sai do “gasto real”.
- O Resumo soma pelos nomes. Por isso o app não deixa dois grupos com o mesmo nome no mesmo ano.

**Não edite a planilha à mão.** As abas estão protegidas *com aviso*: se alguém tentar editar,
o Google alerta que deve ser feito pelo app. Só a célula B1 do Resumo (ano exibido) fica livre.
A planilha antiga tinha todos os valores zerados, então não há nada a migrar. Os grupos e itens dela já vêm no app.

## 1. Publicar o app (GitHub Pages)

O deploy é automático pelo GitHub Actions (`.github/workflows/ci.yml`): a cada push na `main`, os testes rodam e a pasta `app/` é publicada.

1. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Faça push na `main`. O app fica em `https://jbrenodm.github.io/breno-financeiro/`.
3. (Opcional) **Settings → Secrets and variables → Actions → Variables** → crie `GOOGLE_CLIENT_ID` com o Client ID.
   Assim ninguém precisa digitá-lo no app. O Client ID não é segredo.
4. No celular: Chrome → menu → **Instalar app**. No iPhone: Safari → Compartilhar → **Adicionar à Tela de Início**.

O cache do service worker é renovado automaticamente a cada deploy.

## 2. Google Cloud (uma vez só)

1. <https://console.cloud.google.com/> → crie um projeto (ex.: *Controle Financeiro*).
2. *APIs e serviços → Biblioteca* → ative a **Google Sheets API**.
3. *APIs e serviços → Tela de consentimento OAuth* → **Externo** → preencha nome e e-mail.
   - Em **Escopos** não precisa adicionar nada.
   - Em **Usuários de teste**, adicione **o seu e-mail e o da Jaqueline**.
   - Deixe em modo “Teste”. O Google mostrará “app não verificado”: clique em *Continuar*. Isso é normal para uso pessoal.
4. *Credenciais → Criar credenciais → ID do cliente OAuth* → **Aplicativo da Web**.
   - **Origens JavaScript autorizadas**: `https://jbrenodm.github.io` (sem a pasta, sem barra no final) e, para desenvolver, `http://localhost:8080`.
5. Copie o **Client ID** (`….apps.googleusercontent.com`).
   Coloque-o na variável `GOOGLE_CLIENT_ID` do repositório (passo 1.3) ou cole no app em Ajustes.

## 3. Primeiro uso (você)

1. Abra o app → **Ajustes → Planilha do Google Sheets** → cole o Client ID.
2. Toque em **Criar planilha no Google Sheets** e autorize com sua conta Google.
3. A planilha *Controle Financeiro Pessoal* aparece no seu Drive. Abra-a uma vez e confira se o Resumo não tem `#ERROR`.

## 4. Dar acesso à Jaqueline

1. Abra a planilha → **Compartilhar** → e-mail dela → **Editor**.
2. No app: **Ajustes → Enviar convite**. Isso manda um link do app que já leva o endereço da planilha e o Client ID.
3. Ela abre o link, toca em **Entrar** no topo e autoriza com a conta dela.

## Como a sincronização funciona

- Cada valor digitado é gravado **só naquela célula** da planilha em ~1 s. Os dois podem lançar ao mesmo tempo sem um apagar o do outro.
- Mudanças de estrutura (criar, renomear, excluir ou reordenar grupos e itens, criar ano) releem a planilha antes de gravar.
- O app busca novidades ao voltar para ele e a cada 1 minuto com a tela aberta.
- **Sem internet**, os valores ficam guardados no aparelho (“Offline”) e são enviados depois. Mudanças de estrutura precisam de internet.
- O acesso do Google dura ~1 hora. Depois disso aparece **Entrar** no topo: um toque renova o acesso.

## Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| “Sem permissão nesta planilha” | A planilha não foi compartilhada como **Editor** com essa conta |
| Erro `redirect_uri_mismatch` / `origin` no login | A origem do app não está em *Origens JavaScript autorizadas* |
| “Acesso bloqueado: app não concluiu verificação” | O e-mail não está em **Usuários de teste** |
| `#ERROR` no Resumo | Avise-me. As fórmulas foram testadas, mas a conta é criada no seu Google |

## Desenvolvimento

Requisitos: Node.js 20+.

```bash
npm install
npx playwright install chromium   # 1ª vez
npm run dev                       # http://localhost:8080
npm test                          # testes (celular simulado + API do Google simulada)
npm run check:formulas            # opcional: confere as fórmulas no LibreOffice (requer soffice + python3 + openpyxl)
```

Trabalhando com o Claude Code: as regras do projeto para o agente estão em [`CLAUDE.md`](CLAUDE.md).
Decisões de arquitetura ficam em [`docs/decisoes.md`](docs/decisoes.md) e pendências em [`docs/backlog.md`](docs/backlog.md).

## Estrutura

```
app/        o PWA publicado (index.html, styles.css, app.js, sheets.js, sw.js, manifest, ícones)
tests/      testes Playwright + simulação da Google Sheets API
scripts/    servidor local e conferência de fórmulas
docs/       decisões e backlog
```

## Licença

[MIT](LICENSE) © 2026 Breno
