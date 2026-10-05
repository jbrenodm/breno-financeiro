# Decisões de arquitetura

Registro curto do porquê das escolhas. Acrescente novas no topo, com data.

## 2026-10-05 — Repositório e site públicos (GitHub Pages)
- **Preocupação:** a segurança dos dados financeiros, não a visibilidade do código.
- **Alternativas consideradas:**
  - repo privado + GitHub Pro;
  - Cloudflare Pages com repo privado;
  - Cloudflare Access (restringir o site por e-mail);
  - servidor próprio;
  - app nativo (Capacitor/Electron).
- **Decisão:** manter público. Os dados nunca estão no código nem no site. Eles ficam na planilha, acessível só a quem
  (1) faz login no Google com e-mail cadastrado como usuário de teste e (2) tem a planilha compartilhada como Editor.
- **Consequências:**
  - o modo Teste do OAuth faz parte da segurança (não migrar para "Em produção");
  - se um dia for preciso restringir quem abre o app, o caminho mais simples é Cloudflare Pages + Access.

## 2026-10-05 — Google Sheets como fonte de dados
- **Contexto:** Breno e Jaqueline precisam ver e editar os mesmos dados. Ela também quer acesso à planilha.
- **Alternativas consideradas:**
  - JSON no Google Drive: com o escopo `drive.file`, quem recebe o compartilhamento não enxerga o arquivo sem o Google Picker. E a sincronização do arquivo inteiro gera conflito.
  - OneDrive.
  - Apps Script (sem offline, com aviso de "app de outro usuário").
  - Backend próprio (Firebase/Supabase).
- **Decisão:** PWA estático com a Sheets API. Cada usuário entra com a própria conta e o acesso vem do compartilhamento da planilha.
- **Consequências:**
  - Gravação célula a célula, sem conflito entre os dois.
  - O formato da planilha vira contrato (`cfp-1`).
  - É preciso um projeto no Google Cloud (OAuth em modo Teste, com usuários de teste).

## 2026-10-05 — Planilha normalizada (Itens/Grupos) + abas de visualização por fórmula
- O layout antigo (blocos fixos de 8 linhas por grupo, um arquivo por ano) é frágil para gravar pela API.
- Os dados ficam em formato de tabela (uma linha por item e ano). Resumo e Gráficos são só fórmulas.
- Ninguém edita à mão. Há proteção *com aviso*. A proteção rígida bloquearia o próprio app, que grava como o usuário.

## 2026-10-05 — Valor por item/mês (sem lançamentos individuais)
- O usuário escolheu manter o modelo da planilha: um valor consolidado por item em cada mês.

## 2026-10-05 — Correções de cálculo em relação à planilha original
- A média acumulada ignorava janeiro (`SUM(C:…)`). O "total" da média multiplicava por 11.
- **Nova regra:** média = total ÷ meses com lançamento.
- "Despesas" continua incluindo investimentos, como no original. O "gasto real" exclui.

## 2026-10-05 — Sem framework e sem build
- O app é pequeno, hospedado no GitHub Pages e mantido por uma pessoa com ajuda de IA.
- JS puro reduz a superfície de manutenção. Rever se o app crescer muito.
