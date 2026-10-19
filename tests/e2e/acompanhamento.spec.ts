import { expect, test, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';
import { CAPTURAS, THEMES, shoot } from './capturas-util';

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow, 'sem deslocamento horizontal').toBeLessThanOrEqual(1);
}

test('acompanhamento: três separadores com contadores', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/acompanhamento');
  const tabs = page.getByRole('navigation', { name: 'Secções do acompanhamento' }).getByRole('link');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toContainText('Secção');
  await expect(tabs.nth(1)).toContainText('Pedidos');
  await expect(tabs.nth(1)).toContainText('3');
  await expect(tabs.nth(2)).toContainText('Etapas');
  // Secção: pessoas por equipa, pesquisa e mérito secundário
  await expect(page.getByRole('region', { name: 'Equipa Andorinha' })).toBeVisible();
  await page.getByPlaceholder('Pesquisar por nome').fill('Pedro');
  await expect(page.getByText('Pedro Teste').first()).toBeVisible();
  await expect(page.getByText('Ana Fictícia')).toHaveCount(0);
  await expect(page.getByText('Anilha de mérito').first()).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/acomp-seccao-${info.project.name}.png`, fullPage: true });
});

test('pedidos: caixa única com filtros por tipo, estado e equipa, sem duplicados', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/acompanhamento/pedidos');
  const inbox = page.locator('.inbox');
  // Pendentes: uma negociação, um pedido de trilho e um de progresso anterior
  await expect(inbox.locator('> li')).toHaveCount(3);
  await expect(inbox.locator('.type-tag')).toHaveText([/Negociação|Trilho|anterior/, /Negociação|Trilho|anterior/, /Negociação|Trilho|anterior/]);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/acomp-pedidos-${info.project.name}.png`, fullPage: true });

  await page.getByRole('radiogroup', { name: 'Tipo de pedido' }).getByRole('radio', { name: /^Trilhos/ }).click();
  await expect(page).toHaveURL(/tipo=trilhos/);
  await expect(inbox.locator('> li')).toHaveCount(1);
  await expect(inbox).toContainText('Descoberta');

  await page.getByRole('radiogroup', { name: 'Tipo de pedido' }).getByRole('radio', { name: /^Progresso anterior/ }).click();
  await expect(inbox.locator('> li')).toHaveCount(1);
  await expect(inbox).toContainText('Interação e cooperação');

  // Decididos continuam acessíveis
  await page.getByRole('radiogroup', { name: 'Tipo de pedido' }).getByRole('radio', { name: /^Trilhos/ }).click();
  await page.getByLabel('Filtrar por estado').selectOption('decididos');
  await expect(inbox).toContainText('Desempenho');
  const keys = await inbox.locator('> li').allTextContents();
  expect(new Set(keys).size).toBe(keys.length);

  // Filtro por equipa
  await page.getByLabel('Filtrar por estado').selectOption('todos');
  await page.getByLabel('Filtrar por equipa').selectOption({ label: 'Equipa Bússola' });
  await expect(inbox.locator('> li')).toHaveCount(0);
});

test('etapas: Conselho separado da comunicação das decisões de trilhos', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/acompanhamento/etapas?ver=trilhos');
  await expect(page.getByText('Comunicação das decisões de trilhos das equipas')).toBeVisible();
  await expect(page.locator('details[open]', { hasText: 'Comunicação das decisões de trilhos das equipas' })).toContainText('Desempenho');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/acomp-etapas-${info.project.name}.png`, fullPage: true });
});

test('endereços antigos levam ao novo sítio e filtro', async ({ page }) => {
  await installMock(page, leader());
  for (const [from, to] of [
    ['/dirigentes/negociacao', /\/acompanhamento\/pedidos\?tipo=negociacao/],
    ['/acompanhamento/negociacao', /\/acompanhamento\/pedidos\?tipo=negociacao/],
    ['/acompanhamento/historico', /\/acompanhamento\/pedidos\?tipo=anterior/],
    ['/acompanhamento/conselho', /\/acompanhamento\/etapas/],
    ['/acompanhamento/merito', /\/acompanhamento\/seccao\?ver=merito/],
    ['/conselho', /\/acompanhamento\/etapas/],
  ] as const) {
    await page.goto(from);
    await expect(page).toHaveURL(to);
  }
});

test('notificações: eliminar uma, desfazer, eliminar lidas e limpar todas', async ({ page }, info) => {
  const persona = leader();
  const mock = await installMock(page, persona);
  await page.goto('/notificacoes');
  const items = page.locator('li.notif');
  await expect(items).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Notificações, 2 por ler' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/notificacoes-${info.project.name}.png`, fullPage: true });

  // Uma: botão próprio fora da ligação; o contador de não lidas atualiza logo
  const del = page.getByRole('button', { name: 'Eliminar «Novo pedido de validação»' });
  expect(await del.evaluate((b) => !!b.closest('a'))).toBe(false);
  await del.click();
  await expect(items).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Notificações, 1 por ler' })).toBeVisible();
  await expect(page.getByText('Notificação eliminada.')).toBeVisible();
  // Desfazer repõe
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(items).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Notificações, 2 por ler' })).toBeVisible();
  // Só dados de teste: a chamada leva apenas o identificador da notificação simulada
  expect(mock.calls.find((c) => c.fn === 'remove_notifications')?.body).toMatchObject({ p_scope: 'ids', p_ids: ['nl1'] });
  expect(mock.calls.find((c) => c.fn === 'restore_notifications')?.body).toMatchObject({ p_ids: ['nl1'] });

  // Selecionar várias
  await items.nth(0).getByRole('checkbox').check();
  await items.nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Eliminar selecionadas (2)' }).click();
  await expect(items).toHaveCount(2);
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(items).toHaveCount(4);

  // Lidas
  await page.getByRole('button', { name: 'Eliminar lidas (2)' }).click();
  await expect(items).toHaveCount(2);
  // Não reaparecem depois de recarregar
  await page.reload();
  await expect(page.locator('li.notif')).toHaveCount(2);

  // Limpar todas, com a quantidade na confirmação
  await page.getByRole('button', { name: 'Limpar todas' }).click();
  await expect(page.getByText(/Vais eliminar 2 notificações/)).toBeVisible();
  await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Eliminar 2 notificações' }).click();
  await expect(page.locator('li.notif')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Notificações' , exact: true })).toBeVisible();

  // Só notificações: nenhuma outra chamada que mexa em pedidos ou decisões
  const fns = mock.calls.map((c) => c.fn);
  expect(fns.filter((f) => !['remove_notifications', 'restore_notifications', 'mark_notifications_read'].includes(f) && !f.startsWith('GET'))
    .filter((f) => /request|decision|delete|DELETE/.test(f))).toEqual([]);
  expect(persona.tables.trail_requests.length).toBeGreaterThan(0);
});

test('pioneiro: notificações com ligações atuais', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/notificacoes');
  await expect(page.locator('li.notif')).toHaveCount(3);
  await page.getByRole('link', { name: /Trilho a rever/ }).click();
  await expect(page).toHaveURL(/\/pedidos\/r-dev/);
});

test('negociação: cada proposta abre o seu registo; substituída e retirada distinguem-se', async ({ page }, info) => {
  await installMock(page, leader());
  await page.goto('/acompanhamento/pedidos?tipo=negociacao&estado=todos');
  const inbox = page.locator('.inbox');
  // Seis propostas distintas (3 confirmadas, 1 por negociar, 1 substituída, 1 retirada), cada uma com o seu identificador
  await expect(inbox.locator('> li')).toHaveCount(6);
  const refs = await inbox.locator('> li').evaluateAll((els) => els.map((e) => e.textContent?.match(/P-[A-Z0-9]{6}/)?.[0]));
  expect(new Set(refs).size).toBe(6);
  await expect(inbox.locator('.badge', { hasText: 'Confirmada' })).toHaveCount(3);
  for (const t of ['Por negociar', 'Substituída', 'Retirada']) await expect(inbox).toContainText(t);

  await inbox.getByRole('link', { name: /Serviço/ }).click();
  await expect(page).toHaveURL(/\/acompanhamento\/proposta\/c-espiritual-servico$/);
  const summary = page.getByRole('region', { name: 'Resumo da proposta' });
  await expect(summary).toContainText('Identificador');
  await expect(summary).toContainText('Proposta em');
  await expect(summary.getByRole('link', { name: /^P-/ })).toBeVisible(); // substitui a proposta anterior
  await expect(page.getByRole('button', { name: 'Confirmar' })).toBeVisible(); // por negociar: decisão aqui
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/proposta-${info.project.name}.png`, fullPage: true });

  // A proposta substituída é outro registo, com a sua data de decisão e ligação à nova
  await summary.getByRole('link', { name: /^P-/ }).click();
  await expect(page.getByRole('heading', { name: 'Descoberta', level: 1 })).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'Substituída' }).first()).toBeVisible();
  await expect(page.getByText('Substituída em')).toBeVisible();
  await expect(page.getByText('Substituída por')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
  // Voltar regressa à caixa com o filtro
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/tipo=negociacao/);

  // Retirada: comentário só com «—» não aparece
  await page.goto('/acompanhamento/proposta/c-intelectual-procura-do-conhecimento');
  await expect(page.getByText('Retirada em')).toBeVisible();
  await expect(page.getByText('Comentário da decisão')).toHaveCount(0);
});

test('detalhe do pedido: data de envio uma vez no resumo, objetivos junto da justificação, sem campos vazios', async ({ page }) => {
  await installMock(page, leader());
  await page.goto('/revisoes/pedido/r-obj');
  const summary = page.getByRole('region', { name: 'Resumo do pedido' });
  await expect(summary.getByText('Enviado', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Enviado em /)).toHaveCount(0); // não se repete fora do resumo
  // Objetivos e justificação seguidos
  const order = await page.evaluate(() => {
    const objs = document.getElementById('h-objs')!.closest('section')!;
    const just = document.getElementById('h-justificacao')!.closest('section')!;
    return objs.nextElementSibling === just;
  });
  expect(order).toBe(true);
  await expect(page.getByText('Sem decisão')).toHaveCount(0); // linhas antigas sem decisão não aparecem
  await expect(page.locator('.version-content .quote', { hasText: /^—$/ })).toHaveCount(0);
});

test('notificações: lista vazia só com uma mensagem curta', async ({ page }) => {
  const persona = leader();
  persona.tables.notifications = [];
  await installMock(page, persona);
  await page.goto('/notificacoes');
  await expect(page.getByText('Sem notificações.')).toBeVisible();
  await expect(page.locator('main .card')).toHaveCount(0);
  await expect(page.getByRole('button')).not.toContainText(['Limpar todas']);
});

test('progresso anterior: só os dirigentes registam, com o trilho completo e a fundamentação', async ({ page }) => {
  const mock = await installMock(page, leader());
  await page.goto('/acompanhamento/pedidos?tipo=anterior');
  const form = page.locator('details', { hasText: 'Registar progresso anterior' });
  await form.locator('summary').click();
  const register = form.getByRole('button', { name: 'Registar' });
  await expect(register).toBeDisabled();
  await form.getByLabel('Pioneiro').selectOption({ label: 'Pedro Teste' });
  await form.getByLabel('Área').selectOption({ index: 1 });
  await form.getByLabel('Trilho', { exact: true }).selectOption({ index: 1 });
  // Mostra todos os objetivos do trilho escolhido
  await expect(form.getByRole('list', { name: 'Objetivos do trilho' }).getByRole('listitem').first()).toBeVisible();
  await form.getByLabel('Fundamentação').fill('Concluiu este trilho no agrupamento anterior.');
  await expect(register).toBeDisabled(); // a data relevante é obrigatória
  await form.getByLabel('Data relevante').fill('15/06/2025');
  await register.click();
  await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Registar' }).click();
  await expect(form.getByText('Progresso anterior registado.')).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'recognize_in_negotiation')?.body).toMatchObject({
    p_membership: 'm-p1', p_comment: 'Concluiu este trilho no agrupamento anterior.', p_reference_date: '2025-06-15',
  });
});

test('percurso do membro: «Registar progresso anterior» à vista do dirigente, no separador Trilhos', async ({ page }) => {
  const mock = await installMock(page, leader());
  await page.goto('/membros/m-p1?separador=etapa');
  await expect(page.getByRole('tab', { name: 'Etapa', selected: true })).toBeVisible();
  await expect(page.locator('details', { hasText: 'Registar progresso anterior' })).toHaveCount(0); // já não fica no fundo da etapa
  const action = page.locator('.member-head').getByRole('button', { name: 'Registar progresso anterior' });
  await expect(action).toBeVisible();
  await action.click();
  await expect(page).toHaveURL(/separador=trilhos/);
  await expect(page.getByRole('tab', { name: 'Trilhos', selected: true })).toBeVisible();
  const form = page.locator('details#registar-anterior');
  await expect(form).toHaveAttribute('open', '');
  await expect(form.getByLabel('Área')).toBeFocused(); // pronto a usar com o teclado
  await expect(form.getByLabel('Pioneiro')).toHaveCount(0); // o pioneiro já está escolhido
  // Os trilhos do pioneiro continuam por baixo
  await expect(page.locator('[role=tabpanel]').getByRole('link')).toHaveCount(18);
  // Fechar e voltar a abrir pela ação do topo
  await form.locator('summary').click();
  await expect(form).not.toHaveAttribute('open', '');
  await action.click();
  await expect(form).toHaveAttribute('open', '');

  await form.getByLabel('Área').selectOption({ index: 1 });
  await form.getByLabel('Trilho', { exact: true }).selectOption({ index: 1 });
  const objectives = form.getByRole('list', { name: 'Objetivos do trilho' }).getByRole('listitem');
  await expect(objectives.first()).toBeVisible();
  expect(await objectives.count()).toBeGreaterThan(1); // o trilho completo, com todos os objetivos
  await form.getByLabel('Fundamentação').fill('Concluiu este trilho no agrupamento anterior, confirmado pela chefia de então.');
  await form.getByLabel('Data relevante').fill('01/03/2025');
  await form.getByRole('button', { name: 'Registar' }).click();
  await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Registar' }).click();
  await expect(form.getByText('Progresso anterior registado.')).toBeVisible();
  const body = mock.calls.find((c) => c.fn === 'recognize_in_negotiation')?.body;
  expect(body).toMatchObject({ p_membership: 'm-p1', p_reference_date: '2025-03-01' });
  expect(typeof body?.p_trail).toBe('string');

  // Ligação direta com o trilho já escolhido; mudar de separador limpa o pedido de registo
  await page.goto('/membros/m-p1?separador=trilhos&registar=anterior&trilho=social-solidariedade-e-tolerancia');
  await expect(form).toHaveAttribute('open', '');
  await expect(form.getByLabel('Trilho', { exact: true })).toHaveValue('t-social-solidariedade-e-tolerancia');
  await page.getByRole('tab', { name: 'Resumo' }).click();
  await expect(page).not.toHaveURL(/registar=/);
});

test('pioneiro: sem a ação de registar progresso anterior', async ({ page }) => {
  const mock = await installMock(page, pioneer());
  await page.goto('/membros/m-p1?separador=trilhos&registar=anterior');
  await expect(page.locator('main h1').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registar progresso anterior' })).toHaveCount(0);
  await expect(page.locator('details#registar-anterior')).toHaveCount(0);
  expect(mock.calls.some((c) => c.fn === 'recognize_in_negotiation')).toBe(false);
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`progresso anterior no percurso ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      await page.goto('/membros/m-p1');
      await shoot(page, info, theme, 'membro-acao-progresso-anterior', { full: false });
      await page.locator('.member-head').getByRole('button', { name: 'Registar progresso anterior' }).click();
      const form = page.locator('details#registar-anterior');
      await form.getByLabel('Área').selectOption({ index: 1 });
      await form.getByLabel('Trilho', { exact: true }).selectOption({ index: 1 });
      await form.getByLabel('Fundamentação').fill('Concluiu este trilho no agrupamento anterior, com o acompanhamento da chefia de então e registo na ficha de progresso.');
      await form.getByLabel('Data relevante').fill('01/03/2025');
      await shoot(page, info, theme, 'membro-registar-progresso-anterior');
    });
  }
});
