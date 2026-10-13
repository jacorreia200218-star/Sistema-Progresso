import { expect, test, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'sem deslocamento horizontal').toBeLessThanOrEqual(1);
}

async function nav(page: Page, label: string) {
  const isMobile = (page.viewportSize()?.width ?? 1000) < 960;
  const navs = page.getByRole('navigation', { name: 'Navegação principal' });
  await (isMobile ? navs.last() : navs.first()).getByRole('link', { name: label }).click();
}

test('página pública', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'O teu caminho na III Secção' })).toBeVisible();
  await expect(page.getByText('não substitui os registos oficiais')).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole('link', { name: 'Criar conta' }).first().click();
  await expect(page.getByLabel('Nome')).toBeVisible();
  await expect(page.getByLabel('Repetir palavra-passe')).toBeVisible();
  await page.screenshot({ path: `test-results/publico-${info.project.name}.png`, fullPage: true });
});

test('pioneiro: início, progresso, trilho e pedido', async ({ page }, info) => {
  const mock = await installMock(page, pioneer());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Olá, Pedro' })).toBeVisible();
  // Próxima ação concreta: o pedido devolvido tem prioridade
  await expect(page.getByRole('heading', { name: /Rever o pedido de «Autoestima»/ })).toBeVisible();
  await expect(page.getByText('Onde estou no caminho')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'As seis áreas' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/inicio-${info.project.name}.png`, fullPage: true });

  await nav(page, 'Progresso');
  await expect(page.getByRole('heading', { name: 'Progresso global' })).toHaveCount(0); // é um título de secção (h2 com classe)
  for (const area of ['Físico', 'Afetivo', 'Caráter', 'Espiritual', 'Intelectual', 'Social']) {
    await expect(page.getByRole('heading', { name: area, exact: true })).toBeVisible();
  }
  const trailLinks = page.locator('section[id^="area-"] a.list-item');
  await expect(trailLinks).toHaveCount(18);
  // Estados com texto (não só cor)
  await expect(page.locator('section#area-F').getByText('Validado')).toBeVisible();
  await expect(page.locator('section#area-A').getByText('Devolvido')).toBeVisible();
  await expect(page.locator('section#area-S').getByText('Pendente')).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/progresso-${info.project.name}.png`, fullPage: true });

  await page.locator('section#area-C').getByRole('link', { name: /Responsabilidade/ }).click();
  await expect(page.getByRole('heading', { name: 'Responsabilidade' })).toBeVisible();
  await expect(page.getByText('C4', { exact: true })).toBeVisible();
  await expect(page.getByText('Pendente:').first()).toBeVisible(); // ambiguidade do catálogo assinalada
  await expect(page.getByText(/exemplos, não uma lista fechada/)).toBeVisible();
  await noHorizontalScroll(page);

  // Rascunho: guardar só confirma depois do servidor responder
  await page.goto('/pedidos/r-draft');
  await page.getByLabel('Reflexão').fill('Aprendi a fazer escolhas com consciência.');
  mock.failNext('save_request_draft', 'network');
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByText(/Sem ligação ao servidor.*nada foi guardado/)).toBeVisible();
  await expect(page.getByText('Rascunho guardado.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByText('Rascunho guardado.')).toBeVisible();
  const saved = mock.calls.find((c) => c.fn === 'save_request_draft');
  expect(saved?.body.p_reflection).toBe('Aprendi a fazer escolhas com consciência.');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/pedido-${info.project.name}.png`, fullPage: true });

  // Submeter exige confirmação e mostra o erro do servidor (ex.: duplicado)
  mock.failNext('submit_trail_request', 'error', 'Já existe um pedido ativo ou uma validação para este trilho.');
  await page.getByRole('button', { name: 'Submeter' }).click();
  await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Submeter' }).click();
  await expect(page.getByText('Já existe um pedido ativo')).toBeVisible();

  // Pedido devolvido: histórico com comentário e nova versão
  await page.goto('/pedidos/r-dev');
  await expect(page.getByText('Falta mostrar continuidade.')).toBeVisible();
  await page.getByRole('button', { name: 'Preparar nova versão' }).click();
  await expect(page.getByText('Nova versão criada.')).toBeVisible();
  expect(mock.calls.some((c) => c.fn === 'start_new_version' && c.body.p_request === 'r-dev')).toBe(true);
});

test('pioneiro não vê ecrãs de gestão', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/gestao');
  await expect(page.getByRole('heading', { name: 'Olá, Pedro' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gestão' })).toHaveCount(0);
});

test('dirigente e administração', async ({ page }, info) => {
  const mock = await installMock(page, leader());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pendentes' })).toBeVisible();
  await expect(page.getByText(/pedido\(s\) de entrada por confirmar/)).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto('/dirigentes/negociacao');
  await expect(page.getByText(/Proposta:/)).toBeVisible();
  await page.getByRole('button', { name: 'Não aceitar' }).isDisabled();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Escolha confirmada.')).toBeVisible();
  expect(mock.calls.some((c) => c.fn === 'decide_choice' && c.body.p_accept === true)).toBe(true);
  await page.screenshot({ path: `test-results/negociacao-${info.project.name}.png`, fullPage: true });

  await page.goto('/revisoes/pedido/r-hist');
  await expect(page.getByRole('heading', { name: 'Decisão sobre progresso anterior' })).toBeVisible();
  await page.getByLabel('Não reconhecer').check();
  await expect(page.getByRole('button', { name: 'Registar decisão' })).toBeDisabled(); // comentário obrigatório
  await page.getByLabel('Comentário (obrigatório)').fill('Sem evidência suficiente.');
  await page.getByRole('button', { name: 'Registar decisão' }).click();
  await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Registar decisão' }).click();
  await expect(page.getByText('Decisão registada.')).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'decide_historical_request')?.body).toMatchObject({ p_outcome: 'recusado', p_expected_version: 1 });

  await page.goto('/gestao/membros');
  await expect(page.getByText('Pessoa Nova Teste')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar entrada' })).toBeDisabled(); // falta a equipa
  await noHorizontalScroll(page);

  await page.goto('/gestao/configuracoes');
  await page.getByRole('button', { name: 'Desativar progresso anterior' }).click();
  await page.getByRole('button', { name: 'Desativar', exact: true }).click();
  await expect(page.getByText('Progresso anterior desativado.')).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'set_historical_progress')?.body).toMatchObject({ p_enabled: false });
  await page.screenshot({ path: `test-results/gestao-${info.project.name}.png`, fullPage: true });

  await page.goto('/membros/m-p1');
  await expect(page.getByRole('heading', { name: 'Início de Pista e Promessa' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Anilha de mérito' })).toBeVisible();
  await expect(page.getByText('Ainda não elegível').first()).toBeVisible();
  await noHorizontalScroll(page);
});

test('acessibilidade básica: saltar para o conteúdo e foco visível', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Olá, Pedro' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar para o conteúdo' })).toBeFocused();
});
