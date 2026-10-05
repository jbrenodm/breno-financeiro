// Confere as fórmulas do Resumo (app/sheets.js → headerValues) recalculando no LibreOffice
// e comparando com calcYear() do app. Requer: LibreOffice (soffice) e Python com openpyxl.
// Limitações: o LibreOffice não tem FILTER nem intervalos abertos (E2:E) do Google Sheets;
// o script troca esses trechos por equivalentes estáticos só para o teste.
// Uso: npm run check:formulas
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), '8799'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8799/');
  const out = await page.evaluate(() => {
    localStorage.clear();
    const Y = data.years[2026];
    for (let m = 0; m < 12; m++) {
      Y.receitas[0].valores[m] = 8500 + m; Y.receitas[1].valores[m] = m < 9 ? 4000 : 0;
      Y.grupos[0].itens[1].valores[m] = m < 9 ? 1200.5 : 0;
      Y.grupos.find((g) => g.investimento).itens[0].valores[m] = m < 9 && m % 2 ? 1500 : 0;
      Y.grupos[2].itens[0].valores[m] = m < 9 ? 3100 : 0;
    }
    data.years[2027] = cloneStructure(Y); data.years[2027].receitas[0].valores[0] = 777;
    const c = calcYear(2026);
    return { hv: headerValues(2026), rows: dataToRows(data), c, n: monthsWithData(c) };
  });
  const dir = mkdtempSync(join(tmpdir(), 'cfp-'));
  writeFileSync(join(dir, 'in.json'), JSON.stringify(out));
  const r = spawnSync('python3', [join(root, 'scripts/check_formulas.py'), dir], { stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
} finally {
  await browser.close(); server.kill();
}
