import { expect, test, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

async function noHorizontalScroll(page: Page) {
  // Compara com a largura configurada: em telemóvel um elemento largo alarga o viewport de layout (e a página fica reduzida).
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow, 'sem deslocamento horizontal').toBeLessThanOrEqual(1);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fluxo: área → trilho → objetivos → justificação → enviar (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    const persona = pioneer();
    const mock = await installMock(page, persona);

    // 1. Entrada: seis cartões FACEIS; percurso, pedidos e validado em acessos secundários
    await page.goto('/meu-progresso');
    await expect(page.getByRole('heading', { name: 'Meu progresso', level: 1 })).toBeVisible();
    const cards = page.locator('.area-card');
    await expect(cards).toHaveCount(6);
    for (const n of ['Físico', 'Afetivo', 'Caráter', 'Espiritual', 'Intelectual', 'Social']) await expect(cards.filter({ hasText: n })).toBeVisible();
    await expect(page.getByRole('link', { name: /Os meus pedidos/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Progresso validado/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver o meu percurso' })).toBeVisible();
    await expect(page.getByText('Em desenvolvimento')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/fluxo-1-areas-${info.project.name}-${theme}.png`, fullPage: true });

    // 2. Só os trilhos da área, com estado compacto
    await cards.filter({ hasText: 'Físico' }).click();
    await expect(page.getByRole('heading', { name: 'Físico', level: 1 })).toBeVisible();
    const rows = page.locator('.trail-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Desempenho' })).toContainText('Validado');
    await expect(rows.filter({ hasText: 'Autoconhecimento' })).toContainText('Por fechar');
    await page.screenshot({ path: `test-results/fluxo-2-trilhos-${info.project.name}-${theme}.png`, fullPage: true });

    // 3. Objetivos com código, texto completo e caixa de seleção (sem começar o trilho nem registar vivências)
    await rows.filter({ hasText: 'Autoconhecimento' }).click();
    await expect(page.getByRole('heading', { name: 'Autoconhecimento', level: 1 })).toBeVisible();
    const f2 = page.getByRole('checkbox', { name: /F2/ });
    const f3 = page.getByRole('checkbox', { name: /F3/ });
    await expect(f2).toBeEnabled();
    await expect(page.getByText('Aceito-me como sou e respeito as diferenças físicas entre as pessoas.')).toBeVisible();
    await expect(page.getByLabel('Como demonstrei que atingi estes objetivos?')).toHaveCount(0); // só depois de selecionar
    await f2.check();
    await expect(page.locator('.selected-codes')).toContainText('F2');
    await f3.check();
    await expect(page.locator('.selected-codes')).toContainText('F2, F3');
    await expect(page.getByText('Conta o que fizeste, em que situação e o que aprendeste.')).toBeVisible();
    const text = 'No raid ajudei a equipa a adaptar o percurso a um colega com uma lesão e percebi que aceitar os meus limites também é força.';
    await page.getByLabel('Como demonstrei que atingi estes objetivos?').fill(text);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/fluxo-3-objetivos-${info.project.name}-${theme}.png`, fullPage: true });

    // 4. Resumo; voltar preserva o texto
    await page.getByRole('button', { name: 'Rever e enviar' }).click();
    const resumo = page.locator('#pedido');
    await expect(resumo.getByRole('heading', { name: 'Confirma o pedido' })).toBeVisible();
    for (const t of ['Físico', 'Autoconhecimento', 'F2', 'F3', text]) await expect(resumo).toContainText(t);
    await page.screenshot({ path: `test-results/fluxo-4-resumo-${info.project.name}-${theme}.png`, fullPage: true });
    await resumo.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('Como demonstrei que atingi estes objetivos?')).toHaveValue(text);
    await page.getByRole('button', { name: 'Rever e enviar' }).click();

    // 5. Erro de gravação: nada é dado como enviado e o texto mantém-se
    mock.failNext('submit_objectives_request', 'network');
    await page.getByRole('button', { name: 'Enviar para validação' }).click();
    await expect(page.getByText(/Sem ligação ao servidor/)).toBeVisible();
    await expect(page.getByText(/Pedido enviado/)).toHaveCount(0);
    await resumo.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('Como demonstrei que atingi estes objetivos?')).toHaveValue(text);
    await page.getByRole('button', { name: 'Rever e enviar' }).click();
    await page.getByRole('button', { name: 'Enviar para validação' }).click();
    await expect(page.getByText('Pedido enviado. Podes acompanhá-lo em Os meus pedidos.')).toBeVisible();
    // Um só pedido criado; enviado com os objetivos escolhidos e a justificação
    expect(mock.calls.filter((c) => c.fn === 'create_trail_request')).toHaveLength(1);
    const sent = mock.calls.filter((c) => c.fn === 'submit_objectives_request').pop()!;
    expect(sent.body).toMatchObject({ p_objectives: ['o-F2', 'o-F3'], p_justification: text, p_expected_version: 1 });
    // Enviar não é concluir
    await expect(page.locator('.trail-head')).toContainText('Em validação');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.screenshot({ path: `test-results/fluxo-5-enviado-${info.project.name}-${theme}.png`, fullPage: true });

    // 6. Os meus pedidos: trilho, objetivos, data e estado
    await page.getByRole('link', { name: 'Os meus pedidos' }).first().click();
    const card = page.locator('.request-card', { hasText: 'Autoconhecimento' });
    await expect(card).toContainText('Objetivos F2, F3');
    await expect(card).toContainText('Em validação');
    await expect(card).toContainText(/\d{2}\/\d{2}\/\d{4}/);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/fluxo-6-pedidos-${info.project.name}-${theme}.png`, fullPage: true });
  });
}

test('mudar de trilho não transporta a seleção', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/fisico-autoconhecimento');
  await page.getByRole('checkbox', { name: /F2/ }).check();
  await page.getByLabel('Como demonstrei que atingi estes objetivos?').fill('Texto do F2');
  await page.goto('/meu-progresso/trilho/fisico-bem-estar-fisico');
  await expect(page.getByRole('checkbox', { name: /F4/ })).not.toBeChecked();
  await expect(page.getByLabel('Como demonstrei que atingi estes objetivos?')).toHaveCount(0);
  // ... e voltar ao primeiro recupera o que lá estava
  await page.goto('/meu-progresso/trilho/fisico-autoconhecimento');
  await expect(page.getByRole('checkbox', { name: /F2/ })).toBeChecked();
  await expect(page.getByLabel('Como demonstrei que atingi estes objetivos?')).toHaveValue('Texto do F2');
});

test('validação parcial: objetivo aceite fica validado e o trilho continua por fechar', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso?vista=areas&area=I');
  const row = page.locator('.trail-row', { hasText: 'Procura do conhecimento' });
  await expect(row).toContainText('Por fechar');
  await expect(row).toContainText('1 de 2 objetivos validados');
  await row.click();
  await expect(page.locator('.trail-head')).toContainText('Por fechar');
  await expect(page.getByRole('checkbox', { name: /I1/ })).toBeDisabled(); // já validado: não se pede de novo
  await expect(page.locator('.obj-item', { hasText: 'I1' })).toContainText('Validado');
  await expect(page.getByRole('checkbox', { name: /I2/ })).toBeEnabled();
  await page.goto('/meu-progresso?vista=validado');
  await expect(page.getByRole('heading', { name: 'Progresso validado', level: 1 })).toBeVisible();
  await expect(page.locator('.validated-item', { hasText: 'Procura do conhecimento' })).toContainText('1 de 2 objetivos validados');
  await expect(page.locator('.validated-item', { hasText: 'Desempenho' })).toContainText('Validado');
  await page.getByRole('link', { name: 'Voltar às áreas' }).click();
  await expect(page.locator('.area-card')).toHaveCount(6);
});

test('pedido pendente: objetivos em validação não podem ser pedidos de novo', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/espiritual-descoberta');
  await expect(page.locator('.trail-head')).toContainText('Em validação');
  await expect(page.locator('.obj-item', { hasText: 'E1' })).toContainText('Em validação');
  await expect(page.locator('.obj-item', { hasText: 'E3' })).toContainText('Por validar');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText(/restantes objetivos podem ser pedidos depois/)).toBeVisible();
});

test('a rever: feedback por objetivo, corrigir e reenviar com histórico', async ({ page }, info) => {
  const mock = await installMock(page, pioneer());
  await page.goto('/meu-progresso?vista=pedidos&pfiltro=revisao');
  const card = page.locator('.request-card', { hasText: 'Responsabilidade' });
  await expect(card).toContainText('A rever');
  await expect(card).toContainText('Validados: C3');
  await expect(card).toContainText('A rever: C4');
  await card.getByRole('link', { name: 'Corrigir e reenviar' }).click();
  await expect(page.getByRole('heading', { name: 'Responsabilidade', level: 1 })).toBeVisible();
  await expect(page.getByText(/está «A rever»/)).toBeVisible();
  await expect(page.getByText('Conta um exemplo em que assumiste uma responsabilidade na equipa.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /C3/ })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /C4/ })).toBeChecked();
  const field = page.getByLabel('Como demonstrei que atingi estes objetivos?');
  await expect(field).toHaveValue(/projeto da escola/);
  await field.fill('No projeto da escola organizei o grupo. Na equipa fiquei responsável pelo material do acampamento e cumpri.');
  await page.screenshot({ path: `test-results/fluxo-rever-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Rever e enviar' }).click();
  await page.getByRole('button', { name: 'Enviar para validação' }).click();
  await expect(page.getByText('Pedido enviado. Podes acompanhá-lo em Os meus pedidos.')).toBeVisible();
  expect(mock.calls.map((c) => c.fn).filter((f) => ['start_new_version', 'submit_objectives_request'].includes(f))).toEqual(['start_new_version', 'submit_objectives_request']);
  expect(mock.calls.find((c) => c.fn === 'submit_objectives_request')!.body).toMatchObject({ p_request: 'r-rev', p_expected_version: 2, p_objectives: ['o-C4'] });
  // Histórico preservado: a versão anterior e a decisão continuam no pedido
  await page.goto('/pedidos/r-rev');
  await expect(page.getByText('Versão 1')).toBeVisible();
  await expect(page.getByText('Versão 2').first()).toBeVisible();
});

test('registos antigos preservados: pedido por trilho continua legível e decidido', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/meu-progresso/trilho/afetivo-autoestima');
  await expect(page.locator('.trail-head')).toContainText('A rever');
  await expect(page.locator('.obj-item', { hasText: 'A5' })).toContainText('Falta mostrar continuidade.');
  await page.goto('/pedidos/r-dev');
  await expect(page.getByText('Reflexão inicial.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Corrigir e reenviar' })).toBeVisible();
  await page.goto('/meu-progresso/trilho/fisico-desempenho');
  await expect(page.locator('.trail-head')).toContainText('Validado');
  await expect(page.locator('.obj-item', { hasText: 'F1' })).toContainText('Validado');
});

test('revisão por objetivo: aceite e a rever com comentário', async ({ page }, info) => {
  const persona = leader();
  const mock = await installMock(page, persona);
  await page.goto('/revisoes/pedido/r-obj');
  await expect(page.getByRole('heading', { name: 'Descoberta', level: 1 })).toBeVisible();
  await expect(page.getByText('Preparei a vigília da equipa')).toBeVisible();
  await expect(page.getByText('Fora deste pedido: E3.')).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Registar decisão' });
  await expect(confirm).toBeDisabled(); // falta decidir E1 e E2
  await page.getByRole('radiogroup', { name: 'Decisão sobre E1' }).getByText('Validado').click();
  await page.getByRole('radiogroup', { name: 'Decisão sobre E2' }).getByText('A rever').click();
  await expect(confirm).toBeDisabled(); // «a rever» exige comentário
  await page.getByLabel('O que falta em E2?').fill('Fala de um momento em que partilhaste a tua fé com outros.');
  await page.screenshot({ path: `test-results/revisao-objetivos-${info.project.name}.png`, fullPage: true });
  await confirm.click();
  await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Registar decisão' }).click();
  await expect(page.getByText(/O pedido fica «A rever»/)).toBeVisible();
  const call = mock.calls.find((c) => c.fn === 'record_objectives_decision')!;
  expect(call.body.p_decisions).toEqual([
    { objective_id: 'o-E1', accepted: true, comment: '' },
    { objective_id: 'o-E2', accepted: false, comment: 'Fala de um momento em que partilhaste a tua fé com outros.' },
  ]);
  // O histórico mostra o que falta
  await expect(page.locator('.obj-item', { hasText: 'E2' }).first()).toContainText('A rever');
});

test('revisão: aceitar todos os objetivos do pedido não fecha um trilho incompleto', async ({ page }) => {
  await installMock(page, leader());
  await page.goto('/revisoes/pedido/r-obj');
  await page.getByRole('radiogroup', { name: 'Decisão sobre E1' }).getByText('Validado').click();
  await page.getByRole('radiogroup', { name: 'Decisão sobre E2' }).getByText('Validado').click();
  await page.getByRole('button', { name: 'Registar decisão' }).click();
  await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Registar decisão' }).click();
  await expect(page.getByText(/Os objetivos ficam validados; o trilho continua por fechar/)).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'Objetivos validados' }).first()).toBeVisible();
});

test('dirigente: consulta claramente identificada, sem ações do pioneiro', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/meu-progresso');
  await expect(page.getByRole('heading', { name: 'Progresso dos pioneiros' })).toBeVisible();
  await expect(page.getByText(/Os dirigentes não têm percurso pessoal/)).toBeVisible();
  await page.getByLabel('Consultar o progresso de').selectOption({ label: 'Pedro Teste' });
  await expect(page.getByRole('heading', { name: 'Progresso de Pedro' })).toBeVisible();
  await expect(page.getByText(/Modo de consulta/).first()).toBeVisible();
  await expect(page.locator('.area-card')).toHaveCount(6);
  await page.screenshot({ path: `test-results/consulta-dirigente-${info.project.name}.png`, fullPage: true });
  await page.locator('.area-card', { hasText: 'Afetivo' }).click();
  await expect(page).toHaveURL(/pioneiro=m-p1/);
  await page.locator('.trail-row', { hasText: 'Autoestima' }).click();
  await expect(page.getByText(/Modo de consulta · Pedro Teste/)).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rever e enviar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registar vivência' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Voltar aos trilhos' }).click();
  await expect(page).toHaveURL(/area=A.*pioneiro=m-p1|pioneiro=m-p1.*area=A/);
});
