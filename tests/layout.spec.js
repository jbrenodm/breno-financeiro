import { test, expect } from '@playwright/test';
import { skipWelcome } from './fake-sheets.js';

test.beforeEach(async ({ page }) => skipWelcome(page));

test('desktop: menu lateral à esquerda e sem rolagem horizontal em todas as abas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const barra = await page.locator('.tabbar').boundingBox();
  expect(barra.x).toBe(0);
  expect(barra.width).toBeLessThanOrEqual(240);
  for (const tab of ['mes', 'ano', 'graficos', 'ajustes']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('gráficos mostram totais de receitas e despesas e o gráfico empilhado', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-tab="graficos"]').click();
  await expect(page.locator('.stats.two .value')).toHaveCount(2);
  await expect(page.locator('#ch2 svg')).toHaveCount(1);
});

test('gráfico sem lançamentos mostra rótulos do eixo distintos', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-tab="graficos"]').click();
  const graficos = page.locator('.chart');
  expect(await graficos.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await graficos.count()); i++) {
    const rotulos = await graficos.nth(i).locator('svg text[text-anchor="end"]').allTextContents();
    expect(rotulos.length).toBeGreaterThan(2);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  }
});
