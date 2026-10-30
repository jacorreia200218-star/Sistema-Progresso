// Calendário do iCloud: gestão (verificar o link, pré-visualizar, confirmar, sincronizar,
// remoções por confirmar, desligar) e atividades importadas no calendário (etiqueta
// «iCloud», só leitura). A função /api/icloud e a base de dados são simuladas; o link é FICTÍCIO.
import { expect, test, type Page, type Route } from '@playwright/test';
import { CAPTURAS, THEMES, shoot } from './capturas-util';
import { installMock, leader } from './mock-api';

type Row = Record<string, any>;
const LINK = 'webcal://p00-caldav.icloud.com/published/2/FICTICIO-secreto-0123456789abcdef';
const D = 86400e3;
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
const lisbonDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date(iso));
const now = new Date().toISOString();

function source(extra: Row = {}): Row {
  return {
    id: 'src1', space: 'real', kind: 'icloud', name: 'Agrupamento', calname: 'Agrupamento (fictício)', url_mask: 'webcal://p00-caldav.icloud.com/…cdef',
    audience: 'seccao', team_id: null, team_name: null, reminder_minutes: [], status: 'ativa', created_at: now, created_by_name: 'Ana Dirigente Teste',
    stopped_at: null, last_attempt_at: now, last_success_at: now, last_error: null, last_error_at: null, failures: 0,
    last_stats: { criadas: 12, atualizadas: 0 }, last_warning: null, pending_removals: 0, event_count: 12,
    range_from: '2026-09-05', range_to: '2027-07-10', cancelled_count: 0, removed_count: 0, ...extra,
  };
}

async function installIcloud(page: Page, start: Row[] = [], calendar_status = 'teste', inbox: Row[] = []) {
  const state = { sources: start, calendar_status, auto_sync: true, inbox };
  const calls: { fn: string; body: Row; auth?: string }[] = [];
  let syncFails = 0;
  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route: Route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON?.() ?? {};
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    const s = () => state.sources.find((x) => x.id === body.p_source)!;
    switch (fn) {
      case 'cal_sources_list': calls.push({ fn, body }); return ok({ sources: state.sources, calendar_status: state.calendar_status, auto_sync: state.auto_sync });
      case 'cal_source_inbox_list': return ok(state.inbox);
      case 'cal_source_inbox_decide': calls.push({ fn, body }); state.inbox = state.inbox.filter((x) => !body.p_ids.includes(x.id)); return ok(body.p_ids.length);
      case 'cal_source_update': calls.push({ fn, body }); Object.assign(s(), { name: body.p_data.name, audience: body.p_data.audience, team_id: body.p_data.team_id, team_name: body.p_data.team_id ? 'Equipa Andorinha' : null, reminder_minutes: body.p_data.reminder_minutes }); return ok(null);
      case 'cal_source_disconnect': calls.push({ fn, body }); Object.assign(s(), { status: body.p_mode === 'parar' ? 'parada' : 'arquivada' }); return ok(3);
      case 'cal_source_resume': calls.push({ fn, body }); Object.assign(s(), { status: 'ativa' }); return ok(null);
      default: return route.fallback();
    }
  });
  await page.route('**/api/icloud', async (route: Route) => {
    const req = route.request();
    const body = req.postDataJSON?.() ?? {};
    calls.push({ fn: `api:${body.action}`, body, auth: req.headers()['authorization'] });
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const fail = (status: number, error: string) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
    if (body.action === 'preview' || body.action === 'create') {
      if (!String(body.url).includes('icloud.com')) return fail(422, 'Só são aceites calendários partilhados do iCloud (endereços icloud.com).');
      const preview = {
        name: 'Agrupamento (fictício)', events: 12, cancelled: 1, first: '2026-09-05', last: '2027-07-10', complete: true, warnings: [],
        sample: [{ title: 'Reunião de sábado', day: '2026-10-24', all_day: false, starts_at: '2026-10-24T13:30:00.000Z' }, { title: 'Acampamento de Natal', day: '2026-12-27', all_day: true, starts_at: null }],
      };
      if (body.action === 'preview') return ok({ preview });
      state.sources.push(source({ name: body.name, audience: body.audience, team_id: body.team_id, team_name: body.team_id ? 'Equipa Andorinha' : null, reminder_minutes: body.reminder_minutes }));
      return ok({ id: 'src1', stats: { criadas: 12 }, preview });
    }
    if (body.action === 'sync') {
      if (syncFails > 0) {
        syncFails--;
        Object.assign(state.sources[0], { last_error: 'O iCloud respondeu com o código 404: confirma que o calendário continua partilhado como calendário público.', last_error_at: now, failures: 1 });
        return fail(502, 'O iCloud respondeu com o código 404: confirma que o calendário continua partilhado como calendário público.');
      }
      Object.assign(state.sources[0], { last_error: null, failures: 0, pending_removals: 0, last_warning: null, last_stats: body.force ? { removidas: 6 } : { atualizadas: 2 } });
      return ok({ stats: { atualizadas: 2 } });
    }
    return fail(400, 'Ação desconhecida.');
  });
  return { state, calls, failSync: (n = 1) => { syncFails = n; } };
}

test('calendário publicado: ligações novas vão para os dados reais e avisa se uma ficou no teste', async ({ page }) => {
  await installMock(page, leader());
  const ic = await installIcloud(page, [source({ space: 'teste' })], 'disponivel');
  await page.goto('/gestao/icloud');
  await expect(page.getByText('O Calendário escutista ainda não está publicado')).toHaveCount(0);
  await expect(page.getByText('Ligado ao espaço de teste: estas atividades não aparecem no Calendário.')).toBeVisible();
  const add = page.getByRole('region', { name: 'Ligar um calendário do iCloud' });
  if (!(await add.getByLabel('Link do calendário').isVisible())) await page.getByText('Ligar outro calendário').click();
  await add.getByLabel('Link do calendário').fill(LINK);
  await add.getByRole('button', { name: 'Verificar link' }).click();
  await expect(add.getByLabel('Nome na app')).toBeVisible();
  await expect(add.getByText('Onde aparecem')).toHaveCount(0);
  await add.getByRole('button', { name: 'Confirmar e importar' }).click();
  await expect.poll(() => ic.calls.find((c) => c.fn === 'api:create')?.body.space).toBe('real');
});

test('por rever: aprovar, editar antes de aprovar e rejeitar', async ({ page }, info) => {
  if (info.project.name === 'telemovel') await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page, leader());
  const start = '2026-11-07T14:30:00+00:00';
  const end = '2026-11-07T16:00:00+00:00';
  const item = (title: string, extra: Row = {}) => ({ rid: '', title, description: null, location: null, all_day: false, starts_at: start, ends_at: end, start_date: null, end_date: null, ...extra });
  const ic = await installIcloud(page, [source({ review: true, pending_review: 3 })], 'disponivel', [
    { id: 'i1', source_name: 'Agrupamento', kind: 'nova', item: item('Reunião'), current: null },
    { id: 'i2', source_name: 'Agrupamento', kind: 'alterada', item: item('Raid de inverno', { location: 'Serra' }),
      current: { id: 'e2', status: 'ativo', ...item('Raid', { location: 'Sintra' }) } },
    { id: 'i3', source_name: 'Agrupamento', kind: 'removida', item: {}, current: { id: 'e3', status: 'ativo', ...item('Festa') } },
  ]);
  await page.goto('/gestao/icloud');
  const rev = page.getByRole('region', { name: 'Por rever' });
  await expect(rev.locator('.icloud-review-row')).toHaveCount(3);
  await expect(rev.getByText('Antes: 07-11-2026 · 14:30–16:00 · Raid · Sintra')).toBeVisible();
  await expect(rev.getByText('Removida do iCloud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (CAPTURAS) for (const t of THEMES) await shoot(page, info, t, 'icloud-rever');
  // Editar antes de aprovar
  const first = rev.locator('.icloud-review-row').first();
  await first.getByRole('button', { name: 'Editar' }).click();
  await first.getByLabel('Título').fill('Reunião de sábado');
  await first.getByLabel('Local').fill('Sede');
  await first.getByRole('button', { name: 'Guardar e aprovar' }).click();
  await expect.poll(() => ic.calls.find((c) => c.fn === 'cal_source_inbox_decide')?.body).toMatchObject({
    p_ids: ['i1'], p_decision: 'aprovar', p_edits: { title: 'Reunião de sábado', location: 'Sede', description: '' },
  });
  await expect(rev.locator('.icloud-review-row')).toHaveCount(2);
  // A removida não se edita; rejeitar
  const last = rev.locator('.icloud-review-row').last();
  await expect(last.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await last.getByRole('button', { name: 'Rejeitar' }).click();
  await expect(rev.locator('.icloud-review-row')).toHaveCount(1);
  expect(ic.calls.filter((c) => c.fn === 'cal_source_inbox_decide').at(-1)!.body).toMatchObject({ p_ids: ['i3'], p_decision: 'rejeitar' });
  await rev.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByRole('region', { name: 'Por rever' })).toHaveCount(0);
});

test('gestão: verificar o link, pré-visualizar e confirmar a importação', async ({ page }) => {
  await installMock(page, leader());
  const ic = await installIcloud(page);
  await page.goto('/gestao/icloud');
  await expect(page.getByRole('link', { name: 'Calendário iCloud' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('O Calendário escutista ainda não está publicado')).toBeVisible();
  const add = page.getByRole('region', { name: 'Ligar um calendário do iCloud' });
  await add.getByLabel('Link do calendário').fill('webcal://exemplo.invalid/cal.ics');
  await add.getByRole('button', { name: 'Verificar link' }).click();
  await expect(add.getByText('Só são aceites calendários partilhados do iCloud')).toBeVisible();

  await add.getByLabel('Link do calendário').fill(LINK);
  await add.getByRole('button', { name: 'Verificar link' }).click();
  const pv = add.getByLabel('Pré-visualização');
  await expect(pv).toContainText('Agrupamento (fictício)');
  await expect(pv).toContainText('12 (+1 canceladas)');
  await expect(pv).toContainText('05-09-2026 a 10-07-2027');
  await expect(pv).toContainText('24-10-2026 · 14:30 · Reunião de sábado');
  const req = ic.calls.filter((c) => c.fn === 'api:preview').at(-1)!;
  expect(req.auth).toBe('Bearer token-de-teste');
  expect(req.body).toMatchObject({ section_id: 'sec1', url: LINK });
  expect(ic.calls.some((c) => c.fn === 'api:create')).toBe(false); // nada guardado antes de confirmar

  // Por omissão: dados reais, toda a secção, sem lembretes.
  await expect(add.getByLabel('Nome na app')).toHaveValue('Agrupamento (fictício)');
  await expect(add.getByRole('radio', { name: 'Dados reais' })).toBeChecked();
  await expect(add.getByRole('radio', { name: 'Toda a secção' })).toBeChecked();
  await expect(add.getByRole('checkbox', { name: '1 dia' })).not.toBeChecked();
  await add.getByLabel('Nome na app').fill('Agrupamento');
  await add.getByRole('radio', { name: 'Uma equipa' }).check();
  await expect(add.getByRole('button', { name: 'Confirmar e importar' })).toBeDisabled();
  await add.getByLabel('Equipa', { exact: true }).selectOption({ label: 'Equipa Andorinha' });
  await add.getByRole('button', { name: 'Confirmar e importar' }).click();
  await expect(page.getByText('Ligado. 12 atividades importadas.')).toBeVisible();
  expect(ic.calls.find((c) => c.fn === 'api:create')!.body).toMatchObject({ url: LINK, name: 'Agrupamento', space: 'real', audience: 'equipa', team_id: 'teamA', reminder_minutes: [] });

  const card = page.getByRole('region', { name: 'Agrupamento', exact: true });
  await expect(card).toContainText('webcal://p00-caldav.icloud.com/…cdef');
  await expect(card).toContainText('Equipa Equipa Andorinha');
  await expect(card).toContainText('12 · 05-09-2026 a 10-07-2027');
  await expect(card).toContainText('12 novas');
  // O link completo nunca fica visível depois de guardado.
  await page.reload();
  await expect(card).toBeVisible();
  expect(await page.locator('main').innerText()).not.toContain('FICTICIO-secreto');
});

test('gestão: erros de sincronização, remoções por confirmar, alterar e desligar', async ({ page }) => {
  await installMock(page, leader());
  const ic = await installIcloud(page, [source({ last_warning: '7 atividades deixaram de aparecer no iCloud (de 12). Por segurança, nada foi retirado: confirma em «Sincronizar agora».', pending_removals: 7 })]);
  await page.goto('/gestao/icloud');
  const card = page.getByRole('region', { name: 'Agrupamento', exact: true });
  await expect(card).toContainText('nada foi retirado');
  ic.failSync();
  await card.getByRole('button', { name: 'Sincronizar agora' }).click();
  await expect(card.getByText(/código 404/).first()).toBeVisible();
  await expect(card.getByText('As atividades já importadas mantêm-se.')).toBeVisible();
  await card.getByRole('button', { name: 'Sincronizar agora' }).click();
  await expect(card.getByText('Sincronizado.')).toBeVisible();
  await expect(card).toContainText('2 alteradas');

  ic.state.sources[0].pending_removals = 6;
  await page.reload();
  await card.getByRole('button', { name: 'Confirmar remoções (6)' }).click();
  await card.getByRole('button', { name: 'Retirar 6' }).click();
  await expect(card).toContainText('6 removidas');
  expect(ic.calls.filter((c) => c.fn === 'api:sync').at(-1)!.body).toMatchObject({ source_id: 'src1', force: true });

  await card.getByText('Alterar ou desligar').click();
  await card.getByRole('checkbox', { name: '1 dia' }).check();
  await card.getByRole('button', { name: 'Guardar' }).click();
  await expect(card.getByText('Alterações guardadas.')).toBeVisible();
  expect(ic.calls.find((c) => c.fn === 'cal_source_update')!.body.p_data).toMatchObject({ audience: 'seccao', reminder_minutes: [1440] });
  await expect(card).toContainText('1 dia antes');

  await card.getByRole('radio', { name: /Arquivar/ }).check();
  await card.getByRole('button', { name: 'Desligar…' }).click();
  await expect(card.getByText('Nada é apagado')).toBeVisible();
  await card.getByRole('button', { name: 'Desligar', exact: true }).click();
  await expect(card).toContainText('Arquivada');
  expect(ic.calls.find((c) => c.fn === 'cal_source_disconnect')!.body).toMatchObject({ p_source: 'src1', p_mode: 'arquivar' });
  await card.getByRole('button', { name: 'Retomar atualizações' }).click();
  await expect(card).toContainText('Ativa');
  expect(ic.calls.some((c) => c.fn === 'cal_source_resume')).toBe(true);
});

// ---------------------------------------------------------------------------
// Atividades importadas no calendário
// ---------------------------------------------------------------------------
async function installCalendar(page: Page) {
  const start = isoIn(4 * D);
  const base: Row = {
    description: 'Detalhes no iCloud.', location: 'Sede', all_day: false, starts_at: start, ends_at: new Date(Date.parse(start) + 2 * 3600e3).toISOString(),
    start_date: null, end_date: null, audience: 'seccao', team_id: null, team_name: null, responsible_id: null, responsible_name: null,
    registration_deadline: null, deadline_passed: false, needs_authorization: false, needs_payment: false, needs_registration: false, material: null,
    required: [], reminder_minutes: [], deadline_reminder_minutes: [], status: 'ativo', cancel_reason: null, cancelled_at: null,
    updated_at: now, created_at: now, involved: true, my_response: null, my_missing: ['resposta'], counts: { vou: 0, nao_vou: 0, por_confirmar: 0, total: 3 },
  };
  const src = { id: 'src1', kind: 'icloud', name: 'Agrupamento', state: 'ok', removed_at: null, synced_at: now, source_status: 'ativa', readonly: true };
  const events: Row[] = [
    { ...base, id: 'ic1', title: 'Reunião de pais (iCloud)', source: src },
    { ...base, id: 'ic2', title: 'Jantar removido', starts_at: isoIn(6 * D), ends_at: isoIn(6 * D + 3600e3), status: 'cancelado', cancel_reason: 'Removida no iCloud.', cancelled_at: now, source: { ...src, state: 'removido', removed_at: now } },
    { ...base, id: 'app1', title: 'Atividade da app', starts_at: isoIn(5 * D), ends_at: isoIn(5 * D + 3600e3), source: null },
  ];
  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route: Route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON?.() ?? {};
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });
    switch (fn) {
      case 'my_modules':
        return ok(['calendario', 'equipas', 'inventario', 'secretaria', 'tesouraria'].map((m) => ({ module: m, status: m === 'calendario' ? 'teste' : 'desenvolvimento', space: m === 'calendario' ? 'teste' : null, grants: [], dirigente: true })));
      case 'cal_events_list':
        return ok(events.filter((e) => lisbonDay(e.starts_at) <= body.p_to && lisbonDay(e.ends_at) >= body.p_from));
      case 'cal_my_pending': return ok([]);
      case 'cal_config': return ok({ year_start_month: 9, special_days: [], can_manage: true });
      case 'cal_event_get': {
        const e = events.find((x) => x.id === body.p_event)!;
        return ok({ ...e, can_manage: true, can_see_pending: true, can_respond: e.status === 'ativo', me: { response: null, note: null, responded_at: null, missing: [] }, participants: [] });
      }
      case 'cal_form_options': return ok({ teams: [{ id: 'teamA', name: 'Equipa Andorinha' }], members: [{ id: 'u-ana', name: 'Ana Dirigente Teste' }] });
      case 'module_files_of': return ok([]);
      default: return route.fallback();
    }
  });
  return events;
}

test('calendário: etiqueta «iCloud» discreta e dados da origem só de leitura', async ({ page }) => {
  await installMock(page, leader());
  await installCalendar(page);
  await page.goto('/calendario?vista=lista');
  const row = page.getByRole('link', { name: /Reunião de pais \(iCloud\)/ });
  await expect(row.locator('.cal-src')).toHaveText('iCloud');
  await expect(page.getByRole('link', { name: /Jantar removido/ }).locator('.cal-src')).toHaveText('iCloud · removida no iCloud');
  await expect(page.getByRole('link', { name: /Atividade da app/ }).locator('.cal-src')).toHaveCount(0);

  await row.click();
  await expect(page.getByRole('note')).toContainText('Título, datas, local e descrição alteram-se no iCloud.');
  await page.getByRole('button', { name: 'Mais' }).click();
  await expect(page.getByRole('button', { name: /Cancelar atividade/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Alterar' }).click();
  await expect(page.getByLabel('Evento')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Notas (opcional)')).toHaveAttribute('readonly', '');
  await expect(page.locator('#cal-sd')).toBeDisabled();
  await page.getByText('Mais opções').click();
  await expect(page.getByLabel('Local')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Responsável')).toBeEnabled();

  await page.goto('/calendario/evento/ic2');
  await expect(page.getByRole('note')).toContainText('Removida no iCloud');
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`gestão iCloud ${theme}`, async ({ page }, info) => {
      test.setTimeout(60_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      const ic = await installIcloud(page, [
        source({ last_warning: '7 atividades deixaram de aparecer no iCloud (de 12). Por segurança, nada foi retirado: confirma em «Sincronizar agora».', pending_removals: 7 }),
        source({ id: 'src2', name: 'Testes do calendário', space: 'teste', status: 'parada', last_error: 'O iCloud respondeu com o código 404: confirma que o calendário continua partilhado como calendário público.', last_error_at: now, failures: 3, event_count: 4, range_from: '2026-10-03', range_to: '2026-11-28', last_stats: { criadas: 4 } }),
      ]);
      ic.state.auto_sync = theme === 'light';
      await page.goto('/gestao/icloud');
      await shoot(page, info, theme, 'icloud-gestao');
      const add = page.getByRole('region', { name: 'Ligar um calendário do iCloud' });
      await add.getByText('Ligar outro calendário').click();
      await add.getByLabel('Link do calendário').fill(LINK);
      await add.getByRole('button', { name: 'Verificar link' }).click();
      await add.getByLabel('Pré-visualização').waitFor();
      await add.scrollIntoViewIfNeeded();
      await shoot(page, info, theme, 'icloud-pre-visualizacao');
      await installCalendar(page);
      await page.goto('/calendario?vista=lista');
      await shoot(page, info, theme, 'icloud-calendario-lista');
      await page.goto('/calendario/evento/ic1');
      await shoot(page, info, theme, 'icloud-calendario-detalhe');
    });
  }
});
