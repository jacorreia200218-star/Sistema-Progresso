import { expect, test, type Page } from '@playwright/test';
import { bigLeader, emptyLeader, installMock, leader, pioneer } from './mock-api';

async function noHorizontalScroll(page: Page) {
  // Compara com a largura configurada: em telemóvel um elemento largo alarga o viewport de layout (e a página fica reduzida).
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow, 'sem deslocamento horizontal').toBeLessThanOrEqual(1);
}

for (const theme of ['light', 'dark'] as const) {
  test(`percurso individual: resumo único, histórico vs. etapa, mapa só quando aberto (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await installMock(page, pioneer());
    await page.goto('/meu-progresso?vista=caminho');
    await expect(page.getByRole('heading', { name: 'Meu progresso', exact: true })).toBeVisible();
    const summary = page.locator('.summary');
    await expect(summary.getByRole('heading', { name: 'Etapa atual' })).toBeVisible();
    await expect(summary.getByRole('heading', { name: 'Histórico reconhecido' })).toBeVisible();
    await expect(summary).toContainText('1 de 6 áreas com trilho validado nesta etapa');
    await expect(summary.locator('.faceis-row')).toHaveCount(6);
    await expect(summary).toContainText('Falta escolher o trilho de Intelectual e Social.');
    // O mapa e as explicações estão fechados até se abrirem
    await expect(page.locator('.track')).toBeHidden();
    await page.getByText('Ver o mapa do caminho').click();
    await expect(page.locator('.track > li')).toHaveCount(8);
    await expect(page.locator('.track [aria-current="step"]')).toContainText('Conhecimento');
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/caminho-meu-${info.project.name}-${theme}.png`, fullPage: true });
    // Selecionar um requisito (área) abre o trilho
    await summary.locator('.faceis-row', { hasText: 'Afetivo' }).click();
    await expect(page.getByRole('heading', { name: 'Autoestima', level: 1 })).toBeVisible();
  });
}

test('caminho da secção para o pioneiro: só o próprio nome e contagens dos outros', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/caminho');
  await expect(page.getByText(/Vês o teu nome; dos outros pioneiros/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Pedro Teste \(tu\)/ })).toBeVisible();
  await expect(page.getByText('Diogo Fictício')).toHaveCount(0);
  await expect(page.locator('.track-step', { hasText: 'Conhecimento' })).toContainText('+3 outros');
});

for (const theme of ['light', 'dark'] as const) {
  test(`caminho da secção do dirigente: avatares, painel, pesquisa e equipa (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await installMock(page, leader());
    await page.goto('/caminho');
    const conhecimento = page.locator('.track-step', { hasText: 'Conhecimento' });
    await expect(conhecimento).toContainText('4 pessoas');
    // Ordem alfabética, nunca por progresso
    const names = await conhecimento.locator('.avatar-btn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.split(',')[0]));
    expect(names).toEqual(['Diogo Fictício', 'Eva Fictícia', 'Filipe Fictício', 'Pedro Teste']);
    // Avatares com o mesmo tamanho
    const sizes = await page.locator('.avatar-btn .avatar').evaluateAll((els) => [...new Set(els.map((e) => `${e.getBoundingClientRect().width}x${e.getBoundingClientRect().height}`))]);
    expect(sizes).toEqual(['40x40']);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/caminho-seccao-${info.project.name}-${theme}.png`, fullPage: true });

    // Teclado: abrir o painel da pessoa, fechar com Esc
    await conhecimento.getByRole('button', { name: /^Pedro Teste/ }).focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Percurso' });
    await expect(panel).toContainText('Pedro Teste');
    await expect(panel).toContainText('Equipa Andorinha');
    await expect(panel).toContainText('Etapa atual');
    await expect(panel.locator('.faceis-row')).toHaveCount(6);
    await expect(panel).toContainText('Próximo passo do pioneiro');
    await expect(panel.getByRole('link', { name: 'Ver percurso' })).toHaveAttribute('href', /pioneiro=m-p1/);
    await expect(panel.getByRole('link', { name: 'Ver trilhos' })).toHaveAttribute('href', /vista=areas/);
    await expect(page).toHaveURL(/pessoa=m-p1/);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/caminho-painel-${info.project.name}-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // Pesquisa por nome e filtro por equipa (preservados no endereço)
    await page.getByPlaceholder('Pesquisar por nome').fill('eva');
    await expect(page.locator('.avatar-btn')).toHaveCount(1);
    await expect(page).toHaveURL(/q=eva/);
    await page.getByPlaceholder('Pesquisar por nome').fill('');
    await page.getByLabel('Equipa', { exact: true }).selectOption('teamB');
    await expect(page.getByRole('button', { name: /Filipe Fictício/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Diogo Fictício/ })).toBeVisible();
    await expect(page).toHaveURL(/equipa=teamB/);
  });
}

test('grupos grandes: alguns avatares e «+N» com a lista completa', async ({ page }) => {
  await installMock(page, bigLeader());
  await page.goto('/caminho');
  const conhecimento = page.locator('.track-step', { hasText: 'Conhecimento' });
  await expect(conhecimento.locator('.avatar-btn')).toHaveCount(8); // 7 pessoas + «+N»
  await conhecimento.getByRole('button', { name: 'Ver todos (13)' }).click();
  const list = page.getByRole('dialog', { name: /Conhecimento · 13/ });
  await expect(list.locator('.person')).toHaveCount(13);
  await list.getByRole('button', { name: /Zé Extra C/ }).click();
  await expect(page.getByRole('dialog', { name: 'Percurso' })).toContainText('Zé Extra C');
});

test('início do dirigente: cartões com ligações filtradas, marcos e atividade', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/');
  const stats = page.getByRole('list', { name: 'Resumo da secção' });
  await expect(stats.getByRole('link', { name: /Pioneiros/ })).toHaveAttribute('href', '/caminho');
  await expect(stats.getByRole('link', { name: /Pedidos pendentes/ })).toHaveAttribute('href', '/acompanhamento/pedidos');
  await expect(stats.getByRole('link', { name: /Etapas por validar/ })).toHaveAttribute('href', '/acompanhamento/conselho');
  await page.getByRole('list', { name: 'Pessoas por marco do caminho' }).getByRole('link', { name: /Conhecimento/ }).click();
  await expect(page.getByRole('dialog', { name: /Conhecimento · 4/ })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('#h-act').locator('..').locator('..').locator('.list-item')).toHaveCount(2);
  await page.getByRole('link', { name: 'Ver atividade' }).click();
  await expect(page.getByRole('heading', { name: 'Atividade', level: 1 })).toBeVisible();
  await page.goto('/');
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
  expect(bg).toBe('rgb(20, 22, 25)');
});
