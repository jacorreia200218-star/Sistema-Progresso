import { expect, test, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

const AREAS = ['Calendário escutista', 'Presenças', 'Inventário', 'Tesouraria', 'Equipas e cargos', 'Reuniões e tarefas'];
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 960;

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('módulos em desenvolvimento: no menu, separados, só apresentação', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  if (isMobile(page)) {
    // Barra de baixo com quatro destinos e «Mais»
    const bottom = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(bottom.getByRole('link')).toHaveCount(5);
    await bottom.getByRole('link', { name: /Mais/ }).click();
    const list = page.getByRole('navigation', { name: 'Módulos' });
    for (const a of AREAS) await expect(list.getByRole('link', { name: new RegExp(a) })).toContainText('Em desenvolvimento');
    await expect(page.getByRole('navigation', { name: 'Outras secções' })).toContainText('Caminho da secção');
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/mais-${info.project.name}.png`, fullPage: true });
    await list.getByRole('link', { name: /Tesouraria/ }).click();
  } else {
    const group = page.getByRole('group', { name: 'Módulos' });
    for (const a of AREAS) await expect(group.getByRole('link', { name: new RegExp(`${a}.*Em desenvolvimento`) })).toBeVisible();
    await group.getByRole('link', { name: /Tesouraria/ }).click();
  }
  await expect(page).toHaveURL(/\/tesouraria$/);
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Tesouraria', level: 1 })).toBeVisible();
  await expect(main.getByText('Em desenvolvimento')).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Funcionalidades previstas' })).toBeVisible();
  await expect(main).toContainText('verificadas no servidor');
  // Sem formulários, números ou botões de ação
  await expect(main.locator('form, input, select, textarea, button')).toHaveCount(0);
  await expect(main.locator('.future-area')).not.toContainText(/\d/);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/futura-tesouraria-${info.project.name}.png`, fullPage: true });
});

test('cada área tem a sua página; o progresso dos pioneiros não usa este estado', async ({ page }) => {
  await installMock(page, pioneer());
  for (const [path, name] of [['/calendario', 'Calendário escutista'], ['/inventario', 'Inventário'], ['/equipas-e-cargos', 'Equipas e cargos'], ['/reunioes-e-tarefas', 'Reuniões e tarefas'], ['/presencas', 'Presenças']]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.locator('main button, main form')).toHaveCount(0);
  }
  await page.goto('/meu-progresso');
  await expect(page.locator('main').getByText('Em desenvolvimento')).toHaveCount(0);
});
