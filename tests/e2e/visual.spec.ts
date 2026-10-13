import { expect, test } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

const css = (page: import('@playwright/test').Page, sel: string, prop: string) =>
  page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test('tipografia partilhada e cartões do painel', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/');
  expect(await css(page, 'body', 'font-family')).toMatch(/^Arial/);
  expect(await css(page, 'main', 'font-size')).toBe('14px');
  expect(await css(page, 'h1', 'font-size')).toBe('21px');
  expect(await css(page, '.stat-value', 'font-size')).toBe('23px');
  expect(await css(page, 'h1', 'text-transform')).toBe('none');
  // Quatro cartões com a cor indicada, conteúdo centrado e as mesmas dimensões
  const bgs = await page.locator('.stat').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(bgs).toEqual(['rgb(239, 246, 255)', 'rgb(240, 253, 244)', 'rgb(255, 251, 235)', 'rgb(245, 243, 255)']);
  expect(await css(page, '.stat', 'text-align')).toBe('center');
  expect(await css(page, '.stat', 'align-items')).toBe('center');
  const sizes = await page.locator('.stat').evaluateAll((els) => [...new Set(els.map((e) => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`))]);
  expect(sizes, 'cartões com dimensões iguais').toHaveLength(1);
  // Modo escuro: a mesma ideia, com contraste
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await css(page, '.stat-azul', 'background-color')).toBe('rgb(22, 35, 58)');
  if (info.project.name === 'telemovel') {
    await page.goto('/perfil');
    expect(await css(page, '.field input', 'font-size')).toBe('16px'); // sem zoom no iOS
  }
});

test('parágrafos de leitura justificados só onde há largura; textos curtos à esquerda', async ({ page }, info) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/afetivo-autoestima');
  await page.getByRole('checkbox', { name: /A5/ }).check();
  const objective = page.locator('.obj-item .obj-text').first();
  const align = await objective.evaluate((e) => getComputedStyle(e).textAlign);
  expect(align).toBe(info.project.name === 'telemovel' ? 'start' : 'justify');
  expect(await objective.evaluate((e) => getComputedStyle(e).textAlignLast)).toBe('auto');
  expect(await page.locator('h1').evaluate((e) => getComputedStyle(e).textAlign)).toMatch(/start|left/);
  expect(await page.locator('#pedido h2').evaluate((e) => getComputedStyle(e).textAlign)).toMatch(/start|left/);
  expect(await page.locator('.field label').first().evaluate((e) => getComputedStyle(e).textAlign)).toMatch(/start|left/);
});
