// Calendário escutista: calendário anual (civil e escutista), dias especiais, criar atividade
// a partir de um dia, responder, exportar.
// Dados FICTÍCIOS só para teste; as regras do servidor são testadas em tests/db/calendario.test.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { CAPTURAS, THEMES, shoot } from './capturas-util';
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
  const config = { year_start_month: 9, special_days: [] as Row[] };
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
      case 'cal_config':
        return ok({ ...config, can_manage: manage });
      case 'cal_set_year_start':
        if (!manage) return fail('Não tens permissão para esta ação neste módulo.');
        config.year_start_month = body.p_month;
        return ok(null);
      case 'cal_special_day_save': {
        if (!manage) return fail('Não tens permissão para esta ação neste módulo.');
        const id = body.p_id ?? `sd${config.special_days.length + 1}`;
        config.special_days = [...config.special_days.filter((d) => d.id !== id), { id, ...body.p_data }];
        return ok(id);
      }
      case 'cal_special_day_remove':
        config.special_days = config.special_days.filter((d) => d.id !== body.p_id);
        return ok(null);
      default:
        return route.fallback();
    }
  });
  return { calls, events, config };
}

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

const todayDay = () => lisbonDay(new Date().toISOString());
const fmt = (day: string) => day.split('-').reverse().join('/');
const dayButton = (page: Page, day: string) => page.locator(`button[data-day="${day}"]`);

test('calendário anual: 12 meses, fins de semana, feriados, hoje e atividades', async ({ page }, info) => {
  if (info.project.name === 'telemovel') await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page, leader());
  await installCalendar(page, 'ana');
  await page.goto('/calendario');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Calendário escutista', level: 1 })).toBeVisible();
  await expect(main.locator('h1 .page-tag')).toContainText('Em teste');
  const year = todayDay().slice(0, 4);
  await expect(main.getByRole('heading', { name: `Ano ${year}`, level: 2 })).toBeVisible();
  await expect(main.locator('.cal-mm')).toHaveCount(12);
  await expect(main.locator('.cal-mm-title').first()).toHaveText(`janeiro ${year}`);
  // Hoje e a atividade (3 dias depois)
  await expect(dayButton(page, todayDay())).toHaveAttribute('aria-current', 'date');
  const evDay = lisbonDay(isoIn(3 * D));
  if (evDay.slice(0, 4) === year) {
    await expect(dayButton(page, evDay)).toHaveClass(/has-events/);
    await expect(dayButton(page, evDay)).toHaveAttribute('aria-label', /1 atividade/);
  }
  // Feriado fixo com nome e fim de semana com fundo suave
  await expect(dayButton(page, `${year}-12-25`)).toHaveClass(/is-holiday/);
  await expect(dayButton(page, `${year}-12-25`)).toHaveAttribute('title', /feriado nacional: Natal/);
  const sat = [...Array(7)].map((_, i) => `${year}-03-0${i + 1}`).find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6)!;
  await expect(dayButton(page, sat)).toHaveClass(/is-weekend/);
  const bg = await dayButton(page, sat).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  // Próximas atividades ao lado (computador) ou abaixo (telemóvel)
  const next = main.getByRole('region', { name: 'Próximas atividades' });
  await expect(next.getByRole('link', { name: /Raid de outono/ })).toBeVisible();
  const [m1, m2] = [await main.locator('.cal-mm').nth(0).boundingBox(), await main.locator('.cal-mm').nth(1).boundingBox()];
  const side = await next.boundingBox();
  const grid = await main.locator('.cal-year').boundingBox();
  if (info.project.name === 'telemovel') {
    expect(Math.abs(m1!.x - m2!.x)).toBeLessThan(2); // meses em coluna
    expect(m2!.y).toBeGreaterThan(m1!.y + m1!.height - 1);
    expect(side!.y).toBeGreaterThan(grid!.y + grid!.height - 1);
  } else {
    expect(Math.abs(m1!.y - m2!.y)).toBeLessThan(2); // meses lado a lado
    expect(side!.x).toBeGreaterThan(grid!.x + grid!.width - 1);
  }
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/calendario-ano-${info.project.name}.png`, fullPage: true });

  // Feriados móveis com nome: Páscoa 2027 a 28/03; Carnaval como dia relevante
  await main.getByRole('button', { name: 'Ano seguinte' }).click();
  const y1 = String(Number(year) + 1);
  await expect(page).toHaveURL(new RegExp(`ano=${y1}`));
  if (y1 === '2027') {
    await expect(dayButton(page, '2027-03-28')).toHaveAttribute('aria-label', /domingo, 28\/03\/2027, feriado nacional: Páscoa/);
    await expect(dayButton(page, '2027-03-26')).toHaveAttribute('aria-label', /Sexta-feira Santa/);
    await expect(dayButton(page, '2027-05-27')).toHaveAttribute('aria-label', /Corpo de Deus/);
    await expect(dayButton(page, '2027-02-09')).toHaveClass(/is-relevant/);
    await expect(dayButton(page, '2027-02-09')).not.toHaveClass(/is-holiday/);
    await expect(dayButton(page, '2027-02-09')).toHaveAttribute('aria-label', /Carnaval \(tolerância facultativa\)/);
  }
  const marks = main.locator('.cal-marks');
  await marks.locator('summary').click();
  await expect(marks).toContainText('Implantação da República');
  await expect(marks).toContainText('Feriado nacional (móvel)');
  // Dias livres para planear
  const free = main.getByRole('region', { name: 'Livres para planear' });
  await expect(free).toContainText('Fins de semana livres');
  await main.getByLabel('Destacar os dias livres').click();
  await expect(main.getByLabel('Destacar os dias livres')).toBeChecked();
  await expect(page).toHaveURL(/livres=1/);
  await expect(main.locator('.cal-year.show-free .cal-d.is-free').first()).toBeVisible();
  await noHorizontalScroll(page);
});

test('clicar num dia: detalhe do dia e nova atividade com a data preenchida', async ({ page }, info) => {
  if (info.project.name === 'telemovel') await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page, leader());
  const cal = await installCalendar(page, 'ana');
  await page.goto('/calendario');
  const main = page.locator('main');
  const evDay = lisbonDay(isoIn(3 * D));
  if (evDay.slice(0, 4) !== todayDay().slice(0, 4)) await main.getByRole('button', { name: 'Ano seguinte' }).click();
  await dayButton(page, evDay).click();
  await expect(page).toHaveURL(new RegExp(`dia=${evDay}`));
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: new RegExp(fmt(evDay)) })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Raid de outono/ })).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/calendario-dia-${info.project.name}.png` });
  // Abrir o detalhe e voltar: o dia escolhido mantém-se
  await dialog.getByRole('link', { name: /Raid de outono/ }).click();
  await expect(main.getByRole('heading', { name: 'Raid de outono (teste)', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/dia=/);

  // Outro dia (sem atividades) → nova atividade nesse dia
  const target = lisbonDay(isoIn(10 * D));
  if (target.slice(0, 4) !== evDay.slice(0, 4)) await main.getByRole('button', { name: 'Ano seguinte' }).click();
  await dayButton(page, target).click();
  await expect(page.getByRole('dialog')).toContainText('Sem atividades neste dia.');
  await page.getByRole('dialog').getByRole('link', { name: 'Nova atividade neste dia' }).click();
  await expect(page.getByRole('heading', { name: 'Nova atividade', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Início', { exact: true })).toHaveValue(fmt(target));
  await expect(page.getByLabel('Hora de início')).toHaveValue('10:00');
  await page.getByLabel('Título').fill('Jogo de cidade (teste)');
  await page.getByLabel('Dia inteiro (um ou vários dias)').check();
  await expect(page.getByLabel('Primeiro dia')).toHaveValue(fmt(target));
  const last = lisbonDay(isoIn(11 * D));
  await page.getByLabel('Último dia').fill(last);
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('Atividade criada. Os envolvidos foram avisados.')).toBeVisible();
  expect(cal.calls.find((c) => c.fn === 'cal_create_event')!.body.p_data).toMatchObject({ all_day: true, start_date: target, end_date: last });
  // Atividade de vários dias marca todos os dias
  await page.goto(`/calendario?ano=${target.slice(0, 4)}`);
  await expect(dayButton(page, target)).toHaveClass(/has-events/);
  if (last.slice(0, 4) === target.slice(0, 4)) await expect(dayButton(page, last)).toHaveClass(/has-events/);
});

test('ano escutista e configuração de dias especiais', async ({ page }, info) => {
  if (info.project.name === 'telemovel') await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page, leader());
  const cal = await installCalendar(page, 'ana');
  await page.goto('/calendario');
  const main = page.locator('main');
  await main.getByRole('tab', { name: 'Ano escutista' }).click();
  await expect(page).toHaveURL(/tipo=escutista/);
  const t = todayDay();
  const sy = Number(t.slice(5, 7)) >= 9 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
  await expect(main.getByRole('heading', { name: `Ano escutista ${sy}/${sy + 1}`, level: 2 })).toBeVisible();
  await expect(main.locator('.cal-mm-title').first()).toHaveText(`setembro ${sy}`);
  await expect(main.locator('.cal-mm-title').last()).toHaveText(`agosto ${sy + 1}`);
  await main.getByRole('button', { name: 'Ano anterior' }).click();
  await expect(page).toHaveURL(new RegExp(`ano=${sy - 1}`));
  await expect(main.getByRole('heading', { name: `Ano escutista ${sy - 1}/${sy}`, level: 2 })).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/calendario-escutista-${info.project.name}.png`, fullPage: true });

  // Configurar: feriado municipal recorrente e mês inicial
  await main.getByRole('link', { name: 'Dias e ano escutista' }).click();
  await expect(page.getByRole('heading', { name: 'Dias especiais e ano escutista', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Acrescentar' }).click();
  await expect(page.getByText('Indica a data.')).toBeVisible();
  await page.getByLabel('Data').fill('2026-06-24');
  await page.getByLabel('Nome').fill('São João');
  await page.getByRole('button', { name: 'Acrescentar' }).click();
  await expect(page.getByText('Dia acrescentado.')).toBeVisible();
  expect(cal.config.special_days).toEqual([{ id: 'sd1', day: '2026-06-24', name: 'São João', kind: 'municipal', recurring: true }]);
  await expect(main.locator('.cal-sd-list')).toContainText('Todos os anos a 24/06');
  await page.getByLabel('Começa em').selectOption({ label: 'outubro' });
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Mês inicial guardado.')).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto(`/calendario?tipo=escutista&ano=${sy}`);
  await expect(main.locator('.cal-mm-title').first()).toHaveText(`outubro ${sy}`);
  await expect(dayButton(page, `${sy + 1}-06-24`)).toHaveClass(/is-holiday/);
  await expect(dayButton(page, `${sy + 1}-06-24`)).toHaveAttribute('aria-label', /feriado municipal: São João/);
});

test('lista completa das próximas atividades', async ({ page }) => {
  await installMock(page, leader());
  await installCalendar(page, 'ana');
  await page.goto('/calendario');
  await page.locator('main').getByRole('link', { name: 'Ver todas' }).click();
  await expect(page).toHaveURL(/vista=lista/);
  await expect(page.locator('main').getByRole('tab', { name: 'Lista' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('main .cal-month-group')).toContainText('Raid de outono');
  await noHorizontalScroll(page);
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
  await page.getByLabel('Início', { exact: true }).fill('2026-10-25T10:00');
  await page.getByLabel('Fim', { exact: true }).fill('2026-10-25T09:00');
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('O fim não pode ser antes do início.')).toBeVisible();
  await page.getByLabel('Fim', { exact: true }).fill('2026-10-25T12:00');
  await page.getByLabel('Pede autorização').check();
  await page.getByLabel('1 hora').check();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('Atividade criada. Os envolvidos foram avisados.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fogo de conselho (teste)', level: 1 })).toBeVisible();
  const body = cal.calls.find((c) => c.fn === 'cal_create_event')!.body;
  // 25/10/2026 já é hora de inverno (UTC+0)
  expect(body.p_data).toMatchObject({ starts_at: '2026-10-25T10:00:00.000Z', ends_at: '2026-10-25T12:00:00.000Z', needs_authorization: true, reminder_minutes: [1440, 60] });
  await expect(page.locator('main')).toContainText('25/10/2026 · 10:00–12:00');
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

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`calendário ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      const { events } = await installCalendar(page, 'ana');
      const day = lisbonDay(events[0].starts_at);
      events.push({ ...events[0], id: 'ev2', title: 'Reunião de guias com um título bastante longo para testar o corte', starts_at: isoIn(3 * D + 4 * H), ends_at: isoIn(3 * D + 5 * H), location: null });
      events.push({ ...events[0], id: 'ev3', title: 'Atividade de serviço', starts_at: isoIn(3 * D + 6 * H), ends_at: isoIn(3 * D + 7 * H) });
      events.push({ ...events[0], id: 'ev4', title: 'Acampamento de Natal', all_day: true, starts_at: null, ends_at: null, start_date: '2026-12-27', end_date: '2026-12-29' });
      await page.goto('/calendario');
      await shoot(page, info, theme, 'calendario-ano');
      await page.goto(`/calendario?dia=${day}`);
      await page.getByRole('dialog').waitFor();
      await shoot(page, info, theme, 'calendario-dia');
      await page.goto('/calendario?dia=2026-12-25');
      await page.getByRole('dialog').waitFor();
      await shoot(page, info, theme, 'calendario-feriado');
      await page.goto('/calendario/evento/ev1');
      await shoot(page, info, theme, 'calendario-detalhe');
      await page.goto('/calendario?vista=lista');
      await shoot(page, info, theme, 'calendario-lista');
      await page.goto('/calendario/nova');
      await shoot(page, info, theme, 'calendario-formulario');
    });
  }
});
