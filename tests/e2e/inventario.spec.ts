// Inventário (interface): lista com pesquisa e filtros no endereço, criar artigo,
// emprestar e devolver, pedido de empréstimo por quem só consulta. RPC do módulo
// simuladas em memória (dados FICTÍCIOS, apenas para teste).
import { expect, test, type Page, type Route } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;
const isoIn = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function mockInventario(page: Page, manage: boolean) {
  const cats = [{ id: 'c1', name: 'Campismo', archived: false }, { id: 'c2', name: 'Cozinha', archived: false }];
  const items: Row[] = [
    { id: 'i1', name: 'Tenda canadiana', description: 'Tenda para 4 pessoas', unit: 'un.', location: 'Arrecadação', tracking: 'quantidade', category_id: 'c1', total: 6, damaged: 0, repair: 1, min_quantity: 2 },
    { id: 'i2', name: 'Panela grande', description: null, unit: 'un.', location: 'Cozinha da sede', tracking: 'quantidade', category_id: 'c2', total: 3, damaged: 1, repair: 0, min_quantity: null },
    { id: 'i3', name: 'Lanterna frontal', description: null, unit: 'un.', location: 'Arrecadação', tracking: 'quantidade', category_id: null, total: 4, damaged: 0, repair: 0, min_quantity: null },
  ];
  const loans: Row[] = [];
  const calls: { fn: string; body: Row }[] = [];
  const people = [{ id: 'u-ana', name: 'Ana Dirigente' }, { id: 'u-pedro', name: 'Pedro Teste' }];
  const lent = (id: string) => loans.filter((l) => l.item_id === id && l.status === 'ativo').reduce((s, l) => s + l.quantity - l.returned_qty, 0);
  const stock = (i: Row) => {
    const l = lent(i.id);
    const available = Math.max(i.total - i.damaged - i.repair - l, 0);
    const states = [available > 0 && 'disponivel', l > 0 && 'emprestado', i.damaged > 0 && 'danificado', i.repair > 0 && 'reparacao'].filter(Boolean);
    return { total: i.total, damaged: i.damaged, repair: i.repair, lent: l, reserved: 0, reservations: 0, available, states };
  };
  const itemJson = (i: Row) => ({
    id: i.id, name: i.name, description: i.description, unit: i.unit, location: i.location, tracking: i.tracking, category_id: i.category_id,
    category: cats.find((c) => c.id === i.category_id)?.name ?? null, min_quantity: i.min_quantity, archived_at: null, updated_at: isoIn(0),
    has_photo: false, stock: stock(i),
  });
  const loanJson = (l: Row) => {
    const i = items.find((x) => x.id === l.item_id)!;
    return { ...l, item: i.name, unit: i.unit, tracking: i.tracking, borrower: people.find((p) => p.id === l.borrower_id)?.name ?? '?', overdue: false, pieces: [] };
  };
  const ok = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const fail = (route: Route, message: string) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message }) });

  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const b = (route.request().postDataJSON?.() ?? {}) as Row;
    if (fn === 'my_modules') {
      return ok(route, ['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria'].map((m) => (m === 'inventario'
        ? { module: m, status: 'teste', space: 'teste', grants: manage ? ['inventario.gerir'] : [], dirigente: manage }
        : { module: m, status: 'desenvolvimento', space: null, grants: [], dirigente: manage })));
    }
    if (!fn.startsWith('inv_') && fn !== 'module_files_of') return route.fallback();
    calls.push({ fn, body: b });
    switch (fn) {
      case 'inv_overview':
        return ok(route, {
          can_manage: manage, me: manage ? 'u-ana' : 'u-pedro',
          categories: cats.map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id).length })),
          locations: [...new Set(items.map((i) => i.location).filter(Boolean))].sort(),
          items: b.p_archived ? [] : items.map(itemJson).sort((x, y) => x.name.localeCompare(y.name, 'pt')),
          pending_requests: loans.filter((l) => l.status === 'pedido').length, overdue: 0,
        });
      case 'inv_item': {
        const i = items.find((x) => x.id === b.p_item);
        if (!i) return fail(route, 'Registo não encontrado.');
        return ok(route, { ...itemJson(i), can_manage: manage, pieces: [], loans: loans.filter((l) => l.item_id === i.id).map(loanJson), reservations: [],
          movements: [{ id: 1, kind: 'criacao', quantity: i.total, from_state: null, to_state: null, note: null, at: isoIn(-48), actor: 'Ana Dirigente', piece: null, borrower: null }] });
      }
      case 'inv_item_save': {
        if (!String(b.p_name ?? '').trim()) return fail(route, 'Indica o nome do artigo.');
        const id = `i${items.length + 1}`;
        items.push({ id, name: b.p_name, description: b.p_description, unit: b.p_unit, location: b.p_location, tracking: b.p_tracking,
          category_id: b.p_category, total: b.p_quantity ?? 0, damaged: 0, repair: 0, min_quantity: b.p_min_quantity });
        return ok(route, id);
      }
      case 'inv_people': return ok(route, people);
      case 'inv_availability': {
        const i = items.find((x) => x.id === b.p_item)!;
        return ok(route, stock(i).available);
      }
      case 'inv_loan_create': {
        const i = items.find((x) => x.id === b.p_item)!;
        if (b.p_quantity > stock(i).available) return fail(route, `Quantidade indisponível nesse período: só há ${stock(i).available} un. livre(s) de «${i.name}».`);
        const id = `l${loans.length + 1}`;
        loans.push({ id, item_id: i.id, borrower_id: b.p_borrower, quantity: b.p_quantity, returned_qty: 0, out_at: b.p_out_at, due_at: b.p_due_at, status: 'ativo',
          notes: b.p_notes, remind_hours: b.p_remind_hours, reservation_id: null, requested_by: 'Ana Dirigente', requested_at: isoIn(0), decided_by: 'Ana Dirigente',
          decided_at: isoIn(0), decision_note: null, returned_at: null });
        return ok(route, id);
      }
      case 'inv_loan_request': {
        const id = `l${loans.length + 1}`;
        loans.push({ id, item_id: b.p_item, borrower_id: 'u-pedro', quantity: b.p_quantity, returned_qty: 0, out_at: b.p_out_at, due_at: b.p_due_at, status: 'pedido',
          notes: b.p_notes, remind_hours: 24, reservation_id: null, requested_by: 'Pedro Teste', requested_at: isoIn(0), decided_by: null, decided_at: null,
          decision_note: null, returned_at: null });
        return ok(route, id);
      }
      case 'inv_loan_return': {
        const l = loans.find((x) => x.id === b.p_loan)!;
        const q = b.p_quantity ?? l.quantity - l.returned_qty;
        if (q > l.quantity - l.returned_qty) return fail(route, `Só faltam devolver ${l.quantity - l.returned_qty} un.`);
        l.returned_qty += q;
        if (l.returned_qty >= l.quantity) { l.status = 'devolvido'; l.returned_at = isoIn(0); }
        return ok(route, null);
      }
      case 'inv_loans': {
        let list = loans;
        if (b.p_status === 'pedido') list = loans.filter((l) => l.status === 'pedido');
        else if (!b.p_status) list = loans.filter((l) => ['pedido', 'ativo'].includes(l.status));
        if (b.p_mine) list = list.filter((l) => l.borrower_id === (manage ? 'u-ana' : 'u-pedro'));
        return ok(route, list.map(loanJson));
      }
      case 'inv_alerts':
        return ok(route, { overdue: [], due_soon: [], low_stock: [], repair: items.filter((i) => i.repair > 0).map(itemJson), damaged: items.filter((i) => i.damaged > 0).map(itemJson), at_risk: [], requests: [] });
      default:
        return ok(route, []);
    }
  });
  return { calls, loans, items };
}

test('lista: pesquisa e filtros ficam no endereço e sobrevivem ao «voltar»', async ({ page }, info) => {
  await installMock(page, leader());
  await mockInventario(page, true);
  await page.goto('/inventario');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Inventário', level: 1 })).toBeVisible();
  await expect(main.getByText('Ambiente de teste.')).toBeVisible();
  const list = main.getByRole('list', { name: 'Material' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await main.getByPlaceholder('Pesquisar material').fill('tenda');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(page).toHaveURL(/q=tenda/);
  await main.getByPlaceholder('Pesquisar material').fill('');
  await main.getByLabel('Filtrar por localização').selectOption('Arrecadação');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await main.getByLabel('Filtrar por estado').selectOption('reparacao');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Tenda canadiana');
  await expect(list).toContainText('Em reparação');
  await expect(page).toHaveURL(/local=Arrecada.*estado=reparacao|estado=reparacao.*local=Arrecada/);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/inventario-lista-${info.project.name}.png`, fullPage: true });
  await list.getByRole('link', { name: /Tenda canadiana/ }).click();
  await expect(main.getByRole('heading', { name: 'Tenda canadiana', level: 1 })).toBeVisible();
  await noHorizontalScroll(page);
  await page.goBack();
  await expect(main.getByLabel('Filtrar por estado')).toHaveValue('reparacao');
  await expect(main.getByLabel('Filtrar por localização')).toHaveValue('Arrecadação');
  await main.getByLabel('Filtrar por categoria').selectOption('c2');
  await expect(main.getByText('Nenhum artigo com estes filtros.')).toBeVisible();
  await main.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
});

test('criar artigo com validação clara', async ({ page }) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true);
  await page.goto('/inventario');
  const main = page.locator('main');
  await main.getByRole('link', { name: 'Novo artigo' }).click();
  await expect(main.getByRole('heading', { name: 'Novo artigo', level: 1 })).toBeVisible();
  await main.getByRole('button', { name: 'Registar artigo' }).click();
  await expect(main.getByText('Indica o nome do artigo.')).toBeVisible();
  expect(m.calls.some((c) => c.fn === 'inv_item_save')).toBe(false);
  await main.getByLabel('Nome').fill('Fogareiro a gás');
  await main.getByLabel('Categoria', { exact: true }).selectOption('c2');
  await main.getByLabel('Localização (opcional)').fill('Armário 2');
  await main.getByLabel('Quantidade inicial').fill('3');
  await main.getByLabel(/Quantidade mínima/).fill('1');
  await noHorizontalScroll(page);
  await main.getByRole('button', { name: 'Registar artigo' }).click();
  await expect(main.getByRole('heading', { name: 'Fogareiro a gás', level: 1 })).toBeVisible();
  const save = m.calls.find((c) => c.fn === 'inv_item_save')!.body;
  expect(save).toMatchObject({ p_name: 'Fogareiro a gás', p_category: 'c2', p_location: 'Armário 2', p_tracking: 'quantidade', p_quantity: 3, p_min_quantity: 1 });
  await expect(main.getByRole('list', { name: 'Quantidades' })).toContainText('Disponível');
});

test('emprestar e devolver (parcial e total)', async ({ page }, info) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true);
  await page.goto('/inventario/artigo/i1');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Tenda canadiana', level: 1 })).toBeVisible();
  await main.getByRole('button', { name: 'Emprestar' }).click();
  const form = main.getByRole('form', { name: 'Emprestar material' });
  await form.getByRole('button', { name: 'Registar empréstimo' }).click();
  await expect(form.getByText('Escolhe o responsável pelo material.')).toBeVisible();
  await form.getByLabel('Responsável').selectOption('u-pedro');
  await form.getByLabel(/Quantidade/).fill('9');
  await expect(form.getByText(/Livres nesse período: 5 un\./)).toBeVisible();
  await form.getByRole('button', { name: 'Registar empréstimo' }).click();
  await expect(form.getByText(/Quantidade indisponível/)).toBeVisible();
  await form.getByLabel(/Quantidade/).fill('2');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/inventario-emprestar-${info.project.name}.png`, fullPage: true });
  await form.getByRole('button', { name: 'Registar empréstimo' }).click();
  await expect(form).toHaveCount(0);
  const stats = main.getByRole('list', { name: 'Quantidades' });
  await expect(stats.getByText('Emprestado').locator('..')).toContainText('2');
  const card = main.locator('.inv-loan').first();
  await expect(card).toContainText('Pedro Teste');
  await card.getByRole('button', { name: 'Registar devolução' }).click();
  await card.getByLabel(/Quantidade devolvida/).fill('1');
  await card.getByRole('button', { name: 'Confirmar devolução' }).click();
  await expect(card).toContainText('1 de 2 un.');
  await card.getByRole('button', { name: 'Registar devolução' }).click();
  await card.getByRole('button', { name: 'Confirmar devolução' }).click();
  await expect(main.locator('.inv-loan').first()).toContainText('Devolvido');
  expect(m.calls.filter((c) => c.fn === 'inv_loan_return').map((c) => c.body.p_quantity)).toEqual([1, 1]);
  await noHorizontalScroll(page);
});

test('quem só consulta não edita, mas pede empréstimos', async ({ page }) => {
  await installMock(page, pioneer());
  const m = await mockInventario(page, false);
  await page.goto('/inventario');
  const main = page.locator('main');
  await expect(main.getByRole('list', { name: 'Material' }).getByRole('listitem')).toHaveCount(3);
  await expect(main.getByRole('link', { name: 'Novo artigo' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: /Categorias/ })).toHaveCount(0);
  await main.getByRole('link', { name: /Panela grande/ }).click();
  await expect(main.getByRole('button', { name: 'Emprestar' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: /Editar/ })).toHaveCount(0);
  await main.getByRole('button', { name: 'Pedir empréstimo' }).click();
  const form = main.getByRole('form', { name: 'Pedir empréstimo' });
  await expect(form).toContainText('aguardar aprovação');
  await form.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(main.getByText(/Pedido enviado/)).toBeVisible();
  expect(m.calls.find((c) => c.fn === 'inv_loan_request')!.body).toMatchObject({ p_item: 'i2', p_quantity: 1 });
  await expect(main.locator('.inv-loan').first()).toContainText('Pedido por decidir');
  await page.goBack();
  await main.getByRole('navigation', { name: 'Inventário' }).getByRole('link', { name: /Empréstimos/ }).click();
  await main.getByText('Só os meus').click();
  await expect(page).toHaveURL(/meus=1/);
  await expect(main.locator('.inv-loan')).toHaveCount(1);
  await noHorizontalScroll(page);
});
