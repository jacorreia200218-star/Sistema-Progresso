import { expect, test, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

async function noHorizontalScroll(page: Page) {
  // Compara com a largura configurada: em telemóvel um elemento largo alarga o viewport de layout (e a página fica reduzida).
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow, 'sem deslocamento horizontal').toBeLessThanOrEqual(1);
}

const LABEL = 'Como demonstrei que alcancei este trilho?';
const confirm = (page: Page, name: string) => page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name });

for (const theme of ['light', 'dark'] as const) {
  test(`fluxo: área → trilho → objetivos e justificação → pedir validação (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    const mock = await installMock(page, pioneer());

    // 1. Seis cartões FACEIS com três segmentos (trilhos validados)
    await page.goto('/meu-progresso');
    await expect(page.getByRole('heading', { name: 'Meu progresso', level: 1 })).toBeVisible();
    const cards = page.locator('.area-card');
    await expect(cards).toHaveCount(6);
    const fisico = cards.filter({ hasText: 'Físico' });
    await expect(fisico.locator('.seg')).toHaveCount(3);
    await expect(fisico.locator('.segments')).toHaveAttribute('aria-hidden', 'true'); // o número está no texto, sem repetir
    await expect(fisico).toContainText('Conhecimento: Desempenho');
    await expect(page.locator('.legend summary')).toHaveText('Trilhos validados na área');
    await page.locator('.legend summary').click();
    await expect(page.locator('.legend')).toContainText('Um segmento preenchido é um trilho validado');
    await expect(fisico).toContainText('1 de 3 trilhos validados');
    await expect(page.locator('main').getByText('Em desenvolvimento')).toHaveCount(0);
    await noHorizontalScroll(page);

    // 2. Os três trilhos da área com códigos e estado
    await fisico.click();
    const rows = page.locator('.trail-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Desempenho' })).toContainText('F1');
    await expect(rows.filter({ hasText: 'Desempenho' })).toContainText('Validado');
    await expect(rows.filter({ hasText: 'Autoconhecimento' })).toContainText('F2');
    await expect(rows.filter({ hasText: 'Autoconhecimento' })).toContainText('F3');
    await expect(rows.filter({ hasText: 'Autoconhecimento' })).toContainText('Por fechar');

    // 3. Página do trilho: área e trilho, TODOS os objetivos (sem caixas de seleção), justificação
    await rows.filter({ hasText: 'Autoconhecimento' }).click();
    await expect(page.getByRole('heading', { name: 'Autoconhecimento', level: 1 })).toBeVisible();
    // Duas ações separadas: trabalhar (propor) ou fechar (pedir validação)
    await page.getByRole('radiogroup', { name: 'O que queres fazer com este trilho' }).getByText('Fechar este trilho').click();
    await expect(page.locator('.trail-head')).toContainText('Físico');
    const objs = page.getByRole('region', { name: 'Objetivos do trilho Autoconhecimento' });
    await expect(objs.locator('.obj-item')).toHaveCount(2);
    await expect(objs).toContainText('F2');
    await expect(objs).toContainText('F3');
    await expect(objs).toContainText('Aceito-me como sou e respeito as diferenças físicas entre as pessoas.');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByText('Explica o que fizeste, em que situações e como isso demonstra os objetivos acima.')).toBeVisible();
    const send = page.getByRole('button', { name: 'Pedir validação do trilho' });
    await expect(send).toBeDisabled(); // justificação obrigatória
    const text = 'No raid ajudei a equipa a adaptar o percurso a um colega com uma lesão e percebi que aceitar os meus limites também é força.';
    await page.getByLabel(LABEL).fill(text);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/fluxo-pedido-${info.project.name}-${theme}.png`, fullPage: true });

    // 4. Voltar atrás preserva a justificação
    await page.goBack();
    await expect(page.locator('.trail-row')).toHaveCount(3);
    await page.goForward();
    await expect(page.getByLabel(LABEL)).toHaveValue(text);

    // 5. Erro de gravação: nada é dado como enviado e o texto mantém-se
    mock.failNext('submit_trail_validation', 'network');
    await send.click();
    await confirm(page, 'Pedir validação do trilho').click();
    await expect(page.getByText(/Sem ligação ao servidor/)).toBeVisible();
    await expect(page.getByText(/Pedido enviado/)).toHaveCount(0);
    await expect(page.getByLabel(LABEL)).toHaveValue(text);
    await page.getByRole('button', { name: 'Pedir validação do trilho' }).click();
    await confirm(page, 'Pedir validação do trilho').click();
    await expect(page.getByText('Pedido enviado. Podes acompanhá-lo em Os meus pedidos.')).toBeVisible();

    // Um só pedido; enviado para o trilho completo, sem lista de objetivos
    expect(mock.calls.filter((c) => c.fn === 'create_trail_request')).toHaveLength(1);
    const sent = mock.calls.filter((c) => c.fn === 'submit_trail_validation').pop()!;
    expect(sent.body).toMatchObject({ p_justification: text, p_expected_version: 1 });
    expect(sent.body).not.toHaveProperty('p_objectives');
    // Enviar não é fechar
    await expect(page.locator('.trail-head')).toContainText('Em validação');
    await expect(page.locator('.trail-head')).not.toContainText('Validado');
    await page.screenshot({ path: `test-results/fluxo-enviado-${info.project.name}-${theme}.png`, fullPage: true });

    // 6. Os meus pedidos: trilho, objetivos e estado
    await page.getByRole('link', { name: 'Os meus pedidos' }).first().click();
    const card = page.locator('.request-card', { hasText: 'Autoconhecimento' });
    await expect(card).toContainText('F2');
    await expect(card).toContainText('F3');
    await expect(card).toContainText('Em validação');
    await noHorizontalScroll(page);
  });
}

test('Desempenho tem F1; Autoconhecimento tem F2 e F3', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/fisico-desempenho#pedido');
  await expect(page.locator('.obj-item')).toHaveCount(1);
  await expect(page.locator('.obj-item')).toContainText('F1');
  await page.goto('/meu-progresso/trilho/fisico-bem-estar-fisico#pedido');
  await expect(page.getByRole('region', { name: /Objetivos do trilho/ }).locator('.obj-item')).toHaveCount(1);
  await expect(page.getByRole('region', { name: /Objetivos do trilho/ })).toContainText('F4');
});

test('mudar de trilho não transporta a justificação; voltar recupera-a', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/fisico-autoconhecimento#pedido');
  await page.getByLabel(LABEL).fill('Texto do Autoconhecimento');
  await page.goto('/meu-progresso/trilho/fisico-bem-estar-fisico#pedido');
  await expect(page.getByLabel(LABEL)).toHaveValue('');
  await page.goto('/meu-progresso/trilho/fisico-autoconhecimento#pedido');
  await expect(page.getByLabel(LABEL)).toHaveValue('Texto do Autoconhecimento');
});

test('pedido em validação: sem formulário, o trilho continua por fechar', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/espiritual-descoberta');
  await expect(page.locator('.trail-head')).toContainText('Em validação');
  await expect(page.getByLabel(LABEL)).toHaveCount(0);
  await expect(page.getByText(/aguarda a decisão da reunião de Equipa sobre o trilho completo/)).toBeVisible();
});

test('a rever: comentário e objetivos a demonstrar, corrigir e reenviar com histórico', async ({ page }, info) => {
  const mock = await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/afetivo-autoestima');
  await expect(page.locator('.trail-head')).toContainText('A rever');
  await expect(page.getByText('«Falta mostrar continuidade.»')).toBeVisible();
  const field = page.getByLabel(LABEL);
  await expect(field).toHaveValue('Reflexão inicial.');
  await field.fill('Reflexão inicial. Desde setembro mantive o diário da equipa todas as semanas.');
  await page.screenshot({ path: `test-results/fluxo-rever-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Pedir validação do trilho' }).click();
  await confirm(page, 'Pedir validação do trilho').click();
  await expect(page.getByText('Pedido enviado. Podes acompanhá-lo em Os meus pedidos.')).toBeVisible();
  expect(mock.calls.map((c) => c.fn).filter((f) => ['start_new_version', 'submit_trail_validation'].includes(f))).toEqual(['start_new_version', 'submit_trail_validation']);
  expect(mock.calls.find((c) => c.fn === 'submit_trail_validation')!.body).toMatchObject({ p_request: 'r-dev', p_expected_version: 2 });
  await page.goto('/pedidos/r-dev');
  await expect(page.getByText('Versão 1')).toBeVisible();
  await expect(page.getByText('Versão 2').first()).toBeVisible();
});

test('histórico por objetivos preservado sem fechar o trilho', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/intelectual-procura-do-conhecimento#pedido');
  await expect(page.locator('.trail-head')).toContainText('Por fechar');
  // O histórico do modelo anterior só aparece aos dirigentes
  await expect(page.getByText('Histórico por objetivos (modelo anterior)')).toHaveCount(0);
  // O pedido novo abrange o trilho completo
  await expect(page.getByRole('region', { name: /Objetivos do trilho/ }).locator('.obj-item')).toHaveCount(2);
  await expect(page.getByLabel(LABEL)).toBeVisible();
});

test('revisão: o pedido e a revisão mostram os mesmos objetivos; devolver com objetivos a demonstrar', async ({ page }, info) => {
  const mock = await installMock(page, leader());
  await page.goto('/revisoes/pedido/r-obj');
  await expect(page.getByRole('heading', { name: 'Descoberta', level: 1 })).toBeVisible();
  for (const t of ['Pedro Teste', 'Equipa Andorinha', 'Espiritual']) await expect(page.locator('main')).toContainText(t);
  const objs = page.getByRole('list', { name: 'Objetivos do trilho' });
  const codes = await objs.locator('.code').allTextContents();
  expect(codes).toEqual(['E1', 'E2', 'E3']);
  await expect(page.getByText('Preparei a vigília da equipa')).toBeVisible();
  await page.screenshot({ path: `test-results/revisao-trilho-${info.project.name}.png`, fullPage: true });

  await page.getByRole('radio', { name: /Devolver para revisão/ }).check();
  await page.locator('.obj-flags').getByText('E2').click();
  await page.getByLabel(/Fundamentação/).fill('Fala de um momento em que partilhaste a tua fé com outros.');
  await page.getByRole('button', { name: 'Registar decisão' }).click();
  await confirm(page, 'Devolver para revisão').click();
  await expect(page.getByText('Pedido devolvido para revisão.')).toBeVisible();
  const call = mock.calls.find((c) => c.fn === 'record_team_decision')!;
  expect(call.body).toMatchObject({ p_request: 'r-obj', p_validated: false, p_objective_codes: ['E2'], p_comment: 'Fala de um momento em que partilhaste a tua fé com outros.' });
});

test('revisão: validar o trilho completo', async ({ page }) => {
  const mock = await installMock(page, leader());
  await page.goto('/revisoes/pedido/r-obj');
  await page.getByRole('radio', { name: /Validar o trilho/ }).check();
  await page.getByLabel(/Comentário|Fundamentação/).fill('Demonstrou os três objetivos na vigília e no serviço.');
  await page.getByRole('button', { name: 'Registar decisão' }).click();
  await confirm(page, 'Validar o trilho').click();
  await expect(page.getByText(/Trilho validado/).first()).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'record_team_decision')!.body).toMatchObject({ p_validated: true, p_objective_codes: null });
});

test('revisão: os dirigentes confirmam o trilho validado pelos guias', async ({ page }) => {
  const persona = leader();
  persona.tables.trail_requests!.find((r) => r.id === 'r-obj')!.status = 'validado_guias';
  const mock = await installMock(page, persona);
  await page.goto('/revisoes/pedido/r-obj');
  await expect(page.getByText('Aguarda dirigentes').first()).toBeVisible();
  await expect(page.getByRole('radio', { name: /Validar o trilho/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar validação' }).click();
  await confirm(page, 'Confirmar validação').click();
  await expect(page.getByText('Trilho validado.').first()).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'confirm_trail_validation')!.body).toMatchObject({ p_request: 'r-obj', p_comment: null });
});

test('dirigente: grelha de pioneiros, consulta e volta com os filtros', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/meu-progresso');
  // A grelha é o separador «Pioneiros» do Acompanhamento.
  await expect(page.getByRole('heading', { name: 'Acompanhamento', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secções do acompanhamento' }).getByRole('link', { name: 'Pioneiros' })).toHaveAttribute('aria-current', 'page');
  const grid = page.locator('.people-grid');
  await expect(grid.locator('.person-card').first()).toBeVisible();
  // Ordem alfabética
  const names = await grid.locator('.person-name').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt')));
  await page.getByLabel('Filtrar por equipa').selectOption({ label: 'Equipa Andorinha' });
  await page.getByPlaceholder('Pesquisar por nome').fill('pedro');
  await expect(grid.locator('.person-card')).toHaveCount(1);
  await noHorizontalScroll(page);
  // Estado resumido no cartão (o detalhe fica no percurso)
  await page.getByPlaceholder('Pesquisar por nome').fill('carla');
  await expect(grid.locator('.person-card')).toContainText('Aguarda Promessa');
  await expect(grid.locator('.person-card')).not.toContainText('Adesão decidida');
  await page.getByPlaceholder('Pesquisar por nome').fill('pedro');
  await page.screenshot({ path: `test-results/grelha-${info.project.name}.png`, fullPage: true });

  await grid.locator('.person-card', { hasText: 'Pedro Teste' }).click();
  const head = page.getByRole('region', { name: /Modo de consulta/ });
  await expect(head).toContainText('Pedro Teste');
  for (const l of ['Todos os pioneiros', 'Pedidos', 'Percurso', 'Decisões']) await expect(head.getByRole('link', { name: l, exact: true })).toBeVisible();
  // Sem acessos repetidos fora do cabeçalho
  for (const l of ['Pedidos', 'Percurso']) await expect(page.getByRole('link', { name: l, exact: true })).toHaveCount(1);
  await expect(page.getByText('Pedidos deste pioneiro')).toHaveCount(0);
  await expect(page.getByText('Os meus pedidos')).toHaveCount(0);
  // Identificação numa linha, ações na seguinte; equipa e modo sem quebras a meio
  const who = await head.locator('.consult-who').boundingBox();
  const acts = await head.locator('.consult-links').boundingBox();
  expect(acts!.y).toBeGreaterThanOrEqual(who!.y + who!.height - 1);
  for (const sel of ['.consult-meta .nowrap >> nth=0', '.consult-mode']) {
    const lines = await head.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || '18')));
    expect(lines).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: `test-results/consulta-${info.project.name}.png`, fullPage: true });
  await expect(page.locator('.area-card')).toHaveCount(6);
  await page.locator('.area-card', { hasText: 'Afetivo' }).click();
  await page.locator('.trail-row', { hasText: 'Autoestima' }).click();
  await expect(page.getByLabel(LABEL)).toHaveCount(0); // consulta: sem ações do pioneiro
  await expect(page.getByRole('button', { name: 'Pedir validação do trilho' })).toHaveCount(0);

  await page.getByRole('region', { name: /Modo de consulta/ }).getByRole('link', { name: 'Todos os pioneiros' }).click();
  await expect(page.getByPlaceholder('Pesquisar por nome')).toHaveValue('pedro');
  await expect(page.locator('.people-grid .person-card')).toHaveCount(1);
});

test('grelha: teclado, nomes longos e regresso com o botão de voltar', async ({ page }, info) => {
  const persona = leader();
  const sp = persona.rpc!.section_path as { members: Record<string, unknown>[] };
  sp.members = [...sp.members, { membership_id: 'm-longo', full_name: 'Maria Francisca de Albuquerque e Vasconcelos Teixeira', totem: null, photo_path: null, team_id: 'teamB', function: 'pioneiro', milestone: 'promessa', state: 'aguarda_promessa', is_me: false }];
  await installMock(page, persona);
  await page.goto('/meu-progresso');
  await page.getByLabel('Filtrar por equipa').selectOption({ label: 'Equipa Bússola' });
  const card = page.locator('.person-card', { hasText: 'Vasconcelos' });
  await expect(card).toContainText('Aguarda Promessa');
  await noHorizontalScroll(page);
  // Teclado: chega-se ao cartão com Tab e abre-se com Enter
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/pioneiro=m-longo/);
  const head = page.getByRole('region', { name: /Modo de consulta/ });
  await expect(head).toContainText('Maria Francisca de Albuquerque e Vasconcelos Teixeira');
  await expect(head).toContainText('Equipa Bússola');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/consulta-nome-longo-${info.project.name}.png`, fullPage: true });
  // Voltar (browser) regressa à grelha com a equipa escolhida
  await page.goBack();
  await expect(page.getByLabel('Filtrar por equipa')).toHaveValue('teamB');
  await expect(page.locator('.person-card', { hasText: 'Vasconcelos' })).toBeVisible();
});
