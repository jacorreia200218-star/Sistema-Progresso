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
  // Ligações do evento a outros módulos (cal_event_links); vazio = só «Detalhes».
  const links: Row = {};
  let sessions = 0;
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
      case 'cal_create_weekly': {
        const d = body.p_data;
        let n = 0;
        for (let k = 0; ; k++) {
          const shift = (v: string | null) => (v ? new Date(Date.parse(v) + k * 7 * 86400e3).toISOString() : null);
          const day = d.all_day ? new Date(Date.parse(`${d.start_date}T12:00:00Z`) + k * 7 * 86400e3).toISOString().slice(0, 10) : shift(d.starts_at)!.slice(0, 10);
          if (day > body.p_until) break;
          events.push({ ...events[0], ...d, id: `ev${events.length + 1}`, status: 'ativo', team_name: null, responsible_name: null, deadline_passed: false,
            required: [], people: [], starts_at: shift(d.starts_at ?? null), ends_at: shift(d.ends_at ?? null),
            start_date: d.all_day ? day : null, end_date: d.all_day ? day : null });
          n++;
        }
        return ok(n);
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
      case 'cal_event_links':
        return ok(links);
      case 'pres_session_for_event': {
        if (!links.pres_can_register) return fail('Não tens permissão para esta ação neste módulo.');
        const created = !links.presencas;
        if (created) { sessions++; links.presencas = { id: 'ses1', title: find()!.title, status: 'ativa', counts: { presente: 0, justificada: 0, injustificada: 0 }, mine: null }; }
        return ok({ id: links.presencas.id, created });
      }
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
  return { calls, events, config, links, sessions: () => sessions };
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
  await page.goto('/calendario?tipo=civil');
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
  // Cabeçalhos dos dias da semana por extenso curto quando há espaço
  const wd = main.locator('.cal-mm').first().locator('.cal-mm-wd');
  await expect(wd.nth(0).locator('.wd-long')).toBeVisible();
  await expect(wd.nth(0).locator('.wd-long')).toHaveText('Seg');
  await expect(wd.nth(5).locator('.wd-long')).toHaveText('Sáb');
  // Próximas atividades sempre por baixo do calendário (nunca numa coluna ao lado)
  const next = main.getByRole('region', { name: 'Próximas atividades' });
  await expect(next.getByRole('link', { name: /Raid de outono/ })).toBeVisible();
  const box = (i: number) => main.locator('.cal-mm').nth(i).boundingBox();
  const [m1, m2, m4, m5] = [await box(0), await box(1), await box(3), await box(4)];
  const side = await next.boundingBox();
  const grid = await main.locator('.cal-year').boundingBox();
  expect(side!.y).toBeGreaterThan(grid!.y + grid!.height - 1);
  if (info.project.name === 'telemovel') {
    expect(Math.abs(m1!.x - m2!.x)).toBeLessThan(2); // meses em coluna
    expect(m2!.y).toBeGreaterThan(m1!.y + m1!.height - 1);
  } else {
    expect(Math.abs(m1!.y - m4!.y)).toBeLessThan(2); // quatro meses por linha
    expect(m5!.y).toBeGreaterThan(m1!.y + m1!.height - 1);
    expect(grid!.width).toBeGreaterThan(900); // o calendário ocupa a largura toda
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
  // Datas sem atividades registadas (período indicado; não é disponibilidade confirmada)
  const free = main.getByRole('region', { name: 'Sem atividades registadas' });
  await expect(free).toContainText('Fins de semana');
  await expect(free).toContainText(`De 01/01/${y1} a 31/12/${y1}`);
  await expect(free).toContainText('não confirma a disponibilidade');
  await expect(free.getByLabel('Período considerado')).toHaveCount(0); // ano futuro: todo o período
  await main.getByLabel('Destacar fins de semana e feriados sem atividades').click();
  await expect(main.getByLabel('Destacar fins de semana e feriados sem atividades')).toBeChecked();
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
  await expect(page.getByRole('dialog')).toContainText('Sem atividades registadas neste dia.');
  await page.getByRole('dialog').getByRole('link', { name: 'Nova atividade neste dia' }).click();
  await expect(page.getByRole('heading', { name: 'Nova atividade', level: 1 })).toBeVisible();
  // Formulário simples: evento, data e notas; o resto fica em «Mais opções».
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue(fmt(target));
  await expect(page.getByLabel('Hora de início')).toBeHidden();
  await expect(page.getByLabel('Evento', { exact: true })).toHaveValue('Reunião');
  await page.getByLabel('Evento', { exact: true }).fill('Jogo de cidade (teste)');
  await page.getByLabel('Repetir todas as semanas até').uncheck();
  await page.getByText('Mais opções').click();
  // Por omissão, a reunião de sábado (14:30–16:00); sem horas fica de dia inteiro.
  await expect(page.getByLabel('Hora de início')).toHaveValue('14:30');
  await expect(page.getByLabel('Hora de fim')).toHaveValue('16:00');
  await page.getByLabel('Hora de início').fill('');
  await page.getByLabel('Hora de fim').fill('');
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

test('ano escutista (outubro a agosto) por omissão e dias especiais', async ({ page }, info) => {
  if (info.project.name === 'telemovel') await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page, leader());
  const cal = await installCalendar(page, 'ana');
  await page.goto('/calendario');
  const main = page.locator('main');
  await expect(main.getByRole('tab', { name: 'Ano escutista' })).toHaveAttribute('aria-selected', 'true');
  const t = todayDay();
  // Setembro já conta para o ano escutista seguinte.
  const sy = Number(t.slice(5, 7)) >= 9 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
  await expect(main.getByRole('heading', { name: `Ano escutista ${sy}/${sy + 1}`, level: 2 })).toBeVisible();
  await expect(main.locator('.cal-mm')).toHaveCount(11);
  await expect(main.locator('.cal-mm-title').first()).toHaveText(`outubro ${sy}`);
  await expect(main.locator('.cal-mm-title').last()).toHaveText(`agosto ${sy + 1}`);
  await main.getByRole('button', { name: 'Ano anterior' }).click();
  await expect(page).toHaveURL(new RegExp(`ano=${sy - 1}`));
  await expect(main.getByRole('heading', { name: `Ano escutista ${sy - 1}/${sy}`, level: 2 })).toBeVisible();
  await main.getByRole('tab', { name: 'Ano civil' }).click();
  await expect(page).toHaveURL(/tipo=civil/);
  await expect(main.locator('.cal-mm')).toHaveCount(12);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/calendario-escutista-${info.project.name}.png`, fullPage: true });

  // Configurar: feriado municipal recorrente (o ano escutista já não se configura)
  await page.goto('/calendario');
  await main.getByRole('button', { name: 'Mais ações' }).click();
  await main.getByRole('link', { name: 'Dias especiais' }).click();
  await expect(page.getByRole('heading', { name: 'Dias especiais', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Começa em')).toHaveCount(0);
  await page.getByRole('button', { name: 'Acrescentar' }).click();
  await expect(page.getByText('Indica a data.')).toBeVisible();
  await page.getByLabel('Data').fill('2026-06-24');
  await page.getByLabel('Nome').fill('São João');
  await page.getByRole('button', { name: 'Acrescentar' }).click();
  await expect(page.getByText('Dia acrescentado.')).toBeVisible();
  expect(cal.config.special_days).toEqual([{ id: 'sd1', day: '2026-06-24', name: 'São João', kind: 'municipal', recurring: true }]);
  await expect(main.locator('.cal-sd-list')).toContainText('Todos os anos a 24/06');
  await noHorizontalScroll(page);

  await page.goto(`/calendario?ano=${sy}`);
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
  // Por omissão: «Reunião» no próximo sábado
  await expect(page.getByLabel('Evento', { exact: true })).toHaveValue('Reunião');
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);
  await page.getByLabel('Evento', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('Indica o nome do evento.')).toBeVisible();
  await page.getByLabel('Evento', { exact: true }).fill('Fogo de conselho (teste)');
  await page.getByLabel('Data', { exact: true }).fill('25/10/2026');
  await page.getByLabel('Notas (opcional)').fill('Trazer lenha.');
  await expect(page.getByLabel('Repetir todas as semanas até')).toBeChecked();
  await page.getByLabel('Repetir todas as semanas até').uncheck();
  await page.getByText('Mais opções').click();
  await page.getByLabel('Local', { exact: true }).fill('Sede (teste)');
  await page.getByLabel('Hora de início').fill('10:00');
  await page.getByLabel('Hora de fim').fill('09:00');
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('O fim não pode ser antes do início.')).toBeVisible();
  await page.getByLabel('Hora de fim').fill('12:00');
  await page.getByLabel('Pede autorização').check();
  await page.getByLabel('1 hora').check();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('Atividade criada. Os envolvidos foram avisados.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fogo de conselho (teste)', level: 1 })).toBeVisible();
  const body = cal.calls.find((c) => c.fn === 'cal_create_event')!.body;
  // 25/10/2026 já é hora de inverno (UTC+0)
  expect(body.p_data).toMatchObject({ description: 'Trazer lenha.', all_day: false, starts_at: '2026-10-25T10:00:00.000Z', ends_at: '2026-10-25T12:00:00.000Z', needs_authorization: true, reminder_minutes: [1440, 60] });
  await expect(page.locator('main .cal-facts')).toContainText('Início25/10/2026 · 10:00');
  await expect(page.locator('main .cal-facts')).toContainText('Fim25/10/2026 · 12:00');
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
  await main.getByRole('button', { name: 'Mais ações' }).click();
  await main.getByRole('button', { name: 'Cancelar atividade…' }).click();
  await main.getByRole('button', { name: 'Cancelar atividade', exact: true }).click();
  await expect(main.getByText('Atividade cancelada', { exact: false }).first()).toBeVisible();
  await expect(main.getByRole('button', { name: 'Guardar resposta' })).toHaveCount(0);
  await noHorizontalScroll(page);
});

test('nova atividade semanal: a reunião de sábado repete-se até ao fim do ano escutista', async ({ page }) => {
  await installMock(page, leader());
  const cal = await installCalendar(page, 'ana');
  await page.goto('/calendario/nova?dia=2026-10-17');
  await expect(page.getByLabel('Evento', { exact: true })).toHaveValue('Reunião');
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue('17/10/2026');
  await expect(page.getByLabel('Repetir todas as semanas até')).toBeChecked();
  await expect(page.getByLabel('Repetir até')).toHaveValue('31/08/2027');
  await page.getByLabel('Repetir até').fill('07/11/2026');
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect(page.getByText('4 atividades criadas, uma por semana. Os envolvidos foram avisados.')).toBeVisible();
  const body = cal.calls.find((c) => c.fn === 'cal_create_weekly')!.body;
  // 17/10/2026 ainda é hora de verão (UTC+1): 14:30 → 13:30Z
  expect(body).toMatchObject({ p_until: '2026-11-07', p_data: { title: 'Reunião', all_day: false, starts_at: '2026-10-17T13:30:00.000Z', ends_at: '2026-10-17T15:00:00.000Z' } });
  expect(cal.calls.some((c) => c.fn === 'cal_create_event')).toBe(false);
});

const LONG_TASK = 'Confirmar com a junta de freguesia o transporte das tendas e do material de cozinha até ao local do acampamento';
const leaderLinks = (): Row => ({
  pres_can_register: true, presencas: null,
  ata_writer: true, reunioes: [],
  tarefas: [
    { id: 't1', kind: 'tarefa', title: LONG_TASK, exec_status: 'por_fazer', due_date: '2026-10-10', overdue: true, responsible_name: 'Pedro Teste', team_name: null, ata_id: 'ata1' },
    { id: 't2', kind: 'tarefa', title: 'Levar mapas', exec_status: 'em_curso', due_date: null, overdue: false, responsible_name: 'Guia Teste', team_name: null, ata_id: null },
  ],
  reservas: [{ id: 'r1', item_id: 'i1', item: 'Tenda (teste)', unit: 'un.', quantity: 2, status: 'ativa' }], compras: [], inv_can_manage: true,
  financas: { orcamento: { receitas: 5000, despesas: 3000, resultado: 2000 }, efetivo: { receitas: 0, despesas: 1250, resultado: -1250 },
    por_confirmar: { receitas: 0, despesas: 0, resultado: 0 }, tem_dados: true }, fin_can_manage: true,
});

test('evento como ponto de ligação: separadores, teclado e «Registar presenças» sem duplicar', async ({ page }) => {
  await installMock(page, leader());
  const cal = await installCalendar(page, 'ana');
  Object.assign(cal.links, leaderLinks());
  await page.goto('/calendario/evento/ev1');
  const main = page.locator('main');
  const tabs = main.getByRole('tablist', { name: 'Secções da atividade' });
  await expect(tabs.getByRole('tab')).toHaveText(['Detalhes', 'Presenças', /^Ata e tarefas2/, /^Material1/, 'Finanças']);
  await expect(tabs.getByRole('tab', { name: 'Ata e tarefas (2 tarefas por fazer)' })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Detalhes' })).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByRole('heading', { name: 'Participantes' })).toBeVisible();

  // Teclado: setas mudam de separador e o endereço guarda-o
  await tabs.getByRole('tab', { name: 'Detalhes' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Presenças' })).toBeFocused();
  await expect(page).toHaveURL(/sec=presencas/);
  await expect(main.getByRole('tabpanel')).toContainText('Ainda não há presenças registadas.');
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'Finanças' })).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByRole('tabpanel')).toContainText('12,50 €');
  await expect(main.getByRole('link', { name: /Ver na Tesouraria/ })).toHaveAttribute('href', '/tesouraria/atividades#a-ev1');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Detalhes' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).not.toHaveURL(/sec=/);

  // Ata e tarefas: escrever ata com o evento escolhido; tarefas com responsável e prazo
  await tabs.getByRole('tab', { name: /Ata e tarefas/ }).click();
  await expect(main.getByRole('link', { name: 'Escrever ata' })).toHaveAttribute('href', '/atas-e-tarefas/nova?evento=ev1');
  const t1 = main.locator('.ev-task', { hasText: 'junta de freguesia' });
  await expect(t1).toContainText('Pedro Teste · até 10/10/2026');
  await expect(t1).toContainText('Em atraso');
  await expect(t1).toHaveAttribute('href', '/atas-e-tarefas/atas/ata1');
  await expect(main.locator('.ev-task', { hasText: 'Levar mapas' })).toContainText('Guia Teste · sem prazo');
  await noHorizontalScroll(page);

  // Material
  await tabs.getByRole('tab', { name: /Material/ }).click();
  await expect(main.getByRole('link', { name: /Tenda \(teste\)/ })).toHaveAttribute('href', '/inventario/artigo/i1');

  // Registar presenças: abre (cria) a sessão ligada; voltar regressa ao separador
  await tabs.getByRole('tab', { name: 'Presenças' }).click();
  await main.getByRole('button', { name: 'Registar presenças' }).click();
  await expect(page).toHaveURL(/\/presencas\/sessoes\/ses1$/);
  expect(cal.calls.filter((c) => c.fn === 'pres_session_for_event').map((c) => c.body)).toEqual([{ p_section: expect.any(String), p_event: 'ev1' }]);
  await page.goBack();
  await expect(page).toHaveURL(/\/calendario\/evento\/ev1\?sec=presencas$/);
  await expect(main.getByRole('tab', { name: 'Presenças' })).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByRole('tabpanel')).toContainText('Presentes');
  await main.getByRole('button', { name: 'Registar presenças' }).click();
  await expect(page).toHaveURL(/\/presencas\/sessoes\/ses1$/);
  expect(cal.sessions()).toBe(1);
});

test('evento ligado: o pioneiro vê só o que lhe diz respeito, sem blocos vazios', async ({ page }) => {
  await installMock(page, pioneer());
  const cal = await installCalendar(page, 'p1');
  Object.assign(cal.links, {
    pres_can_register: false, presencas: { id: 'ses9', title: 'Raid', status: 'ativa', counts: null, mine: 'justificada' },
    ata_writer: false, reunioes: [], tarefas: [], reservas: [], compras: [], inv_can_manage: false,
    financas: { orcamento: { receitas: 0, despesas: 0, resultado: 0 }, efetivo: { receitas: 0, despesas: 0, resultado: 0 },
      por_confirmar: { receitas: 0, despesas: 0, resultado: 0 }, tem_dados: false }, fin_can_manage: false,
  });
  await page.goto('/calendario/evento/ev1?sec=financas');
  const main = page.locator('main');
  // Separador sem acesso cai para «Detalhes»
  const tabs = main.getByRole('tablist', { name: 'Secções da atividade' });
  await expect(tabs.getByRole('tab')).toHaveText(['Detalhes', 'Presenças']);
  await expect(main.getByRole('tab', { name: 'Detalhes' })).toHaveAttribute('aria-selected', 'true');
  await main.getByRole('tab', { name: 'Presenças' }).click();
  await expect(main.getByRole('tabpanel')).toContainText('A tua presença: Falta justificada');
  await expect(main.getByRole('button', { name: 'Registar presenças' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: /Ver presenças/ })).toHaveAttribute('href', '/presencas/sessoes/ses9');
  await noHorizontalScroll(page);
});

test('evento sem ligações: só os detalhes; com ata: «Abrir ata» em vez de «Escrever ata»', async ({ page }) => {
  await installMock(page, leader());
  const cal = await installCalendar(page, 'ana');
  await page.goto('/calendario/evento/ev1');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Participantes' })).toBeVisible();
  await expect(main.getByRole('tablist', { name: 'Secções da atividade' })).toHaveCount(0);

  Object.assign(cal.links, { ata_writer: true, tarefas: [], reunioes: [{ id: 'm1', title: 'Raid', kind: 'seccao', starts_at: events0(cal), ata_id: 'ata7' }] });
  await page.goto('/calendario/evento/ev1?sec=ata');
  await expect(main.getByRole('tablist', { name: 'Secções da atividade' }).getByRole('tab')).toHaveText(['Detalhes', 'Ata e tarefas']);
  await expect(main.getByRole('link', { name: 'Abrir ata' })).toHaveAttribute('href', '/atas-e-tarefas/atas/ata7');
  await expect(main.getByRole('link', { name: 'Escrever ata' })).toHaveCount(0);
});
const events0 = (cal: { events: Row[] }) => cal.events[0].starts_at as string;
/** Reuniões semanais fictícias (a começar daqui a 5 dias), todas por confirmar para o Pedro. */
function addMeetings(events: Row[], n: number) {
  for (let k = 0; k < n; k++) {
    const start = isoIn(5 * D + k * 7 * D);
    events.push({
      ...events[0], id: `reu${k + 1}`, title: `Reunião semanal ${k + 1} (teste)`, starts_at: start, ends_at: new Date(Date.parse(start) + 90 * 60e3).toISOString(),
      location: 'Sede (teste)', registration_deadline: null, needs_authorization: false, material: null, required: [],
      people: [{ profile_id: 'u-p1', name: 'Pedro Teste', team_name: 'Equipa Andorinha', function: 'pioneiro', response: null, note: null, resolved: [] }],
    });
  }
}

test('o que te falta: três mais próximas, horizonte configurável e «Ver todas» filtrável', async ({ page }, info) => {
  if (info.project.name === 'telemovel') await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page, pioneer());
  const { events } = await installCalendar(page, 'p1');
  addMeetings(events, 20);
  await page.goto('/calendario');
  const main = page.locator('main');
  const todo = main.getByRole('region', { name: 'O que te falta' });
  // Só as três mais próximas; o resto fica para «Ver todas»
  await expect(todo.locator('.cal-pending-row')).toHaveCount(3);
  await expect(todo.locator('.cal-pending-row').first()).toContainText('Raid de outono');
  await expect(todo.getByLabel('Período das pendências')).toHaveValue('4');
  // Contadores compactos (próximas 4 semanas: raid + 4 reuniões); no computador, numa linha por cima do calendário
  const counter = main.locator('.cal-counter', { hasText: 'Confirmar presença' }).first();
  await expect(counter).toHaveText(/5\s*Confirmar presença/);
  await expect(main.locator('.cal-counter', { hasText: 'Autorização' }).first()).toHaveText(/1\s*Autorização/);
  const grid = await main.locator('.cal-year').boundingBox();
  if (info.project.name === 'telemovel') {
    expect((await todo.boundingBox())!.y).toBeLessThan(grid!.y);
  } else {
    expect((await main.locator('.cal-strip').boundingBox())!.y).toBeLessThan(grid!.y);
    expect((await todo.boundingBox())!.y).toBeGreaterThan(grid!.y + grid!.height - 1);
  }
  await expect(todo).toContainText('16 mais tarde');
  // A mesma reunião não se repete nas próximas atividades
  const next = main.getByRole('region', { name: 'Próximas atividades' });
  await expect(next).not.toContainText('Raid de outono');
  await expect(next).not.toContainText('Reunião semanal 1 ');
  await expect(next).toContainText('Reunião semanal 3 (teste)');
  await noHorizontalScroll(page);

  // Horizonte de 2 semanas, guardado para a próxima visita
  await todo.getByLabel('Período das pendências').selectOption('2');
  await expect(counter).toHaveText(/3\s*Confirmar presença/);
  await page.reload();
  await expect(main.getByRole('region', { name: 'O que te falta' }).getByLabel('Período das pendências')).toHaveValue('2');

  // «Ver todas»: vista própria, filtrável por período e por tipo, e voltar.
  // (Em 2 semanas só há três, já todas visíveis: «Ver todas» abre todas as datas.)
  await main.getByRole('region', { name: 'O que te falta' }).getByRole('link', { name: /Ver todas/ }).click();
  await expect(page).toHaveURL(/\/calendario\/pendentes\?semanas=todas/);
  await expect(main.getByRole('heading', { name: 'O que te falta', level: 1 })).toBeVisible();
  await expect(main.locator('.cal-pending-row')).toHaveCount(21);
  await main.getByLabel('Período das pendências').selectOption({ label: 'Próximas 8 semanas' });
  await expect(page).toHaveURL(/semanas=8/);
  await expect(main.locator('.cal-pending-row')).toHaveCount(9);
  await expect(main.getByRole('button', { name: /Ver também as mais tarde \(12\)/ })).toBeVisible();
  await main.getByLabel('Período das pendências').selectOption({ label: 'Todas as datas' });
  await expect(main.locator('.cal-pending-row')).toHaveCount(21);
  await main.getByRole('button', { name: /Autorização/ }).click();
  await expect(page).toHaveURL(/falta=autorizacao/);
  await expect(main.getByRole('button', { name: /Autorização/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(main.locator('.cal-pending-row')).toHaveCount(1);
  await noHorizontalScroll(page);
  await main.locator('.cal-pending-row').first().click();
  await expect(main.getByRole('heading', { name: 'Raid de outono (teste)', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(main.locator('.cal-pending-row')).toHaveCount(1);
  await main.getByRole('button', { name: 'Voltar' }).click();
  await expect(page).toHaveURL(/\/calendario(\?|$)/);
  await expect(main.locator('.cal-mm')).toHaveCount(11);
});

test('sem pendências próximas: uma linha curta, sem cartão grande', async ({ page }) => {
  await installMock(page, pioneer());
  const { events } = await installCalendar(page, 'p1');
  events[0].people[0].response = 'vou';
  events[0].people[0].resolved = ['autorizacao', 'material'];
  addMeetings(events, 1);
  events[1].starts_at = isoIn(70 * D);
  events[1].ends_at = isoIn(70 * D + H);
  await page.goto('/calendario');
  const todo = page.locator('main').getByRole('region', { name: 'O que te falta' });
  await expect(todo).toContainText('Nada pendente até');
  await expect(todo).toContainText('1 mais tarde');
  await todo.getByRole('link', { name: 'Ver todas' }).click();
  await expect(page).toHaveURL(/semanas=todas/);
  await expect(page.locator('main .cal-pending-row')).toHaveCount(1);
});

test('teclado, «Hoje» e «Ir para o mês atual» mantêm a vista anual', async ({ page }, info) => {
  if (info.project.name === 'telemovel') await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page, leader());
  await installCalendar(page, 'ana');
  await page.goto('/calendario?tipo=civil');
  const main = page.locator('main');
  const today = todayDay();
  const year = today.slice(0, 4);
  // Um só ponto de paragem na grelha (o dia de hoje); as setas mudam de dia
  await expect(main.locator('.cal-year button[tabindex="0"]')).toHaveCount(1);
  await expect(dayButton(page, today)).toHaveAttribute('tabindex', '0');
  await dayButton(page, today).focus();
  const add = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * D).toISOString().slice(0, 10);
  let target = today;
  for (const [key, n] of [['ArrowRight', 1], ['ArrowDown', 7], ['ArrowLeft', -1], ['ArrowUp', -7]] as const) {
    const t = add(target, n);
    if (t.slice(0, 4) !== year) continue;
    await page.keyboard.press(key);
    target = t;
    await expect(dayButton(page, target)).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByRole('heading', { name: new RegExp(fmt(target)) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dayButton(page, target)).toBeFocused();

  // Noutro ano: «Ir para o mês atual» volta ao ano atual e ao mês de hoje
  await main.getByRole('button', { name: 'Ano seguinte' }).click();
  await expect(page).toHaveURL(/ano=/);
  await expect(main.getByRole('heading', { name: `Ano ${Number(year) + 1}`, level: 2 })).toBeVisible();
  await main.getByRole('button', { name: 'Ir para o mês atual' }).click();
  await expect(page).not.toHaveURL(/ano=/);
  await expect(main.getByRole('heading', { name: `Ano ${year}`, level: 2 })).toBeVisible();
  await expect(dayButton(page, today)).toBeFocused();
  await expect(main.locator('.cal-mm')).toHaveCount(12);
  // «Hoje» abre o dia de hoje, por cima da vista anual
  await main.getByRole('button', { name: 'Ano anterior' }).click();
  await expect(main.getByRole('heading', { name: `Ano ${Number(year) - 1}`, level: 2 })).toBeVisible();
  await main.getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: new RegExp(fmt(today)) })).toBeVisible();
  await expect(page).not.toHaveURL(/ano=/);
  await expect(main.locator('.cal-mm')).toHaveCount(12);
  await page.keyboard.press('Escape');

  // Datas sem atividades: por omissão a partir de hoje; pode considerar o ano todo
  const free = main.getByRole('region', { name: 'Sem atividades registadas' });
  if (today !== `${year}-01-01`) {
    await expect(free).toContainText(`De ${fmt(today)} a 31/12/${year}`);
    await free.getByLabel('Período considerado').selectOption({ label: 'Todo o período' });
    await expect(page).toHaveURL(/livres_de=inicio/);
    await expect(free).toContainText(`De 01/01/${year} a 31/12/${year}`);
  }
  await noHorizontalScroll(page);
});

test('carregamento: o calendário aparece logo, com o estado de carregamento', async ({ page }) => {
  await installMock(page, pioneer());
  await installCalendar(page, 'p1');
  await page.route('http://mock.supabase.test/rest/v1/rpc/cal_events_list', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.fallback();
  });
  await page.goto('/calendario');
  await expect(page.locator('main .cal-year[aria-busy="true"]')).toBeVisible();
  await expect(page.locator('main .cal-mm')).toHaveCount(11);
  await expect(page.locator('main .cal-year[aria-busy="false"]')).toBeVisible();
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`calendário ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      const { events, links } = await installCalendar(page, 'ana');
      const day = lisbonDay(events[0].starts_at);
      events.push({ ...events[0], id: 'ev2', title: 'Reunião de guias com um título bastante longo para testar o corte', starts_at: isoIn(3 * D + 4 * H), ends_at: isoIn(3 * D + 5 * H), location: null });
      events.push({ ...events[0], id: 'ev3', title: 'Atividade de serviço', starts_at: isoIn(3 * D + 6 * H), ends_at: isoIn(3 * D + 7 * H) });
      events.push({ ...events[0], id: 'ev4', title: 'Acampamento de Natal', all_day: true, starts_at: null, ends_at: null, start_date: '2026-12-27', end_date: '2026-12-29' });
      await page.goto('/calendario');
      await shoot(page, info, theme, 'calendario-ano');
      if (info.project.name === 'telemovel') {
        await page.goto('/calendario');
        await page.locator('.cal-jump.is-current').click();
        await page.waitForTimeout(600);
        await shoot(page, info, theme, 'calendario-mes', { full: false });
      }
      await page.goto(`/calendario?dia=${day}`);
      await page.getByRole('dialog').waitFor();
      await shoot(page, info, theme, 'calendario-dia', { full: false });
      await page.goto('/calendario?dia=2026-12-25');
      await page.getByRole('dialog').waitFor();
      await shoot(page, info, theme, 'calendario-feriado', { full: false });
      await page.goto('/calendario/evento/ev1');
      await shoot(page, info, theme, 'calendario-detalhe');
      Object.assign(links, leaderLinks());
      await page.goto('/calendario/evento/ev1');
      await shoot(page, info, theme, 'evento-ligacoes-detalhes');
      for (const sec of ['presencas', 'ata', 'material', 'financas']) {
        await page.goto(`/calendario/evento/ev1?sec=${sec}`);
        await shoot(page, info, theme, `evento-ligacoes-${sec}`);
      }
      for (const k of Object.keys(links)) delete links[k];
      await page.goto('/calendario?vista=lista');
      await shoot(page, info, theme, 'calendario-lista');
      await page.goto('/calendario/nova');
      await shoot(page, info, theme, 'calendario-formulario');
    });
    test(`calendário com pendências ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, pioneer());
      const { events } = await installCalendar(page, 'p1');
      addMeetings(events, 40);
      await page.goto('/calendario');
      await shoot(page, info, theme, 'calendario-ano-pendencias');
      await page.goto('/calendario/pendentes?semanas=8');
      await shoot(page, info, theme, 'calendario-pendentes');
    });
  }
});
