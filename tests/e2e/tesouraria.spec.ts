// Tesouraria v2 (interface): painel com fórmula do saldo, saldo inicial e gráfico, filtros
// (ano escutista, mês, atividade) no URL, lista de movimentos com pesquisa, quem consulta não vê
// dados pessoais, criar receita/despesa, saldo inicial e situação do próprio, em telemóvel e
// computador. Dados FICTÍCIOS, apenas para teste.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CAPTURAS, THEMES, shoot } from './capturas-util';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;

/** No telemóvel os filtros ficam atrás do botão «Filtros». */
async function openFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /^Filtros/ });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Ações secundárias do título (menu «Mais»). */
async function openMore(page: Page) {
  await page.locator('main .page-actions').getByRole('button', { name: 'Mais ações' }).click();
}

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

const base = { state: 'efetivo', account_id: 'acc1', account_name: 'Caixa', activity_id: null, activity_title: null, member_profile_id: null, member_name: null,
  quota_charge_id: null, quota_name: null, notes: null, corrects_id: null, replaced_by: null, voided_at: null, void_reason: null, voided_by_name: null,
  created_by_name: 'Ana Dirigente Teste', updated_by_name: null, files: 0 };

/** API simulada da Tesouraria (registada depois do installMock). Quem só consulta recebe os dados já filtrados, como o servidor faz. */
async function mockFin(page: Page, manage: boolean) {
  const calls: { fn: string; body: Row }[] = [];
  const accounts = [{ id: 'acc1', name: 'Caixa', kind: 'caixa', archived: false }];
  const activities = [{ id: 'ev1', title: 'Acampamento de teste', status: 'ativo', day: '2026-09-20' }];
  const opening = { id: 'op1', account_id: null, account_name: null, reference_date: '2026-09-01', amount_cents: 10000, ...(manage ? { notes: 'Transitado (teste)' } : {}) };
  const movements: Row[] = [
    { ...base, id: 'mv0', kind: 'receita', occurred_on: '2026-08-20', description: 'Venda antiga (teste)', category: 'Angariação de fundos', amount_cents: 5000, created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z' },
    { ...base, id: 'mv4', kind: 'despesa', occurred_on: '2026-09-20', description: 'Gás (teste)', category: 'Material', amount_cents: 500, activity_id: 'ev1', activity_title: 'Acampamento de teste', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z' },
    { ...base, id: 'mv1', kind: 'receita', occurred_on: '2026-10-01', description: 'Venda de rifas (teste)', category: 'Angariação de fundos', amount_cents: 10, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' },
    { ...base, id: 'mv2', kind: 'receita', occurred_on: '2026-10-02', description: 'Donativo; "anónimo"', category: 'Donativos', amount_cents: 20, created_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:00:00Z' },
    { ...base, id: 'mv3', kind: 'receita', occurred_on: '2026-10-03', description: 'Inscrição de Pedro Teste', category: 'Atividades', amount_cents: 1500, member_profile_id: 'u-p9', member_name: 'Pedro Teste', notes: 'Nota privada de teste', files: 1, created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z' },
  ];
  const shared = (m: Row) => manage ? { ...m, before_opening: m.occurred_on < opening.reference_date } : {
    id: m.id, kind: m.kind, occurred_on: m.occurred_on, description: m.member_profile_id ? 'Pagamento individual' : m.description, category: m.category,
    amount_cents: m.amount_cents, state: m.state, activity_id: m.activity_id, activity_title: m.activity_title, individual: !!m.member_profile_id, mine: false,
    voided_at: null, files: 0, before_opening: m.occurred_on < opening.reference_date,
  };
  const filt = (b: Row) => movements.filter((m) => (!b.p_from || m.occurred_on >= b.p_from) && (!b.p_to || m.occurred_on <= b.p_to)
    && (!b.p_category || m.category === b.p_category) && (!b.p_activity || m.activity_id === b.p_activity) && (!b.p_state || m.state === b.p_state))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
  const tot = (list: Row[], st: string) => {
    const r = list.filter((m) => m.state === st && m.kind === 'receita').reduce((a, m) => a + m.amount_cents, 0);
    const d = list.filter((m) => m.state === st && m.kind === 'despesa').reduce((a, m) => a + m.amount_cents, 0);
    return { receitas: r, despesas: d, saldo: r - d };
  };
  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON?.() ?? {};
    const ok = (v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (fn === 'my_modules') {
      return ok(['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria', 'presencas'].map((k) => ({
        module: k, status: k === 'tesouraria' ? 'teste' : 'desenvolvimento', space: k === 'tesouraria' ? 'teste' : null,
        grants: k === 'tesouraria' && manage ? ['tesouraria.gerir'] : [], dirigente: manage,
      })));
    }
    if (!fn.startsWith('fin_') && fn !== 'module_files_of' && fn !== 'module_file_prepare') return route.fallback();
    calls.push({ fn, body });
    if (fn === 'module_files_of') return ok([]);
    if (fn === 'fin_options') return ok({ can_manage: manage, space: 'teste', accounts, categories: ['Angariação de fundos', 'Atividades', 'Donativos', 'Material', 'Quotas'], opening: [{ account_id: null, reference_date: opening.reference_date }] });
    if (fn === 'fin_activity_options') return ok(activities);
    if (fn === 'fin_members') return manage ? ok([{ profile_id: 'u-p9', full_name: 'Pedro Teste', function: 'pioneiro', team_id: 'teamA' }]) : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'Não tens permissão para esta ação neste módulo.' }) });
    if (fn === 'fin_list_opening_balances') return ok([opening]);
    if (fn === 'fin_save_opening_balance') return ok('op2');
    if (fn === 'fin_dashboard') {
      const list = filt(body);
      const counted = movements.filter((m) => m.state === 'efetivo' && m.occurred_on >= opening.reference_date);
      const rec = counted.filter((m) => m.kind === 'receita').reduce((a, m) => a + m.amount_cents, 0);
      const des = counted.filter((m) => m.kind === 'despesa').reduce((a, m) => a + m.amount_cents, 0);
      return ok({
        can_manage: manage, space: 'teste', today: '2026-10-16',
        opening: { mode: 'global', total: opening.amount_cents, reference_date: opening.reference_date, items: [opening] },
        current: { saldo_inicial: opening.amount_cents, receitas: rec, despesas: des, saldo: opening.amount_cents + rec - des },
        before_opening: { count: 1, receitas: 5000, despesas: 0 },
        totals: { efetivo: tot(list, 'efetivo'), pendente: tot(list, 'pendente'), previsto: tot(list, 'previsto') },
        count: list.length,
        evolution: { granularity: 'mes', from: '2026-09-01', to: '2026-10-16', points: [
          { date: '2026-09-01', kind: 'inicio', saldo: 10000 }, { date: '2026-09-30', kind: 'mes', saldo: 9500 }, { date: '2026-10-16', kind: 'mes', saldo: 11030 }] },
        latest: list.slice(0, 6).map(shared),
        by_category: [], years: [2026, 2025],
        activity: body.p_activity ? { activity_id: 'ev1', title: 'Acampamento de teste', status: 'ativo', day: '2026-09-20', orcamento: { receitas: 0, despesas: 0, resultado: 0 },
          efetivo: { receitas: 0, despesas: 500, resultado: -500 }, por_confirmar: { receitas: 0, despesas: 0, resultado: 0 }, lines: [], by_category: [] } : null,
        accounts: [{ id: 'acc1', name: 'Caixa', kind: 'caixa', archived: false, opening: null, movimentos: rec - des, saldo: rec - des }],
      });
    }
    if (fn === 'fin_search_movements') {
      const q = (body.p_search ?? '').toLowerCase();
      const items = filt(body).map(shared).filter((m: Row) => !q || [m.description, m.category, m.activity_title ?? ''].some((t) => t.toLowerCase().includes(q)));
      return ok({ can_manage: manage, total: items.length, limit: 300, items });
    }
    if (fn === 'fin_list_movements') return ok(movements);
    if (fn === 'fin_create_movement') {
      const id = `mv${movements.length + 1}`;
      movements.unshift({ ...base, id, kind: body.p_kind, occurred_on: body.p_on, description: body.p_description, category: body.p_category, amount_cents: body.p_amount, state: body.p_state, activity_id: body.p_activity, activity_title: body.p_activity ? 'Acampamento de teste' : null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
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

test('painel: saldo atual com a fórmula, saldo inicial, gráfico acessível e filtros no URL', async ({ page }, info) => {
  await installMock(page, pioneer());
  const calls = await mockFin(page, false);
  await page.goto('/tesouraria');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Tesouraria', level: 1 })).toBeVisible();
  await expect(page.locator('main h1 .page-tag')).toContainText('Em teste');
  // Indicadores centrados
  await expect(page.getByTestId('saldo-atual')).toHaveText('110,30 €');
  await expect(page.getByTestId('receitas-periodo')).toHaveText('15,30 €');
  await expect(page.getByTestId('despesas-periodo')).toHaveText('5,00 €');
  await expect(page.getByTestId('resultado-periodo')).toHaveText('10,30 €');
  const align = await page.locator('.fin-kpis .stat').first().evaluate((el) => getComputedStyle(el).textAlign);
  expect(align).toBe('center');
  // Só três indicadores principais, com a mesma altura
  const heights = await page.locator('.fin-kpis .stat').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(heights).toHaveLength(3);
  expect(new Set(heights).size).toBe(1);
  // Fórmula com os números e saldo inicial identificado (em «Mais informação»); regra dos movimentos anteriores
  await expect(page.getByTestId('formula')).toBeHidden();
  await page.getByText('Como se calcula o saldo atual').click();
  await expect(page.getByTestId('formula')).toHaveText('Saldo atual = Saldo inicial + Receitas − Despesas');
  await expect(page.getByTestId('formula-valores')).toHaveText('110,30 € = 100,00 € + 15,30 € − 5,00 €');
  await expect(page.getByTestId('saldo-inicial')).toContainText('100,00 € em 01/09/2026');
  await expect(page.getByTestId('anteriores')).toContainText('já incluídos no saldo inicial');
  // Gráfico com descrição e tabela alternativa
  const chart = page.getByRole('img', { name: 'Evolução do saldo' });
  await expect(chart).toBeVisible();
  await page.getByText('Ver os valores em tabela').click();
  await expect(page.getByRole('row', { name: /fim de setembro de 2026 95,00 €/ })).toBeVisible();
  // Últimos movimentos sem dados pessoais; sem botões de registo
  const latest = page.getByRole('list', { name: 'Últimos movimentos' });
  await expect(latest.getByText('Pagamento individual')).toBeVisible();
  await expect(page.getByText('Pedro Teste')).toHaveCount(0);
  await expect(main.getByRole('link', { name: /Nova receita/ })).toHaveCount(0);
  const tabs = page.getByRole('navigation', { name: 'Secções da tesouraria' });
  await expect(tabs.getByRole('link', { name: 'Quotas' })).toHaveCount(0);
  // Por omissão, o ano escutista atual (setembro a agosto)
  expect(calls.find((c) => c.fn === 'fin_dashboard')!.body).toMatchObject({ p_from: '2026-09-01', p_to: '2027-08-31', p_activity: null });

  // Valores alinhados com algarismos tabulares
  expect(await latest.locator('.fin-amount').first().evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
  // Quem consulta só tem «Exportar CSV» no menu «Mais»
  await openMore(page);
  await expect(page.getByRole('button', { name: /Exportar CSV/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Filtros por mês e atividade no URL; sobrevivem ao «voltar»
  const filters = page.getByRole('form', { name: 'Filtros' });
  await openFilters(page);
  await filters.getByLabel('Mês').selectOption('2026-10');
  await expect(page).toHaveURL(/mes=2026-10/);
  await expect(page.getByTestId('despesas-periodo')).toHaveText('0,00 €');
  await filters.getByLabel('Atividade').selectOption('ev1');
  await expect(page).toHaveURL(/atividade=ev1/);
  await expect(page.getByTestId('resultado-atividade')).toHaveText('−5,00 €');
  expect(calls.filter((c) => c.fn === 'fin_dashboard').at(-1)!.body).toMatchObject({ p_from: '2026-10-01', p_to: '2026-10-31', p_activity: 'ev1' });
  await tabs.getByRole('link', { name: 'A minha situação' }).click();
  await expect(page).toHaveURL(/\/tesouraria\/minha$/);
  await page.goBack();
  await expect(page).toHaveURL(/mes=2026-10/);
  await expect(filters.getByLabel('Mês')).toHaveValue('2026-10');
  // Ano escutista anterior limpa o mês
  await openFilters(page);
  await filters.getByLabel('Ano escutista').selectOption('2025');
  await expect(page).toHaveURL(/ano=2025/);
  await expect(page).not.toHaveURL(/mes=/);
  await expect.poll(() => calls.filter((c) => c.fn === 'fin_dashboard').at(-1)!.body.p_from).toBe('2025-09-01');
  expect(calls.filter((c) => c.fn === 'fin_dashboard').at(-1)!.body).toMatchObject({ p_to: '2026-08-31' });
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tesouraria-painel-${info.project.name}.png`, fullPage: true });

  // Modo escuro: o gráfico usa as cores do tema
  const light = await page.locator('.fin-chart-line').evaluate((el) => getComputedStyle(el).stroke);
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await page.locator('.fin-chart-line').evaluate((el) => getComputedStyle(el).stroke);
  expect(dark).not.toBe(light);
  await page.screenshot({ path: `test-results/tesouraria-painel-escuro-${info.project.name}.png`, fullPage: true });
});

test('quem consulta: movimentos partilhados com pesquisa, sem dados pessoais nem comprovativos', async ({ page }, info) => {
  await installMock(page, pioneer());
  const calls = await mockFin(page, false);
  await page.goto('/tesouraria/movimentos');
  const list = page.getByRole('list', { name: 'Lista de movimentos' });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list.getByText('Pagamento individual')).toBeVisible();
  await expect(page.getByText('Pedro Teste')).toHaveCount(0);
  await expect(page.getByText('Nota privada')).toHaveCount(0);
  // Sem ligação ao detalhe (reservado a quem gere) nem botões de registo
  await expect(list.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Nova despesa/ })).toHaveCount(0);
  expect(calls.some((c) => c.fn === 'fin_list_movements')).toBe(false);
  await expect(page.getByRole('link', { name: /Novo movimento/ })).toHaveCount(0);
  // Pesquisa no URL
  await page.getByRole('searchbox', { name: 'Pesquisar' }).fill('rifas');
  await expect(page).toHaveURL(/q=rifas/);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect.poll(() => calls.filter((c) => c.fn === 'fin_search_movements').at(-1)!.body.p_search).toBe('rifas');
  expect(calls.filter((c) => c.fn === 'fin_search_movements').at(-1)!.body.p_include_voided).toBe(false);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Pesquisar' })).toHaveValue('rifas');
  await expect(page.getByRole('list', { name: 'Lista de movimentos' }).getByRole('listitem')).toHaveCount(1);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tesouraria-movimentos-consulta-${info.project.name}.png`, fullPage: true });
  // Página de registo recusada
  await page.goto('/tesouraria/movimentos/novo');
  await expect(page.getByText(/reservada a quem a administração autorizou/)).toBeVisible();
});

test('a minha situação: quotas devidas, pagas e em falta', async ({ page }, info) => {
  await installMock(page, pioneer());
  await mockFin(page, false);
  await page.goto('/tesouraria/minha');
  await expect(page.getByTestId('em-falta')).toHaveText('3,33 €');
  await expect(page.getByText('Quota de teste 2026/27').first()).toBeVisible();
  await expect(page.getByText('Por pagar')).toBeVisible();
  await expect(page.getByText('limite 31/12/2026', { exact: false })).toBeVisible();
  await page.goto('/tesouraria/quotas');
  await expect(page.getByText(/reservada a quem a administração autorizou/)).toBeVisible();
  await page.goto('/tesouraria/minha');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tesouraria-minha-${info.project.name}.png`, fullPage: true });
});

test('tesoureiro autorizado: nova receita e nova despesa, validação, lista com pesquisa e CSV', async ({ page }, info) => {
  await installMock(page, leader());
  const calls = await mockFin(page, true);
  await page.goto('/tesouraria');
  // Ação principal no título; receita e despesa no menu «Mais»
  await expect(page.locator('main .page-actions').getByRole('link', { name: 'Novo movimento' })).toBeVisible();
  await openMore(page);
  await page.getByRole('link', { name: /Nova receita/ }).click();
  await expect(page).toHaveURL(/\/tesouraria\/movimentos\/novo\?tipo=receita$/);
  await expect(page.getByRole('heading', { name: 'Nova receita' })).toBeVisible();
  // Validação clara
  await page.getByRole('button', { name: 'Registar movimento' }).click();
  await expect(page.getByText('Escreve uma descrição.')).toBeVisible();
  await expect(page.getByText(/Indica um valor superior a zero/)).toBeVisible();
  expect(calls.some((c) => c.fn === 'fin_create_movement')).toBe(false);
  // Uma só caixa: já escolhida
  await expect(page.getByLabel('Conta ou caixa')).toHaveValue('acc1');
  await page.getByLabel('Descrição').fill('Venda de bolos');
  await page.getByLabel('Valor (€)').fill('45,50');
  await page.getByLabel('Categoria').fill('Angariação de fundos');
  // Data anterior ao saldo inicial: aviso de que não soma de novo
  await page.getByLabel('Data').fill('2026-08-15');
  await expect(page.getByText(/Data anterior ao saldo inicial \(01\/09\/2026\)/)).toBeVisible();
  await page.getByLabel('Data').fill('2026-10-10');
  await page.getByLabel('Observações (opcional, privadas)').fill('Entregue pela equipa A');
  await page.getByRole('button', { name: 'Registar movimento' }).click();
  await expect(page.getByText('Movimento registado.')).toBeVisible();
  const sent = calls.find((c) => c.fn === 'fin_create_movement')!.body;
  expect(sent).toMatchObject({ p_kind: 'receita', p_amount: 4550, p_on: '2026-10-10', p_account: 'acc1', p_state: 'efetivo', p_notes: 'Entregue pela equipa A' });
  expect(sent.p_client_key).toMatch(/[0-9a-f-]{36}/);

  // Nova despesa com atividade
  await page.goto('/tesouraria/movimentos/novo?tipo=despesa');
  await page.getByLabel('Descrição').fill('Gás para o acampamento');
  await page.getByLabel('Valor (€)').fill('12,30');
  await page.getByLabel('Categoria').fill('Material');
  await page.getByLabel('Atividade (opcional)').selectOption('ev1');
  await page.getByRole('button', { name: 'Registar movimento' }).click();
  await expect(page.getByRole('heading', { name: 'Gás para o acampamento' })).toBeVisible();
  await expect(page.getByText('−12,30 €')).toBeVisible();
  expect(calls.filter((c) => c.fn === 'fin_create_movement').at(-1)!.body).toMatchObject({ p_kind: 'despesa', p_amount: 1230, p_activity: 'ev1' });

  // Lista: quem gere vê o membro e abre o detalhe; pesquisa e filtros no URL; o formulário não está embutido
  await page.goto('/tesouraria/movimentos');
  const list = page.getByRole('list', { name: 'Lista de movimentos' });
  await expect(list.getByText('Atividades · Pedro Teste')).toBeVisible();
  await expect(page.getByLabel('Descrição')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registar movimento' })).toHaveCount(0);
  await page.locator('main .page-actions').getByRole('link', { name: 'Novo movimento' }).click();
  await expect(page).toHaveURL(/\/tesouraria\/movimentos\/novo$/);
  await expect(page.getByRole('heading', { name: 'Novo movimento' })).toBeVisible();
  await page.goBack();
  await list.getByText('Venda de rifas (teste)').click();
  await expect(page.getByRole('heading', { name: 'Venda de rifas (teste)' })).toBeVisible();
  await page.goBack();
  await page.getByRole('searchbox', { name: 'Pesquisar' }).fill('gás');
  await expect(page).toHaveURL(/q=g%C3%A1s|q=gás/);
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect.poll(() => calls.filter((c) => c.fn === 'fin_search_movements').at(-1)!.body.p_search).toBe('gás');
  expect(calls.filter((c) => c.fn === 'fin_search_movements').at(-1)!.body.p_include_voided).toBe(true);
  await openFilters(page);
  await page.getByLabel('Estado').selectOption('pendente');
  await expect(page).toHaveURL(/estado=pendente/);
  await expect(page.getByText('Sem movimentos')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByRole('searchbox', { name: 'Pesquisar' })).toHaveValue('');
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await openMore(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exportar CSV/ }).click()]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('Gás para o acampamento;Material;-12,30;Efetivo');
  expect(csv).toContain('"Donativo; ""anónimo"""');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tesouraria-movimentos-${info.project.name}.png`, fullPage: true });
});

test('tesoureiro autorizado: definir o saldo inicial (global ou por conta)', async ({ page }, info) => {
  await installMock(page, leader());
  const calls = await mockFin(page, true);
  await page.goto('/tesouraria/contas');
  await expect(page.getByRole('heading', { name: 'Saldo inicial' })).toBeVisible();
  await expect(page.getByTestId('saldo-inicial-valor')).toHaveText('100,00 €');
  await page.getByRole('button', { name: 'Alterar' }).click();
  const form = page.getByRole('form', { name: 'Alterar saldo inicial' });
  await expect(form.getByLabel('Aplica-se a')).toBeDisabled();
  await form.getByLabel('Valor (€)').fill('abc');
  await form.getByRole('button', { name: 'Guardar alteração' }).click();
  await expect(page.getByText(/Indica o valor, por exemplo 250,00/)).toBeVisible();
  await form.getByLabel('Valor (€)').fill('-12,40');
  await form.getByRole('button', { name: 'Guardar alteração' }).click();
  await expect(page.getByText('Saldo inicial alterado.')).toBeVisible();
  expect(calls.find((c) => c.fn === 'fin_save_opening_balance')!.body).toMatchObject({ p_id: 'op1', p_account: null, p_reference_date: '2026-09-01', p_amount: -1240 });
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/tesouraria-saldo-inicial-${info.project.name}.png`, fullPage: true });
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`tesouraria ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      await mockFin(page, true);
      await page.goto('/tesouraria');
      await shoot(page, info, theme, 'tesouraria-painel');
      await page.goto('/tesouraria/movimentos');
      await shoot(page, info, theme, 'tesouraria-movimentos');
      await page.goto('/tesouraria/movimentos/novo');
      await shoot(page, info, theme, 'tesouraria-lancamento');
      await page.goto('/tesouraria/movimentos/mv3');
      await shoot(page, info, theme, 'tesouraria-detalhe');
      await page.goto('/tesouraria/atividades');
      await shoot(page, info, theme, 'tesouraria-atividades');
      await page.goto('/tesouraria/minha');
      await shoot(page, info, theme, 'tesouraria-minha');
      await page.goto('/tesouraria/quotas');
      await shoot(page, info, theme, 'tesouraria-quotas');
      await page.goto('/tesouraria/contas');
      await shoot(page, info, theme, 'tesouraria-contas');
    });
  }
});
