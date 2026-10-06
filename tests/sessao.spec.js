// Sessão do Google expirando no meio de uma ação de estrutura (API responde 401 uma vez).
import { test, expect } from '@playwright/test';
import { FakeSheets, attach } from './fake-sheets.js';

const OUT = 13; // outubro em Itens

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
  await expect(A.locator('#syncLabel')).toHaveText('Não sincronizado');
  expect(fake.itens().some((r) => r[3] === 'Teste')).toBe(false);

  await A.locator('#authBtn').click();
  await expect(A.locator('#syncLabel')).toHaveText('Sincronizado');
});

test('ao recarregar, renova o acesso sem janela', async ({ browser }) => {
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

  await A.reload();
  await expect(A.locator('#syncLabel')).toHaveText('Sincronizado');
  await expect(A.locator('[data-tab="graficos"]')).toHaveClass(/active/);
});

test('ao recarregar, sem renovação silenciosa, mostra Entrar', async ({ browser }) => {
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

  await A.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({
    contentType: 'text/javascript',
    body: `window.google={accounts:{oauth2:{
      initTokenClient:(o)=>({requestAccessToken:()=>setTimeout(()=>o.callback({error:'immediate_failed'}),5)}),
      revoke:()=>{}}}}`,
  }));
  await A.reload();
  await expect(A.locator('#syncLabel')).toHaveText('Não sincronizado');
  await expect(A.locator('#authBanner')).toBeVisible();
});

test('alteração sem login fica pendente e Publicar envia após o login', async ({ browser }) => {
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

  await A.evaluate(() => GAuth.clear());
  await A.locator('[data-tab="mes"]').click();
  await A.locator('[data-key="rec"] .group-head').click();
  const breno = A.locator('[data-key="rec"] .money').first();
  await breno.fill('777'); await breno.press('Tab');
  await expect(A.locator('#pendBar')).toContainText('1 valor pendente');
  await expect(A.locator('.money.pend')).toHaveCount(1);
  expect(fake.itens().find((r) => r[3] === 'Breno')[OUT]).toBe(0);

  await A.locator('#publicar').click();
  await expect(A.locator('#pendBar')).toContainText('Tudo publicado');
  await expect(A.locator('.money.pend')).toHaveCount(0);
  expect(fake.itens().find((r) => r[3] === 'Breno')[OUT]).toBe(777);
});

test('sair da conta Google não renova sozinho ao recarregar', async ({ browser }) => {
  const fake = new FakeSheets();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block' });
  const A = await ctx.newPage();
  await attach(A, fake);
  await A.goto('/');
  await A.locator('[data-tab="ajustes"]').click();
  await A.locator('#clientId').fill('cid.apps.googleusercontent.com');
  await A.locator('#shCreate').click();
  await expect(A.locator('#sheetStatus')).toHaveText('Planilha criada');

  await A.locator('#shAuth').click();
  await A.locator('#dialog button', { hasText: 'Sair' }).click();
  await expect(A.locator('#syncLabel')).toHaveText('Não sincronizado');
  await expect(A.locator('#authBanner')).toBeVisible();
  await expect(A.locator('#shAuth')).toHaveText('Entrar com Google');

  await A.reload();
  await expect(A.locator('#syncLabel')).toHaveText('Não sincronizado');
});
