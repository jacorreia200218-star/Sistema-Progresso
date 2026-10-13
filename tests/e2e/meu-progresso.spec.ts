import { expect, test, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

async function noHorizontalScroll(page: Page) {
  // Compara com a largura configurada: em telemóvel um elemento largo alarga o viewport de layout (e a página fica reduzida).
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow, 'sem deslocamento horizontal').toBeLessThanOrEqual(1);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fluxo completo: área → trilho → vivência → pedido → validação (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    const persona = pioneer();
    const mock = await installMock(page, persona);

    // 1. Abrir Meu progresso e escolher a área
    await page.goto('/meu-progresso?vista=areas');
    await expect(page.getByRole('tab', { name: 'Áreas FACEIS', selected: true })).toBeVisible();
    await page.locator('.area-card', { hasText: 'Espiritual' }).click();
    await expect(page.getByRole('heading', { name: 'Desenvolvimento Espiritual' })).toBeVisible();
    // Os três trilhos com os nomes oficiais do manual
    await expect(page.locator('.trail-row')).toHaveCount(3);
    for (const n of ['Descoberta', 'Aprofundamento', 'Serviço']) await expect(page.locator('.trail-row', { hasText: n })).toBeVisible();

    // 2. Consultar o trilho e os objetivos
    await page.locator('.trail-row', { hasText: 'Aprofundamento' }).click();
    await expect(page.getByRole('heading', { name: 'Aprofundamento', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Objetivos', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Próximo passo', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Estás em' })).toContainText('Espiritual');
    await expect(page.getByText('Aprofundo os hábitos de oração diários e participo nas celebrações comunitárias.').first()).toBeVisible();
    await page.getByText('Explicação e palavras-chave').click();
    await expect(page.getByText(/Diálogo Inter-religioso/)).toBeVisible();
    await expect(page.locator('.trail-head')).toContainText('Por iniciar');
    await noHorizontalScroll(page);

    // 3. Registar uma vivência
    await page.getByLabel('O que viveste?').fill('Animei a oração da manhã no acampamento');
    await page.getByLabel('Reflexão (opcional)').fill('Percebi que gosto de preparar a oração.');
    await page.getByRole('button', { name: 'Registar vivência' }).click();
    await expect(page.getByText('Vivência registada.')).toBeVisible();
    expect(mock.calls.find((c) => c.fn === 'POST experiences')?.body).toMatchObject({ trail_key: 'espiritual-aprofundamento', title: 'Animei a oração da manhã no acampamento' });
    await expect(page.locator('#vivencias').getByText('Animei a oração da manhã no acampamento')).toBeVisible();
    await expect(page.locator('.trail-head')).toContainText('Em desenvolvimento');

    // 4. Pedir validação no próprio trilho (área e trilho já definidos)
    await page.locator('#pedido').getByRole('button', { name: 'Pedir validação' }).click();
    await expect(page.getByText('Rascunho criado.')).toBeVisible();
    await page.getByLabel('O que fiz').fill('Preparei e animei três momentos de oração da Equipa.');
    await page.getByLabel('Em que contexto').fill('Acampamento de Equipa, em julho.');
    await page.getByLabel('O que aprendi (obrigatório)').fill('A oração diária ajuda-me a parar e agradecer.');
    await page.getByLabel('Como demonstrei os objetivos do trilho').fill('E4: rezo todos os dias e participo na Eucaristia ao domingo.');
    await expect(page.locator('.destination')).toContainText('reunião de Equipa');
    await expect(page.getByText(/Submeter não é concluir/)).toBeVisible();
    await page.getByRole('button', { name: 'Guardar rascunho' }).click();
    await expect(page.getByText('Rascunho guardado.')).toBeVisible();
    expect(mock.calls.find((c) => c.fn === 'save_request_draft')?.body).toMatchObject({ p_context: 'Acampamento de Equipa, em julho.', p_evidence: 'E4: rezo todos os dias e participo na Eucaristia ao domingo.' });
    await page.screenshot({ path: `test-results/trilho-pedido-${info.project.name}-${theme}.png`, fullPage: true });
    await page.locator('#pedido').getByRole('button', { name: 'Submeter' }).click();
    await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Submeter' }).click();
    await expect(page.getByText('Pedido submetido.')).toBeVisible();

    // 5. Estado: a aguardar validação (submeter não é concluir) e sem duplicação
    await expect(page.locator('.trail-head')).toContainText('A aguardar validação');
    await expect(page.locator('#pedido').getByRole('button', { name: 'Pedir validação' })).toHaveCount(0);
    expect(mock.calls.filter((c) => c.fn === 'create_trail_request')).toHaveLength(1);
    await page.goto('/meu-progresso?vista=pedidos&pfiltro=aguarda');
    await expect(page.locator('.request-card', { hasText: 'Aprofundamento' })).toBeVisible();

    // 6. A reunião de Equipa valida (simulado no servidor de teste) → o que falta atualiza
    const req = persona.tables.trail_requests.find((r) => r.trail_key === 'espiritual-aprofundamento')!;
    req.status = 'validado_equipa';
    persona.tables.trail_decisions.push({ id: 'd-novo', request_id: req.id, version_id: `v-${req.id}`, kind: 'validado_equipa', meeting_date: '2026-10-10', comment: 'Validado em reunião de Equipa.', reference_date: null, recorded_by: 'u-guia', recorded_as: 'guia', recorded_at: new Date().toISOString() });
    await page.goto('/meu-progresso/trilho/espiritual-aprofundamento');
    await expect(page.locator('.trail-head')).toContainText('Validado');
    await expect(page.getByText(/Validado na reunião de Equipa em 10\/10\/2026/)).toBeVisible();
    await expect(page.getByText('Validado em reunião de Equipa.').first()).toBeVisible();
    await page.goto('/meu-progresso?vista=areas');
    await expect(page.locator('.area-card', { hasText: 'Espiritual' })).toContainText('1 de 3 validados');
    await noHorizontalScroll(page);
  });
}

test('pedido devolvido: feedback e ação para corrigir', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso?vista=pedidos&pfiltro=revisao');
  const card = page.locator('.request-card', { hasText: 'Autoestima' });
  await expect(card).toContainText('Falta mostrar continuidade.');
  await card.getByRole('link', { name: 'Corrigir ou complementar' }).click();
  await expect(page.getByRole('heading', { name: 'Autoestima', level: 1 })).toBeVisible();
  await expect(page.locator('.next-step')).toContainText('devolvido');
  await expect(page.locator('#pedido').getByText('Falta mostrar continuidade.')).toBeVisible();
  await expect(page.locator('#pedido').getByRole('button', { name: 'Preparar nova versão' })).toBeVisible();
});

test('dirigente: consulta claramente identificada, sem percurso próprio nem ações do pioneiro', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/meu-progresso');
  await expect(page.getByRole('heading', { name: 'Progresso dos pioneiros' })).toBeVisible();
  await expect(page.getByText(/Os dirigentes não têm percurso pessoal/)).toBeVisible();
  await page.getByLabel('Consultar o progresso de').selectOption({ label: 'Pedro Teste' });
  await expect(page.getByRole('heading', { name: 'Progresso de Pedro' })).toBeVisible();
  await expect(page.getByText(/Modo de consulta/).first()).toBeVisible();
  await expect(page.locator('.summary .faceis-row')).toHaveCount(6);
  await expect(page.locator('.summary')).toContainText('Próximo passo do pioneiro');
  await page.screenshot({ path: `test-results/consulta-dirigente-${info.project.name}.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Áreas FACEIS' }).click();
  await expect(page).toHaveURL(/pioneiro=m-p1/);
  await page.locator('.area-card', { hasText: 'Afetivo' }).click();
  await page.locator('.trail-row', { hasText: 'Autoestima' }).click();
  await expect(page.getByText(/Modo de consulta · Pedro Teste/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Próximo passo do pioneiro' })).toBeVisible();
  await expect(page.getByText(/^Podes /)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pedir validação' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registar vivência' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preparar nova versão' })).toHaveCount(0);
});

test('filtros preservados ao voltar de um trilho', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso?vista=areas');
  await page.getByRole('radiogroup', { name: 'Filtrar trilhos' }).getByText('Validados', { exact: true }).click();
  await expect(page).toHaveURL(/filtro=validado/);
  await page.locator('.trail-row', { hasText: 'Desempenho' }).click();
  await expect(page.getByRole('heading', { name: 'Desempenho', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à área' }).click();
  await expect(page).toHaveURL(/filtro=validado/);
  await expect(page.locator('.trail-row')).toHaveCount(1);
});
