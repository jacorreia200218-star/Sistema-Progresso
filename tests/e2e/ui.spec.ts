import { expect, test, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

async function noHorizontalScroll(page: Page) {
  // Compara com a largura configurada: em telemóvel um elemento largo alarga o viewport de layout (e a página fica reduzida).
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
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
  await expect(page.locator('.next-step')).toContainText('Rever o pedido de «Autoestima»');
  const stats = page.getByRole('list', { name: 'Resumo do meu progresso' });
  await expect(stats.getByRole('link', { name: /Etapa atual/ })).toContainText('Conhecimento');
  await expect(stats.getByRole('link', { name: /Trilhos validados/ })).toHaveAttribute('href', '/meu-progresso?vista=validado');
  await expect(stats.getByRole('link', { name: /Pedidos em validação/ })).toHaveAttribute('href', '/meu-progresso?vista=pedidos&pfiltro=aguarda');
  await expect(stats.getByRole('link', { name: /Pedidos a rever/ })).toHaveAttribute('href', '/meu-progresso?vista=pedidos&pfiltro=revisao');
  await expect(page.locator('main').getByText('Em desenvolvimento')).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/inicio-${info.project.name}.png`, fullPage: true });

  await nav(page, 'Progresso');
  await expect(page.getByRole('heading', { name: 'Meu progresso' })).toBeVisible();
  const cards = page.locator('.area-card');
  await expect(cards).toHaveCount(6);
  await expect(cards.filter({ hasText: 'Físico' })).toContainText('1 de 3 trilhos validados');
  // Cartão só com nome, segmentos, total validado e trilho da etapa; o estado de cada trilho vê-se ao abrir a área
  await expect(cards.filter({ hasText: 'Afetivo' })).toContainText('Conhecimento: Autoestima');
  await expect(cards.filter({ hasText: 'Afetivo' })).not.toContainText('a rever');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/progresso-${info.project.name}.png`, fullPage: true });

  await cards.filter({ hasText: 'Caráter' }).click();
  await page.locator('.trail-row', { hasText: 'Responsabilidade' }).click();
  await expect(page.getByRole('heading', { name: 'Responsabilidade', level: 1 })).toBeVisible();
  await expect(page.getByText('C4', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Pendente:').first()).toBeVisible(); // ambiguidade do catálogo assinalada
  await expect(page.getByText('Ver exemplos')).toBeVisible(); // exemplos do manual dentro do trilho
  await noHorizontalScroll(page);

  // Rascunho antigo (por trilho): continua-se na página do trilho, por objetivos
  await page.goto('/pedidos/r-draft');
  await expect(page.getByRole('link', { name: 'Continuar no trilho' })).toHaveAttribute('href', '/meu-progresso/trilho/carater-autonomia#pedido');

  // Progresso anterior: o editor próprio mantém-se (guardar só confirma depois do servidor responder)
  await page.goto('/pedidos/r-hist');
  await expect(page.getByText('Fui guia de cozinha no acampamento.')).toBeVisible();
  void mock;
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
  await expect(page.getByRole('heading', { name: 'Gestão' })).toBeVisible();
  await expect(page.getByText('Pedidos de entrada por confirmar')).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto('/dirigentes/negociacao');
  await expect(page).toHaveURL(/\/acompanhamento\/pedidos\?tipo=negociacao/);
  await page.locator('.inbox').getByRole('link', { name: /Serviço/ }).click();
  await expect(page).toHaveURL(/\/acompanhamento\/proposta\/c-espiritual-servico/);
  await expect(page.getByRole('heading', { name: 'Decisão da negociação' })).toBeVisible();
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
  // A equipa indicada pela pessoa vem pré-preenchida; a administração pode corrigir
  await expect(page.getByText('indicou a equipa Equipa Bússola')).toBeVisible();
  await expect(page.locator('#m-novo-team')).toHaveValue('teamB');
  await expect(page.getByRole('button', { name: 'Aprovar entrada' })).toBeEnabled();
  await noHorizontalScroll(page);

  await page.goto('/gestao/configuracoes');
  await page.getByRole('button', { name: 'Desativar progresso anterior' }).click();
  await page.getByRole('button', { name: 'Desativar', exact: true }).click();
  await expect(page.getByText('Progresso anterior desativado.')).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'set_historical_progress')?.body).toMatchObject({ p_enabled: false });
  await page.screenshot({ path: `test-results/gestao-${info.project.name}.png`, fullPage: true });

  await page.goto('/membros/m-p1?separador=historico');
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
