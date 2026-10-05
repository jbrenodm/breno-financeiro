# Backlog

## Configuração (feito)
- [x] Repositório no GitHub, licença MIT, deploy no GitHub Pages pelo Actions.
- [x] Projeto no Google Cloud, Sheets API, OAuth em modo Teste, cliente Web com as origens.
- [x] Variável `GOOGLE_CLIENT_ID` no repositório.

## Validar com conta Google real (prioridade)
- [ ] Primeiro deploy verde (jobs test + deploy) e app abrindo em https://jbrenodm.github.io/breno-financeiro/.
- [ ] Criar a planilha pelo app e conferir no Sheets: formatação de moeda, colunas ocultas, proteção com aviso, validação de B1, os 2 gráficos.
- [ ] Conferir que `FILTER`/`TRANSPOSE`/intervalos abertos funcionam com a planilha em `pt_BR` (sem `#ERROR`).
- [ ] Testar o convite: Jaqueline com acesso de Editor → link → login → lançar.
- [ ] Testar o login no iPhone (PWA instalado / Safari) e no Android (Chrome instalado). Popups em app standalone.
- [ ] Mensagem amigável quando o e-mail não está em "Usuários de teste".

## Melhorias
- [ ] Renovação do acesso menos intrusiva (hoje: botão "Entrar" a cada ~1 h).
- [ ] Indicar no app quem alterou por último ou quando (exigiria coluna extra: decidir se muda o formato → `cfp-2`).
- [ ] Botão "Recriar abas de visualização" (reaplicar `headerValues`/`formatRequests` numa planilha existente) para corrigir fórmulas sem perder dados.
- [ ] Exportar o ano para .xlsx no layout da planilha antiga.
- [ ] Ícones dedicados (maskable) e tela de abertura.
