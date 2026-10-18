// Inventário (interface): três entradas (Material, Empréstimos com as reservas, A comprar),
// indicadores que abrem os alertas, pesquisa e filtros no endereço («Mais filtros» para local,
// conservação e arquivados), «Novo artigo» com o essencial primeiro, emprestar e devolver,
// reservas e compras ligadas a atividades pelo seletor comum, pedido de empréstimo por quem
// só consulta e marcar como comprado. RPC do módulo simuladas em memória (dados FICTÍCIOS,
// apenas para teste); os testes verificam as chamadas e os argumentos enviados.
import { expect, test, type Page, type Route } from '@playwright/test';
import { CAPTURAS, THEMES, shoot } from './capturas-util';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;
const isoIn = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** No telemóvel os filtros ficam atrás do botão «Filtros»: abre-o antes de mexer nos selects. */
async function openFilters(page: Page) {
  const toggle = page.locator('main').getByRole('button', { name: /^Filtros/ });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Local, armário, conservação e arquivados ficam em «Mais filtros». */
async function openMoreFilters(page: Page) {
  await openFilters(page);
  const more = page.locator('main details.more-options').filter({ hasText: 'Mais filtros' });
  if (!(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator('summary').click();
}

async function mockInventario(page: Page, manage: boolean, finOk = false, opts: { delay?: number } = {}) {
  const cats = [{ id: 'c1', name: 'Campismo', archived: false }, { id: 'c2', name: 'Cozinha', archived: false }];
  const items: Row[] = [
    { id: 'i1', name: 'Tenda canadiana', description: 'Tenda para 4 pessoas', unit: 'un.', room: 'Arrecadação', cabinet: 'Armário 1', shelf: 'Prateleira 2', box: null, condition: 'bom', notes: 'Secar antes de guardar', tracking: 'quantidade', category_id: 'c1', total: 6, damaged: 0, repair: 1, min_quantity: 2 },
    { id: 'i2', name: 'Panela grande', description: null, unit: 'un.', room: 'Cozinha da sede', cabinet: null, shelf: null, box: null, condition: 'razoavel', notes: null, tracking: 'quantidade', category_id: 'c2', total: 3, damaged: 1, repair: 0, min_quantity: null },
    { id: 'i3', name: 'Lanterna frontal', description: null, unit: 'un.', room: 'Arrecadação', cabinet: 'Armário 2', shelf: null, box: 'Caixa azul', condition: null, notes: null, tracking: 'quantidade', category_id: null, total: 4, damaged: 0, repair: 0, min_quantity: 5 },
  ];
  const purchases: Row[] = [
    { id: 'p1', item_id: 'i1', new_material: false, name: 'Tenda canadiana', category_id: 'c1', quantity: 2, unit: 'un.', reason: 'Duas tendas rasgadas', priority: 'alta', status: 'por_comprar', needed_by: null, event_id: null, event: null, amount_cents: 12000 },
    { id: 'p2', item_id: null, new_material: true, name: 'Bússola', category_id: null, quantity: 3, unit: 'un.', reason: null, priority: 'baixa', status: 'por_comprar', needed_by: null, event_id: null, event: null, amount_cents: null },
  ];
  const expenses = [{ id: 'm1', occurred_on: '2026-10-10', description: 'Loja de campismo', category: 'Material', amount_cents: 11990, state: 'efetivo' }];
  const loc = (i: Row) => [i.room, i.cabinet, i.shelf, i.box].filter(Boolean).join(' · ') || null;
  const purchaseJson = (p: Row) => ({
    item_archived: false, tracking: p.item_id ? 'quantidade' : null, category: cats.find((c) => c.id === p.category_id)?.name ?? null,
    bought_qty: null, bought_on: null, bought_at: null, bought_by: null, stock_added_at: null, stock_item_id: null, stock_added_by: null,
    has_expense: false, expense: null, cancelled_at: null, cancel_reason: null, cancelled_by: null, created_by: 'Ana Dirigente', created_at: isoIn(-24), ...p,
  });
  const loans: Row[] = [];
  // Duas atividades com o mesmo nome no mesmo dia (o seletor junta a hora) e uma de dia inteiro.
  const events = [
    { id: 'e1', title: 'Acampamento', all_day: false, starts_at: '2026-11-14T09:00:00Z', ends_at: '2026-11-14T18:00:00Z' },
    { id: 'e2', title: 'Acampamento', all_day: false, starts_at: '2026-11-14T15:00:00Z', ends_at: '2026-11-15T12:00:00Z' },
    { id: 'e3', title: 'Dia do Patrono', all_day: true, starts_at: '2026-11-20T00:00:00Z', ends_at: '2026-11-21T00:00:00Z' },
  ];
  const reservations: Row[] = [
    { id: 'r1', item_id: 'i3', quantity: 4, starts_at: isoIn(72), ends_at: isoIn(96), status: 'ativa', notes: null, event_id: 'e1', event: 'Acampamento', event_cancelled: false, at_risk: true },
    { id: 'r2', item_id: 'i2', quantity: 1, starts_at: isoIn(120), ends_at: isoIn(130), status: 'ativa', notes: null, event_id: null, event: null, event_cancelled: false, at_risk: false },
  ];
  const resJson = (r: Row) => {
    const i = items.find((x) => x.id === r.item_id)!;
    return { ...r, item: i.name, unit: i.unit, created_by: 'Ana Dirigente', created_at: isoIn(-1), close_note: null };
  };
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
    id: i.id, name: i.name, description: i.description, unit: i.unit, location: loc(i), room: i.room ?? null, cabinet: i.cabinet ?? null,
    shelf: i.shelf ?? null, box: i.box ?? null, condition: i.condition ?? null, notes: i.notes ?? null, tracking: i.tracking, category_id: i.category_id,
    category: cats.find((c) => c.id === i.category_id)?.name ?? null, min_quantity: i.min_quantity, archived_at: null, updated_at: isoIn(0),
    has_photo: false, stock: stock(i),
  });
  const loanJson = (l: Row) => {
    const i = items.find((x) => x.id === l.item_id)!;
    return { ...l, item: i.name, unit: i.unit, tracking: i.tracking, borrower: people.find((p) => p.id === l.borrower_id)?.name ?? '?', overdue: false, pieces: [],
      registered_by: l.status === 'pedido' ? null : 'Ana Dirigente', returns: l.returns ?? [] };
  };
  const ok = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const fail = (route: Route, message: string) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message }) });

  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const b = (route.request().postDataJSON?.() ?? {}) as Row;
    if (fn === 'my_modules') {
      return ok(route, ['calendario', 'inventario', 'tesouraria', 'equipas', 'secretaria'].map((m) => (m === 'inventario'
        ? { module: m, status: 'teste', space: 'teste', grants: manage ? ['inventario.gerir'] : [], dirigente: manage }
        : m === 'tesouraria' && finOk ? { module: m, status: 'teste', space: 'teste', grants: ['tesouraria.gerir'], dirigente: manage }
        : { module: m, status: 'desenvolvimento', space: null, grants: [], dirigente: manage })));
    }
    if (!fn.startsWith('inv_') && fn !== 'module_files_of') return route.fallback();
    calls.push({ fn, body: b });
    if (opts.delay && fn === 'inv_overview') await new Promise((r) => setTimeout(r, opts.delay));
    switch (fn) {
      case 'inv_overview':
        return ok(route, {
          can_manage: manage, fin_ok: finOk, me: manage ? 'u-ana' : 'u-pedro',
          rooms: [...new Set(items.map((i) => i.room).filter(Boolean))].sort(),
          cabinets: items.filter((i) => i.cabinet).map((i) => ({ room: i.room, cabinet: i.cabinet })),
          summary: {
            lent_units: loans.filter((l) => l.status === 'ativo').reduce((a, l) => a + l.quantity - l.returned_qty, 0),
            lent_loans: loans.filter((l) => l.status === 'ativo').length, overdue: 0,
            repair_units: items.reduce((a, i) => a + i.repair, 0), repair_items: items.filter((i) => i.repair > 0).length,
            purchases_pending: purchases.filter((p) => p.status === 'por_comprar').length,
            purchases_high: purchases.filter((p) => p.status === 'por_comprar' && p.priority === 'alta').length,
          },
          categories: cats.map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id).length })),
          locations: [...new Set(items.map(loc).filter(Boolean))].sort(),
          items: b.p_archived ? [] : items.map(itemJson).sort((x, y) => x.name.localeCompare(y.name, 'pt')),
          pending_requests: loans.filter((l) => l.status === 'pedido').length, overdue: 0,
        });
      case 'inv_item': {
        const i = items.find((x) => x.id === b.p_item);
        if (!i) return fail(route, 'Registo não encontrado.');
        return ok(route, { ...itemJson(i), can_manage: manage, pieces: [], loans: loans.filter((l) => l.item_id === i.id).map(loanJson),
          reservations: reservations.filter((r) => r.item_id === i.id && r.status === 'ativa').map(resJson),
          purchases: purchases.filter((p) => p.item_id === i.id).map(purchaseJson),
          movements: [{ id: 1, kind: 'criacao', quantity: i.total, from_state: null, to_state: null, note: null, at: isoIn(-48), actor: 'Ana Dirigente', piece: null, borrower: null }] });
      }
      case 'inv_item_save': {
        if (!String(b.p_name ?? '').trim()) return fail(route, 'Indica o nome do artigo.');
        const id = `i${items.length + 1}`;
        items.push({ id, name: b.p_name, description: b.p_description, unit: b.p_unit, room: b.p_room, cabinet: b.p_cabinet, shelf: b.p_shelf, box: b.p_box,
          condition: b.p_condition, notes: b.p_notes, tracking: b.p_tracking,
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
        l.returns = [...(l.returns ?? []), { at: isoIn(0), quantity: q, condition: b.p_condition ?? 'disponivel', note: null, by: 'Ana Dirigente' }];
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
      case 'inv_purchases': {
        const st = b.p_status ?? 'todos';
        return ok(route, purchases.filter((p) => st === 'todos' || p.status === st).map(purchaseJson)
          .map((p) => (manage || finOk ? p : { ...p, amount_cents: null })));
      }
      case 'inv_purchase_save': {
        if (!b.p_item && !String(b.p_name ?? '').trim()) return fail(route, 'Indica o material a comprar (um artigo existente ou o nome do material novo).');
        const it = items.find((i) => i.id === b.p_item);
        const id = `p${purchases.length + 1}`;
        purchases.push({ id, item_id: b.p_item, new_material: !b.p_item, name: it?.name ?? b.p_name, category_id: it?.category_id ?? b.p_category,
          quantity: b.p_quantity, unit: it?.unit ?? b.p_unit ?? 'un.', reason: b.p_reason, priority: b.p_priority, status: 'por_comprar',
          needed_by: b.p_needed_by, event_id: b.p_event, event: null, amount_cents: b.p_amount });
        return ok(route, id);
      }
      case 'inv_expense_options':
        return ok(route, finOk ? { allowed: true, accounts: [{ id: 'a1', name: 'Caixa', kind: 'caixa' }], categories: ['Material', 'Outros'], expenses }
          : { allowed: false, reason: 'Associar despesas exige a permissão de tesoureiro autorizado.' });
      case 'inv_purchase_buy': {
        const p = purchases.find((x) => x.id === b.p_id)!;
        if (p.status !== 'por_comprar') return fail(route, 'Esta compra já está marcada como comprada.');
        Object.assign(p, { status: 'comprado', bought_qty: b.p_quantity, bought_on: b.p_bought_on, bought_at: isoIn(0), bought_by: 'Ana Dirigente', amount_cents: b.p_amount ?? p.amount_cents });
        if (b.p_add_stock) {
          const it = items.find((i) => i.id === p.item_id);
          if (it) it.total += b.p_quantity;
          Object.assign(p, { stock_added_at: isoIn(0), stock_item_id: p.item_id, stock_added_by: 'Ana Dirigente' });
        }
        if (b.p_movement) {
          const m = expenses.splice(expenses.findIndex((e) => e.id === b.p_movement), 1)[0];
          Object.assign(p, { has_expense: true, expense: { ...m, voided: false, account: 'Caixa' } });
        }
        return ok(route, { item_id: p.item_id, movement_id: b.p_movement ?? null });
      }
      case 'inv_alerts':
        return ok(route, { overdue: [], due_soon: [], low_stock: items.filter((i) => i.min_quantity != null && stock(i).available < i.min_quantity).map(itemJson),
          repair: items.filter((i) => i.repair > 0).map(itemJson), damaged: items.filter((i) => i.damaged > 0).map(itemJson),
          at_risk: reservations.filter((r) => r.status === 'ativa' && r.at_risk).map(resJson), requests: [] });
      case 'inv_event_options': return ok(route, events);
      case 'inv_reservations':
        return ok(route, reservations.filter((r) => (b.p_past ? r.status !== 'ativa' : r.status === 'ativa')).map(resJson));
      case 'inv_reservation_create': {
        const ev = events.find((e) => e.id === b.p_event);
        const id = `r${reservations.length + 1}`;
        reservations.push({ id, item_id: b.p_item, quantity: b.p_quantity, starts_at: b.p_starts_at ?? ev!.starts_at, ends_at: b.p_ends_at ?? ev!.ends_at,
          status: 'ativa', notes: b.p_notes, event_id: b.p_event, event: ev?.title ?? null, event_cancelled: false, at_risk: false });
        return ok(route, id);
      }
      default:
        return ok(route, []);
    }
  });
  return { calls, loans, items, purchases, reservations };
}

test('lista: pesquisa e filtros ficam no endereço e sobrevivem ao «voltar»', async ({ page }, info) => {
  await installMock(page, leader());
  await mockInventario(page, true);
  await page.goto('/inventario');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Inventário', level: 1 })).toBeVisible();
  await expect(main.locator('h1 .page-tag')).toContainText('Em teste');
  const list = main.getByRole('list', { name: 'Material' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await main.getByPlaceholder('Pesquisar material').fill('tenda');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(page).toHaveURL(/q=tenda/);
  await main.getByPlaceholder('Pesquisar material').fill('');
  await openFilters(page);
  // À vista: pesquisa, tipo e estado; o local fica em «Mais filtros».
  await expect(main.getByLabel('Filtrar por tipo')).toBeVisible();
  await expect(main.getByLabel('Filtrar por estado')).toBeVisible();
  await expect(main.getByLabel('Filtrar por localização')).toBeHidden();
  await expect(main.getByLabel('Filtrar por conservação')).toBeHidden();
  await expect(main.getByLabel('Ver arquivados')).toBeHidden();
  await openMoreFilters(page);
  await main.getByLabel('Filtrar por localização').selectOption('Arrecadação');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await main.getByLabel('Filtrar por estado').selectOption('reparacao');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Tenda canadiana');
  await expect(list).toContainText('Em reparação');
  // Cada linha: material, quantidade disponível, local curto e um só estado.
  await expect(list.getByRole('listitem').first()).toContainText('5 de 6 un.');
  await expect(list.getByRole('listitem').first().locator('.badge')).toHaveCount(1);
  await expect(page).toHaveURL(/local=Arrecada.*estado=reparacao|estado=reparacao.*local=Arrecada/);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/inventario-lista-${info.project.name}.png`, fullPage: true });
  await list.getByRole('link', { name: /Tenda canadiana/ }).click();
  await expect(main.getByRole('heading', { name: 'Tenda canadiana', level: 1 })).toBeVisible();
  await noHorizontalScroll(page);
  await page.goBack();
  await expect(main.getByLabel('Filtrar por estado')).toHaveValue('reparacao');
  // Ao voltar, «Mais filtros» abre sozinho porque há um local escolhido.
  await openFilters(page);
  await expect(main.getByLabel('Filtrar por localização')).toBeVisible();
  await expect(main.getByLabel('Filtrar por localização')).toHaveValue('Arrecadação');
  await openFilters(page);
  await main.getByLabel('Filtrar por tipo').selectOption('c2');
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
  // Primeiro só o essencial, por esta ordem; o resto fica em «Mais detalhes» (fechado).
  const first = await main.locator('form input:visible, form select:visible, form textarea:visible').evaluateAll((els) => els.map((e) => e.id));
  expect(first).toEqual(['inv-name', 'inv-cat', 'inv-qty', 'inv-unit', 'inv-room', 'inv-cond']);
  for (const label of ['Armário', 'Prateleira', 'Caixa', 'Fotografia (opcional)', 'Observações (opcional)', 'Quantidade mínima (opcional)', 'Descrição (opcional)']) {
    await expect(main.getByLabel(label, { exact: true })).toBeHidden();
  }
  await expect(main.getByText('Peças identificadas (código ou n.º de série)')).toBeHidden();
  await main.getByLabel('Nome').fill('Fogareiro a gás');
  await main.getByLabel('Tipo', { exact: true }).selectOption('c2');
  await main.getByLabel('Quantidade inicial').fill('3');
  await main.getByLabel('Localização').fill('Arrecadação');
  await main.getByLabel('Estado de conservação').selectOption('novo');
  // Erro num campo de «Mais detalhes» abre a secção.
  const more = main.locator('details.more-options').filter({ hasText: 'Mais detalhes' });
  await main.locator('#inv-min').evaluate((el) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '-1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await main.getByRole('button', { name: 'Registar artigo' }).click();
  await expect(main.getByText('A quantidade mínima tem de ser um número inteiro, 0 ou mais.')).toBeVisible();
  await expect(more).toHaveAttribute('open', '');
  expect(m.calls.some((c) => c.fn === 'inv_item_save')).toBe(false);
  await main.getByLabel('Armário', { exact: true }).fill('Armário 2');
  await main.getByLabel('Caixa', { exact: true }).fill('Caixa verde');
  await main.getByLabel('Observações (opcional)').fill('Verificar a válvula');
  await main.getByLabel(/Quantidade mínima/).fill('1');
  await noHorizontalScroll(page);
  await main.getByRole('button', { name: 'Registar artigo' }).click();
  await expect(main.getByRole('heading', { name: 'Fogareiro a gás', level: 1 })).toBeVisible();
  const save = m.calls.find((c) => c.fn === 'inv_item_save')!.body;
  expect(save).toMatchObject({ p_name: 'Fogareiro a gás', p_category: 'c2', p_room: 'Arrecadação', p_cabinet: 'Armário 2', p_shelf: null, p_box: 'Caixa verde',
    p_condition: 'novo', p_notes: 'Verificar a válvula', p_tracking: 'quantidade', p_quantity: 3, p_min_quantity: 1 });
  await expect(main.getByRole('list', { name: 'Quantidades' })).toContainText('Disponível');
  await expect(main.getByRole('definition').filter({ hasText: 'Caixa verde' })).toBeVisible();
  const ficha = main.getByRole('region', { name: 'Dados do artigo' });
  await expect(ficha.getByRole('term').filter({ hasText: 'Conservação' }).locator('..')).toContainText('Novo');
  await expect(ficha.getByRole('term').filter({ hasText: 'Tipo' }).locator('..')).toContainText('Cozinha');
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
  await expect(main.locator('.inv-loan').first()).toContainText('Saída registada por');
  await expect(main.locator('.inv-loan').first().getByRole('list', { name: 'Devoluções' }).getByRole('listitem')).toHaveCount(2);
  expect(m.calls.filter((c) => c.fn === 'inv_loan_return').map((c) => c.body.p_quantity)).toEqual([1, 1]);
  await noHorizontalScroll(page);
});

test('ficha: ação principal «Emprestar», restantes no menu «Mais» e arquivar só a pedido', async ({ page }) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true);
  await page.goto('/inventario/artigo/i1');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Tenda canadiana', level: 1 })).toBeVisible();
  // Local completo e dados secundários na ficha
  await expect(main.getByRole('definition').filter({ hasText: 'Prateleira 2' })).toBeVisible();
  // O formulário de arquivo não está aberto por omissão
  await expect(main.getByText('Retirar do inventário')).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Reservar' })).toBeHidden();
  await main.locator('.page-head').getByRole('button', { name: 'Mais ações' }).click();
  for (const label of ['Reservar', 'Entrada ou saída', 'Mudar estado', 'Pôr na lista «A comprar»', 'Arquivar']) {
    await expect(main.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(main.getByRole('link', { name: /Editar/ })).toBeVisible();
  await main.getByRole('button', { name: 'Arquivar', exact: true }).click();
  const box = main.getByRole('region', { name: 'Arquivo' });
  await expect(box).toContainText('Retirar do inventário');
  await box.getByLabel('Motivo (opcional)').fill('Rota');
  await box.getByRole('button', { name: 'Arquivar artigo' }).click();
  await expect.poll(() => m.calls.filter((c) => c.fn === 'inv_item_archive').length).toBe(1);
  expect(m.calls.find((c) => c.fn === 'inv_item_archive')!.body).toMatchObject({ p_item: 'i1', p_archived: true, p_note: 'Rota' });
  await noHorizontalScroll(page);
});

test('quem só consulta não edita, mas pede empréstimos', async ({ page }) => {
  await installMock(page, pioneer());
  const m = await mockInventario(page, false);
  await page.goto('/inventario');
  const main = page.locator('main');
  await expect(main.getByRole('list', { name: 'Material' }).getByRole('listitem')).toHaveCount(3);
  await expect(main.getByRole('link', { name: 'Novo artigo' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: /Tipos/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Configurar' })).toHaveCount(0);
  await expect(main.getByRole('navigation', { name: 'Inventário' }).getByRole('link')).toHaveCount(3);
  // Os indicadores também servem a quem só consulta.
  await expect(main.getByRole('list', { name: 'Resumo do inventário' }).getByRole('link', { name: /Stock baixo/ })).toContainText('1');
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
  expect(m.calls.filter((c) => c.fn === 'inv_loans').at(-1)!.body).toMatchObject({ p_mine: true });
  // Reservas: vê-as, sem ações de quem gere.
  await main.getByRole('radio', { name: 'Reservas' }).click();
  await expect(main.getByRole('radio', { name: 'Reservas' })).toBeChecked();
  const res = main.getByRole('list', { name: 'Reservas' });
  await expect(res.getByRole('listitem')).toHaveCount(2);
  await expect(res.getByRole('button')).toHaveCount(0);
  // Na ficha, não há «Reservar» (só quem gere reserva).
  await page.goto('/inventario/artigo/i1');
  await expect(main.getByRole('button', { name: 'Pedir empréstimo' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Mais ações' })).toHaveCount(0);
  await noHorizontalScroll(page);
});

test('indicadores abrem os alertas: stock baixo e avariado filtram a lista, com teclado e «voltar»', async ({ page }) => {
  await installMock(page, leader());
  await mockInventario(page, true);
  await page.goto('/inventario');
  const main = page.locator('main');
  const summary = main.getByRole('list', { name: 'Resumo do inventário' });
  await expect(summary.getByRole('listitem')).toHaveCount(4);
  await expect(summary.getByRole('link', { name: /Emprestado/ })).toHaveAttribute('href', '/inventario/emprestimos?estado=ativo');
  await expect(summary.getByRole('link', { name: /Em atraso/ })).toContainText('0');
  await expect(summary.getByRole('link', { name: /Stock baixo/ })).toContainText('1');
  await expect(summary.getByRole('link', { name: /Avariado/ })).toContainText('2');
  await expect(summary.getByRole('link', { name: /Avariado/ })).toContainText('1 em reparação');
  // Cartões centrados e com a mesma altura (com ou sem dica)
  const align = await summary.locator('.stat').first().evaluate((el) => getComputedStyle(el).textAlign);
  expect(align).toBe('center');
  const heights = await summary.locator('.stat').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
  const list = main.getByRole('list', { name: 'Material' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  // Teclado: o indicador «Stock baixo» abre-se com Enter.
  await summary.getByRole('link', { name: /Stock baixo/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/alerta=stock/);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Lanterna frontal');
  await expect(list.getByRole('listitem').first().locator('.badge')).toHaveText('Mínimo 5 un.');
  await expect(summary.getByRole('link', { name: /Stock baixo/ })).toHaveAttribute('aria-current', 'true');
  await expect(main.getByText('Stock baixo', { exact: true }).last()).toBeVisible();
  await noHorizontalScroll(page);
  // Outro indicador: danificado ou em reparação.
  await summary.getByRole('link', { name: /Avariado/ }).click();
  await expect(page).toHaveURL(/alerta=avaria/);
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('Tenda canadiana');
  await expect(list).toContainText('Panela grande');
  // «Voltar» regressa ao filtro anterior; voltar a carregar no indicador ativo tira o filtro.
  await page.goBack();
  await expect(page).toHaveURL(/alerta=stock/);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await summary.getByRole('link', { name: /Stock baixo/ }).click();
  await expect(page).not.toHaveURL(/alerta=/);
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.goto('/inventario?alerta=avaria');
  await main.getByRole('button', { name: 'Ver todo o material' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  // Linha «Também a ver»: reservas sem material suficiente → reservas filtradas em Empréstimos.
  await main.getByRole('list', { name: 'Também a ver' }).getByRole('link', { name: '1 reserva sem material suficiente' }).click();
  await expect(page).toHaveURL(/emprestimos\?ver=reservas&risco=1/);
  const res = main.getByRole('list', { name: 'Reservas' });
  await expect(res.getByRole('listitem')).toHaveCount(1);
  await expect(res).toContainText('Lanterna frontal');
  await expect(res).toContainText('Sem material suficiente');
  await main.getByRole('button', { name: 'Ver todos' }).click();
  await expect(res.getByRole('listitem')).toHaveCount(2);
  await noHorizontalScroll(page);
});

test('«Mais filtros»: local exato, conservação e arquivados no endereço', async ({ page }, info) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true);
  await page.goto('/inventario');
  const main = page.locator('main');
  const list = main.getByRole('list', { name: 'Material' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await openMoreFilters(page);
  await main.getByLabel('Filtrar por localização').selectOption('Arrecadação');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await main.getByLabel('Filtrar por armário').selectOption('Armário 2');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Lanterna frontal');
  // Na lista só o local curto; o armário e a caixa ficam na ficha
  await expect(list).toContainText('Arrecadação');
  await expect(list).not.toContainText('Caixa azul');
  await expect(page).toHaveURL(/armario=Arm/);
  await main.getByLabel('Filtrar por armário').selectOption('');
  await main.getByLabel('Filtrar por conservação').selectOption('bom');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Tenda canadiana');
  await expect(list).not.toContainText('Conservação');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/inventario-resumo-${info.project.name}.png`, fullPage: true });
  // Mudar de local limpa o armário escolhido
  await main.getByLabel('Filtrar por localização').selectOption('Cozinha da sede');
  await expect(page).not.toHaveURL(/armario=/);
  await main.getByRole('navigation', { name: 'Inventário' }).getByRole('link', { name: /A comprar/ }).click();
  await expect(main.getByRole('heading', { name: 'A comprar', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(main.getByLabel('Filtrar por localização')).toHaveValue('Cozinha da sede');
  await expect(main.getByLabel('Filtrar por conservação')).toHaveValue('bom');
  // Arquivados: pede a lista arquivada ao servidor e esconde os indicadores.
  await openFilters(page);
  await main.getByLabel('Ver arquivados').click();
  await expect(main.getByLabel('Ver arquivados')).toBeChecked();
  await expect(page).toHaveURL(/arquivados=1/);
  await expect.poll(() => m.calls.some((c) => c.fn === 'inv_overview' && c.body.p_archived === true)).toBe(true);
  await expect(main.getByRole('list', { name: 'Resumo do inventário' })).toHaveCount(0);
});

test('três entradas; tipos em «Configurar»; reservas dentro de Empréstimos', async ({ page }) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true);
  await page.goto('/inventario');
  const main = page.locator('main');
  const nav = main.getByRole('navigation', { name: 'Inventário' });
  await expect(nav.getByRole('link')).toHaveText([/Material/, /Empréstimos/, /A comprar\s*2/]);
  await main.locator('.page-head').getByRole('button', { name: 'Configurar' }).click();
  await main.getByRole('link', { name: 'Tipos de material' }).click();
  await expect(main.getByRole('heading', { name: 'Tipos de material', level: 1 })).toBeVisible();
  await expect(main.getByRole('list', { name: 'Categorias' }).getByRole('listitem')).toHaveCount(2);
  await main.getByRole('button', { name: 'Novo tipo' }).click();
  await main.getByLabel('Novo tipo (configurável)').fill('Ferramentas');
  await main.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect.poll(() => m.calls.find((c) => c.fn === 'inv_category_save')?.body).toMatchObject({ p_id: null, p_name: 'Ferramentas' });
  await main.getByRole('button', { name: 'Voltar' }).click();
  await expect(main.getByRole('heading', { name: 'Inventário', level: 1 })).toBeVisible();
  // Endereço antigo das reservas abre as reservas dentro de Empréstimos.
  await page.goto('/inventario/reservas');
  await expect(page).toHaveURL(/\/inventario\/emprestimos\?ver=reservas/);
  await expect(main.getByRole('radio', { name: 'Reservas' })).toBeChecked();
  const res = main.getByRole('list', { name: 'Reservas' });
  await expect(res.getByRole('listitem')).toHaveCount(2);
  await expect(res.getByRole('listitem').first()).toContainText('Reservado');
  await expect(main.getByRole('list', { name: 'Empréstimos' })).toHaveCount(0);
  await main.getByText('Terminadas e canceladas').click();
  await expect(page).toHaveURL(/reservas=terminadas/);
  await expect.poll(() => m.calls.some((c) => c.fn === 'inv_reservations' && c.body.p_past === true)).toBe(true);
  await main.getByRole('radio', { name: 'Empréstimos' }).click();
  await expect(page).not.toHaveURL(/ver=reservas/);
  await expect(main.getByRole('radiogroup', { name: 'Estado dos empréstimos' })).toBeVisible();
  // O endereço antigo dos alertas leva à lista com os indicadores.
  await page.goto('/inventario/alertas');
  await expect(page).toHaveURL(/\/inventario$/);
  await expect(main.getByRole('list', { name: 'Resumo do inventário' })).toBeVisible();
  await noHorizontalScroll(page);
});

test('reservar e comprar para uma atividade com o seletor comum (data · nome, hora quando há outra igual)', async ({ page }) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true);
  await page.goto('/inventario/artigo/i1');
  const main = page.locator('main');
  await main.locator('.page-head').getByRole('button', { name: 'Mais ações' }).click();
  await main.getByRole('button', { name: 'Reservar', exact: true }).click();
  const form = main.getByRole('form', { name: 'Reservar material' });
  const ev = form.getByLabel('Atividade do calendário');
  await expect(ev.locator('option')).toHaveText(['Sem atividade', '20/11/2026 · Dia do Patrono', '14/11/2026 · Acampamento · 09:00', '14/11/2026 · Acampamento · 15:00']);
  await ev.selectOption({ label: '14/11/2026 · Acampamento · 15:00' });
  await expect(form.getByLabel(/Usar o período da atividade/)).toBeChecked();
  await form.getByLabel(/Quantidade/).fill('2');
  await form.getByRole('button', { name: 'Reservar' }).click();
  await expect(main.getByText('Reserva registada.')).toBeVisible();
  expect(m.calls.find((c) => c.fn === 'inv_reservation_create')!.body).toMatchObject({ p_item: 'i1', p_event: 'e2', p_quantity: 2, p_starts_at: null, p_ends_at: null });
  await expect(main.getByRole('region', { name: 'Reservas' })).toContainText('Acampamento');
  // Compra ligada a uma atividade: guarda o id.
  await main.locator('.page-head').getByRole('button', { name: 'Mais ações' }).click();
  await main.getByRole('button', { name: 'Pôr na lista «A comprar»' }).click();
  const buy = main.getByRole('form', { name: 'Nova compra' });
  await buy.getByLabel('Atividade do calendário (opcional)').selectOption({ label: '20/11/2026 · Dia do Patrono' });
  await buy.getByRole('button', { name: 'Acrescentar à lista' }).click();
  await expect(main.getByText('Acrescentado à lista «A comprar».')).toBeVisible();
  expect(m.calls.find((c) => c.fn === 'inv_purchase_save')!.body).toMatchObject({ p_item: 'i1', p_event: 'e3' });
  await noHorizontalScroll(page);
});

test('a carregar e textos longos sem deslocamento horizontal', async ({ page }) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true, false, { delay: 700 });
  m.items.push({ id: 'i9', name: 'Conjunto de cordas de sisal entrançadas para construções pioneiras de grande porte e torres de observação', description: null, unit: 'rolos',
    room: 'Arrecadação do pavilhão grande junto ao campo de futebol', cabinet: null, shelf: null, box: null, condition: 'bom', notes: null, tracking: 'quantidade',
    category_id: 'c1', total: 12, damaged: 0, repair: 0, min_quantity: 20 });
  await page.goto('/inventario');
  const main = page.locator('main');
  await expect(main.getByRole('status')).toBeVisible();
  const list = main.getByRole('list', { name: 'Material' });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(main.getByRole('status')).toHaveCount(0);
  await noHorizontalScroll(page);
  await list.getByRole('link', { name: /Conjunto de cordas/ }).click();
  await expect(main.getByRole('heading', { level: 1 })).toContainText('Conjunto de cordas');
  await noHorizontalScroll(page);
});

test('lista «A comprar»: nova compra, marcar comprado com inventário e despesa existente', async ({ page }, info) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true, true);
  await page.goto('/inventario/comprar');
  const main = page.locator('main');
  const list = main.getByRole('list', { name: 'Compras' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').first()).toContainText('Prioridade alta');
  await expect(list.getByRole('listitem').first()).toContainText('120,00 €');
  // Nova compra: validação e material novo
  await main.getByRole('button', { name: 'Nova compra' }).click();
  const form = main.getByRole('form', { name: 'Nova compra' });
  await form.getByRole('button', { name: 'Acrescentar à lista' }).click();
  await expect(form.getByText(/Escolhe um artigo existente/)).toBeVisible();
  await form.getByLabel('Nome do material novo').fill('Panela grande');
  await expect(form.getByText(/soma-se a esse artigo/)).toBeVisible();
  await form.getByLabel('Nome do material novo').fill('Machado');
  await form.getByLabel('Quantidade', { exact: true }).fill('2');
  await form.getByLabel('Prioridade').selectOption('media');
  await form.getByLabel('Motivo (opcional)').fill('Construções do acampamento');
  await noHorizontalScroll(page);
  await form.getByRole('button', { name: 'Acrescentar à lista' }).click();
  await expect(main.getByText('Acrescentado à lista «A comprar».')).toBeVisible();
  expect(m.calls.find((c) => c.fn === 'inv_purchase_save')!.body).toMatchObject({ p_item: null, p_name: 'Machado', p_quantity: 2, p_priority: 'media' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  // Marcar como comprado: acrescentar ao inventário e ligar a despesa já registada
  const card = list.getByRole('listitem').filter({ hasText: 'Tenda canadiana' }).first();
  await card.getByRole('button', { name: 'Marcar como comprado' }).click();
  const buy = card.getByRole('form', { name: 'Marcar como comprado' });
  await expect(buy.getByLabel(/Acrescentar ao inventário/)).toBeChecked();
  await buy.getByLabel('Despesa já registada').check();
  await buy.getByRole('button', { name: 'Confirmar compra' }).click();
  await expect(buy.getByText('Escolhe a despesa a associar.')).toBeVisible();
  await buy.getByLabel('Despesa', { exact: true }).selectOption('m1');
  await buy.getByLabel('Valor pago (opcional)').fill('119,90');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/inventario-comprar-${info.project.name}.png`, fullPage: true });
  await buy.getByRole('button', { name: 'Confirmar compra' }).click();
  await expect(list.getByRole('listitem').filter({ hasText: 'Tenda canadiana' })).toHaveCount(0);
  const body = m.calls.find((c) => c.fn === 'inv_purchase_buy')!.body;
  expect(body).toMatchObject({ p_id: 'p1', p_quantity: 2, p_amount: 11990, p_add_stock: true, p_movement: 'm1', p_expense: null });
  expect(m.items.find((i) => i.id === 'i1')!.total).toBe(8);
  await main.getByText('Compradas').click();
  await expect(page).toHaveURL(/estado=comprado/);
  const bought = list.getByRole('listitem').first();
  await expect(bought).toContainText('Comprado');
  await expect(bought).toContainText('Acrescentado ao inventário');
  await expect(bought).toContainText('Despesa na Tesouraria: Loja de campismo');
  await expect(bought.getByRole('button', { name: 'Associar despesa' })).toHaveCount(0);
  await noHorizontalScroll(page);
});

test('sem «tesouraria.gerir» marca comprado sem associar despesa', async ({ page }) => {
  await installMock(page, leader());
  const m = await mockInventario(page, true, false);
  await page.goto('/inventario/comprar?prioridade=baixa');
  const main = page.locator('main');
  const list = main.getByRole('list', { name: 'Compras' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  const card = list.getByRole('listitem').first();
  await card.getByRole('button', { name: 'Marcar como comprado' }).click();
  const buy = card.getByRole('form', { name: 'Marcar como comprado' });
  await expect(buy).toContainText('associada mais tarde por quem gere a Tesouraria');
  await expect(buy.getByLabel('Registar nova despesa')).toHaveCount(0);
  await buy.getByRole('button', { name: 'Confirmar compra' }).click();
  await expect.poll(() => m.calls.filter((c) => c.fn === 'inv_purchase_buy').length).toBe(1);
  expect(m.calls.find((c) => c.fn === 'inv_purchase_buy')!.body).toMatchObject({ p_id: 'p2', p_movement: null, p_expense: null, p_add_stock: true });
  await noHorizontalScroll(page);
});

test('quem só consulta vê a lista «A comprar» sem ações nem valores', async ({ page }) => {
  await installMock(page, pioneer());
  await mockInventario(page, false);
  await page.goto('/inventario/comprar');
  const main = page.locator('main');
  const list = main.getByRole('list', { name: 'Compras' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(main.getByRole('button', { name: 'Nova compra' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Marcar como comprado' })).toHaveCount(0);
  await expect(list).not.toContainText('€');
  await noHorizontalScroll(page);
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`inventário ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      await mockInventario(page, true, true);
      await page.goto('/inventario');
      await shoot(page, info, theme, 'inventario-lista');
      await page.goto('/inventario?alerta=stock');
      await shoot(page, info, theme, 'inventario-stock-baixo');
      await page.goto('/inventario?local=Arrecada%C3%A7%C3%A3o');
      await page.locator('main').getByRole('list', { name: 'Material' }).waitFor();
      await openFilters(page);
      await shoot(page, info, theme, 'inventario-mais-filtros');
      await page.goto('/inventario/artigo/i1');
      await shoot(page, info, theme, 'inventario-artigo');
      await page.goto('/inventario/comprar');
      await shoot(page, info, theme, 'inventario-comprar');
      await page.goto('/inventario/emprestimos');
      await shoot(page, info, theme, 'inventario-emprestimos');
      await page.goto('/inventario/emprestimos?ver=reservas');
      await shoot(page, info, theme, 'inventario-reservas');
      await page.goto('/inventario/novo');
      await shoot(page, info, theme, 'inventario-formulario');
      await page.locator('main summary').filter({ hasText: 'Mais detalhes' }).click();
      await shoot(page, info, theme, 'inventario-formulario-detalhes');
      await page.goto('/inventario/categorias');
      await shoot(page, info, theme, 'inventario-tipos');
      await page.goto('/inventario?q=nada-disto');
      await shoot(page, info, theme, 'inventario-vazio');
      await page.goto('/inventario/artigo/i1');
      await page.locator('main .page-head').getByRole('button', { name: 'Mais ações' }).click();
      await shoot(page, info, theme, 'inventario-artigo-menu');
      await page.getByRole('button', { name: 'Reservar', exact: true }).click();
      await shoot(page, info, theme, 'inventario-reservar');
    });
  }
});
