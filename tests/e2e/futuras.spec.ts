import { expect, test, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

const AREAS = ['Calendário escutista', 'Presenças', 'Inventário', 'Tesouraria', 'Equipas e cargos', 'Atas e tarefas'];
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 960;

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('menu: Início, depois por ordem alfabética, Gestão no fim; módulos em desenvolvimento só apresentação', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  if (isMobile(page)) {
    // Dirigente: Início, Acompanhar, Presenças, Calendário e «Mais»
    const bottom = page.getByRole('navigation', { name: 'Navegação principal' }).filter({ visible: true });
    await expect(bottom.getByRole('link')).toHaveText([/Início/, /Acompanhar/, /Presenças/, /Calendário/, /Mais/]);
    await bottom.getByRole('link', { name: /Mais/ }).click();
    const list = page.getByRole('navigation', { name: 'Outras secções' });
    await expect(list.getByRole('link')).toHaveText([/Atas e tarefas/, /Equipas e cargos/, /Inventário/, /Tesouraria/, /Trilhos/]);
    await expect(list.getByRole('link', { name: /Tesouraria/ })).toContainText('Em desenvolvimento');
    await expect(page.getByRole('navigation', { name: 'Gestão' }).getByRole('link')).toHaveText([/Gestão/]);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/mais-${info.project.name}.png`, fullPage: true });
    await list.getByRole('link', { name: /Tesouraria/ }).click();
  } else {
    const side = page.locator('.side-nav');
    await expect(side.locator('.nav-link > span:nth-child(2)')).toHaveText([
      'Início', 'Acompanhamento', 'Atas e tarefas', 'Calendário escutista', 'Equipas e cargos', 'Inventário', 'Presenças', 'Tesouraria', 'Trilhos', 'Gestão',
    ]);
    await expect(side.getByText('Módulos')).toHaveCount(0);
    await expect(side.getByRole('link', { name: 'Perfil' })).toHaveCount(0);
    for (const a of AREAS) await expect(side.getByRole('link', { name: new RegExp(`${a}.*Em desenvolvimento`) })).toBeVisible();
    await side.getByRole('link', { name: /Tesouraria/ }).click();
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
  for (const [path, name] of [['/calendario', 'Calendário escutista'], ['/inventario', 'Inventário'], ['/equipas-e-cargos', 'Equipas e cargos'], ['/atas-e-tarefas', 'Atas e tarefas'], ['/presencas', 'Presenças']]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.locator('main button, main form')).toHaveCount(0);
  }
  await page.goto('/meu-progresso');
  await expect(page.locator('main').getByText('Em desenvolvimento')).toHaveCount(0);
});
