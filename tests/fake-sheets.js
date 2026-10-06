// Simulação em memória de um subconjunto da Google Sheets API v4 + Google Identity Services.
// Implementa só o que o app usa (ver app/sheets.js). Fórmulas são guardadas como texto (não são calculadas).

export const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

export class FakeSheets {
  constructor() { this.sheets = {}; this.requests = []; this.calls = []; this.offline = false; }

  ref(a1) {
    const m = a1.match(/^([A-Z]+)(\d*)$/);
    let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
    return { c: c - 1, r: m[2] ? +m[2] - 1 : null };
  }
  parse(range) {
    const [sh, rg] = range.split('!'); const [a, b] = rg.split(':');
    const s = this.ref(a), e = b ? this.ref(b) : s;
    return { sh, r0: s.r ?? 0, c0: s.c, r1: e.r ?? 999999, c1: e.c };
  }
  grid(sh) { return (this.sheets[sh] ||= []); }
  set(range, values) {
    const p = this.parse(range), g = this.grid(p.sh);
    values.forEach((row, i) => row.forEach((v, j) => { (g[p.r0 + i] ||= [])[p.c0 + j] = v; }));
  }
  get(range) {
    const p = this.parse(range), g = this.grid(p.sh), out = [];
    for (let r = p.r0; r <= Math.min(p.r1, g.length - 1); r++) {
      const row = []; for (let c = p.c0; c <= p.c1; c++) row.push(g[r]?.[c] ?? '');
      while (row.length && row[row.length - 1] === '') row.pop();
      out.push(row);
    }
    while (out.length && !out[out.length - 1].length) out.pop();
    return out.length ? { values: out } : {};
  }
  clear(range) {
    const p = this.parse(range), g = this.grid(p.sh);
    for (let r = p.r0; r <= Math.min(p.r1, g.length - 1); r++) for (let c = p.c0; c <= p.c1; c++) if (g[r]) g[r][c] = '';
  }
  /** Linhas de dados da aba Itens (sem cabeçalho). */
  itens() { return this.get('Itens!A2:Q').values || []; }
  grupos() { return this.get('Grupos!A2:D').values || []; }

  async handle(route) {
    if (this.offline) return route.abort();
    const req = route.request(), u = new URL(req.url());
    const path = decodeURIComponent(u.pathname.replace('/v4/spreadsheets', ''));
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    this.calls.push(`${req.method()} ${path}`);
    const json = (o) => route.fulfill({ json: o });
    if (req.method() === 'POST' && path === '') return json({ spreadsheetId: SHEET_ID });
    if (!path.startsWith('/' + SHEET_ID)) return route.fulfill({ status: 404, json: { error: { message: 'not found' } } });
    const rest = path.slice(SHEET_ID.length + 1);
    if (rest === '/values:batchGet') return json({ valueRanges: u.searchParams.getAll('ranges').map((r) => this.get(r)) });
    if (rest === '/values:batchUpdate') { body.data.forEach((d) => this.set(d.range, d.values)); return json({}); }
    if (rest === '/values:batchClear') { body.ranges.forEach((r) => this.clear(r)); return json({}); }
    if (rest === ':batchUpdate') { this.requests.push(...body.requests); return json({}); }
    if (rest.startsWith('/values/')) {
      const r = rest.slice(8);
      if (req.method() === 'PUT') { this.set(r, body.values); return json({}); }
      return json(this.get(r));
    }
    return route.fulfill({ status: 400, json: { error: { message: 'não simulado: ' + rest } } });
  }
}

const GIS_STUB = `window.google={accounts:{oauth2:{
  initTokenClient:(o)=>({requestAccessToken:()=>setTimeout(()=>o.callback({access_token:'TOKEN',expires_in:3600}),5)}),
  revoke:()=>{}}}}`;

/** Pula a tela de entrada (primeiro uso) em testes que não tratam de login. */
export async function skipWelcome(page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('cfp:settings:v1')) localStorage.setItem('cfp:settings:v1', JSON.stringify({ localOnly: true }));
  });
}

/** Liga uma página ao fake (login Google sempre aceito). */
export async function attach(page, fake) {
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await skipWelcome(page);
  await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: GIS_STUB }));
  await page.route('https://sheets.googleapis.com/**', (r) => fake.handle(r));
  return page;
}
