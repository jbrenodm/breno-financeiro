/* Controle Financeiro Pessoal — PWA
 * Fonte de dados: planilha do Google Sheets (ver sheets.js). Sem planilha conectada, os dados ficam só no aparelho.
 */
'use strict';

// Se preferir não digitar o Client ID na tela de Ajustes, cole-o aqui.
const DEFAULT_CLIENT_ID = '';

const STORAGE_KEY = 'cfp:data:v1';
const SETTINGS_KEY = 'cfp:settings:v1';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/* ---------- utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10);
const zeros = () => Array(12).fill(0);
const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dec = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n) => brl.format(n || 0);
const fmtNum = (n) => dec.format(n || 0);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function fmtShort(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (a >= 1e3) return (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return Math.round(n).toLocaleString('pt-BR');
}
function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }

/** Converte texto digitado em número. Aceita "1.234,56", "1234.56", "R$ 10", e somas: "100+50,5-20". */
function parseMoney(text) {
  let s = String(text ?? '').replace(/R\$|\s/g, '');
  if (!s) return 0;
  const parts = s.match(/[+-]?[^+-]+/g) || [];
  let total = 0;
  for (let p of parts) {
    let sign = 1;
    if (p[0] === '-') { sign = -1; p = p.slice(1); } else if (p[0] === '+') p = p.slice(1);
    if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
    else if ((p.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(p)) p = p.replace(/\./g, '');
    const v = parseFloat(p);
    if (isNaN(v)) return NaN;
    total += sign * v;
  }
  return round2(total);
}

/* ---------- dados ---------- */
function defaultYear() {
  const item = (nome) => ({ id: uid(), nome, valores: zeros() });
  const grupo = (nome, itens, investimento = false) => ({ id: uid(), nome, investimento, itens: itens.map(item) });
  return {
    receitaGroup: { id: uid(), nome: 'Receitas' },
    receitas: ['Breno', 'Jaqueline'].map(item),
    grupos: [
      grupo('Cartão de Crédito/Empréstimos', ['Nubank Breno', 'C6', 'BB', 'Shopee Breno', 'BB - Empréstimo Breno', 'Nubank Jaqueline', 'Shopee Jaqueline']),
      grupo('Pessoas', ['Pai', 'Marco Antônio']),
      grupo('Casa Valparaíso', ['Financiamento', 'Água', 'Energia', 'Condomínio', 'Manutenção']),
      grupo('Casa Candangolândia', ['Aluguel', 'Água', 'Energia', 'Internet', 'Manutenção']),
      grupo('Carro', ['Lavagem', 'Combustível', 'Manutenção 10km', 'Pai - Regularização Carro', 'Josely - Regularização Carro']),
      grupo('Mercado/Alimentação', ['Compra do Mês']),
      grupo('Investimentos/Reserva', ['Nubank Caixinha/Limite Garantido'], true),
      grupo('Entretenimento', ['Yudi - Jogo', 'Águas Correntes - Entrada']),
      grupo('Diversos', ['Internet Móvel Celular Breno', 'Geladeira Niva', 'Material Escolar Yudi', 'DAS']),
    ],
  };
}
function emptyData() {
  return { app: 'controle-financeiro', version: 1, updatedAt: Date.now(), metaPct: 30, years: { 2026: defaultYear() } };
}
/** Novo ano copiando a estrutura (fontes de receita, grupos e itens) de um ano existente, com valores zerados. */
function cloneStructure(year) {
  const it = (i) => ({ id: uid(), nome: i.nome, valores: zeros() });
  return {
    receitaGroup: { id: uid(), nome: year.receitaGroup?.nome || 'Receitas' },
    receitas: year.receitas.map(it),
    grupos: year.grupos.map((g) => ({ id: uid(), nome: g.nome, investimento: !!g.investimento, itens: g.itens.map(it) })),
  };
}
function validData(d) {
  return d && typeof d === 'object' && d.years && typeof d.years === 'object' && Object.keys(d.years).length > 0;
}
function normalize(d) {
  d.metaPct = Number.isFinite(+d.metaPct) ? +d.metaPct : 30;
  d.updatedAt = +d.updatedAt || Date.now();
  for (const y of Object.values(d.years)) {
    y.receitaGroup = { id: y.receitaGroup?.id || uid(), nome: y.receitaGroup?.nome || 'Receitas' };
    y.receitas = (y.receitas || []).map((i) => ({ id: i.id || uid(), nome: i.nome || '', valores: fix12(i.valores) }));
    y.grupos = (y.grupos || []).map((g) => ({
      id: g.id || uid(), nome: g.nome || '', investimento: !!g.investimento,
      itens: (g.itens || []).map((i) => ({ id: i.id || uid(), nome: i.nome || '', valores: fix12(i.valores) })),
    }));
  }
  return d;
}
function fix12(v) { const a = zeros(); (v || []).slice(0, 12).forEach((x, i) => { a[i] = Number(x) || 0; }); return a; }

let data = (() => {
  try { const d = JSON.parse(safeGet(STORAGE_KEY)); if (validData(d)) return normalize(d); } catch {}
  return emptyData();
})();
let settings = (() => {
  const base = { clientId: '', sheetId: '', authed: false, theme: 'auto' };
  try { return { ...base, ...JSON.parse(safeGet(SETTINGS_KEY) || '{}') }; } catch { return base; }
})();
function saveSettings() { safeSet(SETTINGS_KEY, JSON.stringify(settings)); }
function findItemIn(d, id) {
  for (const Y of Object.values(d.years)) {
    const it = Y.receitas.find((i) => i.id === id) || Y.grupos.flatMap((g) => g.itens).find((i) => i.id === id);
    if (it) return it;
  }
  return null;
}
/** Nomes de grupo precisam ser únicos no ano (a planilha soma por nome). */
function groupNameTaken(Y, name, exceptId) {
  const n = name.trim().toLowerCase();
  return (Y.receitaGroup.id !== exceptId && Y.receitaGroup.nome.toLowerCase() === n) || Y.grupos.some((g) => g.id !== exceptId && g.nome.toLowerCase() === n);
}

/* ---------- cálculos (equivalentes às fórmulas da planilha) ---------- */
function calcYear(y) {
  const Y = data.years[y];
  const receitas = zeros(), despesas = zeros(), invest = zeros();
  const grupos = Y.grupos.map((g) => {
    const tot = zeros();
    g.itens.forEach((i) => i.valores.forEach((v, m) => { tot[m] += v; }));
    tot.forEach((v, m) => { despesas[m] += v; if (g.investimento) invest[m] += v; });
    return { g, tot: tot.map(round2) };
  });
  Y.receitas.forEach((i) => i.valores.forEach((v, m) => { receitas[m] += v; }));
  const r = receitas.map(round2), d = despesas.map(round2), inv = invest.map(round2);
  return {
    receitas: r,
    meta: r.map((v) => round2(v * data.metaPct / 100)),
    recMenosInv: r.map((v, m) => round2(v - inv[m])),
    grupos,
    despesas: d,
    invest: inv,
    gastoReal: d.map((v, m) => round2(v - inv[m])),
    saldo: r.map((v, m) => round2(v - d[m])),
  };
}
/** Meses do ano com algum valor lançado — base da média (corrige a média da planilha, que ignorava janeiro). */
function monthsWithData(c) {
  let n = 0;
  for (let m = 0; m < 12; m++) if (c.receitas[m] || c.despesas[m]) n++;
  return n;
}
const avg = (arr, n) => (n ? round2(sum(arr) / n) : 0);

/* ---------- estado de UI ---------- */
const now = new Date();
const ui = {
  tab: 'mes',
  year: data.years[now.getFullYear()] ? now.getFullYear() : +Object.keys(data.years).sort().slice(-1)[0],
  month: now.getMonth(),
  open: new Set(JSON.parse(safeGet('cfp:open') || '[]')),
  anoView: 'resumo',
};
const years = () => Object.keys(data.years).map(Number).sort((a, b) => a - b);

/* ---------- toast & diálogos ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function dialog({ title, text = '', body = '', buttons = [{ label: 'OK', value: true, primary: true }] }) {
  const dlg = $('#dialog'), form = $('#dialogForm');
  form.innerHTML = `<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${body ? `<div class="dlg-body">${body}</div>` : ''}
    <div class="dlg-actions">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" value="${i}">${esc(b.label)}</button>`).join('')}</div>`;
  return new Promise((resolve) => {
    dlg.onclose = () => {
      const i = dlg.returnValue;
      const b = buttons[+i];
      const fields = {};
      $$('[name]', form).forEach((el) => { fields[el.name] = el.value; });
      resolve(b ? { value: b.value, fields } : { value: null, fields });
    };
    dlg.returnValue = '';
    dlg.showModal();
    const first = $('input', form); if (first) setTimeout(() => first.focus(), 50);
  });
}
async function confirmDlg(title, text, okLabel = 'Confirmar', danger = false) {
  const r = await dialog({ title, text, buttons: [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, primary: !danger, danger }] });
  return r.value === true;
}
async function promptDlg(title, label, value = '') {
  const r = await dialog({
    title,
    body: `<label class="field" style="padding:0"><span>${esc(label)}</span><input class="input" name="v" value="${esc(value)}" autocomplete="off"></label>`,
    buttons: [{ label: 'Cancelar', value: false }, { label: 'Salvar', value: true, primary: true }],
  });
  return r.value ? r.fields.v.trim() : null;
}

/* ---------- cabeçalho / navegação ---------- */
function renderHeader() {
  const per = $('#period');
  per.hidden = ui.tab === 'ajustes';
  $('#periodLabel').textContent = ui.tab === 'mes' ? `${cap(MESES[ui.month])} de ${ui.year}` : String(ui.year);
  const ys = years();
  const first = ys[0];
  $('#prevBtn').disabled = ui.tab === 'mes' ? (ui.year === first && ui.month === 0) : ui.year === first;
  $('#prevBtn').setAttribute('aria-label', ui.tab === 'mes' ? 'Mês anterior' : 'Ano anterior');
  $('#nextBtn').setAttribute('aria-label', ui.tab === 'mes' ? 'Próximo mês' : 'Próximo ano');
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
}
async function step(dir) {
  let y = ui.year, m = ui.month;
  if (ui.tab === 'mes') { m += dir; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } }
  else y += dir;
  if (!data.years[y]) {
    if (dir < 0) return;
    if (!(await needAuth())) return;
    const ok = await confirmDlg(`Criar o ano ${y}?`, `Os grupos, itens e fontes de receita de ${ui.year} serão copiados com valores zerados.`, `Criar ${y}`);
    if (!ok) return;
    const from = ui.year;
    const done = await Sync.mutate((d) => { if (!d.years[y]) d.years[y] = cloneStructure(d.years[from] || d.years[Math.max(...Object.keys(d.years).map(Number))]); });
    if (!done) return;
    toast(`Ano ${y} criado`);
  }
  ui.year = y; ui.month = m;
  render();
}
function render() {
  renderHeader();
  const v = $('#view');
  if (ui.tab === 'mes') renderMes(v);
  else if (ui.tab === 'ano') renderAno(v);
  else if (ui.tab === 'graficos') renderGraficos(v);
  else renderAjustes(v);
}

/* ---------- tela: Mês ---------- */
const chevron = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
function moneyInput(id, v, label) {
  return `<input class="money ${v ? '' : 'zero'}" inputmode="decimal" enterkeyhint="next" autocomplete="off" data-id="${id}" aria-label="${esc(label)}" value="${v ? fmtNum(v) : '0,00'}">`;
}
function groupCard(key, nome, tot, itens, badge = '') {
  const open = ui.open.has(key);
  return `<section class="card group ${open ? 'open' : ''}" data-key="${key}">
    <button class="group-head" type="button" aria-expanded="${open}">
      <span class="name">${chevron}<span class="t">${esc(nome)}</span>${badge}</span>
      <span class="total num" data-total="${key}">${fmt(tot)}</span>
    </button>
    <div class="group-body">
      ${itens.length ? itens.map((i) => `<div class="item"><label for="in-${i.id}">${esc(i.nome || '(sem nome)')}</label>${moneyInput(i.id, i.valores[ui.month], i.nome).replace('<input', `<input id="in-${i.id}"`)}</div>`).join('') : '<div class="empty">Nenhum item. Adicione em Ajustes.</div>'}
      <div class="group-foot"><span>Total no ano</span><span class="num" data-yeartotal="${key}"></span></div>
    </div>
  </section>`;
}
function renderMes(v) {
  const Y = data.years[ui.year];
  const m = ui.month;
  const c = calcYear(ui.year);
  v.innerHTML = `
    <section class="card" id="summary"></section>
    <div class="pend-bar" id="pendBar"></div>
    <h2 class="section-title">Receitas</h2>
    ${groupCard('rec', 'Receitas', c.receitas[m], Y.receitas)}
    <h2 class="section-title">Despesas</h2>
    ${Y.grupos.map((g, gi) => groupCard(g.id, g.nome, c.grupos[gi].tot[m], g.itens, g.investimento ? '<span class="badge">invest.</span>' : '')).join('')}
    <div class="row-actions" style="margin-top:16px">
      <button class="btn block" id="copyPrev" type="button">Copiar valores do mês anterior (só itens zerados)</button>
    </div>
    <p class="hint">Dica: no valor você pode digitar contas, ex.: <b>120+35,90</b>.</p>`;
  updateMesTotals();
  refreshPendingUI();

  $$('.group-head', v).forEach((h) => h.addEventListener('click', () => {
    const card = h.closest('.group'); const key = card.dataset.key;
    card.classList.toggle('open'); h.setAttribute('aria-expanded', card.classList.contains('open'));
    ui.open.has(key) ? ui.open.delete(key) : ui.open.add(key);
    safeSet('cfp:open', JSON.stringify([...ui.open]));
  }));
  const inputs = $$('.money', v);
  inputs.forEach((inp, idx) => {
    inp.addEventListener('focus', () => {
      const it = findItem(inp.dataset.id);
      inp.value = it && it.valores[ui.month] ? fmtNum(it.valores[ui.month]) : '';
      requestAnimationFrame(() => inp.select());
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const nx = inputs.slice(idx + 1).find((x) => x.offsetParent); nx ? nx.focus() : inp.blur(); }
    });
    inp.addEventListener('blur', () => commitInput(inp));
  });
  $('#copyPrev', v).addEventListener('click', copyPrevMonth);
}
/** Pendente = digitado mas ainda não gravado na planilha. Publicado = gravado. */
function refreshPendingUI() {
  const bar = $('#pendBar');
  if (bar) {
    const n = Sync.mode() === 'sheet' ? Sync.pendingCount : 0;
    bar.innerHTML = Sync.mode() !== 'sheet' ? '' : n
      ? `<span>${n} ${n === 1 ? 'valor pendente' : 'valores pendentes'}</span><button class="btn sm primary" id="publicar" type="button">Publicar</button>`
      : '<span>Tudo publicado</span>';
  }
  $$('.money').forEach((inp) => inp.classList.toggle('pend', Sync.isPending(inp.dataset.id, ui.month)));
}
async function publicar() {
  if (!GAuth.valid() && !(await Sync.login())) return;
  Sync.publish();
}
function findItem(id) {
  const Y = data.years[ui.year];
  return Y.receitas.find((i) => i.id === id) || Y.grupos.flatMap((g) => g.itens).find((i) => i.id === id);
}
function commitInput(inp) {
  const it = findItem(inp.dataset.id);
  if (!it) return;
  const val = parseMoney(inp.value);
  if (Number.isNaN(val)) { toast('Valor inválido'); inp.value = fmtNum(it.valores[ui.month]); return; }
  inp.value = fmtNum(val);
  inp.classList.toggle('zero', !val);
  if (val !== it.valores[ui.month]) {
    Sync.setValue(it, ui.month, val);
    updateMesTotals();
  }
}
function updateMesTotals() {
  const c = calcYear(ui.year), m = ui.month, Y = data.years[ui.year];
  const s = c.saldo[m];
  const metaPct = data.metaPct;
  $('#summary').innerHTML = `
    <div class="hero">
      <div class="label">Saldo do mês (Receitas − Despesas)</div>
      <div class="value num ${s > 0 ? 'pos' : s < 0 ? 'neg' : ''}">${fmt(s)}</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label"><i class="dot" style="background:var(--s-rec)"></i>Receitas</div><div class="value num">${fmt(c.receitas[m])}</div></div>
      <div class="stat"><div class="label">Despesas (total)</div><div class="value num">${fmt(c.despesas[m])}</div></div>
      <div class="stat"><div class="label"><i class="dot" style="background:var(--s-desp)"></i>Gasto real</div><div class="value num">${fmt(c.gastoReal[m])}</div></div>
      <div class="stat"><div class="label"><i class="dot" style="background:var(--s-inv)"></i>Investimentos</div><div class="value num">${fmt(c.invest[m])}</div></div>
      <div class="stat"><div class="label">Receitas − Invest.</div><div class="value num">${fmt(c.recMenosInv[m])}</div></div>
      <div class="stat"><div class="label">${fmtNum(metaPct).replace(',00', '')}% da receita</div><div class="value num">${fmt(c.meta[m])}</div></div>
    </div>`;
  const set = (key, mv, yv) => {
    const t = $(`[data-total="${key}"]`); if (t) t.textContent = fmt(mv);
    const y = $(`[data-yeartotal="${key}"]`); if (y) y.textContent = fmt(yv);
  };
  set('rec', c.receitas[m], sum(c.receitas));
  Y.grupos.forEach((g, gi) => set(g.id, c.grupos[gi].tot[m], sum(c.grupos[gi].tot)));
}
async function copyPrevMonth() {
  let py = ui.year, pm = ui.month - 1;
  if (pm < 0) { pm = 11; py--; }
  const P = data.years[py];
  if (!P) { toast('Não há mês anterior'); return; }
  const ok = await confirmDlg('Copiar do mês anterior?', `Itens com valor zero em ${MESES[ui.month]} receberão o valor de ${MESES[pm]}/${py}. Valores já preenchidos não mudam.`, 'Copiar');
  if (!ok) return;
  const Y = data.years[ui.year];
  // Em anos diferentes os IDs mudam; casa os itens pelo nome do grupo + nome do item.
  const prevMap = new Map();
  P.receitas.forEach((i) => prevMap.set('rec|' + i.nome, i.valores[pm]));
  P.grupos.forEach((g) => g.itens.forEach((i) => prevMap.set(g.nome + '|' + i.nome, i.valores[pm])));
  let n = 0;
  const apply = (key, i) => { const pv = prevMap.get(key); if (!i.valores[ui.month] && pv) { Sync.setValue(i, ui.month, pv); n++; } };
  Y.receitas.forEach((i) => apply('rec|' + i.nome, i));
  Y.grupos.forEach((g) => g.itens.forEach((i) => apply(g.nome + '|' + i.nome, i)));
  if (n) render();
  toast(n ? `${n} valor(es) copiado(s)` : 'Nada para copiar');
}

/* ---------- tela: Resumo anual ---------- */
function tableHTML(rows, c) {
  const nMeses = monthsWithData(c);
  const cur = ui.year === now.getFullYear() ? now.getMonth() : -1;
  const head = `<tr><th>${esc(rows.title)}</th>${MES_ABREV.map((m, i) => `<th class="${i === cur ? 'cur' : ''}">${m}</th>`).join('')}<th>Total ano</th><th>Média</th></tr>`;
  const body = rows.items.map((r) => `<tr class="${r.strong ? 'strong' : ''}"><td title="${esc(r.label)}">${esc(r.label)}</td>${r.vals.map((v, i) => `<td class="num ${i === cur ? 'cur' : ''} ${r.colored ? (v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted') : v ? '' : 'muted'}">${fmtNum(v)}</td>`).join('')}<td class="num ${r.colored ? (sum(r.vals) > 0 ? 'pos' : sum(r.vals) < 0 ? 'neg' : '') : ''}">${fmtNum(sum(r.vals))}</td><td class="num">${fmtNum(avg(r.vals, nMeses))}</td></tr>`).join('');
  return `<div class="card"><div class="table-wrap"><table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>
    <p class="hint">Média = total ÷ meses com lançamento (${nMeses} ${nMeses === 1 ? 'mês' : 'meses'}). Role a tabela para o lado.</p>`;
}
function renderAno(v) {
  const Y = data.years[ui.year], c = calcYear(ui.year);
  const tabs = [['resumo', 'Resumo'], ['receitas', 'Receitas'], ...Y.grupos.map((g) => [g.id, g.nome])];
  if (!tabs.find((t) => t[0] === ui.anoView)) ui.anoView = 'resumo';
  let rows;
  if (ui.anoView === 'resumo') {
    rows = {
      title: 'Resumo', items: [
        { label: 'Receitas', vals: c.receitas, strong: true },
        { label: `${fmtNum(data.metaPct).replace(',00', '')}% Receita`, vals: c.meta },
        { label: 'Receitas − Investimentos', vals: c.recMenosInv },
        ...c.grupos.map(({ g, tot }) => ({ label: g.nome, vals: tot })),
        { label: 'Despesas', vals: c.despesas, strong: true },
        { label: 'Despesas − Investimentos', vals: c.gastoReal },
        { label: 'Receitas − Despesas', vals: c.saldo, strong: true, colored: true },
      ],
    };
  } else if (ui.anoView === 'receitas') {
    rows = { title: 'Receitas', items: [...Y.receitas.map((i) => ({ label: i.nome, vals: i.valores })), { label: 'TOTAL MÊS', vals: c.receitas, strong: true }] };
  } else {
    const gi = Y.grupos.findIndex((g) => g.id === ui.anoView);
    const g = Y.grupos[gi];
    rows = { title: g.nome, items: [...g.itens.map((i) => ({ label: i.nome, vals: i.valores })), { label: 'TOTAL MÊS', vals: c.grupos[gi].tot, strong: true }] };
  }
  v.innerHTML = `<div class="seg" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-k="${k}" class="${k === ui.anoView ? 'active' : ''}" aria-selected="${k === ui.anoView}">${esc(l)}</button>`).join('')}</div>${tableHTML(rows, c)}`;
  $$('.seg button', v).forEach((b) => b.addEventListener('click', () => { ui.anoView = b.dataset.k; renderAno(v); }));
  const act = $('.seg .active', v); if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

/* ---------- tela: Gráficos ---------- */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}
function renderGraficos(v) {
  const c = calcYear(ui.year);
  const Y = data.years[ui.year];
  const totAno = c.grupos.map(({ g, tot }) => ({ nome: g.nome, inv: g.investimento, v: sum(tot) })).sort((a, b) => b.v - a.v);
  const maxG = Math.max(1, ...totAno.map((t) => t.v));
  const hasData = monthsWithData(c) > 0;
  v.innerHTML = `
    <section class="card">
      <div class="stats two">
        <div class="stat"><div class="label"><i class="dot" style="background:var(--s-rec)"></i>Receitas do ano</div><div class="value">${fmt(sum(c.receitas))}</div></div>
        <div class="stat"><div class="label"><i class="dot" style="background:var(--s-desp)"></i>Despesas do ano</div><div class="value">${fmt(sum(c.despesas))}</div></div>
      </div>
    </section>
    <div class="g-bloco">
      <h2 class="section-title">Receitas × Despesas e Investimentos</h2>
      <section class="card">
        <div class="legend"><span><i style="background:var(--s-rec)"></i>Receitas</span><span><i style="background:var(--s-desp)"></i>Gasto real</span><span><i style="background:var(--s-inv)"></i>Investimentos</span></div>
        <div class="chart" id="ch1"></div>
      </section>
    </div>
    <div class="g-bloco">
      <h2 class="section-title">Receitas, despesas e investimentos por mês</h2>
      <section class="card">
        <div class="legend"><span><i style="background:var(--s-rec)"></i>Sobra de receita</span><span><i style="background:var(--s-desp)"></i>Gasto real</span><span><i style="background:var(--s-inv)"></i>Investimentos</span></div>
        <div class="chart" id="ch2"></div>
      </section>
    </div>
    <div class="g-bloco">
      <h2 class="section-title">Despesas por grupo em ${ui.year}</h2>
      <section class="card">
        ${hasData ? `<div class="hbar">${totAno.map((t) => `<span>${esc(t.nome)}</span><span class="num">${fmt(t.v)}</span><div class="bar ${t.inv ? 'inv' : ''}"><span style="width:${(t.v / maxG) * 100}%"></span></div>`).join('')}</div>` : '<div class="empty">Sem lançamentos neste ano.</div>'}
      </section>
    </div>`;
  barChart($('#ch1', v), c);
  stackedChart($('#ch2', v), c);
}
function barChart(el, c) {
  const W = 360, H = 200, L = 40, R = 6, T = 8, B = 22;
  const iw = W - L - R, ih = H - T - B, bw = iw / 12;
  const max = Math.max(...c.receitas, ...c.despesas);
  const span = niceMax(Math.max(max, 100));
  const y = (val) => T + ih * (1 - val / span);
  let g = '';
  const ticks = [span, span * 0.75, span * 0.5, span * 0.25, 0];
  ticks.forEach((t) => { g += `<line class="${t === 0 ? 'axis' : 'gridline'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`; });
  const bar = (x, y1, y2, w, color, roundTop = true) => {
    const h = Math.abs(y2 - y1); if (h < 0.5) return '';
    const yy = Math.min(y1, y2), r = Math.min(3, h, w / 2);
    // canto arredondado só na extremidade livre (longe da linha de base)
    if (roundTop) return `<path d="M${x},${yy + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + w - r} Q${x + w},${yy} ${x + w},${yy + r} V${yy + h} Z" fill="${color}"/>`;
    return `<path d="M${x},${yy} V${yy + h - r} Q${x},${yy + h} ${x + r},${yy + h} H${x + w - r} Q${x + w},${yy + h} ${x + w},${yy + h - r} V${yy} Z" fill="${color}"/>`;
  };
  for (let m = 0; m < 12; m++) {
    const x0 = L + m * bw;
    {
      const w = Math.min(10, bw * 0.34), gap = 2;
      const xa = x0 + bw / 2 - w - gap / 2, xb = x0 + bw / 2 + gap / 2;
      g += bar(xa, y(0), y(c.receitas[m]), w, 'var(--s-rec)');
      const gr = c.gastoReal[m], inv = c.invest[m];
      if (inv > 0 && gr > 0) {
        // segmento de baixo reto; 2px de respiro; segmento de cima com canto arredondado
        g += `<rect x="${xb}" y="${y(gr)}" width="${w}" height="${Math.max(0, y(0) - y(gr))}" fill="var(--s-desp)"/>`;
        if (y(gr) - y(gr + inv) > 2.5) g += bar(xb, y(gr) - 2, y(gr + inv), w, 'var(--s-inv)');
      } else if (gr > 0) g += bar(xb, y(0), y(gr), w, 'var(--s-desp)');
      else if (inv > 0) g += bar(xb, y(0), y(inv), w, 'var(--s-inv)');
    }
    g += `<text x="${x0 + bw / 2}" y="${H - 6}" text-anchor="middle">${MES_ABREV[m]}</text>`;
    g += `<rect class="hit" data-m="${m}" x="${x0}" y="${T}" width="${bw}" height="${ih}" rx="4"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas, gasto real e investimentos por mês">${g}</svg><div class="tip"></div>`;
  wireTip(el, (m) => [['Receitas', c.receitas[m]], ['Gasto real', c.gastoReal[m]], ['Investimentos', c.invest[m]], ['Despesas (total)', c.despesas[m]]]);
}
function stackedChart(el, c) {
  const W = 360, H = 240, L = 40, R = 6, T = 8, B = 22;
  const iw = W - L - R, ih = H - T - B, bw = iw / 12;
  const span = niceMax(Math.max(100, ...c.receitas.map((r, m) => Math.max(r, c.despesas[m]))));
  const y = (val) => T + ih * (1 - val / span);
  let g = '';
  [span, span * 0.75, span * 0.5, span * 0.25, 0].forEach((t) => {
    g += `<line class="${t === 0 ? 'axis' : 'gridline'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`;
  });
  for (let m = 0; m < 12; m++) {
    const x0 = L + m * bw, w = Math.min(18, bw * 0.7), x = x0 + (bw - w) / 2;
    let base = 0;
    const sobra = Math.max(0, c.receitas[m] - c.despesas[m]);
    [[c.invest[m], 'var(--s-inv)'], [c.gastoReal[m], 'var(--s-desp)'], [sobra, 'var(--s-rec)']].forEach(([v, color]) => {
      if (v <= 0) return;
      g += `<rect x="${x}" y="${y(base + v)}" width="${w}" height="${y(base) - y(base + v)}" rx="2" fill="${color}"/>`;
      base += v;
    });
    g += `<text x="${x0 + bw / 2}" y="${H - 6}" text-anchor="middle">${MES_ABREV[m]}</text>`;
    g += `<rect class="hit" data-m="${m}" x="${x0}" y="${T}" width="${bw}" height="${ih}" rx="4"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas, despesas e investimentos empilhados por mês">${g}</svg><div class="tip"></div>`;
  wireTip(el, (m) => [['Receitas', c.receitas[m]], ['Gasto real', c.gastoReal[m]], ['Investimentos', c.invest[m]], ['Despesas (total)', c.despesas[m]], ['Sobra', Math.max(0, c.receitas[m] - c.despesas[m])]]);
}
function wireTip(el, rowsFor) {
  const tip = $('.tip', el);
  const show = (rect) => {
    const m = +rect.dataset.m;
    $$('.hit', el).forEach((h) => h.classList.toggle('on', h === rect));
    tip.innerHTML = `<b>${MESES[m]}</b>${rowsFor(m).map(([k, val]) => `<div><span>${k}</span><span>${fmt(val)}</span></div>`).join('')}`;
    const box = el.getBoundingClientRect(), rb = rect.getBoundingClientRect();
    let left = rb.left - box.left + rb.width / 2 - 85;
    left = Math.max(4, Math.min(left, box.width - 174));
    tip.style.left = left + 'px'; tip.style.top = '4px';
    tip.classList.add('show');
  };
  $$('.hit', el).forEach((h) => { h.addEventListener('mouseenter', () => show(h)); h.addEventListener('click', () => show(h)); });
  el.addEventListener('mouseleave', () => { tip.classList.remove('show'); $$('.hit', el).forEach((h) => h.classList.remove('on')); });
}

/* ---------- tela: Ajustes ---------- */
function renderAjustes(v) {
  const Y = data.years[ui.year];
  const ys = years();
  const editList = (list, scope) => list.map((i, idx) => `
    <div class="edit-row" data-scope="${scope}" data-id="${i.id}">
      <input class="input" value="${esc(i.nome)}" data-act="rename" aria-label="Nome">
      <button class="mini" data-act="up" ${idx === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
      <button class="mini del" data-act="del" aria-label="Excluir">✕</button>
    </div>`).join('');
  v.innerHTML = `
    <h2 class="section-title">Ano em edição</h2>
    <section class="card">
      <label class="field"><span>A estrutura (grupos e itens) é guardada por ano</span>
        <select class="input" id="yearSel">${ys.map((y) => `<option ${y === ui.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </label>
      <div class="pad-actions row-actions">
        <button class="btn sm" id="newYear" type="button">+ Novo ano (copia estrutura)</button>
        ${ys.length > 1 ? '<button class="btn sm danger" id="delYear" type="button">Excluir este ano</button>' : ''}
      </div>
    </section>

    <h2 class="section-title">Receitas (fontes)</h2>
    <section class="card">${editList(Y.receitas, 'rec')}
      <div class="pad-actions"><button class="btn sm" data-add="rec" type="button">+ Fonte de receita</button></div>
    </section>

    <h2 class="section-title">Grupos de despesa</h2>
    ${Y.grupos.map((g, gi) => `
      <section class="card group ${ui.open.has('cfg-' + g.id) ? 'open' : ''}" data-key="cfg-${g.id}">
        <button class="group-head" type="button"><span class="name">${chevron}<span class="t">${esc(g.nome)}</span>${g.investimento ? '<span class="badge">invest.</span>' : ''}</span><span class="badge">${g.itens.length} itens</span></button>
        <div class="group-body">
          <div class="edit-row" data-scope="grp" data-id="${g.id}">
            <input class="input" value="${esc(g.nome)}" data-act="rename" aria-label="Nome do grupo" style="font-weight:600">
            <button class="mini" data-act="up" ${gi === 0 ? 'disabled' : ''} aria-label="Subir grupo">↑</button>
            <button class="mini del" data-act="del" aria-label="Excluir grupo">✕</button>
          </div>
          <label class="switch"><span>Conta como investimento/reserva<br><small style="color:var(--text-3)">Sai do "gasto real" e entra em "Receitas − Investimentos"</small></span><input type="checkbox" data-inv="${g.id}" ${g.investimento ? 'checked' : ''}></label>
          ${editList(g.itens, 'item:' + g.id)}
          <div class="pad-actions"><button class="btn sm" data-add="item:${g.id}" type="button">+ Item</button></div>
        </div>
      </section>`).join('')}
    <button class="btn block" data-add="grp" type="button" style="margin-bottom:12px">+ Novo grupo</button>

    <h2 class="section-title">Cálculos</h2>
    <section class="card">
      <label class="field"><span>Percentual da receita exibido no resumo (planilha: 30%)</span>
        <input class="input" id="metaPct" inputmode="decimal" value="${fmtNum(data.metaPct).replace(',00', '')}"></label>
    </section>

    <h2 class="section-title">Planilha do Google Sheets</h2>
    <section class="card" id="sheetCard"></section>

    <h2 class="section-title">Backup e exportação</h2>
    <section class="card"><div class="pad-actions row-actions">
      <button class="btn sm" id="expJson" type="button">Exportar backup (.json)</button>
      <button class="btn sm" id="impJson" type="button">Importar backup</button>
      <button class="btn sm" id="expCsv" type="button">Exportar ${ui.year} (.csv p/ Excel)</button>
      <input type="file" id="impFile" accept="application/json,.json" hidden>
    </div></section>

    <h2 class="section-title">Aparência</h2>
    <section class="card"><label class="field"><span>Tema</span>
      <select class="input" id="themeSel">
        ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) => `<option value="${k}" ${settings.theme === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label></section>
    <p class="hint" style="text-align:center;margin:16px 0">${Sync.mode() === 'sheet' ? 'Dados na planilha do Google Sheets (cópia offline neste aparelho).' : 'Dados salvos só neste aparelho.'}</p>`;

  renderSheetCard();

  $$('.group-head', v).forEach((h) => h.addEventListener('click', () => {
    const card = h.closest('.group'); const key = card.dataset.key;
    card.classList.toggle('open');
    ui.open.has(key) ? ui.open.delete(key) : ui.open.add(key);
    safeSet('cfp:open', JSON.stringify([...ui.open]));
  }));
  const yr = ui.year;
  const listIn = (d, scope) => {
    const Yd = d.years[yr]; if (!Yd) return null;
    if (scope === 'rec') return Yd.receitas;
    if (scope === 'grp') return Yd.grupos;
    return Yd.grupos.find((g) => g.id === scope.split(':')[1])?.itens || null;
  };
  const listFor = (scope) => listIn(data, scope);
  const redo = () => { if (ui.tab === 'ajustes') renderAjustes(v); };
  $$('.edit-row', v).forEach((row) => {
    const scope = row.dataset.scope, id = row.dataset.id;
    const cur = () => listFor(scope).find((x) => x.id === id);
    $('[data-act="rename"]', row).addEventListener('change', async (e) => {
      const name = e.target.value.trim();
      if (!name || name === cur()?.nome) { e.target.value = cur()?.nome || ''; return; }
      if (scope === 'grp' && groupNameTaken(data.years[yr], name, id)) { toast('Já existe um grupo com esse nome'); e.target.value = cur().nome; return; }
      const ok = await Sync.mutate((d) => {
        const it = listIn(d, scope)?.find((x) => x.id === id); if (!it) return false;
        if (scope === 'grp' && groupNameTaken(d.years[yr], name, id)) return false;
        it.nome = name;
      });
      if (!ok) { toast('Não foi possível renomear'); redo(); return; }
      if (scope === 'grp') { const t = $('.t', row.closest('.group')); if (t) t.textContent = name; }
    });
    $('[data-act="up"]', row).addEventListener('click', async () => {
      if (!(await needAuth())) return;
      await Sync.mutate((d) => {
        const list = listIn(d, scope); const i = list ? list.findIndex((x) => x.id === id) : -1;
        if (i <= 0) return false;
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
      });
      redo();
    });
    $('[data-act="del"]', row).addEventListener('click', async () => {
      if (!(await needAuth())) return;
      const it = cur(); if (!it) return;
      const isGrp = scope === 'grp';
      const total = isGrp ? sum(it.itens.flatMap((i) => i.valores)) : sum(it.valores);
      const ok = await confirmDlg(`Excluir "${it.nome}"?`, `${isGrp ? `O grupo e seus ${it.itens.length} itens serão removidos de ${yr}.` : `Removido de ${yr}.`}${total ? ` Há ${fmt(total)} lançados no ano que deixarão de contar.` : ''}`, 'Excluir', true);
      if (!ok) return;
      await Sync.mutate((d) => {
        const list = listIn(d, scope); const i = list ? list.findIndex((x) => x.id === id) : -1;
        if (i < 0) return false;
        list.splice(i, 1);
      });
      redo();
    });
  });
  $$('[data-add]', v).forEach((b) => b.addEventListener('click', async () => {
    if (!(await needAuth())) return;
    const scope = b.dataset.add;
    const name = await promptDlg(scope === 'grp' ? 'Novo grupo' : scope === 'rec' ? 'Nova fonte de receita' : 'Novo item', 'Nome');
    if (!name) return;
    if (scope === 'grp' && groupNameTaken(data.years[yr], name)) { toast('Já existe um grupo com esse nome'); return; }
    const newId = uid();
    const ok = await Sync.mutate((d) => {
      if (scope === 'grp') {
        if (groupNameTaken(d.years[yr], name)) return false;
        d.years[yr].grupos.push({ id: newId, nome: name, investimento: false, itens: [] });
      } else {
        const list = listIn(d, scope); if (!list) return false;
        list.push({ id: newId, nome: name, valores: zeros() });
      }
    });
    if (ok && scope === 'grp') { ui.open.add('cfg-' + newId); safeSet('cfp:open', JSON.stringify([...ui.open])); }
    redo();
  }));
  $$('[data-inv]', v).forEach((cb) => cb.addEventListener('change', async () => {
    const gid = cb.dataset.inv, val = cb.checked;
    await Sync.mutate((d) => { const g = d.years[yr]?.grupos.find((x) => x.id === gid); if (!g) return false; g.investimento = val; });
    redo();
  }));
  $('#yearSel', v).addEventListener('change', (e) => { ui.year = +e.target.value; render(); });
  $('#newYear', v).addEventListener('click', async () => {
    if (!(await needAuth())) return;
    const y = await promptDlg('Novo ano', 'Ano', String(Math.max(...ys) + 1));
    if (!y) return;
    if (!/^\d{4}$/.test(y)) { toast('Ano inválido'); return; }
    if (data.years[y]) { toast('Esse ano já existe'); return; }
    const ok = await Sync.mutate((d) => { if (d.years[y]) return false; d.years[y] = cloneStructure(d.years[yr]); });
    if (ok) { ui.year = +y; render(); toast(`Ano ${y} criado`); }
  });
  const del = $('#delYear', v);
  if (del) del.addEventListener('click', async () => {
    if (!(await needAuth())) return;
    if (!(await confirmDlg(`Excluir ${yr}?`, 'Todos os valores e a estrutura deste ano serão apagados.', 'Excluir', true))) return;
    const ok = await Sync.mutate((d) => { if (Object.keys(d.years).length < 2) return false; delete d.years[yr]; });
    if (ok) { ui.year = years().slice(-1)[0]; render(); }
  });
  $('#metaPct', v).addEventListener('change', async (e) => {
    const p = parseMoney(e.target.value);
    if (Number.isNaN(p) || p < 0 || p > 100) { toast('Informe um percentual entre 0 e 100'); return; }
    if (await Sync.setMeta(p)) toast('Percentual atualizado');
  });
  $('#themeSel', v).addEventListener('change', (e) => { settings.theme = e.target.value; saveSettings(); applyTheme(); });
  $('#expJson', v).addEventListener('click', () => download(`controle-financeiro-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json'));
  $('#impJson', v).addEventListener('click', async () => { if (await needAuth()) $('#impFile', v).click(); });
  $('#impFile', v).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = '';
    let d;
    try { d = JSON.parse(await f.text()); if (!validData(d)) throw new Error(); } catch { toast('Arquivo inválido'); return; }
    const onde = Sync.mode() === 'sheet' ? 'na planilha' : 'neste aparelho';
    if (!(await confirmDlg('Importar backup?', `Todos os dados ${onde} serão substituídos pelo arquivo.`, 'Importar', true))) return;
    const imp = normalize(d);
    const ok = await Sync.mutate((cur) => { cur.metaPct = imp.metaPct; cur.years = imp.years; });
    if (ok) { ui.year = years().includes(ui.year) ? ui.year : years().slice(-1)[0]; render(); toast('Backup importado'); }
  });
  $('#expCsv', v).addEventListener('click', exportCsv);
}
/** Em modo planilha, garante o login antes de ações que mudam a estrutura (precisa ser chamado direto no toque). */
async function needAuth() {
  if (Sync.mode() !== 'sheet' || GAuth.valid()) return true;
  return Sync.login();
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCsv() {
  const Y = data.years[ui.year], c = calcYear(ui.year);
  const n = (v) => fmtNum(v).replace(/\./g, '');
  const line = (label, vals) => [`"${String(label).replace(/"/g, '""')}"`, ...vals.map(n), n(sum(vals))].join(';');
  const head = (t) => [`"${t}"`, ...MES_ABREV, 'TOTAL ANO'].join(';');
  const out = [head('Receitas'), ...Y.receitas.map((i) => line(i.nome, i.valores)), line('TOTAL MÊS', c.receitas), ''];
  Y.grupos.forEach((g, gi) => { out.push(head(g.nome), ...g.itens.map((i) => line(i.nome, i.valores)), line('TOTAL MÊS', c.grupos[gi].tot), ''); });
  out.push(head('Resumo'), line('Receitas', c.receitas), line(`${data.metaPct}% Receita`, c.meta), line('Receitas - Investimentos', c.recMenosInv),
    ...c.grupos.map(({ g, tot }) => line(g.nome, tot)), line('Despesas', c.despesas), line('Despesas - Investimentos', c.gastoReal), line('Receitas - Despesas', c.saldo));
  download(`controle-financeiro-${ui.year}.csv`, '﻿' + out.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---------- Ajustes: conexão com o Google Sheets ---------- */
const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
function parseSheetId(text) {
  const t = String(text || '').trim();
  const m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : (/^[a-zA-Z0-9_-]{25,}$/.test(t) ? t : '');
}
function hasAnyValue(d) {
  return Object.values(d.years).some((Y) => [...Y.receitas, ...Y.grupos.flatMap((g) => g.itens)].some((i) => i.valores.some(Boolean)));
}
function renderSheetCard() {
  const el = $('#sheetCard'); if (!el) return;
  if (Sync.mode() === 'sheet') {
    el.innerHTML = `
      <p class="note">Os dados ficam na planilha do Google Sheets. Quem tiver acesso de <b>Editor</b> a ela pode usar o app com a própria conta Google.</p>
      <div class="pad-actions row-actions">
        <a class="btn sm" href="${sheetUrl(settings.sheetId)}" target="_blank" rel="noopener">Abrir planilha</a>
        <button class="btn sm primary" id="shRefresh" type="button">Atualizar agora</button>
        <button class="btn sm" id="shInvite" type="button">Enviar convite</button>
        <button class="btn sm ${settings.authed ? '' : 'primary'}" id="shAuth" type="button">${settings.authed ? 'Sair da conta Google' : 'Entrar com Google'}</button>
        <button class="btn sm danger" id="shOff" type="button">Desconectar</button>
      </div>
      <div class="status-line" id="sheetStatus"></div>`;
    $('#shRefresh', el).addEventListener('click', () => Sync.refresh());
    $('#shInvite', el).addEventListener('click', invite);
    $('#shAuth', el).addEventListener('click', async () => {
      if (!settings.authed) { if (await Sync.login()) Sync.refresh(); return; }
      if (!(await confirmDlg('Sair da conta Google?', 'A planilha continua conectada. Para sincronizar de novo, entre com Google.', 'Sair'))) return;
      Sync.logout(); render();
    });
    $('#shOff', el).addEventListener('click', async () => {
      if (!(await confirmDlg('Desconectar da planilha?', 'A planilha continua no seu Drive. Este aparelho passa a guardar os dados só localmente.', 'Desconectar'))) return;
      Sync.disconnect(); render();
    });
  } else {
    el.innerHTML = `
      <label class="field"><span>OAuth Client ID (Google Cloud)</span>
        <input class="input" id="clientId" value="${esc(settings.clientId || DEFAULT_CLIENT_ID)}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
      <div class="pad-actions">
        <button class="btn block primary" id="shCreate" type="button">Criar planilha no Google Sheets</button>
        <p class="hint">Cria a planilha no seu Drive já com os grupos, itens e valores deste aparelho.</p>
      </div>
      <label class="field"><span>…ou conectar a uma planilha existente (cole o link)</span>
        <input class="input" id="shLink" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" spellcheck="false"></label>
      <div class="pad-actions"><button class="btn sm" id="shUse" type="button">Conectar a esta planilha</button></div>
      <div class="status-line" id="sheetStatus"></div>
      <p class="note">No Client ID, autorize a origem <code>${esc(location.origin)}</code>.</p>`;
    const saveCid = () => { settings.clientId = $('#clientId', el).value.trim(); saveSettings(); };
    $('#clientId', el).addEventListener('change', saveCid);
    $('#shCreate', el).addEventListener('click', async () => {
      saveCid();
      if (!GAuth.clientId()) { toast('Cole o Client ID primeiro'); return; }
      if (!(await Sync.login())) return;
      try {
        const { errs } = await Sync.createSheet();
        render();
        toast(errs.length ? 'Planilha criada, mas há fórmulas com erro no Resumo — veja o README' : 'Planilha criada no seu Drive');
      } catch (e) { toast(e.message); Sync.paint(); }
    });
    $('#shUse', el).addEventListener('click', async () => {
      saveCid();
      const id = parseSheetId($('#shLink', el).value);
      if (!GAuth.clientId()) { toast('Cole o Client ID primeiro'); return; }
      if (!id) { toast('Link da planilha inválido'); return; }
      if (!(await Sync.login())) return;
      if (hasAnyValue(data) && !(await confirmDlg('Usar a planilha?', 'Os dados guardados neste aparelho serão substituídos pelos da planilha.', 'Usar planilha', true))) return;
      try { await Sync.linkSheet(id); render(); toast('Planilha conectada'); } catch (e) { toast(e.message); Sync.paint(); }
    });
  }
  Sync.paint();
}
async function invite() {
  const url = `${location.origin}${location.pathname}#planilha=${settings.sheetId}&client=${encodeURIComponent(GAuth.clientId())}`;
  const text = 'Abra este link para usar o Controle Financeiro. Antes, aceite o compartilhamento da planilha (acesso de Editor).';
  if (navigator.share) { try { await navigator.share({ title: 'Controle Financeiro', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Link copiado'); return; } catch {}
  dialog({ title: 'Link de convite', text, body: `<input class="input" value="${esc(url)}" readonly onfocus="this.select()">` });
}
/** Link de convite: #planilha=ID&client=CLIENT_ID */
function readInviteHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const id = parseSheetId(h.get('planilha'));
  if (!id) return;
  settings.sheetId = id;
  if (h.get('client')) settings.clientId = h.get('client');
  saveSettings();
  history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => toast('Planilha configurada. Toque em “Entrar” no topo.'), 300);
}

/* ---------- tema ---------- */
function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/* ---------- inicialização ---------- */
applyTheme();
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
$('#prevBtn').addEventListener('click', () => step(-1));
$('#nextBtn').addEventListener('click', () => step(1));
$('#syncBtn').addEventListener('click', () => Sync.refresh());
$('#authBtn').addEventListener('click', () => Sync.login());
$('#view').addEventListener('click', (e) => { if (e.target.closest('#publicar')) publicar(); });
document.addEventListener('cfp:pending', refreshPendingUI);
readInviteHash();
if (Sync.mode() === 'sheet') ui.tab = 'graficos';
render();
Sync.boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
