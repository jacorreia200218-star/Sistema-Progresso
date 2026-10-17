import { expect, test } from '@playwright/test';
import { installMock, pioneer } from './mock-api';

test('pioneiro propõe fechar um trilho e vê a proposta pendente', async ({ page }, info) => {
  const mock = await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/intelectual-resolucao-de-problemas');
  const card = page.locator('#escolha');
  await expect(card.getByRole('heading', { name: 'Quero fechar este trilho' })).toBeVisible();
  await card.getByLabel('Como pensas fechá-lo? (opcional)').fill('Projeto de equipa para resolver o problema do material.');
  await page.screenshot({ path: `test-results/proposta-trilho-${info.project.name}.png`, fullPage: true });
  await card.getByRole('button', { name: 'Propor fechar este trilho' }).click();
  await expect(card.getByText(/Os dirigentes já sabem que queres fechar este trilho/)).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'propose_choice')?.body).toMatchObject({
    p_trail: 't-intelectual-resolucao-de-problemas', p_planned: 'Projeto de equipa para resolver o problema do material.', p_replaces: null,
  });
});

test('na lista da área, a proposta pendente aparece no trilho', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso?vista=areas&area=E');
  await expect(page.locator('.trail-row', { hasText: 'Serviço' })).toContainText('Proposto para fechar · aguarda a Equipa de Animação');
  await page.locator('.trail-row', { hasText: 'Serviço' }).click();
  const card = page.locator('#escolha');
  await expect(card).toContainText('Proposta enviada para a etapa');
  await expect(card.getByRole('button', { name: 'Retirar proposta' })).toBeVisible();
});
