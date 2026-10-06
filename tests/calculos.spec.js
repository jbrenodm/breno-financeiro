// Regras de cálculo e entrada de valores (modo local, sem planilha).
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00-03:00'));
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('cfp:settings:v1', JSON.stringify({ localOnly: true })); });
  await page.reload();
});

test('parseMoney aceita formatos brasileiros e somas', async ({ page }) => {
  const r = await page.evaluate(() => ['1.234,56', '120+35,90', '10.5', 'R$ 2.000', '100-30', '', 'abc'].map(parseMoney));
  expect(r.slice(0, 6)).toEqual([1234.56, 155.9, 10.5, 2000, 70, 0]);
  expect(Number.isNaN(r[6])).toBe(true);
});

test('calcYear segue as regras do Resumo', async ({ page }) => {
  const c = await page.evaluate(() => {
    const Y = data.years[2026];
    Y.receitas[0].valores[0] = 8000; Y.receitas[1].valores[0] = 4000;          // receitas 12000
    Y.grupos[0].itens[0].valores[0] = 2000;                                    // despesa
    Y.grupos.find((g) => g.investimento).itens[0].valores[0] = 1500;           // investimento
    Y.receitas[0].valores[2] = 100;                                            // março só com receita
    return { ...calcYear(2026), meses: monthsWithData(calcYear(2026)) };
  });
  expect(c.receitas[0]).toBe(12000);
  expect(c.meta[0]).toBe(3600);              // 30% da receita
  expect(c.despesas[0]).toBe(3500);          // Despesas inclui investimentos (igual à planilha)
  expect(c.invest[0]).toBe(1500);
  expect(c.gastoReal[0]).toBe(2000);         // Despesas − Investimentos
  expect(c.recMenosInv[0]).toBe(10500);      // Receitas − Investimentos
  expect(c.saldo[0]).toBe(8500);             // Receitas − Despesas
  expect(c.meses).toBe(2);                   // média usa meses com lançamento (jan e mar)
});

test('lançar valor atualiza o resumo do mês e persiste', async ({ page }) => {
  await expect(page.locator('#periodLabel')).toHaveText('Outubro de 2026');
  await page.locator('[data-key="rec"] .group-head').click();
  const inputs = page.locator('[data-key="rec"] .money');
  await inputs.nth(0).fill('8.500,00');
  await inputs.nth(0).press('Enter');                       // Enter vai para o próximo campo
  await expect(inputs.nth(1)).toBeFocused();
  await inputs.nth(1).fill('4200+300');
  await inputs.nth(1).press('Tab');
  await expect(page.locator('#summary .value').first()).toHaveText(/13\.000,00/);
  await page.reload();
  expect(await page.evaluate(() => data.years[2026].receitas[1].valores[9])).toBe(4500);
});

test('sem rolagem horizontal e sem erros em todas as abas', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  for (const tab of ['mes', 'ano', 'graficos', 'ajustes']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('nomes de grupo não podem se repetir no ano', async ({ page }) => {
  await page.locator('[data-tab="ajustes"]').click();
  await page.locator('[data-add="grp"]').click();
  await page.locator('#dialog input').fill('carro');
  await page.locator('#dialog button', { hasText: 'Salvar' }).click();
  await expect(page.locator('#toast')).toHaveText(/Já existe um grupo/);
});
