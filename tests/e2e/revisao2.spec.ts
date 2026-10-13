import { expect, test, type Page } from '@playwright/test';
import { bigLeader, installMock, leader } from './mock-api';

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow, 'sem deslocamento horizontal').toBeLessThanOrEqual(1);
}

test('vista por equipa: alfabética, agrupada por equipa, filtro por área agrupa por trilho', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/caminho');
  await page.getByText('Por equipa', { exact: true }).click();
  await expect(page).toHaveURL(/vista=equipa/);
  const table = page.locator('.team-table');
  await expect(table.locator('.team-row')).toHaveCount(2);
  const names = await table.locator('tbody').first().locator('tr:not(.team-row) th .link-btn').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt')));
  await expect(table.getByRole('row', { name: /Pedro Teste/ })).toContainText('Conhecimento');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/vista-equipa-${info.project.name}.png`, fullPage: true });
  await page.getByLabel('Área', { exact: true }).selectOption('A');
  await expect(page.getByRole('region', { name: /Afetivo: Autoestima/ })).toContainText('Pedro Teste');
  await page.getByRole('button', { name: /Pedro Teste/ }).click();
  await expect(page.getByRole('dialog', { name: 'Percurso' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/vista=equipa/);
  await expect(page).toHaveURL(/area=A/);
});

test('mapa com muitas pessoas: nomes curtos que distinguem, sem sobreposição', async ({ page }) => {
  await installMock(page, bigLeader());
  await page.goto('/caminho');
  const conhecimento = page.locator('.track-step', { hasText: 'Conhecimento' });
  await expect(conhecimento.locator('.avatar-name').filter({ hasText: 'Zé A.' })).toBeVisible();
  // Nenhum grupo de marcos se sobrepõe a outro
  const boxes = await page.locator('.track-step').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    const overlap = a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1;
    expect(overlap, `marcos ${i + 1} e ${j + 1} sobrepostos`).toBe(false);
  }
  await noHorizontalScroll(page);
  // Filtros preservados ao abrir e fechar o painel
  await page.getByLabel('Equipa', { exact: true }).selectOption('teamA');
  await conhecimento.getByRole('button', { name: /^Pedro Teste/ }).click();
  await page.getByRole('button', { name: 'Fechar' }).click();
  await expect(page).toHaveURL(/equipa=teamA/);
  await expect(page.getByLabel('Equipa', { exact: true })).toHaveValue('teamA');
});

test('página do membro em separadores, sem repetir informação', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/membros/m-p1');
  await expect(page.getByRole('tab', { name: 'Resumo', selected: true })).toBeVisible();
  await expect(page.locator('.summary .faceis-row')).toHaveCount(6);
  await expect(page.getByText('Próximo passo do pioneiro')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Início de Pista e Promessa' })).toHaveCount(0); // está no Histórico
  await page.screenshot({ path: `test-results/membro-resumo-${info.project.name}.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Etapa' }).click();
  await expect(page).toHaveURL(/separador=etapa/);
  await expect(page.getByText('Propor trilho para a etapa')).toBeVisible();
  await expect(page.locator('#pt-area')).toBeHidden(); // formulários recolhidos até serem precisos
  await expect(page.locator('#rn-t-area')).toBeHidden();
  await page.getByRole('tab', { name: 'Trilhos' }).click();
  await expect(page.locator('.tabpanel, [role=tabpanel]').getByRole('link')).toHaveCount(18);
  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page.getByRole('heading', { name: 'Início de Pista e Promessa' })).toBeVisible();
  await expect(page.getByText('Registado em')).toBeVisible();
  await noHorizontalScroll(page);
});
