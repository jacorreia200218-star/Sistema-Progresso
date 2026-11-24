// Menu de comandos (Ctrl K) e ações que não se repetem com um toque duplo.
import { expect, test } from '@playwright/test';
import { installMock, leader } from './mock-api';

test('Ctrl K abre o menu de comandos e salta para a página', async ({ page }, info) => {
  test.skip(info.project.name === 'telemovel', 'Atalho de teclado: só computador');
  await installMock(page, leader());
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Ir para/ })).toContainText('Ctrl K');
  await page.keyboard.press('Control+k');
  const box = page.getByRole('dialog', { name: 'Ir para' });
  await expect(box).toBeVisible();
  await box.getByRole('combobox', { name: 'Procurar página' }).fill('calend');
  await expect(box.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/calendario/);
  await expect(box).toBeHidden();
  // Esc fecha sem navegar
  await page.keyboard.press('Control+k');
  await expect(box).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await expect(page).toHaveURL(/\/calendario/);
});
