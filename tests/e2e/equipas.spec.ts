// Equipas e cargos: vista por equipa, vista individual, nomear e terminar cargos,
// mudar de equipa — em telemóvel e computador. Pessoas FICTÍCIAS, só para teste.
import { expect, test, type Page, type Route } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
const fmt = (d: string) => d.split('-').reverse().join('/');
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const scoutYear = (d: string) => { const y = +d.slice(0, 4); const s = +d.slice(5, 7) >= 9 ? y : y - 1; return `${s}/${String((s + 1) % 100).padStart(2, '0')}`; };

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

type Row = Record<string, any>;

function state(manage: boolean) {
  const start = addDays(today, -60);
  return {
    space: 'teste', can_manage: manage, today, year: scoutYear(today), me: manage ? 'm-ana' : 'm-p1',
    teams: [
      { id: 'teamA', name: 'Equipa Andorinha', archived_at: null, color: '#2f7d4f', motto: 'Sempre alerta', emblem: null },
      { id: 'teamB', name: 'Equipa Bússola', archived_at: null, color: '#2f6fb5', motto: null, emblem: null },
    ],
    members: [
      { membership_id: 'm-p1', profile_id: 'u-p1', full_name: 'Pedro Teste', totem: 'Lince Atento', function: 'pioneiro', status: 'ativo', team_id: 'teamA', since: '2025-09-02' },
      { membership_id: 'm-guia', profile_id: 'u-guia', full_name: 'Guia Teste', totem: null, function: 'guia', status: 'ativo', team_id: 'teamA', since: '2025-09-02' },
      ...(manage ? [{ membership_id: 'm-ana', profile_id: 'u-ana', full_name: 'Ana Dirigente Teste', totem: null, function: 'dirigente', status: 'ativo', team_id: null, since: '2025-09-02' }] : []),
    ],
    roles: [
      { id: 'r-guia', name: 'Guia', kind: 'guia', description: 'Anima e representa a equipa.', single: true, archived_at: null },
      { id: 'r-sub', name: 'Subguia', kind: 'subguia', description: 'Apoia o guia e substitui-o.', single: true, archived_at: null },
      { id: 'r-int', name: 'Intendente', kind: 'cargo', description: 'Cuida do material da equipa.', single: true, archived_at: null },
    ],
    appointments: [
      { id: 'a1', role_id: 'r-guia', team_id: 'teamA', membership_id: 'm-guia', starts_on: start, ends_on: null, end_reason: null, notes: null, remind_days: null, cancelled_at: null, cancel_reason: null, created_at: start, created_by_name: 'Ana Dirigente Teste', ended_by_name: null },
      { id: 'a0', role_id: 'r-int', team_id: 'teamA', membership_id: 'm-p1', starts_on: addDays(start, -400), ends_on: addDays(start, -30), end_reason: 'Fim de mandato', notes: null, remind_days: null, cancelled_at: null, cancel_reason: null, created_at: start, created_by_name: 'Ana Dirigente Teste', ended_by_name: 'Ana Dirigente Teste' },
    ] as Row[],
    moves: [
      { id: 'h1', membership_id: 'm-p1', on: addDays(start, -380), at: start, from_team_id: 'teamB', to_team_id: 'teamA', reason: 'Equilíbrio das equipas', source: 'modulo', applied: true, by_name: 'Ana Dirigente Teste' },
    ] as Row[],
  };
}

async function mockEquipas(page: Page, manage = true) {
  const s = state(manage);
  const calls: { fn: string; body: Row }[] = [];
  const ok = (route: Route, v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON?.() ?? {};
    if (fn === 'my_modules') {
      return ok(route, ['calendario', 'equipas', 'inventario', 'secretaria', 'tesouraria'].map((k) => ({
        module: k, status: k === 'equipas' ? 'teste' : 'desenvolvimento', space: k === 'equipas' ? 'teste' : null, grants: [], dirigente: manage,
      })));
    }
    if (!fn.startsWith('eq_')) return route.fallback();
    calls.push({ fn, body });
    if (fn === 'eq_overview') return ok(route, s);
    if (fn === 'eq_appoint') {
      if (s.appointments.some((a) => a.role_id === body.p_role && a.team_id === body.p_team && !a.ends_on && !a.cancelled_at && body.p_role !== 'r-int')) {
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'A equipa Equipa Andorinha já tem Guia nesse período (Guia Teste). Termina primeiro essa nomeação.' }) });
      }
      s.appointments.unshift({ id: `a${s.appointments.length + 1}`, role_id: body.p_role, team_id: body.p_team, membership_id: body.p_membership, starts_on: body.p_starts_on, ends_on: body.p_ends_on, end_reason: null, notes: body.p_notes, remind_days: body.p_remind_days, cancelled_at: null, cancel_reason: null, created_at: today, created_by_name: 'Ana Dirigente Teste', ended_by_name: null });
      return ok(route, 'novo');
    }
    if (fn === 'eq_end_appointment') {
      Object.assign(s.appointments.find((a) => a.id === body.p_appointment)!, { ends_on: body.p_ends_on, end_reason: body.p_reason });
      return ok(route, null);
    }
    if (fn === 'eq_move_member') {
      const m = s.members.find((x) => x.membership_id === body.p_membership)!;
      s.moves.unshift({ id: 'h2', membership_id: m.membership_id, on: body.p_effective_on, at: new Date().toISOString(), from_team_id: m.team_id, to_team_id: body.p_to_team, reason: body.p_reason, source: 'modulo', applied: false, by_name: 'Ana Dirigente Teste' });
      for (const a of s.appointments) if (a.membership_id === m.membership_id && a.team_id === m.team_id && !a.ends_on) Object.assign(a, { ends_on: body.p_effective_on, end_reason: 'Mudança de equipa' });
      m.team_id = body.p_to_team;
      return ok(route, 'h2');
    }
    return ok(route, null);
  });
  return calls;
}

test('vista por equipa: equipas do ano, guia, membros e cargos', async ({ page }, info) => {
  await installMock(page, leader());
  await mockEquipas(page);
  await page.goto('/equipas-e-cargos');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Equipas e cargos', level: 1 })).toBeVisible();
  await expect(main.getByText('Ambiente de teste.')).toBeVisible();
  const card = main.getByRole('link', { name: /Equipa Andorinha/ });
  await expect(card).toContainText('Sempre alerta');
  await expect(card).toContainText('Guia Teste');
  await expect(card).toContainText('2 membros');
  await expect(main.getByLabel('Ano escutista')).toHaveValue(scoutYear(today));
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/equipas-${info.project.name}.png`, fullPage: true });
  await card.click();
  await expect(page).toHaveURL(/\/equipas-e-cargos\/equipa\/teamA$/);
  await expect(main.getByRole('heading', { name: 'Equipa Andorinha', level: 1 })).toBeVisible();
  const cargos = main.getByTestId('nomeacao');
  await expect(cargos.first()).toContainText('Guia');
  await expect(cargos.first()).toContainText('Em funções');
  await expect(main.getByRole('heading', { name: 'Membros atuais' })).toBeVisible();
  await expect(main.getByRole('link', { name: /Pedro Teste/ })).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/equipa-${info.project.name}.png`, fullPage: true });
  // Voltar mantém a vista
  await main.getByRole('button', { name: 'Voltar' }).click();
  await expect(page).toHaveURL(/\/equipas-e-cargos$/);
});

test('vista individual: pesquisa no URL, cargos atuais e históricos, histórico de equipas', async ({ page }, info) => {
  await installMock(page, leader());
  await mockEquipas(page);
  await page.goto('/equipas-e-cargos?vista=pessoas');
  const main = page.locator('main');
  await main.getByLabel('Pesquisar').fill('lince');
  await expect(page).toHaveURL(/q=lince/);
  await expect(main.getByRole('link', { name: /Guia Teste/ })).toHaveCount(0);
  await main.getByRole('link', { name: /Pedro Teste/ }).click();
  await expect(main.getByRole('heading', { name: 'Pedro Teste', level: 1 })).toBeVisible();
  await expect(main.getByText('Sem cargos atuais.')).toBeVisible();
  const hist = main.getByTestId('nomeacao');
  await expect(hist).toContainText(['Intendente']);
  await expect(hist.first()).toContainText('Terminado');
  await expect(hist.first()).toContainText('Fim de mandato');
  await expect(main.getByText('Equipa Bússola →')).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: `test-results/pessoa-${info.project.name}.png`, fullPage: true });
  await page.goBack();
  await expect(main.getByLabel('Pesquisar')).toHaveValue('lince');
});

test('nomear e terminar um cargo (validação e confirmação do servidor)', async ({ page }) => {
  await installMock(page, leader());
  const calls = await mockEquipas(page);
  await page.goto('/equipas-e-cargos/equipa/teamA');
  const main = page.locator('main');
  await main.getByText('Nomear para um cargo').click();
  const form = main.getByRole('form', { name: 'Nomear para um cargo' });
  await form.getByRole('button', { name: 'Nomear' }).click();
  await expect(form).toContainText('Escolhe o cargo.');
  // Guia único: o servidor recusa e a mensagem aparece
  await form.getByLabel('Cargo').selectOption({ label: 'Guia' });
  await form.getByLabel('Pessoa').selectOption({ label: 'Pedro Teste' });
  await form.getByRole('button', { name: 'Nomear' }).click();
  await expect(form).toContainText('já tem Guia');
  await form.getByLabel('Cargo').selectOption({ label: 'Subguia' });
  await expect(form).toContainText('Apoia o guia');
  await form.getByRole('button', { name: 'Nomear' }).click();
  await expect(form).toContainText('Nomeação registada');
  expect(calls.filter((c) => c.fn === 'eq_appoint').at(-1)!.body).toMatchObject({ p_section: 'sec1', p_role: 'r-sub', p_team: 'teamA', p_membership: 'm-p1', p_starts_on: today, p_ends_on: null });
  const item = main.getByTestId('nomeacao').filter({ hasText: 'Subguia' });
  await expect(item).toContainText('Em funções');
  await item.getByRole('button', { name: 'Terminar' }).click();
  await item.getByLabel('Motivo (opcional)').fill('Passagem de testemunho');
  await item.getByRole('button', { name: 'Confirmar fim' }).click();
  await expect(item).toContainText('Terminado');
  await expect(item).toContainText(`${fmt(today)} a ${fmt(today)}`);
  expect(calls.find((c) => c.fn === 'eq_end_appointment')!.body).toMatchObject({ p_appointment: expect.any(String), p_ends_on: today, p_reason: 'Passagem de testemunho' });
  await noHorizontalScroll(page);
});

test('mudar de equipa (no teste não muda a equipa real) e o histórico fica visível', async ({ page }) => {
  await installMock(page, leader());
  const calls = await mockEquipas(page);
  await page.goto('/equipas-e-cargos/pessoa/m-guia');
  const main = page.locator('main');
  await main.locator('summary', { hasText: 'Mudar de equipa' }).click();
  const form = main.getByRole('form', { name: 'Mudar de equipa' });
  await expect(form).toContainText('a equipa real da pessoa não muda');
  await form.getByRole('button', { name: 'Mudar de equipa' }).click();
  await expect(form).toContainText('Escolhe a nova equipa.');
  await form.getByLabel('Nova equipa').selectOption({ label: 'Equipa Bússola' });
  await form.getByLabel('Motivo (opcional)').fill('Equilíbrio das equipas');
  await form.getByRole('button', { name: 'Mudar de equipa' }).click();
  await expect(main).toContainText('A equipa real da pessoa não foi alterada');
  expect(calls.find((c) => c.fn === 'eq_move_member')!.body).toMatchObject({ p_membership: 'm-guia', p_to_team: 'teamB', p_effective_on: today, p_end_roles: true });
  await expect(main.locator('.eq-person-head')).toContainText('Equipa Bússola');
  await expect(main.getByText('Equipa Andorinha →')).toBeVisible();
  await expect(main.getByText(/só no ambiente de teste/)).toBeVisible();
  await expect(main.getByTestId('nomeacao').filter({ hasText: 'Guia' })).toContainText('Mudança de equipa');
  await noHorizontalScroll(page);
});

test('quem só consulta não vê ações de gestão', async ({ page }) => {
  await installMock(page, pioneer());
  const calls = await mockEquipas(page, false);
  await page.goto('/equipas-e-cargos/equipa/teamA');
  const main = page.locator('main');
  await expect(main.getByTestId('nomeacao').first()).toBeVisible();
  await expect(main.getByText('Nomear para um cargo')).toHaveCount(0);
  await expect(main.getByText('Editar identidade')).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Terminar' })).toHaveCount(0);
  await page.goto('/equipas-e-cargos?vista=cargos');
  await expect(main.getByText('Cuida do material da equipa.')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await expect(main).toContainText('Um cargo não dá permissões');
  expect(calls.every((c) => c.fn === 'eq_overview')).toBe(true);
  await noHorizontalScroll(page);
});
