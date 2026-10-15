// Calendário escutista: vistas (próximas e mensal), criar atividade, responder, exportar.
// Dados FICTÍCIOS só para teste; as regras do servidor são testadas em tests/db/calendario.test.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;
const H = 3600e3;
const D = 86400e3;
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
const lisbonDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date(iso));

const MISSING = (e: Row, p: Row) => {
  if (e.status !== 'ativo' || p.response === 'nao_vou') return [];
  const out: string[] = [];
  if (!p.response || p.response === 'por_confirmar') out.push('resposta');
  for (const r of e.required) if (!p.resolved?.includes(r)) out.push(r);
  return out;
};

async function installCalendar(page: Page, who: 'ana' | 'p1') {
  const me = who === 'ana' ? 'u-ana' : 'u-p1';
  const start = isoIn(3 * D);
  const events: Row[] = [{
    id: 'ev1', title: 'Raid de outono (teste)', description: 'Percurso pedestre fictício.', location: 'Serra (teste)',
    all_day: false, starts_at: start, ends_at: new Date(Date.parse(start) + 3 * H).toISOString(), start_date: null, end_date: null,
    audience: 'seccao', team_id: null, team_name: null, responsible_id: 'u-ana', responsible_name: 'Ana Dirigente Teste',
    registration_deadline: isoIn(2 * D), deadline_passed: false, needs_authorization: true, needs_payment: false, needs_registration: false,
    material: 'Lanterna', required: ['autorizacao', 'material'], reminder_minutes: [1440], deadline_reminder_minutes: [1440],
    status: 'ativo', cancel_reason: null, cancelled_at: null, updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
    people: [
      { profile_id: 'u-p1', name: 'Pedro Teste', team_name: 'Equipa Andorinha', function: 'pioneiro', response: null, note: null, resolved: [] },
      { profile_id: 'u-guia', name: 'Guia Teste', team_name: 'Equipa Andorinha', function: 'guia', response: 'vou', note: null, resolved: ['autorizacao'] },
      { profile_id: 'u-ana', name: 'Ana Dirigente Teste', team_name: null, function: 'dirigente', response: 'vou', note: null, resolved: ['autorizacao', 'material'] },
    ],
  }];
  const calls: { fn: string; body: Row }[] = [];
  const manage = who === 'ana';
  const view = (e: Row): Row => {
    const mine = e.people.find((p: Row) => p.profile_id === me) ?? { response: null, resolved: [] };
    const { people, ...rest } = e;
    return {
      ...rest, involved: true, my_response: mine.response, my_missing: MISSING(e, mine),
      counts: { vou: people.filter((p: Row) => p.response === 'vou').length, nao_vou: 0, por_confirmar: 0, total: people.length },
    };
  };
  const detail = (e: Row) => {
    const mine = e.people.find((p: Row) => p.profile_id === me) ?? { response: null, resolved: [] };
    return {
      ...view(e), people: undefined, can_manage: manage, can_see_pending: manage, can_respond: e.status === 'ativo',
      me: { response: mine.response, note: mine.note, responded_at: null, missing: MISSING(e, mine) },
      participants: e.people.map((p: Row) => ({
        ...p, is_me: p.profile_id === me, is_responsible: p.profile_id === e.responsible_id, responded_at: null,
        note: manage || p.profile_id === me ? p.note : null,
        missing: manage || p.profile_id === me ? MISSING(e, p) : null,
      })),
    };
  };
  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route: Route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON?.() ?? {};
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    const fail = (message: string) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message }) });
    calls.push({ fn, body });
    const find = () => events.find((e) => e.id === body.p_event);
    switch (fn) {
      case 'my_modules':
        return ok(['calendario', 'equipas', 'inventario', 'secretaria', 'tesouraria'].map((m) => ({
          module: m, status: m === 'calendario' ? 'teste' : 'desenvolvimento', space: m === 'calendario' ? 'teste' : null, grants: [], dirigente: manage,
        })));
      case 'cal_events_list':
        return ok(events.filter((e) => {
          const from = e.all_day ? e.start_date : lisbonDay(e.starts_at);
          const to = e.all_day ? e.end_date : lisbonDay(e.ends_at);
          return from <= body.p_to && to >= body.p_from;
        }).map(view));
      case 'cal_my_pending':
        return ok(events.map(view).filter((e) => e.status === 'ativo' && e.my_missing.length).map((e) => ({ ...e, missing: e.my_missing })));
      case 'cal_event_get': {
        const e = find();
        return e ? ok(detail(e)) : fail('Registo não encontrado.');
      }
      case 'cal_form_options':
        return manage ? ok({
          teams: [{ id: 'teamA', name: 'Equipa Andorinha' }, { id: 'teamB', name: 'Equipa Bússola' }],
          members: [{ id: 'u-ana', name: 'Ana Dirigente Teste' }, { id: 'u-p1', name: 'Pedro Teste' }],
        }) : fail('Não tens permissão para esta ação neste módulo.');
      case 'cal_create_event': {
        const d = body.p_data;
        const e = {
          ...events[0], ...d, id: `ev${events.length + 1}`, team_name: null, responsible_name: null, deadline_passed: false,
          required: [d.needs_authorization && 'autorizacao', d.needs_payment && 'pagamento', d.needs_registration && 'inscricao', d.material && 'material'].filter(Boolean),
          status: 'ativo', people: [{ profile_id: 'u-p1', name: 'Pedro Teste', team_name: 'Equipa Andorinha', function: 'pioneiro', response: null, note: null, resolved: [] }],
          starts_at: d.starts_at ?? null, ends_at: d.ends_at ?? null, start_date: d.start_date ?? null, end_date: d.end_date ?? null,
        };
        events.push(e);
        return ok(e.id);
      }
      case 'cal_respond': {
        const e = find()!;
        const target = body.p_profile ?? me;
        const p = e.people.find((x: Row) => x.profile_id === target);
        if (p) Object.assign(p, { response: body.p_response, note: body.p_profile ? p.note : body.p_note });
        return ok(null);
      }
      case 'cal_set_pending': {
        const p = find()!.people.find((x: Row) => x.profile_id === body.p_profile);
        p.resolved = body.p_done ? [...p.resolved, body.p_item] : p.resolved.filter((r: string) => r !== body.p_item);
        return ok(null);
      }
      case 'cal_cancel_event':
        Object.assign(find()!, { status: 'cancelado', cancel_reason: body.p_reason, cancelled_at: new Date().toISOString() });
        return ok(null);
      case 'module_files_of':
        return ok([]);
      default:
        return route.fallback();
    }
  });
  return { calls, events };
}

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('próximas atividades e vista mensal, com «O que te falta»', async ({ page }, info) => {
  await installMock(page, leader());
  await installCalendar(page, 'ana');
  await page.goto('/calendario');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Calendário escutista', level: 1 })).toBeVisible();
  await expect(main.getByText('Ambiente de teste.')).toBeVisible();
  await expect(main.getByRole('link', { name: /Raid de outono/ })).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/calendario-proximas-${info.project.name}.png`, fullPage: true });

  await main.getByRole('tab', { name: 'Mês' }).click();
  await expect(page).toHaveURL(/vista=mes/);
  const grid = main.getByRole('grid');
  await expect(grid).toBeVisible();
  const day = lisbonDay(isoIn(3 * D));
  const [y, m, d] = day.split('-');
  // Se a atividade cair no mês seguinte, avançar
  if (day.slice(0, 7) !== lisbonDay(new Date().toISOString()).slice(0, 7)) {
    await main.getByRole('button', { name: 'Mês seguinte' }).click();
  }
  await grid.getByRole('gridcell', { name: new RegExp(`${d}/${m}/${y}, 1 atividade`) }).click();
  await expect(page).toHaveURL(new RegExp(`dia=${day}`));
  await expect(main.locator('.cal-day-list')).toContainText('Raid de outono');
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/calendario-mes-${info.project.name}.png`, fullPage: true });
  // O filtro sobrevive a voltar atrás
  await main.locator('.cal-day-list').getByRole('link', { name: /Raid de outono/ }).click();
  await expect(main.getByRole('heading', { name: 'Raid de outono (teste)', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`vista=mes.*dia=${day}|dia=${day}.*vista=mes`));
});

test('criar atividade com validação e horas de Lisboa', async ({ page }) => {
  await installMock(page, leader());
  const cal = await installCalendar(page, 'ana');
  await page.goto('/calendario');
  await page.locator('main').getByRole('link', { name: 'Nova atividade' }).click();
  await expect(page.getByRole('heading', { name: 'Nova atividade', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('Indica o título da atividade.')).toBeVisible();
  await page.getByLabel('Título').fill('Fogo de conselho (teste)');
  await page.getByLabel('Local (opcional)').fill('Sede (teste)');
  await page.getByLabel('Início').fill('2026-10-25T10:00');
  await page.getByLabel('Fim').fill('2026-10-25T09:00');
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('O fim não pode ser antes do início.')).toBeVisible();
  await page.getByLabel('Fim').fill('2026-10-25T12:00');
  await page.getByLabel('Pede autorização').check();
  await page.getByLabel('1 hora').check();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('Atividade criada. Os envolvidos foram avisados.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fogo de conselho (teste)', level: 1 })).toBeVisible();
  const body = cal.calls.find((c) => c.fn === 'cal_create_event')!.body;
  // 25/10/2026 já é hora de inverno (UTC+0)
  expect(body.p_data).toMatchObject({ starts_at: '2026-10-25T10:00:00.000Z', ends_at: '2026-10-25T12:00:00.000Z', needs_authorization: true, reminder_minutes: [1440, 60] });
  await expect(page.locator('main')).toContainText('25/10/2026, 10:00–12:00');
});

test('pioneiro responde, vê o que lhe falta e exporta para o calendário', async ({ page }, info) => {
  await installMock(page, pioneer());
  const cal = await installCalendar(page, 'p1');
  await page.goto('/calendario');
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: 'Nova atividade' })).toHaveCount(0);
  const todo = main.getByRole('region', { name: 'O que te falta' });
  await expect(todo).toContainText('Confirmar presença');
  await expect(todo).toContainText('Autorização');
  await todo.getByRole('link', { name: /Raid de outono/ }).click();
  await expect(main.getByRole('heading', { name: 'A tua resposta' })).toBeVisible();
  await main.getByRole('button', { name: 'Guardar resposta' }).click();
  await expect(main.getByText('Escolhe «Vou», «Não vou» ou «Por confirmar».')).toBeVisible();
  await main.getByRole('radio', { name: 'Vou', exact: true }).check();
  await main.getByLabel('Nota (opcional)').fill('Levo lanterna extra');
  await main.getByRole('button', { name: 'Guardar resposta' }).click();
  await expect(main.getByText('Resposta guardada.')).toBeVisible();
  expect(cal.calls.find((c) => c.fn === 'cal_respond')!.body).toMatchObject({ p_event: 'ev1', p_response: 'vou', p_note: 'Levo lanterna extra' });
  await expect(main.locator('.cal-me')).not.toContainText('Confirmar presença');
  await expect(main.locator('.cal-me')).toContainText('Autorização');
  // Pendências de outras pessoas não aparecem; sem botões de gestão
  await expect(main.getByRole('group', { name: /Pendências de/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /Cancelar atividade/ })).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/calendario-evento-${info.project.name}.png`, fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: /Adicionar ao meu calendário/ }).click()]);
  expect(download.suggestedFilename()).toBe('raid-de-outono-teste.ics');
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  expect(text).toContain('BEGIN:VEVENT');
  expect(text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
});

test('dirigente marca pendências e cancela', async ({ page }) => {
  await installMock(page, leader());
  const cal = await installCalendar(page, 'ana');
  await page.goto('/calendario/evento/ev1');
  const main = page.locator('main');
  const pedro = main.locator('.cal-person', { hasText: 'Pedro Teste' });
  await expect(pedro).toContainText('O que falta');
  await pedro.getByRole('button', { name: 'Autorização' }).click();
  await expect(pedro.getByRole('button', { name: 'Autorização' })).toHaveAttribute('aria-pressed', 'true');
  expect(cal.calls.find((c) => c.fn === 'cal_set_pending')!.body).toMatchObject({ p_profile: 'u-p1', p_item: 'autorizacao', p_done: true });
  await main.getByRole('tab', { name: 'Com pendências' }).click();
  await expect(page).toHaveURL(/p=falta/);
  await main.getByRole('button', { name: 'Cancelar atividade…' }).click();
  await main.getByRole('button', { name: 'Cancelar atividade', exact: true }).click();
  await expect(main.getByText('Atividade cancelada', { exact: false }).first()).toBeVisible();
  await expect(main.getByRole('button', { name: 'Guardar resposta' })).toHaveCount(0);
  await noHorizontalScroll(page);
});
