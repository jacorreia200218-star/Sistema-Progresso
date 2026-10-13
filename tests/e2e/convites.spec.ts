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
