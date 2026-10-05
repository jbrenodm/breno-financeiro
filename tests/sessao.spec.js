// Sessão do Google expirando no meio de uma ação de estrutura (API responde 401 uma vez).
import { test, expect } from '@playwright/test';
import { FakeSheets, attach } from './fake-sheets.js';

test('sessão expirada avisa, não grava e o login recupera a planilha', async ({ browser }) => {
  const fake = new FakeSheets();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block' });
  const A = await ctx.newPage();
  await A.clock.setFixedTime(new Date('2026-10-15T12:00:00-03:00'));
  await attach(A, fake);
  await A.goto('/');
  await A.locator('[data-tab="ajustes"]').click();
  await A.locator('#clientId').fill('cid.apps.googleusercontent.com');
  await A.locator('#shCreate').click();
  await expect(A.locator('#sheetStatus')).toHaveText('Planilha criada');

  let expirou = true;
  await A.route('https://sheets.googleapis.com/**', (r) => {
    if (expirou && r.request().url().includes('values:batchGet')) {
      expirou = false;
      return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"expired"}}' });
    }
    return fake.handle(r);
  });

  await A.locator('.group', { hasText: 'Carro' }).locator('.group-head').click();
  await A.locator('.group', { hasText: 'Carro' }).locator('[data-add^="item:"]').click();
  await A.locator('#dialog input').fill('Teste');
  await A.locator('#dialog button', { hasText: 'Salvar' }).click();
  await expect(A.locator('#toast')).toHaveText(/Sessão do Google expirou/);
  await expect(A.locator('#syncLabel')).toHaveText('Entrar');
  expect(fake.itens().some((r) => r[3] === 'Teste')).toBe(false);

  await A.locator('#syncBtn').click();
  await expect(A.locator('#syncLabel')).toHaveText('Sincronizado');
});
