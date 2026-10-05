import { test, expect } from '@playwright/test';

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
