import { expect, test } from '@playwright/test';
import { installMock, leader, pendingUser, pioneer } from './mock-api';

test('mostrar e ocultar a palavra-passe', async ({ page }) => {
  await page.goto('/registo');
  const pwd = page.getByLabel('Palavra-passe', { exact: true });
  await pwd.fill('segredo-123');
  await expect(pwd).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Mostrar palavra-passe' }).first().click();
  await expect(pwd).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ocultar palavra-passe' }).first().click();
  await expect(pwd).toHaveAttribute('type', 'password');
});

test('pedido de entrada: a própria pessoa indica a equipa', async ({ page }) => {
  const mock = await installMock(page, pendingUser());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pedido de entrada enviado' })).toBeVisible();
  await page.getByLabel('A que equipa pertences?').selectOption({ label: 'Equipa Andorinha' });
  await page.getByRole('button', { name: 'Guardar equipa' }).click();
  await expect.poll(() => mock.calls.find((c) => c.fn === 'set_requested_team')?.body).toMatchObject({ p_membership: 'm-novo', p_team: 'teamA' });
});

test('administração: muda o nome de quem pediu entrada', async ({ page }) => {
  const mock = await installMock(page, leader());
  await page.goto('/gestao/membros');
  const nome = page.getByLabel('Nome', { exact: true }).first();
  await expect(nome).toHaveValue('Pessoa Nova Teste');
  await nome.fill('Pessoa Nova Corrigida');
  await page.getByRole('button', { name: 'Guardar nome' }).click();
  await expect.poll(() => mock.calls.find((c) => c.fn === 'admin_update_profile')?.body).toMatchObject({ p_membership: 'm-novo', p_full_name: 'Pessoa Nova Corrigida' });
});

test('escolher primeiro a área e depois o trilho', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/progresso-anterior');
  const trilho = page.getByLabel('Trilho', { exact: true });
  await expect(trilho).toBeDisabled();
  await page.getByLabel('Área', { exact: true }).selectOption({ label: 'A · Afetivo' });
  await expect(trilho).toBeEnabled();
  const options = await trilho.locator('option').allTextContents();
  // Só os trilhos de Afetivo, sem o que já tem pedido ativo (Autoestima)
  expect(options).toEqual(['Escolhe o trilho…', 'Relacionamento e sensibilidade', 'Equilíbrio emocional']);
});

for (const theme of ['light', 'dark'] as const) {
  test(`trilhos em árvore com pesquisa e exemplos (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await installMock(page, pioneer());
    await page.goto('/trilhos');
    await expect(page.locator('.tree > li')).toHaveCount(6);
    await page.getByRole('button', { name: 'Abrir tudo' }).click();
    await expect(page.locator('.tree-trail[open]')).toHaveCount(0); // trilhos continuam fechados; abrem-se as áreas
    await expect(page.locator('.tree-area[open]')).toHaveCount(6);
    await expect(page.locator('.tree-trail > summary', { hasText: /^Desempenho/ })).toContainText('Validado');
    await page.getByPlaceholder('Procurar trilho, objetivo ou palavra-chave').fill('oracao');
    await expect(page.getByText(/trilho\(s\) encontrado\(s\)\./)).toBeVisible(); // objetivos, explicações e exemplos
    await expect(page.locator('.tree mark').first()).toHaveText('oração');
    await expect(page.getByText(/Aprofundo os hábitos de/)).toBeVisible();
    await expect(page).toHaveURL(/q=oracao/);
    // Exemplos dentro do respetivo trilho
    await page.locator('.tree-trail', { hasText: 'Aprofundamento' }).getByText('Ver exemplos').click();
    await expect(page.locator('.tree-trail', { hasText: 'Aprofundamento' }).locator('.more-inner[open] li').first()).toBeVisible();
    const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, page.viewportSize()!.width);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/trilhos-${info.project.name}-${theme}.png`, fullPage: true });
  });
}
