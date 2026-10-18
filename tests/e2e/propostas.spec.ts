import { expect, test } from '@playwright/test';
import { installMock, pioneer } from './mock-api';

test('trilho: duas ações separadas — trabalhar (propor) ou fechar (pedir validação)', async ({ page }, info) => {
  const mock = await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/intelectual-resolucao-de-problemas');
  const choice = page.getByRole('radiogroup', { name: 'O que queres fazer com este trilho' });
  await expect(choice.getByText('Trabalhar neste trilho')).toBeVisible();
  await expect(choice.getByText('Fechar este trilho')).toBeVisible();
  await expect(choice).toContainText('Ainda não propuseste');
  // Trabalhar: proposta à Equipa de Animação
  const card = page.locator('#escolha');
  await card.getByLabel('Como pensas trabalhá-lo? (opcional)').fill('Projeto de equipa para resolver o problema do material.');
  await page.screenshot({ path: `test-results/trilho-trabalhar-${info.project.name}.png`, fullPage: true });
  await card.getByRole('button', { name: 'Propor trabalhar neste trilho' }).click();
  await expect(card.getByText(/já sabem que queres trabalhar neste trilho/)).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'propose_choice')?.body).toMatchObject({
    p_trail: 't-intelectual-resolucao-de-problemas', p_planned: 'Projeto de equipa para resolver o problema do material.', p_replaces: null,
  });
  // Fechar: pedido de validação, noutro passo
  await choice.getByText('Fechar este trilho').click();
  await expect(page.getByRole('heading', { name: 'Fechar este trilho', level: 2 })).toBeVisible();
  await expect(page.locator('#escolha')).toHaveCount(0);
  await page.screenshot({ path: `test-results/trilho-fechar-${info.project.name}.png`, fullPage: true });
});

test('na lista da área, a proposta para trabalhar aparece no trilho', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso?vista=areas&area=E');
  await expect(page.locator('.trail-row', { hasText: 'Serviço' })).toContainText('Queres trabalhar neste trilho · aguarda a Equipa de Animação');
  await page.locator('.trail-row', { hasText: 'Serviço' }).click();
  const card = page.locator('#escolha');
  await expect(card).toContainText('Propuseste trabalhar neste trilho');
  await expect(card.getByRole('button', { name: 'Retirar proposta' })).toBeVisible();
});

test('pioneiros já não têm o progresso anterior', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/progresso-anterior');
  await expect(page).toHaveURL(/vista=pedidos/);
  await expect(page.getByRole('link', { name: 'Progresso anterior' })).toHaveCount(0);
  // Um pedido antigo fica guardado e à espera dos dirigentes, sem botões para o retirar ou reenviar
  await page.goto('/pedidos/r-hist');
  await expect(page.getByText('O pedido aguarda decisão dos dirigentes.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Retirar para editar|Submeter|Preparar nova versão/ })).toHaveCount(0);
});
