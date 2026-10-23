import { expect, test } from '@playwright/test';
import { installMock, leader } from './mock-api';

test('falha a carregar uma página: navegação visível e «Tentar novamente» recupera', async ({ page }) => {
  await installMock(page, leader());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  // Simula o que acontece depois de uma nova publicação: o código antigo da página já não existe.
  await page.route(/\/src\/pages\/Caminho\.tsx/, (r) => r.abort());
  // Para quem dirige, o Caminho é um separador do Acompanhamento.
  await page.getByRole('navigation', { name: 'Navegação principal' }).filter({ visible: true }).getByRole('link', { name: /Acompanha/ }).click();
  await page.getByRole('navigation', { name: 'Secções do acompanhamento' }).getByRole('link', { name: 'Caminho' }).click();
  // Tenta recarregar uma vez; se continuar a falhar, mostra a mensagem sem esvaziar o ecrã.
  await expect(page.getByText(/Não foi possível abrir esta página/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('navigation', { name: 'Navegação principal' }).first()).toBeVisible();
  await page.unroute(/\/src\/pages\/Caminho\.tsx/);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.locator('.caminho-page')).toBeVisible();
});

test('acesso direto, navegação interna e voltar/avançar', async ({ page }) => {
  await installMock(page, leader());
  await page.goto('/caminho?equipa=teamB');
  await expect(page.locator('.caminho-page')).toBeVisible();
  await page.getByRole('navigation', { name: 'Navegação principal' }).first().getByRole('link', { name: /Início/ }).first().click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.caminho-page')).toBeVisible();
  await expect(page).toHaveURL(/equipa=teamB/);
  await page.goForward();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
});

test('barra superior: ícone do tema e sino alinhados e do mesmo tamanho', async ({ page }) => {
  await installMock(page, leader());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  const theme = await page.locator('.topbar').getByRole('button', { name: /^Tema/ }).locator('svg').boundingBox();
  const bell = await page.locator('.topbar').getByRole('link', { name: /^Notificações/ }).locator('svg').boundingBox();
  expect(Math.abs(theme!.y + theme!.height / 2 - (bell!.y + bell!.height / 2))).toBeLessThan(1);
  expect(Math.abs(theme!.height - bell!.height)).toBeLessThan(1);
});
