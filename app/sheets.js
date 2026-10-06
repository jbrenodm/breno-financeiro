/* Camada Google Sheets: login, leitura/gravação e criação da planilha.
 * Carregado antes de app.js; usa as globais de app.js (data, settings, render…) só em tempo de execução.
 *
 * Formato da planilha (cfp-1)
 *   Itens   (dados)  A:ID  B:Ano  C:Grupo  D:Item  E..P:jan..dez  Q:Total ano (fórmula)
 *   Grupos  (dados)  A:ID  B:Ano  C:Grupo  D:Tipo (Receita | Despesa | Investimento)
 *   Config  (dados)  B1: % da receita   B2: "cfp-1"   D2..: anos existentes
 *   Resumo  (fórmulas) — escolha o ano em B1
 *   Gráficos (fórmulas + 2 gráficos)
 */
'use strict';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const FORMAT_TAG = 'cfp-1';
const SID = { resumo: 1, graficos: 5, itens: 2, grupos: 3, config: 4 };
const RESUMO_GRP_FIRST = 13, RESUMO_GRP_LAST = 62; // linhas do bloco "Por grupo" no Resumo
const colL = (i) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const authErr = () => Object.assign(new Error('Faça login no Google'), { code: 'auth' });

/* ---------- login (Google Identity Services, token de ~1h) ---------- */
const GAuth = (() => {
  let token = null, exp = 0, client = null, clientFor = '', pending = null, loading = null;
  const clientId = () => (settings.clientId || DEFAULT_CLIENT_ID).trim();
  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = res; s.onerror = () => { loading = null; rej(Object.assign(new Error('Sem conexão com o Google'), { code: 'offline' })); };
      document.head.appendChild(s);
    });
    return loading;
  }
  const valid = () => !!token && Date.now() < exp - 60000;
  /** interactive=true só dentro de um toque do usuário (pode abrir o popup do Google). */
  async function get(interactive = false) {
    if (valid()) return token;
    if (!interactive) throw authErr();
    return request(settings.authed ? '' : 'consent');
  }
  /** Tenta renovar sem janela (prompt 'none'). Resolve true se deu certo. */
  function silent() {
    if (valid()) return Promise.resolve(true);
    if (!settings.authed || !clientId()) return Promise.resolve(false);
    return request('none').then(() => true, () => false);
  }
  async function request(prompt) {
    if (!clientId()) throw new Error('Informe o Client ID em Ajustes');
    await loadGis();
    if (!client || clientFor !== clientId()) {
      clientFor = clientId();
      client = google.accounts.oauth2.initTokenClient({
        client_id: clientFor,
        scope: SHEETS_SCOPE,
        callback: (r) => {
          const p = pending; pending = null;
          if (r.error) { p?.rej(new Error(r.error_description || r.error)); return; }
          token = r.access_token; exp = Date.now() + (r.expires_in || 3600) * 1000;
          if (!settings.authed) { settings.authed = true; saveSettings(); }
          p?.res(token);
        },
        error_callback: (e) => { const p = pending; pending = null; p?.rej(new Error(e?.type === 'popup_closed' ? 'Login cancelado' : (e?.message || 'Falha no login'))); },
      });
    }
    return new Promise((res, rej) => {
      pending = { res, rej };
      client.requestAccessToken({ prompt });
    });
  }
  function clear() { token = null; exp = 0; }
  function revoke() { if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {}); clear(); settings.authed = false; saveSettings(); }
  return { get, silent, valid, clear, revoke, clientId };
})();

async function gapi(method, url, body) {
  const t = await GAuth.get(false);
  let r;
  try {
    r = await fetch(url, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw Object.assign(new Error('Sem conexão'), { code: 'offline' }); }
  if (r.status === 401) { GAuth.clear(); throw authErr(); }
  if (!r.ok) {
    let m = r.statusText;
    try { m = (await r.json()).error.message; } catch {}
    if (r.status === 403) m = 'Sem permissão nesta planilha (peça para compartilharem com você como Editor). ' + m;
    if (r.status === 404) m = 'Planilha não encontrada. ' + m;
    throw Object.assign(new Error(m), { status: r.status });
  }
  return r.status === 204 ? null : r.json();
}
const qs = (ranges) => ranges.map((r) => 'ranges=' + encodeURIComponent(r)).join('&');

/* ---------- conversão planilha <-> modelo do app ---------- */
function sheetToData(vr) {
  const [cfg, grp, itn] = vr.map((v) => v.values || []);
  if ((cfg[1] || [])[1] !== FORMAT_TAG) throw new Error('Esta planilha não está no formato do app (aba Config, célula B2 = cfp-1).');
  const d = { app: 'controle-financeiro', version: 1, updatedAt: Date.now(), metaPct: Number((cfg[0] || [])[1]) || 0, years: {} };
  const byName = new Map();
  const yearOf = (y) => (d.years[y] ||= { receitaGroup: null, receitas: [], grupos: [] });
  for (const [id, ano, nome, tipo] of grp) {
    const y = Number(ano); if (!y || !nome) continue;
    const Y = yearOf(y);
    if (tipo === 'Receita') {
      if (!Y.receitaGroup) Y.receitaGroup = { id: String(id || uid()), nome: String(nome) };
      byName.set(y + '|' + nome, 'rec');
    } else {
      const g = { id: String(id || uid()), nome: String(nome), investimento: tipo === 'Investimento', itens: [] };
      Y.grupos.push(g); byName.set(y + '|' + nome, g);
    }
  }
  for (const row of itn) {
    const [id, ano, gnome, inome] = row;
    const y = Number(ano); if (!y || !gnome) continue;
    const Y = yearOf(y);
    let g = byName.get(y + '|' + gnome);
    if (!g) { g = { id: uid(), nome: String(gnome), investimento: false, itens: [] }; Y.grupos.push(g); byName.set(y + '|' + gnome, g); }
    const item = { id: String(id || uid()), nome: String(inome ?? ''), valores: fix12(row.slice(4, 16)) };
    (g === 'rec' ? Y.receitas : g.itens).push(item);
  }
  for (const Y of Object.values(d.years)) if (!Y.receitaGroup) Y.receitaGroup = { id: uid(), nome: 'Receitas' };
  if (!Object.keys(d.years).length) d.years[new Date().getFullYear()] = defaultYear();
  return d;
}
function dataToRows(d) {
  const grupos = [], itens = [];
  for (const y of Object.keys(d.years).map(Number).sort((a, b) => a - b)) {
    const Y = d.years[y];
    grupos.push([Y.receitaGroup.id, y, Y.receitaGroup.nome, 'Receita']);
    Y.receitas.forEach((i) => itens.push([i.id, y, Y.receitaGroup.nome, i.nome, ...i.valores]));
    for (const g of Y.grupos) {
      grupos.push([g.id, y, g.nome, g.investimento ? 'Investimento' : 'Despesa']);
      g.itens.forEach((i) => itens.push([i.id, y, g.nome, i.nome, ...i.valores]));
    }
  }
  return { grupos, itens, anos: Object.keys(d.years).map(Number).sort((a, b) => a - b) };
}

/* ---------- operações na planilha ---------- */
const SheetsApi = {
  async load(id) {
    const r = await gapi('GET', `${SS_API}/${id}/values:batchGet?${qs(['Config!A1:B2', 'Grupos!A2:D', 'Itens!A2:P'])}&valueRenderOption=UNFORMATTED_VALUE`);
    return sheetToData(r.valueRanges);
  },
  /** Regrava Grupos/Itens/Config inteiros (usado em mudanças de estrutura). Escreve antes e só depois limpa as sobras, para nunca deixar a planilha vazia. */
  async writeAll(id, d) {
    const { grupos, itens, anos } = dataToRows(d);
    const ni = itens.length, ng = grupos.length;
    const data = [
      { range: 'Config!B1', values: [[d.metaPct]] },
      { range: `Config!D2:D${anos.length + 1}`, values: anos.map((a) => [a]) },
      { range: `Grupos!A2:D${ng + 1}`, values: grupos },
    ];
    if (ni) data.push({ range: `Itens!A2:P${ni + 1}`, values: itens });
    await gapi('POST', `${SS_API}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data });
    if (ni) await gapi('POST', `${SS_API}/${id}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data: [{ range: `Itens!Q2:Q${ni + 1}`, values: itens.map((_, k) => [`=SUM(E${k + 2}:P${k + 2})`]) }] });
    await gapi('POST', `${SS_API}/${id}/values:batchClear`, { ranges: [`Itens!A${ni + 2}:Q`, `Grupos!A${ng + 2}:D`, `Config!D${anos.length + 2}:D`] });
  },
  /** Grava só as células alteradas. Localiza a linha pelo ID na hora (outra pessoa pode ter mudado a ordem). */
  async writeValues(id, ops) {
    const r = await gapi('GET', `${SS_API}/${id}/values/${encodeURIComponent('Itens!A2:A')}?valueRenderOption=UNFORMATTED_VALUE`);
    const rowOf = new Map((r.values || []).map((v, k) => [String(v[0]), k + 2]));
    const data = [], missing = [];
    for (const op of ops) {
      const row = rowOf.get(op.id);
      if (!row) { missing.push(op); continue; }
      data.push({ range: `Itens!${colL(4 + op.m)}${row}`, values: [[op.v]] });
    }
    if (data.length) await gapi('POST', `${SS_API}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data });
    return { missing };
  },
  async writeMeta(id, pct) {
    await gapi('PUT', `${SS_API}/${id}/values/${encodeURIComponent('Config!B1')}?valueInputOption=RAW`, { values: [[pct]] });
  },
  /** Cria a planilha completa (abas, fórmulas, formatação, proteção e gráficos) e grava os dados atuais. */
  async create(d, title) {
    const sheet = (sheetId, t, index, rows, cols, frozenRowCount = 0, frozenColumnCount = 0) =>
      ({ properties: { sheetId, title: t, index, gridProperties: { rowCount: rows, columnCount: cols, frozenRowCount, frozenColumnCount } } });
    const ss = await gapi('POST', SS_API, {
      properties: { title, locale: 'pt_BR', timeZone: 'America/Sao_Paulo' },
      sheets: [
        sheet(SID.resumo, 'Resumo', 0, 70, 16, 3, 1),
        sheet(SID.graficos, 'Gráficos', 1, 40, 20, 1),
        sheet(SID.itens, 'Itens', 2, 3000, 17, 1, 4),
        sheet(SID.grupos, 'Grupos', 3, 500, 4, 1),
        sheet(SID.config, 'Config', 4, 60, 4),
      ],
    });
    const id = ss.spreadsheetId;
    const anoVisivel = d.years[ui.year] ? ui.year : Math.max(...Object.keys(d.years).map(Number));
    await gapi('POST', `${SS_API}/${id}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data: [...headerValues(anoVisivel)] });
    await this.writeAll(id, d);
    await gapi('POST', `${SS_API}/${id}:batchUpdate`, { requests: formatRequests() });
    return id;
  },
  /** Confere se as fórmulas do Resumo calcularam sem erro. */
  async check(id) {
    const r = await gapi('GET', `${SS_API}/${id}/values/${encodeURIComponent('Resumo!A2:P14')}`);
    return (r.values || []).flat().filter((v) => typeof v === 'string' && /^#(REF|NAME|VALUE|ERROR|N\/A|DIV)/.test(v));
  },
};

function headerValues(ano) {
  const months = MES_ABREV;
  const L = (k) => colL(2 + k); // C..N no Resumo
  const resumo = [];
  resumo.push(['Ano', ano, '← escolha o ano']);
  resumo.push(['Meses com lançamento', '=SUMPRODUCT(--(((C4:N4<>0)+(C7:N7<>0))>0))']);
  resumo.push(['Resumo', '', ...months, 'Total ano', 'Média']);
  const line = (label, f) => {
    const r = resumo.length + 1;
    resumo.push([label, '', ...months.map((_, k) => f(L(k), r)), `=SUM(C${r}:N${r})`, `=IF($B$2=0,0,O${r}/$B$2)`]);
  };
  const rng = (c) => `${c}$${RESUMO_GRP_FIRST}:${c}$${RESUMO_GRP_LAST}`;
  const tipo = `$B$${RESUMO_GRP_FIRST}:$B$${RESUMO_GRP_LAST}`;
  line('Receitas', (c) => `=SUMIFS(${rng(c)},${tipo},"Receita")`);                       // 4
  line('=Config!$B$1&"% da receita"', (c) => `=${c}4*Config!$B$1/100`);                   // 5
  line('Receitas − Investimentos', (c) => `=${c}4-${c}8`);                               // 6
  line('Despesas (inclui investimentos)', (c) => `=SUMIFS(${rng(c)},${tipo},"Despesa")+${c}8`); // 7
  line('Investimentos/Reserva', (c) => `=SUMIFS(${rng(c)},${tipo},"Investimento")`);      // 8
  line('Despesas − Investimentos (gasto real)', (c) => `=${c}7-${c}8`);                  // 9
  line('Receitas − Despesas (saldo)', (c) => `=${c}4-${c}7`);                            // 10
  resumo.push([]);
  resumo.push(['Por grupo', 'Tipo', ...months, 'Total ano', 'Média']);                    // 12
  for (let r = RESUMO_GRP_FIRST; r <= RESUMO_GRP_LAST; r++) {
    const row = r === RESUMO_GRP_FIRST
      ? ['=IFERROR(FILTER(Grupos!C2:C,Grupos!B2:B=$B$1),"")', '=IFERROR(FILTER(Grupos!D2:D,Grupos!B2:B=$B$1),"")']
      : ['', ''];
    months.forEach((_, k) => { const ic = colL(4 + k); row.push(`=IF($A${r}="","",SUMIFS(Itens!${ic}$2:${ic},Itens!$B$2:$B,$B$1,Itens!$C$2:$C,$A${r}))`); });
    row.push(`=IF($A${r}="","",SUM(C${r}:N${r}))`, `=IF(OR($A${r}="",$B$2=0),"",O${r}/$B$2)`);
    resumo.push(row);
  }
  const graf = [
    ['Mês', 'Receitas', 'Gasto real', 'Investimentos', 'Saldo'],
    ['=TRANSPOSE(Resumo!C3:N3)', '=TRANSPOSE(Resumo!C4:N4)', '=TRANSPOSE(Resumo!C9:N9)', '=TRANSPOSE(Resumo!C8:N8)', '=TRANSPOSE(Resumo!C10:N10)'],
  ];
  return [
    { range: `Resumo!A1:P${resumo.length}`, values: resumo.map((r) => { const a = r.slice(); while (a.length < 16) a.push(''); return a; }) },
    { range: 'Gráficos!A1:E2', values: graf },
    { range: 'Gráficos!G1', values: [['Ano exibido: escolha em Resumo!B1']] },
    { range: 'Itens!A1:Q1', values: [['ID', 'Ano', 'Grupo', 'Item', ...months, 'Total ano']] },
    { range: 'Grupos!A1:D1', values: [['ID', 'Ano', 'Grupo', 'Tipo']] },
    { range: 'Config!A1:D1', values: [['Percentual da receita (%)', 30, '', 'Anos']] },
    { range: 'Config!A2:B2', values: [['Formato (não alterar)', FORMAT_TAG]] },
    { range: 'Config!A4', values: [['Esta planilha é mantida pelo app Controle Financeiro. Edite pelo app.']] },
  ];
}

function formatRequests() {
  const R = (sheetId, r0, r1, c0, c1) => ({ sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
  const money = { numberFormat: { type: 'CURRENCY', pattern: '"R$" #,##0.00' } };
  const head = { textFormat: { bold: true }, backgroundColor: { red: 0.94, green: 0.94, blue: 0.92 } };
  const rgb = (h) => ({ red: parseInt(h.slice(1, 3), 16) / 255, green: parseInt(h.slice(3, 5), 16) / 255, blue: parseInt(h.slice(5, 7), 16) / 255 });
  const fmtCell = (range, f, fields) => ({ repeatCell: { range, cell: { userEnteredFormat: f }, fields } });
  const width = (sheetId, c0, c1, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c0, endIndex: c1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
  const hide = (sheetId, c0, c1) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c0, endIndex: c1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
  const protect = (sheetId, extra = {}) => ({ addProtectedRange: { protectedRange: { range: { sheetId }, description: 'Alterar pelo app Controle Financeiro', warningOnly: true, ...extra } } });
  const g = SID.graficos;
  const src = (c) => ({ sourceRange: { sources: [R(g, 0, 13, c, c + 1)] } });
  const chart = (title, cols, colors, row) => ({
    addChart: { chart: {
      spec: { title, basicChart: {
        chartType: 'COLUMN', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        axis: [{ position: 'BOTTOM_AXIS' }, { position: 'LEFT_AXIS' }],
        domains: [{ domain: src(0) }],
        series: cols.map((c, k) => ({ series: src(c), targetAxis: 'LEFT_AXIS', colorStyle: { rgbColor: rgb(colors[k]) } })),
      } },
      position: { overlayPosition: { anchorCell: { sheetId: g, rowIndex: row, columnIndex: 6 }, widthPixels: 680, heightPixels: 330 } },
    } },
  });
  return [
    // Resumo
    fmtCell(R(SID.resumo, 3, RESUMO_GRP_LAST, 2, 16), money, 'userEnteredFormat.numberFormat'),
    fmtCell(R(SID.resumo, 2, 3, 0, 16), head, 'userEnteredFormat(textFormat,backgroundColor)'),
    fmtCell(R(SID.resumo, 11, 12, 0, 16), head, 'userEnteredFormat(textFormat,backgroundColor)'),
    ...[3, 6, 9].map((r) => fmtCell(R(SID.resumo, r, r + 1, 0, 16), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat')),
    fmtCell(R(SID.resumo, 0, 1, 0, 2), { textFormat: { bold: true, fontSize: 12 }, backgroundColor: rgb('#cde2fb') }, 'userEnteredFormat(textFormat,backgroundColor)'),
    width(SID.resumo, 0, 1, 260), width(SID.resumo, 1, 2, 110), width(SID.resumo, 2, 16, 105),
    { setDataValidation: { range: R(SID.resumo, 0, 1, 1, 2), rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Config!$D$2:$D$60' }] }, showCustomUi: true, strict: true } } },
    { addConditionalFormatRule: { index: 0, rule: { ranges: [R(SID.resumo, 9, 10, 2, 16)], booleanRule: { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] }, format: { textFormat: { foregroundColor: rgb('#0f7a3d') }, backgroundColor: rgb('#e3f4e8') } } } } },
    { addConditionalFormatRule: { index: 1, rule: { ranges: [R(SID.resumo, 9, 10, 2, 16)], booleanRule: { condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0' }] }, format: { textFormat: { foregroundColor: rgb('#c62f2e') }, backgroundColor: rgb('#fbe5e5') } } } } },
    // Itens
    fmtCell(R(SID.itens, 1, 3000, 4, 17), money, 'userEnteredFormat.numberFormat'),
    fmtCell(R(SID.itens, 0, 1, 0, 17), head, 'userEnteredFormat(textFormat,backgroundColor)'),
    hide(SID.itens, 0, 1), width(SID.itens, 2, 4, 220), width(SID.itens, 4, 17, 100),
    { setBasicFilter: { filter: { range: R(SID.itens, 0, 3000, 0, 17) } } },
    // Grupos
    fmtCell(R(SID.grupos, 0, 1, 0, 4), head, 'userEnteredFormat(textFormat,backgroundColor)'),
    hide(SID.grupos, 0, 1), width(SID.grupos, 2, 3, 260), width(SID.grupos, 3, 4, 130),
    { setDataValidation: { range: R(SID.grupos, 1, 500, 3, 4), rule: { condition: { type: 'ONE_OF_LIST', values: ['Receita', 'Despesa', 'Investimento'].map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: true } } },
    // Config
    width(SID.config, 0, 1, 260),
    // Gráficos
    fmtCell(R(g, 1, 13, 1, 5), money, 'userEnteredFormat.numberFormat'),
    fmtCell(R(g, 0, 1, 0, 5), head, 'userEnteredFormat(textFormat,backgroundColor)'),
    chart('Receitas × Gasto real × Investimentos', [1, 2, 3], ['#2a78d6', '#eb6834', '#1baf7a'], 1),
    chart('Saldo mensal (Receitas − Despesas)', [4], ['#1c5cab'], 20),
    // Proteção com aviso: quem editar à mão recebe alerta; o app (API) grava normalmente.
    protect(SID.itens), protect(SID.grupos), protect(SID.config), protect(SID.graficos),
    protect(SID.resumo, { unprotectedRanges: [R(SID.resumo, 0, 1, 1, 2)] }),
  ];
}

/* ---------- motor de sincronização ---------- */
const PENDING_KEY = 'cfp:pending:v1';
const Sync = (() => {
  let status = 'local', message = '', timer = null, chain = Promise.resolve(), busy = 0, needsRender = false;
  let pending = (() => { try { return JSON.parse(safeGet(PENDING_KEY) || '[]'); } catch { return []; } })();
  const mode = () => (settings.sheetId ? 'sheet' : 'local');
  const savePending = () => { safeSet(PENDING_KEY, JSON.stringify(pending)); document.dispatchEvent(new Event('cfp:pending')); };
  const isPending = (id, m) => pending.some((p) => p.id === id && p.m === m);
  const cache = () => safeSet(STORAGE_KEY, JSON.stringify(data));
  const hhmm = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  function set(s, m = '') { status = s; message = m; paint(); }
  function fail(e) {
    if (e.code === 'auth') set('auth', pending.length ? `Toque para entrar e enviar ${pending.length} alteração(ões)` : 'Toque para entrar no Google');
    else if (e.code === 'offline') set('offline', `Sem conexão${pending.length ? ` — ${pending.length} alteração(ões) aguardando` : ''}`);
    else { set('error', e.message); toast(e.message); }
  }
  /** Serializa todas as operações com a planilha (uma de cada vez). */
  function run(fn) {
    const p = chain.then(async () => { busy++; paint(); try { return await fn(); } finally { busy--; paint(); } });
    chain = p.catch(() => {});
    return p;
  }
  /** Re-renderiza sem atrapalhar quem está digitando um valor. */
  function renderSafe() {
    if (document.activeElement?.classList?.contains('money')) {
      if (!needsRender) {
        needsRender = true;
        document.addEventListener('focusout', function h() {
          setTimeout(() => {
            if (document.activeElement?.classList?.contains('money')) return;
            document.removeEventListener('focusout', h); needsRender = false; render();
          }, 0);
        });
      }
    } else render();
  }
  function applyPending(d) {
    for (const op of pending) { const it = findItemIn(d, op.id); if (it) it.valores[op.m] = op.v; }
  }
  async function flushNow() {
    if (!pending.length) return;
    const ops = pending.slice();
    const { missing } = await SheetsApi.writeValues(settings.sheetId, ops);
    pending = pending.filter((p) => !ops.includes(p)); savePending();
    if (missing.length) toast(`${missing.length} valor(es) não gravado(s): o item foi removido por outra pessoa`);
  }

  /** Valor de um item num mês (operação mais comum). */
  function setValue(item, m, v) {
    item.valores[m] = v;
    data.updatedAt = Date.now(); cache();
    if (mode() === 'local') return;
    pending = pending.filter((p) => !(p.id === item.id && p.m === m));
    pending.push({ id: item.id, m, v }); savePending();
    clearTimeout(timer);
    if (!GAuth.valid()) { fail(authErr()); return; }
    set('pending', 'Enviando…');
    timer = setTimeout(() => run(flushNow).then(() => set('ok', `Salvo às ${hhmm()}`), fail), 600);
  }
  /** Baixa a planilha (enviando antes o que estiver pendente). */
  function refresh() {
    if (mode() === 'local') return Promise.resolve();
    return run(async () => {
      set('busy', 'Sincronizando…');
      await flushNow();
      const fresh = await SheetsApi.load(settings.sheetId);
      applyPending(fresh);
      data = fresh; cache();
      if (!data.years[ui.year]) ui.year = years().slice(-1)[0];
      renderSafe();
      set('ok', `Atualizado às ${hhmm()}`);
    }).catch(fail);
  }
  /** Mudança de estrutura: relê a planilha, aplica fn sobre os dados frescos e regrava. fn recebe os dados (não use objetos antigos). */
  async function mutate(fn) {
    if (mode() === 'local') { const r = fn(data); if (r === false) return false; data.updatedAt = Date.now(); cache(); render(); return true; }
    try {
      await GAuth.get(false);
      return await run(async () => {
        set('busy', 'Salvando…');
        await flushNow();
        const fresh = await SheetsApi.load(settings.sheetId);
        applyPending(fresh);
        if (fn(fresh) === false) { set('ok', message); return false; }
        await SheetsApi.writeAll(settings.sheetId, fresh);
        data = fresh; cache(); render();
        set('ok', `Salvo às ${hhmm()}`);
        return true;
      });
    } catch (e) {
      fail(e);
      if (e.code === 'auth') toast('Sessão do Google expirou. Toque em Entrar e tente de novo.');
      return false;
    }
  }
  async function setMeta(p) {
    if (mode() === 'local') { data.metaPct = p; cache(); return true; }
    try { await GAuth.get(false); await run(() => SheetsApi.writeMeta(settings.sheetId, p)); data.metaPct = p; cache(); set('ok', `Salvo às ${hhmm()}`); return true; } catch (e) { fail(e); return false; }
  }
  /** Para chamar dentro de um toque: garante o login (pode abrir o popup do Google). */
  async function login() {
    try { await GAuth.get(true); } catch (e) { fail(e); return false; }
    if (status === 'auth') refresh();
    return true;
  }
  async function createSheet() {
    return run(async () => {
      set('busy', 'Criando planilha…');
      const id = await SheetsApi.create(data, 'Controle Financeiro Pessoal');
      settings.sheetId = id; saveSettings(); pending = []; savePending();
      const errs = await SheetsApi.check(id).catch(() => []);
      set('ok', 'Planilha criada');
      return { id, errs };
    });
  }
  async function linkSheet(id) {
    return run(async () => {
      set('busy', 'Lendo planilha…');
      const fresh = await SheetsApi.load(id);
      settings.sheetId = id; saveSettings(); pending = []; savePending();
      data = fresh; cache();
      ui.year = data.years[ui.year] ? ui.year : years().slice(-1)[0];
      set('ok', `Atualizado às ${hhmm()}`);
    });
  }
  function disconnect() { settings.sheetId = ''; saveSettings(); pending = []; savePending(); GAuth.revoke(); set('local'); }
  function logout() { GAuth.revoke(); set('auth', 'Conta Google desconectada. Entre para sincronizar.'); }
  function paint() {
    const btn = $('#syncBtn'); if (!btn) return;
    btn.hidden = mode() === 'local';
    btn.classList.remove('busy', 'ok', 'warn');
    const st = busy && status !== 'auth' ? 'busy' : status;
    if (st === 'busy' || st === 'pending') btn.classList.add('busy');
    if (st === 'ok') btn.classList.add('ok');
    if (st === 'error' || st === 'auth' || st === 'offline') btn.classList.add('warn');
    $('#syncLabel').textContent = { busy: 'Sincronizando', pending: 'Sincronizando', ok: 'Sincronizado', auth: 'Não sincronizado', offline: 'Não sincronizado', error: 'Não sincronizado' }[st] || 'Planilha';
    btn.title = message;
    const banner = $('#authBanner'); if (banner) banner.hidden = status !== 'auth' || mode() === 'local';
    const line = $('#sheetStatus'); if (line) line.textContent = message || (mode() === 'sheet' ? 'Conectado' : 'Dados só neste aparelho');
  }
  /** Envia os pendentes. Chamar dentro de um toque: pede o login antes, se preciso. */
  function publish() {
    return run(async () => { set('pending', 'Publicando…'); await flushNow(); set('ok', `Publicado às ${hhmm()}`); }).catch(fail);
  }
  function boot() {
    setInterval(() => { if (mode() === 'sheet' && document.visibilityState === 'visible' && GAuth.valid() && !busy) refresh(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (mode() === 'sheet' && document.visibilityState === 'visible' && GAuth.valid()) refresh(); });
    if (mode() === 'local') set('local');
    else GAuth.silent().then((ok) => { if (ok) refresh(); else fail(authErr()); });
  }
  return { setValue, refresh, publish, mutate, setMeta, login, logout, createSheet, linkSheet, disconnect, paint, boot, mode, isPending, get pendingCount() { return pending.length; } };
})();
