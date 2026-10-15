// Tesouraria (interface): resumo, novo movimento, filtros no URL, exportação CSV,
// situação do próprio, em telemóvel e computador. Dados FICTÍCIOS, apenas para teste.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** API simulada da Tesouraria (registada depois do installMock). */
async function mockFin(page: Page, manage: boolean) {
  const calls: { fn: string; body: Row }[] = [];
  const accounts = [{ id: 'acc1', name: 'Caixa', kind: 'caixa', archived: false }];
  const activities = [{ id: 'ev1', title: 'Acampamento de teste', status: 'ativo', day: '2026-10-20' }];
  const movements: Row[] = [
    { id: 'mv1', kind: 'receita', occurred_on: '2026-10-01', description: 'Venda de rifas (teste)', category: 'Angariação de fundos', amount_cents: 10, state: 'efetivo', account_id: 'acc1', account_name: 'Caixa', activity_id: null, activity_title: null, member_profile_id: null, member_name: null, quota_charge_id: null, quota_name: null, notes: null, corrects_id: null, replaced_by: null, voided_at: null, void_reason: null, voided_by_name: null, created_by_name: 'Ana Dirigente Teste', created_at: '2026-10-01T10:00:00Z', updated_by_name: null, updated_at: '2026-10-01T10:00:00Z', files: 0 },
    { id: 'mv2', kind: 'receita', occurred_on: '2026-10-02', description: 'Donativo; "anónimo"', category: 'Donativos', amount_cents: 20, state: 'efetivo', account_id: 'acc1', account_name: 'Caixa', activity_id: null, activity_title: null, member_profile_id: null, member_name: null, quota_charge_id: null, quota_name: null, notes: null, corrects_id: null, replaced_by: null, voided_at: null, void_reason: null, voided_by_name: null, created_by_name: 'Ana Dirigente Teste', created_at: '2026-10-02T10:00:00Z', updated_by_name: null, updated_at: '2026-10-02T10:00:00Z', files: 0 },
  ];
  const filt = (b: Row) => movements.filter((m) => (!b.p_from || m.occurred_on >= b.p_from) && (!b.p_to || m.occurred_on <= b.p_to)
    && (!b.p_category || m.category === b.p_category) && (!b.p_activity || m.activity_id === b.p_activity) && (!b.p_state || m.state === b.p_state));
  const tot = (list: Row[], st: string) => {
    const r = list.filter((m) => m.state === st && !m.voided_at && m.kind === 'receita').reduce((a, m) => a + m.amount_cents, 0);
    const d = list.filter((m) => m.state === st && !m.voided_at && m.kind === 'despesa').reduce((a, m) => a + m.amount_cents, 0);
    return { receitas: r, despesas: d, saldo: r - d };
  };
  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON?.() ?? {};
    const ok = (v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (fn === 'my_modules') {
      return ok(['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria'].map((k) => ({
        module: k, status: k === 'tesouraria' ? 'teste' : 'desenvolvimento', space: k === 'tesouraria' ? 'teste' : null,
        grants: k === 'tesouraria' && manage ? ['tesouraria.gerir'] : [], dirigente: manage,
      })));
    }
    if (!fn.startsWith('fin_') && fn !== 'module_files_of') return route.fallback();
    calls.push({ fn, body });
    if (fn === 'module_files_of') return ok([]);
    if (fn === 'fin_options') return ok({ can_manage: manage, space: 'teste', accounts, categories: ['Angariação de fundos', 'Donativos', 'Material', 'Quotas'] });
    if (fn === 'fin_activity_options') return ok(activities);
    if (fn === 'fin_members') return manage ? ok([{ profile_id: 'u-p1', full_name: 'Pedro Teste', function: 'pioneiro', team_id: 'teamA' }]) : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'Não tens permissão para esta ação neste módulo.' }) });
    if (fn === 'fin_summary') {
      const list = filt(body).filter((m) => !m.voided_at);
      const cats = [...new Set(list.map((m) => `${m.kind}|${m.category}`))].map((k) => {
        const [kind, category] = k.split('|');
        const sum = (st: string) => list.filter((m) => m.kind === kind && m.category === category && m.state === st).reduce((a, m) => a + m.amount_cents, 0);
        return { category, kind, efetivo: sum('efetivo'), pendente: sum('pendente'), previsto: sum('previsto') };
      });
      const all = movements.filter((m) => !m.voided_at && m.state === 'efetivo');
      return ok({
        can_manage: manage, count: list.length, by_category: cats, by_activity: [],
        totals: { efetivo: tot(list, 'efetivo'), pendente: tot(list, 'pendente'), previsto: tot(list, 'previsto') },
        accounts: [{ id: 'acc1', name: 'Caixa', kind: 'caixa', saldo: tot(all, 'efetivo').saldo }],
      });
    }
    if (fn === 'fin_list_movements') return ok(filt(body));
    if (fn === 'fin_create_movement') {
      const id = `mv${movements.length + 1}`;
      movements.unshift({ ...movements[0], id, kind: body.p_kind, occurred_on: body.p_on, description: body.p_description, category: body.p_category, amount_cents: body.p_amount, state: body.p_state, activity_id: body.p_activity, activity_title: body.p_activity ? 'Acampamento de teste' : null, created_at: new Date().toISOString() });
      return ok(id);
    }
    if (fn === 'fin_history') return ok([{ id: 1, entity: 'fin_movements', action: 'criado', old_values: null, new_values: {}, actor_name: 'Ana Dirigente Teste', at: new Date().toISOString() }]);
    if (fn === 'fin_activity_results') return ok([]);
    if (fn === 'fin_list_quotas') return ok([]);
    if (fn === 'fin_my_situation') {
      return ok({
        charges: [
          { id: 'c1', quota_id: 'q1', profile_id: 'u-p1', member_name: null, amount_cents: 1000, status: 'ativa', waive_reason: null, pago: 667, pendente: 0, em_falta: 333, excesso: 0, quota_name: 'Quota de teste 2026/27', period_start: '2026-09-01', period_end: '2027-08-31', due_date: '2026-12-31', quota_status: 'ativa' },
        ],
        totals: { devido: 1000, pago: 667, pendente: 0, em_falta: 333 },
        payments: [{ id: 'p1', occurred_on: '2026-10-03', description: 'Quota: Quota de teste 2026/27', category: 'Quotas', amount_cents: 667, state: 'efetivo', quota_name: 'Quota de teste 2026/27', files: 0 }],
      });
    }
    return ok(null);
  });
  return calls;
}

test('resumo partilhado, filtros no URL e exportação CSV', async ({ page }, info) => {
  await installMock(page, pioneer());
  const calls = await mockFin(page, false);
  await page.goto('/tesouraria');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Tesouraria', level: 1 })).toBeVisible();
  await expect(page.getByText('Ambiente de teste.')).toBeVisible();
  // 0,10 + 0,20 = 0,30 exatamente
  await expect(page.getByTestId('saldo-efetivo')).toHaveText('0,30 €');
  // Quem só consulta não vê movimentos individuais nem quotas
  const tabs = page.getByRole('navigation', { name: 'Secções da tesouraria' });
  await expect(tabs.getByRole('link', { name: 'Movimentos' })).toHaveCount(0);
  await expect(tabs.getByRole('link', { name: 'Quotas' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: /Novo movimento/ })).toHaveCount(0);
  expect(calls.some((c) => c.fn === 'fin_list_movements')).toBe(false);

  // Filtros por categoria e período ficam no URL e sobrevivem ao «voltar»
  const filters = page.getByRole('form', { name: 'Filtros' });
  await filters.getByLabel('Categoria').selectOption('Donativos');
  await expect(page).toHaveURL(/categoria=Donativos/);
  await expect(page.getByTestId('saldo-efetivo')).toHaveText('0,20 €');
  await filters.getByLabel('De', { exact: true }).fill('2026-10-02');
  await expect(page).toHaveURL(/de=2026-10-02/);
  await tabs.getByRole('link', { name: 'A minha situação' }).click();
  await expect(page).toHaveURL(/\/tesouraria\/minha$/);
  await page.goBack();
  await expect(page).toHaveURL(/categoria=Donativos/);
  await expect(filters.getByLabel('Categoria')).toHaveValue('Donativos');
  expect(calls.filter((c) => c.fn === 'fin_summary').at(-1)!.body).toMatchObject({ p_category: 'Donativos', p_from: '2026-10-02' });

  // Exportação CSV
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exportar CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^tesouraria-resumo-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('Categoria;Tipo;Efetivo (€)');
  expect(csv).toContain('Donativos;receita;0,20;0,00;0,00');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tesouraria-resumo-${info.project.name}.png`, fullPage: true });
});

test('a minha situação: quotas devidas, pagas e em falta', async ({ page }, info) => {
  await installMock(page, pioneer());
  await mockFin(page, false);
  await page.goto('/tesouraria/minha');
  await expect(page.getByTestId('em-falta')).toHaveText('3,33 €');
  await expect(page.getByText('Quota de teste 2026/27').first()).toBeVisible();
  await expect(page.getByText('Por pagar')).toBeVisible();
  await expect(page.getByText('limite 31/12/2026', { exact: false })).toBeVisible();
  // Páginas de gestão recusadas a quem só consulta
  await page.goto('/tesouraria/movimentos');
  await expect(page.getByText(/reservada a quem a administração autorizou/)).toBeVisible();
  await page.goto('/tesouraria/minha');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tesouraria-minha-${info.project.name}.png`, fullPage: true });
});

test('tesoureiro autorizado: criar movimento, validação, filtros e CSV dos movimentos', async ({ page }, info) => {
  await installMock(page, leader());
  const calls = await mockFin(page, true);
  await page.goto('/tesouraria');
  await page.getByRole('link', { name: /Novo movimento/ }).click();
  await expect(page).toHaveURL(/\/tesouraria\/movimentos\/novo$/);
  // Validação clara
  await page.getByRole('button', { name: 'Registar movimento' }).click();
  await expect(page.getByText('Escreve uma descrição.')).toBeVisible();
  await expect(page.getByText(/Indica um valor superior a zero/)).toBeVisible();
  expect(calls.some((c) => c.fn === 'fin_create_movement')).toBe(false);

  await page.getByLabel('Descrição').fill('Gás para o acampamento');
  await page.getByLabel('Valor (€)').fill('12,30');
  await page.getByLabel('Categoria').fill('Material');
  await page.getByLabel('Conta ou caixa').selectOption('acc1');
  await page.getByLabel('Atividade (opcional)').selectOption('ev1');
  await page.getByRole('button', { name: 'Registar movimento' }).click();
  await expect(page.getByText('Movimento registado.')).toBeVisible();
  const sent = calls.find((c) => c.fn === 'fin_create_movement')!.body;
  expect(sent).toMatchObject({ p_kind: 'despesa', p_amount: 1230, p_category: 'Material', p_account: 'acc1', p_state: 'efetivo', p_activity: 'ev1' });
  expect(Number.isInteger(sent.p_amount)).toBe(true);
  expect(sent.p_client_key).toMatch(/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: 'Gás para o acampamento' })).toBeVisible();
  await expect(page.getByText('−12,30 €')).toBeVisible();

  // Lista com filtros por estado e atividade no URL
  await page.goto('/tesouraria/movimentos?atividade=ev1');
  await expect(page.getByLabel('Lista de movimentos').getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Estado').selectOption('pendente');
  await expect(page).toHaveURL(/estado=pendente/);
  await expect(page.getByText('Sem movimentos')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByLabel('Lista de movimentos').getByRole('listitem')).toHaveCount(3);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exportar CSV/ }).click()]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('Gás para o acampamento;Material;-12,30;Efetivo');
  expect(csv).toContain('"Donativo; ""anónimo"""');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tesouraria-movimentos-${info.project.name}.png`, fullPage: true });
});
