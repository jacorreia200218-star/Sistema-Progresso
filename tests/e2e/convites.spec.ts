import { expect, test } from '@playwright/test';
import { installMock, leader, newUser } from './mock-api';

test('gestão de convites: código curto, copiar e QR', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installMock(page, leader());
  await page.goto('/gestao/convites');
  await expect(page.locator('.invite-code')).toHaveText('AB7K-9M2P');
  await page.getByRole('button', { name: 'Copiar código' }).click();
  await expect(page.getByRole('button', { name: 'Código copiado' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('AB7K-9M2P');
  await page.getByRole('button', { name: 'Copiar ligação' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/c#AB7K-9M2P$/);
  await page.getByRole('button', { name: 'Mostrar QR' }).click();
  await expect(page.getByRole('img', { name: /Código QR/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerar novo' })).toBeVisible();
});

test('entrar com convite: código com espaços e minúsculas, destino antes de confirmar', async ({ page }) => {
  const mock = await installMock(page, newUser());
  await page.goto('/');
  await page.getByLabel('Código do convite').fill(' ab7k 9m2p ');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Vais pedir entrada em')).toBeVisible();
  await expect(page.locator('.invite-dest')).toContainText('Pioneiros (teste)');
  await expect(page.locator('.invite-dest')).toContainText('Equipa Bússola');
  expect(mock.calls.some((c) => c.fn === 'join_section')).toBe(false); // ainda não entrou
  await page.getByRole('button', { name: 'Confirmar entrada' }).click();
  await expect.poll(() => mock.calls.find((c) => c.fn === 'join_section')?.body).toEqual({ p_code: 'AB7K9M2P' });
});

test('ligação curta guarda o código e mostra-o', async ({ page }) => {
  await page.goto('/c#ab7k-9m2p');
  await expect(page.getByText('AB7K-9M2P')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pioneiros.convite'))).toBe('AB7K9M2P');
  await expect(page).toHaveURL(/\/convite$/);
});

test('links pessoais: vários de uma vez, um por pessoa, só uma utilização', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const mock = await installMock(page, leader());
  await page.goto('/gestao/convites');
  await page.getByLabel('Nomes (um por linha)').fill('Ana Silva\nBruno Costa\n\nAna Silva\nCarla Sousa');
  await expect(page.getByText('3 pessoas')).toBeVisible(); // linhas vazias e repetidos ignorados
  await page.getByRole('button', { name: 'Criar 3 links' }).click();
  await expect(page.getByText('3 links criados.')).toBeVisible();
  const sent = mock.calls.filter((c) => c.fn === 'create_invite').map((c) => c.body);
  expect(sent.map((b) => b.p_label)).toEqual(['Ana Silva', 'Bruno Costa', 'Carla Sousa']);
  expect(sent.every((b) => b.p_max_uses === 1)).toBe(true);
  const items = page.locator('.created-link');
  await expect(items).toHaveCount(3);
  await expect(items.first()).toContainText('/c#');
  await page.getByRole('button', { name: 'Copiar link de Bruno Costa' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/c#TST2-PQR2$/);
  await page.getByRole('button', { name: 'Copiar todos (nome e link)' }).click();
  const all = await page.evaluate(() => navigator.clipboard.readText());
  expect(all.split('\n')).toHaveLength(3);
  expect(all).toMatch(/^Ana Silva: .*\/c#TST1-PQR1$/m);
  await expect(page.getByLabel('Nomes (um por linha)')).toHaveValue('');
  await page.screenshot({ path: `test-results/links-pessoais-${info.project.name}.png`, fullPage: true });
});

test('links pessoais: um erro mantém os nomes por criar', async ({ page }) => {
  const mock = await installMock(page, leader());
  await page.goto('/gestao/convites');
  await page.getByLabel('Nomes (um por linha)').fill('Ana Silva\nBruno Costa');
  mock.failNext('create_invite', 'error', 'Erro de teste.');
  await page.getByRole('button', { name: 'Criar 2 links' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Nomes (um por linha)')).toHaveValue('Ana Silva\nBruno Costa');
});
