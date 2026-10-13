import { expect, test, type Page } from '@playwright/test';
import { emptyLeader, installMock, leader, pioneer } from './mock-api';

async function noHorizontalScroll(page: Page) {
  // Compara com a largura configurada: em telemóvel um elemento largo alarga o viewport de layout (e a página fica reduzida).
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow, 'sem deslocamento horizontal').toBeLessThanOrEqual(1);
}

for (const theme of ['light', 'dark'] as const) {
  test(`caminho do pioneiro (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await installMock(page, pioneer());
    await page.goto('/meu-progresso?vista=caminho');
    await expect(page.getByRole('heading', { name: 'Meu progresso', exact: true })).toBeVisible();
    await expect(page.locator('.caminho-hero').getByRole('heading', { name: 'Conhecimento' })).toBeVisible();
    // Checklist da etapa com mensagens concretas por área
    await expect(page.locator('.checklist .ck-row')).toHaveCount(8);
    await expect(page.getByText('Falta escolher o trilho de Intelectual e Social.')).toBeVisible();
    await expect(page.locator('#marco-titulo')).toHaveText('Conhecimento');
    await expect(page.getByText(/^Falta /).first()).toBeVisible();
    await expect(page.getByText('Requisitos educativos:').first()).toBeVisible();
    await expect(page.getByText('Decisão pedagógica:').first()).toBeVisible();
    await expect(page.getByText('Reconhecimento:').first()).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/caminho-meu-${info.project.name}-${theme}.png`, fullPage: true });

    // Teclado: escolher outro marco no mapa visível
    const map = page.locator('svg.trail-map:visible');
    const node = map.getByRole('button', { name: /^Acampamento/ });
    await node.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#marco-titulo')).toHaveText('Acampamento / Anilha de Mérito');
    await expect(page).toHaveURL(/marco=acampamento/);

    // Vista em lista com a mesma informação
    await page.getByText('Lista', { exact: true }).click();
    await expect(page.locator('.milestone-list > li')).toHaveCount(8);
    await expect(page.getByText('Sinais de Pista').first()).toBeVisible();
    await noHorizontalScroll(page);
  });
}

test('caminho da secção para o pioneiro: só contagens dos outros', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/caminho?marco=conhecimento');
  await expect(page.getByText(/Vês quantos pioneiros estão em cada marco/)).toBeVisible();
  await expect(page.getByText('Pedro Teste (tu)')).toBeVisible();
  await expect(page.getByText('Diogo Fictício')).toHaveCount(0);
  await expect(page.getByText(/E mais 3 pioneiros/)).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`caminho da secção do dirigente (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await installMock(page, leader());
    await page.goto('/caminho');
    await expect(page.locator('#marco-titulo')).toHaveText('Início de Pista');
    const map = page.locator('svg.trail-map:visible');
    await map.getByRole('button', { name: /^Conhecimento/ }).click();
    await expect(page.getByRole('button', { name: /Diogo Fictício/ })).toBeVisible();
    await expect(page.getByText('Requisitos cumpridos · falta pedir a validação').first()).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/caminho-seccao-${info.project.name}-${theme}.png`, fullPage: true });

    // Filtro por equipa preservado ao voltar do detalhe
    await page.getByLabel('Equipa').selectOption('teamB');
    await expect(page.getByRole('button', { name: /Filipe Fictício/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Diogo Fictício/ }).click();
    await expect(page.getByRole('heading', { name: 'Resumo do percurso' })).toBeVisible();
    await expect(page).toHaveURL(/equipa=teamB/);
    await expect(page).toHaveURL(/pessoa=/);
  });
}

test('início do dirigente e estado vazio sem pioneiros', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Distribuição por marco' })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: /Caminho da secção/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atividade recente' })).toBeVisible();
  await expect(page.locator('nav').getByRole('link', { name: /Acompanhamento|Acompanhar/ }).first()).toBeVisible();
  await page.screenshot({ path: `test-results/inicio-dirigente-${info.project.name}.png`, fullPage: true });
  await noHorizontalScroll(page);
});

test('estado vazio útil', async ({ page }) => {
  await installMock(page, emptyLeader());
  await page.goto('/');
  await expect(page.getByText('Ainda não há pioneiros na secção.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Convidar elementos' })).toBeVisible();
  await page.goto('/caminho');
  await expect(page.getByText('Ainda não há pioneiros ativos na secção.')).toBeVisible();
});

test('tema guardado sem flash e endereços antigos', async ({ page }) => {
  await installMock(page, leader());
  await page.addInitScript(() => localStorage.setItem('pioneiros.tema', 'dark'));
  await page.goto('/dirigentes/negociacao');
  await expect(page).toHaveURL(/\/acompanhamento\/negociacao/);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(24, 27, 24)');
});
