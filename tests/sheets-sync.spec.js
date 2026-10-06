// Sincronização com o Google Sheets usando uma API simulada (tests/fake-sheets.js), com dois usuários.
import { test, expect } from '@playwright/test';
import { FakeSheets, attach } from './fake-sheets.js';

const OUT = 13; // coluna de outubro em Itens (A=0 … E=jan=4 … N=out=13)

test('criar planilha, convidar e editar em dois aparelhos', async ({ browser }) => {
  const fake = new FakeSheets();
  const newUser = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-10-15T12:00:00-03:00'));
    return attach(p, fake);
  };
  const row = (nome, ano = 2026) => fake.itens().find((r) => r[3] === nome && r[1] === ano);

  // --- Breno: lança em modo local e cria a planilha (migra os dados)
  const A = await newUser();
  await A.goto('/');
  await A.locator('[data-key="rec"] .group-head').click();
  await A.locator('[data-key="rec"] .money').first().fill('8000');
  await A.locator('[data-key="rec"] .money').first().press('Tab');
  await A.locator('[data-tab="ajustes"]').click();
  await A.locator('#clientId').fill('cid.apps.googleusercontent.com');
  await A.locator('#shCreate').click();
  await expect(A.locator('#sheetStatus')).toHaveText('Planilha criada');
  expect(row('Breno')[OUT]).toBe(8000);
  expect(row('Breno')[16]).toMatch(/^=SUM\(E\d+:P\d+\)$/);
  expect(fake.get('Config!B2').values[0][0]).toBe('cfp-1');
  expect(fake.requests.some((r) => r.addChart)).toBe(true);
  expect(fake.requests.filter((r) => r.addProtectedRange).every((r) => r.addProtectedRange.protectedRange.warningOnly)).toBe(true);

  // --- edição de valor grava só a célula
  await A.locator('[data-tab="mes"]').click();
  await A.locator('[data-key="rec"] .money').nth(1).fill('4.500,50');
  await A.locator('[data-key="rec"] .money').nth(1).press('Tab');
  await expect(A.locator('#syncLabel')).toHaveText('Sincronizado');
  expect(row('Jaqueline')[OUT]).toBe(4500.5);

  // --- Jaqueline entra pelo link de convite
  const invite = await A.evaluate(() => `${location.pathname}#planilha=${settings.sheetId}&client=${encodeURIComponent(GAuth.clientId())}`);
  const B = await newUser();
  await B.goto(invite);
  await expect(B.locator('#syncLabel')).toHaveText('Não sincronizado');
  await B.locator('#authBtn').click();
  await expect(B.locator('#syncLabel')).toHaveText('Sincronizado');
  await expect(B.locator('[data-tab="graficos"]')).toHaveClass(/active/);
  await B.locator('[data-tab="mes"]').click();
  await expect(B.locator('#summary .value').first()).toHaveText(/12\.500,50/);

  // --- B muda a estrutura (novo item no meio); A, com dados antigos, lança em item posterior → célula certa
  await B.locator('[data-tab="ajustes"]').click();
  await B.locator('.group', { hasText: 'Carro' }).locator('.group-head').click();
  await B.locator('.group', { hasText: 'Carro' }).locator('[data-add^="item:"]').click();
  await B.locator('#dialog input').fill('Seguro');
  await B.locator('#dialog button', { hasText: 'Salvar' }).click();
  await expect.poll(() => !!row('Seguro')).toBe(true);
  await A.locator('.group', { hasText: 'Mercado' }).locator('.group-head').click();
  const compra = A.locator('.group', { hasText: 'Mercado' }).locator('.money');
  await compra.fill('1234'); await compra.press('Tab');
  await expect.poll(() => row('Compra do Mês')[OUT]).toBe(1234);
  expect(row('Seguro')[OUT]).toBe(0);

  // --- renomear grupo atualiza Grupos e Itens
  await B.locator('.group', { hasText: 'Cartão de Crédito' }).locator('.group-head').click();
  const nomeGrupo = B.locator('.edit-row[data-scope="grp"] input').first();
  await nomeGrupo.fill('Cartões'); await nomeGrupo.press('Tab');
  await expect.poll(() => row('C6')?.[2]).toBe('Cartões');

  // --- novo ano copia a estrutura
  await B.locator('#newYear').click();
  await B.locator('#dialog input').fill('2027');
  await B.locator('#dialog button', { hasText: 'Salvar' }).click();
  await expect.poll(() => fake.itens().filter((r) => r[1] === 2027).length).toBe(fake.itens().filter((r) => r[1] === 2026).length);

  // --- A atualiza e vê tudo
  await A.locator('#syncBtn').click();
  await expect.poll(() => A.evaluate(() => years())).toEqual([2026, 2027]);

  // --- offline: guarda e envia depois
  fake.offline = true;
  await A.locator('[data-tab="mes"]').click();
  const breno = A.locator('[data-key="rec"] .money').first();
  await breno.fill('9999'); await breno.press('Tab');
  await expect(A.locator('#syncLabel')).toHaveText('Não sincronizado');
  fake.offline = false;
  await A.locator('#syncBtn').click();
  await expect.poll(() => row('Breno')[OUT]).toBe(9999);

  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
});
