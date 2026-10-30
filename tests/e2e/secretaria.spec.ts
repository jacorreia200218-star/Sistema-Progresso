// Atas e tarefas (interface): ata ligada a um evento do calendário (ou criado aqui), edição com
// histórico, tarefas com responsável escolhido numa lista pesquisável, «As minhas tarefas» e
// os endereços antigos. API simulada; as regras do servidor estão em tests/db/atas.test.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { CAPTURAS, THEMES, shoot } from './capturas-util';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;
const now = new Date().toISOString();
const BASE = '/atas-e-tarefas';
const PEOPLE = [
  { id: 'u-ana', name: 'Ana Dirigente Teste', function: 'dirigente', team_name: null },
  { id: 'u-guia', name: 'Guia Teste', function: 'guia', team_name: 'Equipa Andorinha' },
  { id: 'u-p1', name: 'Pedro Teste', function: 'pioneiro', team_name: 'Equipa Andorinha' },
];
const ev = (id: string, title: string, day: string, start: string | null): Row => ({
  id, title, all_day: !start, starts_at: start ? `${day}T${start}:00.000Z` : null, ends_at: start ? `${day}T15:00:00.000Z` : null,
  start_date: start ? null : day, end_date: start ? null : day, day, location: 'Sede', audience: 'seccao', team_id: null, team_name: null, status: 'ativo',
});
const nameOf = (id: string) => PEOPLE.find((p) => p.id === id)?.name ?? '';

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'deslocamento horizontal').toBeLessThanOrEqual(1);
}

/** API simulada do módulo, com estado (só para teste). */
async function installAtas(page: Page, opts: { write?: boolean; me?: string; events?: Row[]; atas?: boolean } = {}) {
  const write = opts.write ?? true;
  const me = opts.me ?? 'u-ana';
  const S = {
    events: opts.events ?? [ev('ev1', 'Reunião', '2026-10-17', '13:30'), ev('ev2', 'Acampamento de outono', '2026-10-24', null)],
    atas: [] as Row[],
    tasks: [] as Row[],
    calls: [] as { fn: string; body: Row }[],
  };
  if (opts.atas ?? true) {
    S.atas.push({ id: 'a1', meeting_id: 'mt1', event_id: 'ev2', scope: 'seccao', team_name: null, created_by: 'u-ana',
      versions: [{ version: 1, body: 'Ficou combinado o acampamento.', saved_at: now, by: 'u-ana' }], updated_at: now, updated_by: 'u-ana' });
    S.atas.push({ id: 'a2', meeting_id: 'mt2', event_id: null, title: 'Reunião de dirigentes', day: '2026-10-03', scope: 'dirigentes', team_name: null, created_by: 'u-ana',
      versions: [{ version: 1, body: 'Assuntos reservados.', saved_at: now, by: 'u-ana' }], updated_at: now, updated_by: 'u-ana' });
    S.tasks.push({ id: 't1', ata_id: 'a1', text: 'Reservar o parque', responsible_id: 'u-p1', due_date: '2020-01-10', status: 'por_fazer' });
  }
  const eventOf = (id: string | null) => S.events.find((e) => e.id === id) ?? null;
  const task = (t: Row) => {
    const a = S.atas.find((x) => x.id === t.ata_id)!;
    const participants = (t.participants ?? []).map((id: string) => ({ id, name: nameOf(id), team_name: PEOPLE.find((p) => p.id === id)?.team_name ?? null }));
    return { title: null, ...t, participants, responsible_name: nameOf(t.responsible_id), overdue: t.status !== 'concluida' && !!t.due_date && t.due_date < now.slice(0, 10),
      event: eventOf(a.event_id), updated_at: now, updated_by_name: 'Ana Dirigente Teste' };
  };
  const row = (a: Row) => {
    const e = eventOf(a.event_id);
    return { id: a.id, meeting_id: a.meeting_id, title: e?.title ?? a.title, day: e?.day ?? a.day, event_id: a.event_id, scope: a.scope, team_name: a.team_name,
      updated_at: a.updated_at, updated_by_name: nameOf(a.updated_by),
      open_tasks: S.tasks.filter((t) => t.ata_id === a.id && t.status !== 'concluida').length };
  };
  const ok = (route: Route, v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v ?? null) });
  const fail = (route: Route, message: string) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message }) });

  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const b = route.request().postDataJSON?.() ?? {};
    S.calls.push({ fn, body: b });
    switch (fn) {
      case 'my_modules':
        return ok(route, ['calendario', 'equipas', 'inventario', 'presencas', 'secretaria', 'tesouraria'].map((k) => ['secretaria', 'equipas'].includes(k)
          ? { module: k, status: 'disponivel', space: 'real', grants: [], dirigente: write }
          : { module: k, status: 'teste', space: null, grants: [], dirigente: write }));
      case 'ata_list': {
        const q = String(b.p_search ?? '').toLowerCase();
        return ok(route, { can_write: write, atas: S.atas.map(row).filter((a) => !q || a.title.toLowerCase().includes(q)).sort((x, y) => y.day.localeCompare(x.day)) });
      }
      case 'ata_events':
        if (!write) return fail(route, 'Só os dirigentes e quem redige atas podem fazer isto.');
        return ok(route, S.events.map((e) => ({ ...e, ata_id: S.atas.find((a) => a.event_id === e.id)?.id ?? null })));
      case 'ata_event_create': {
        if (!String(b.p_title ?? '').trim()) return fail(route, 'Indica o nome do evento.');
        const id = `ev${S.events.length + 1}`;
        S.events.unshift(ev(id, b.p_title, b.p_day, b.p_start));
        return ok(route, id);
      }
      case 'ata_save': {
        if (!String(b.p_body ?? '').trim()) return fail(route, 'Escreve o texto da ata.');
        if (!b.p_ata) {
          if (S.atas.some((a) => a.event_id === b.p_event)) return fail(route, 'Este evento já tem ata. Abre-a para a editar.');
          const id = `a${S.atas.length + 1}`;
          S.atas.push({ id, meeting_id: `m-${id}`, event_id: b.p_event, scope: b.p_scope === 'dirigentes' ? 'dirigentes' : 'seccao', team_name: null, created_by: me,
            versions: [{ version: 1, body: b.p_body, saved_at: now, by: me }], updated_at: now, updated_by: me });
          return ok(route, id);
        }
        const a = S.atas.find((x) => x.id === b.p_ata)!;
        if (b.p_expected_version !== a.versions.length) return fail(route, 'A ata mudou entretanto. Atualiza a página.');
        a.versions.push({ version: a.versions.length + 1, body: b.p_body, saved_at: now, by: me });
        a.scope = b.p_scope === 'dirigentes' ? 'dirigentes' : 'seccao';
        return ok(route, a.id);
      }
      case 'ata_get': {
        const a = S.atas.find((x) => x.id === b.p_ata);
        if (!a) return fail(route, 'Registo não encontrado.');
        const cur = a.versions.length;
        const v = a.versions.find((x: Row) => x.version === (b.p_version ?? cur));
        const e = eventOf(a.event_id);
        return ok(route, { id: a.id, meeting_id: a.meeting_id, title: e?.title ?? a.title, scope: a.scope, team_id: null, team_name: null, event: e,
          day: e?.day ?? a.day, body: v.body, version: v.version, current_version: cur, updated_at: now, updated_by_name: nameOf(a.versions[cur - 1].by),
          created_by_name: nameOf(a.created_by), versions: [...a.versions].reverse().map((x: Row) => ({ version: x.version, saved_at: x.saved_at, saved_by_name: nameOf(x.by) })),
          can_write: write, tasks: S.tasks.filter((t) => t.ata_id === a.id).map(task) });
      }
      case 'ata_people': return ok(route, PEOPLE);
      case 'ata_task_save': {
        if (!write) return fail(route, 'Só os dirigentes e quem redige atas podem fazer isto.');
        if (!b.p_responsible) return fail(route, 'Escolhe o responsável.');
        if (b.p_task) {
          const t = S.tasks.find((x) => x.id === b.p_task)!;
          Object.assign(t, { title: b.p_title, text: b.p_text, responsible_id: b.p_responsible, due_date: b.p_due, status: b.p_status,
            participants: b.p_participants ?? t.participants });
          return ok(route, b.p_task);
        }
        const id = `t${S.tasks.length + 1}`;
        S.tasks.push({ id, ata_id: b.p_ata, title: b.p_title, text: b.p_text, responsible_id: b.p_responsible, due_date: b.p_due,
          status: b.p_status ?? 'por_fazer', participants: b.p_participants ?? [] });
        return ok(route, id);
      }
      case 'ata_task_status': {
        const t = S.tasks.find((x) => x.id === b.p_task)!;
        if (!write && t.responsible_id !== me) return fail(route, 'Só o responsável ou quem gere as tarefas pode mudar o estado.');
        t.status = b.p_status;
        return ok(route, null);
      }
      case 'ata_my_tasks': return ok(route, S.tasks.filter((t) => t.responsible_id === me || (t.participants ?? []).includes(me))
        .map((t) => ({ ...task(t), my_role: t.responsible_id === me ? 'responsavel' : 'participante' })));
      case 'ata_tasks': {
        const f = b.p_filter ?? 'abertas';
        return ok(route, { can_write: write, tasks: S.tasks.filter((t) => f === 'todas' || (f === 'concluidas') === (t.status === 'concluida')).map(task) });
      }
      default: return route.fallback();
    }
  });
  return S;
}

test('dirigente: lista com pesquisa, nova ata a partir de um evento, editar e ver o histórico', async ({ page }) => {
  await installMock(page, leader());
  const S = await installAtas(page);
  await page.goto(BASE);
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Atas e tarefas', level: 1 })).toBeVisible();
  await expect(main.getByText('Em teste')).toHaveCount(0);
  const list = main.getByRole('list', { name: 'Atas' });
  await expect(list.getByRole('link')).toHaveCount(2);
  await expect(list.getByRole('link').first()).toContainText('Acampamento de outono');
  await expect(list.getByRole('link').first()).toContainText('24-10-2026');
  await expect(list.getByRole('link').nth(1)).toContainText('Reservada');
  await main.getByPlaceholder('Pesquisar atas').fill('acamp');
  await expect(page).toHaveURL(/q=acamp/);
  await expect(list.getByRole('link')).toHaveCount(1);
  await main.getByPlaceholder('Pesquisar atas').fill('');

  await main.getByRole('link', { name: 'Nova ata' }).click();
  await expect(main.getByRole('heading', { name: 'Nova ata' })).toBeVisible();
  await main.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.getByText('Escolhe o evento.')).toBeVisible();
  await expect(main.getByText('Escreve o texto da ata.')).toBeVisible();
  // O evento que já tem ata leva à ata existente
  await main.getByLabel('Evento').selectOption('ev2');
  await expect(main.getByRole('link', { name: 'Abrir a ata' })).toBeVisible();
  await main.getByLabel('Evento').selectOption('ev1');
  await expect(main.getByLabel('Evento').locator('option:checked')).toContainText('17-10-2026 · Reunião');
  await main.getByLabel('Ata', { exact: true }).fill('Planeámos o raide.\nFicou tudo combinado.');
  await main.getByRole('button', { name: 'Guardar' }).click();

  await expect(page).toHaveURL(/\/atas-e-tarefas\/atas\/a3$/);
  await expect(main.getByRole('heading', { name: 'Reunião', level: 1 })).toBeVisible();
  await expect(main.locator('.sec-body')).toHaveText('Planeámos o raide.\nFicou tudo combinado.');
  await expect(main).toContainText('Escrita por Ana Dirigente Teste');
  await expect(main).toContainText('Toda a secção');
  expect(S.calls.find((c) => c.fn === 'ata_save')!.body).toMatchObject({ p_ata: null, p_event: 'ev1', p_scope: 'evento' });

  await main.getByRole('button', { name: 'Editar' }).click();
  await main.getByLabel('Texto da ata').fill('Planeámos o raide de novembro.');
  await main.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.getByText('Ata guardada.')).toBeVisible();
  await expect(main.locator('.sec-body')).toHaveText('Planeámos o raide de novembro.');
  await main.getByText('Histórico (2 versões)').click();
  await main.getByRole('button', { name: 'Versão 1' }).click();
  await expect(page).toHaveURL(/versao=1/);
  await expect(main.locator('.sec-body')).toHaveText('Planeámos o raide.\nFicou tudo combinado.');
  await expect(main.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await main.getByRole('button', { name: 'Ver a versão atual' }).click();
  await expect(main.locator('.sec-body')).toHaveText('Planeámos o raide de novembro.');
});

test('sem evento: «Criar reunião» e a ata fica associada ao novo evento', async ({ page }) => {
  await installMock(page, leader());
  const S = await installAtas(page, { events: [], atas: false });
  await page.goto(`${BASE}/nova`);
  const main = page.locator('main');
  await expect(main.getByText('Ainda não há eventos no calendário para associar a esta ata.')).toBeVisible();
  await main.getByRole('button', { name: 'Criar reunião' }).click();
  const group = main.getByRole('group', { name: 'Criar evento no calendário' });
  await expect(group).toBeVisible();
  await expect(group.getByLabel('Nome do evento')).toHaveValue('Reunião');
  // A data proposta é o dia de hoje (Europe/Lisbon)
  const today = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()).replace(/\//g, '-');
  await expect(group.getByLabel('Data')).toHaveValue(today);
  await group.getByLabel('Nome do evento').fill('Reunião de pais');
  await group.getByRole('button', { name: 'Criar evento' }).click();
  await expect(group).toHaveCount(0);
  await expect(main.getByLabel('Evento').locator('option:checked')).toContainText('Reunião de pais');
  await main.getByLabel('Ata', { exact: true }).fill('Apresentámos o plano do ano.');
  await main.getByText('Mais opções').click();
  await main.getByLabel('Reservada aos dirigentes').check();
  await main.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.getByRole('heading', { name: 'Reunião de pais', level: 1 })).toBeVisible();
  await expect(main).toContainText('Reservada aos dirigentes');
  expect(S.calls.find((c) => c.fn === 'ata_event_create')!.body).toMatchObject({ p_title: 'Reunião de pais', p_start: '14:30', p_end: '16:00' });
  expect(S.calls.find((c) => c.fn === 'ata_save')!.body).toMatchObject({ p_event: 'ev1', p_scope: 'dirigentes' });
});

test('muitos eventos com o mesmo nome: «DD-MM-AAAA · Nome», hora quando coincidem no dia, e pesquisa', async ({ page }) => {
  await installMock(page, leader());
  const many = Array.from({ length: 14 }, (_, i) => ev(`r${i}`, 'Reunião', `2026-09-${String(i + 1).padStart(2, '0')}`, '13:30'));
  many.push({ ...ev('r-tarde', 'Reunião', '2026-09-05', '16:00') });
  const S = await installAtas(page, { events: many, atas: false });
  await page.goto(`${BASE}/nova`);
  const main = page.locator('main');
  const box = main.getByRole('combobox', { name: 'Evento' });
  await box.click();
  const list = main.getByRole('listbox', { name: 'Atividades' });
  await expect(list.getByRole('option').first()).toHaveText(/^14-09-2026 · Reunião$/);
  await box.fill('05/09');
  await expect(list.getByRole('option')).toHaveCount(2);
  await expect(list.getByRole('option').nth(0)).toContainText('05-09-2026 · Reunião · 14:30');
  await expect(list.getByRole('option').nth(1)).toContainText('05-09-2026 · Reunião · 17:00');
  await list.getByRole('option').nth(1).click();
  await main.getByLabel('Ata', { exact: true }).fill('Reunião da tarde.');
  await main.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.getByRole('heading', { name: 'Reunião', level: 1 })).toBeVisible();
  expect(S.calls.find((c) => c.fn === 'ata_save')!.body).toMatchObject({ p_event: 'r-tarde' });
});

test('tarefa: responsável escolhido na lista pesquisável, editar e mudar o estado', async ({ page }) => {
  await installMock(page, leader());
  const S = await installAtas(page);
  await page.goto(`${BASE}/atas/a1`);
  const main = page.locator('main');
  const tasks = main.getByRole('region', { name: 'Tarefas' });
  await expect(tasks.getByRole('listitem')).toHaveCount(1);
  await expect(tasks.getByRole('listitem').first()).toContainText('Até 10-01-2020 (em atraso)');
  await tasks.getByRole('button', { name: 'Nova tarefa' }).click();
  await tasks.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(tasks.getByText('Dá um título curto à tarefa.')).toBeVisible();
  await expect(tasks.getByText('Descreve o que é preciso fazer.')).toBeVisible();
  await tasks.getByLabel('Título', { exact: true }).fill('Gás');
  await tasks.getByLabel('O que fazer', { exact: true }).fill('Comprar gás');
  await tasks.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(tasks.getByText('Escolhe o responsável.')).toBeVisible();
  const who = tasks.getByRole('combobox', { name: 'Responsável' });
  await who.fill('ped');
  const options = tasks.getByRole('listbox', { name: 'Pessoas da secção' }).getByRole('option');
  await expect(options).toHaveCount(1);
  await options.filter({ hasText: 'Pedro Teste' }).click();
  await expect(who).toHaveValue('Pedro Teste');
  await tasks.getByLabel('Prazo (opcional)').fill('30-10-2026');
  await tasks.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(main.getByText('Tarefa criada. O responsável e os participantes foram avisados.')).toBeVisible();
  expect(S.calls.find((c) => c.fn === 'ata_task_save')!.body).toMatchObject({
    p_ata: 'a1', p_title: 'Gás', p_text: 'Comprar gás', p_responsible: 'u-p1', p_due: '2026-10-30', p_participants: [],
  });
  await expect(tasks.getByRole('listitem')).toHaveCount(2);

  // Reatribuir com o teclado
  await tasks.getByRole('listitem').filter({ hasText: 'Gás' }).getByRole('button', { name: 'Editar' }).click();
  await expect(tasks.getByLabel('Título', { exact: true })).toHaveValue('Gás');
  await expect(tasks.getByLabel('O que fazer', { exact: true })).toHaveValue('Comprar gás');
  const who2 = tasks.getByRole('combobox', { name: 'Responsável' });
  await who2.fill('guia');
  await who2.press('Enter');
  await tasks.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.getByText('Tarefa guardada.')).toBeVisible();
  await expect(tasks.getByRole('listitem').filter({ hasText: 'Gás' })).toContainText('Guia Teste');

  await tasks.getByLabel('Estado de «Reservar o parque»').selectOption('em_curso');
  await expect.poll(() => S.tasks.find((t) => t.id === 't1')!.status).toBe('em_curso');
  await noHorizontalScroll(page);
});

test('tarefa com participantes: escolha múltipla por nome ou equipa, etiquetas removíveis e «O que fazer» ao abrir', async ({ page }) => {
  await installMock(page, leader());
  const S = await installAtas(page);
  await page.goto(`${BASE}/atas/a1`);
  const main = page.locator('main');
  const tasks = main.getByRole('region', { name: 'Tarefas' });
  await tasks.getByRole('button', { name: 'Nova tarefa' }).click();
  const form = tasks.getByRole('form', { name: 'Nova tarefa' });
  await form.getByLabel('Título', { exact: true }).fill('Material do raid');
  await form.getByLabel('O que fazer', { exact: true }).fill('Separar mapas e bússolas e deixar na sede.');
  const who = form.getByRole('combobox', { name: 'Responsável' });
  await who.fill('guia');
  await who.press('Enter');
  // Participantes: o responsável aparece indisponível; uma equipa inteira junta quem falta.
  const people = form.getByRole('combobox', { name: 'Participantes (opcional)' });
  await people.click();
  const list = form.getByRole('listbox', { name: 'Participantes' });
  await expect(list.getByRole('option', { name: /Guia Teste/ })).toHaveAttribute('aria-disabled', 'true');
  await people.fill('pedro');
  await people.press('Enter');
  await expect(list.getByRole('option', { name: /Pedro Teste/ })).toHaveAttribute('aria-selected', 'true');
  await people.press('Escape');
  const tags = form.getByRole('list', { name: 'Escolhidos' });
  await expect(tags.getByRole('listitem')).toHaveCount(1);
  await tags.getByRole('button', { name: 'Tirar Pedro Teste' }).click();
  await expect(tags).toHaveCount(0);
  await form.getByLabel('Juntar uma equipa inteira').selectOption('Equipa Andorinha');
  await expect(form.getByRole('list', { name: 'Escolhidos' }).getByRole('listitem')).toHaveCount(1);
  await form.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(main.getByText('Tarefa criada. O responsável e os participantes foram avisados.')).toBeVisible();
  expect(S.calls.filter((c) => c.fn === 'ata_task_save').at(-1)!.body).toMatchObject({ p_responsible: 'u-guia', p_participants: ['u-p1'] });

  // Na lista: título, responsável e participantes; ao abrir, «O que fazer».
  const item = tasks.getByRole('listitem').filter({ hasText: 'Material do raid' });
  await expect(item).toContainText('Guia Teste');
  await expect(item).toContainText('Pedro Teste');
  const toggle = item.getByRole('button', { name: 'Material do raid' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(item.getByRole('heading', { name: 'O que fazer' })).toBeVisible();
  await expect(item).toContainText('Separar mapas e bússolas e deixar na sede.');

  // Editar preserva as escolhas.
  await item.getByRole('button', { name: 'Editar' }).click();
  const edit = tasks.getByRole('form', { name: 'Editar tarefa' });
  await expect(edit.getByRole('list', { name: 'Escolhidos' }).getByRole('listitem')).toHaveCount(1);
  await expect(edit.getByRole('combobox', { name: 'Responsável' })).toHaveValue('Guia Teste');
  await noHorizontalScroll(page);
});

test('participante: a tarefa aparece em «As minhas tarefas», sem mudar o estado nem abrir a ata reservada', async ({ page }) => {
  await installMock(page, pioneer());
  const S = await installAtas(page, { write: false, me: 'u-p1' });
  S.tasks.push({ id: 't9', ata_id: 'a2', title: 'Contactar a junta', text: 'Pedir a sala.', responsible_id: 'u-guia', due_date: null,
    status: 'por_fazer', participants: ['u-p1'] });
  await page.goto(`${BASE}/minhas`);
  const open = page.locator('main').getByRole('region', { name: 'Por concluir' });
  const item = open.getByRole('listitem').filter({ hasText: 'Contactar a junta' });
  await expect(item).toContainText('Participas');
  await expect(item.getByRole('combobox')).toHaveCount(0);
  await expect(open.getByRole('listitem').filter({ hasText: 'Reservar o parque' }).getByRole('combobox')).toHaveCount(1);
});

test('pioneiro: vê atas partilhadas sem botões de escrita e muda o estado das suas tarefas', async ({ page }) => {
  await installMock(page, pioneer());
  const S = await installAtas(page, { write: false, me: 'u-p1' });
  await page.goto(BASE);
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: 'Nova ata' })).toHaveCount(0);
  await main.getByRole('link', { name: /Acampamento de outono/ }).click();
  await expect(main.locator('.sec-body')).toHaveText('Ficou combinado o acampamento.');
  await expect(main.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Nova tarefa' })).toHaveCount(0);
  await expect(main.locator('textarea')).toHaveCount(0);

  await page.goBack();
  await main.getByRole('link', { name: 'As minhas tarefas' }).click();
  await expect(page).toHaveURL(/\/atas-e-tarefas\/minhas$/);
  const open = main.getByRole('region', { name: 'Por concluir' });
  await expect(open.getByRole('listitem')).toHaveCount(1);
  await expect(open).toContainText('Reservar o parque');
  await expect(open).toContainText('Acampamento de outono');
  await expect(main.getByText('Tens 1 tarefa em atraso.')).toBeVisible();
  await open.getByLabel('Estado de «Reservar o parque»').selectOption('concluida');
  await expect(main.getByRole('region', { name: 'Concluídas' })).toContainText('Reservar o parque');
  expect(S.calls.find((c) => c.fn === 'ata_task_status')!.body).toMatchObject({ p_task: 't1', p_status: 'concluida' });

  await page.goto(`${BASE}/nova`);
  await expect(main.getByText('Só os dirigentes e quem redige atas podem fazer isto.')).toBeVisible();
});

test('endereços antigos levam a Atas e tarefas', async ({ page }) => {
  await installMock(page, leader());
  await installAtas(page);
  await page.goto('/reunioes-e-tarefas');
  await expect(page).toHaveURL(/\/atas-e-tarefas$/);
  await page.goto('/secretaria/o-que-me-diz-respeito');
  await expect(page).toHaveURL(/\/atas-e-tarefas\/minhas$/);
  await page.goto('/reunioes-e-tarefas/tarefas/i2');
  await expect(page.locator('main').getByRole('list', { name: 'Tarefas' })).toBeVisible();
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`atas e tarefas ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      await installAtas(page);
      await page.goto(BASE);
      await shoot(page, info, theme, 'atas-lista');
      await page.goto(`${BASE}/atas/a1`);
      await shoot(page, info, theme, 'atas-ata');
      await page.locator('main').getByRole('button', { name: 'Nova tarefa' }).click();
      const form = page.locator('main').getByRole('form', { name: 'Nova tarefa' });
      await form.getByLabel('Título', { exact: true }).fill('Material do raid');
      await form.getByLabel('O que fazer', { exact: true }).fill('Separar mapas e bússolas e deixar na sede.');
      await form.getByRole('combobox', { name: 'Responsável' }).fill('guia');
      await form.getByRole('combobox', { name: 'Responsável' }).press('Enter');
      await form.getByLabel('Juntar uma equipa inteira').selectOption('Equipa Andorinha');
      await form.getByRole('combobox', { name: 'Participantes (opcional)' }).click();
      await shoot(page, info, theme, 'atas-tarefa-nova');
      await form.getByRole('combobox', { name: 'Participantes (opcional)' }).press('Escape');
      await form.getByRole('button', { name: 'Criar tarefa' }).click();
      await page.locator('main').getByRole('button', { name: 'Material do raid' }).click();
      await shoot(page, info, theme, 'atas-tarefa-aberta');
      await page.goto(`${BASE}/nova`);
      await shoot(page, info, theme, 'atas-nova');
      await page.locator('main').getByRole('button', { name: 'Criar evento' }).click();
      await shoot(page, info, theme, 'atas-nova-evento');
      await page.goto(`${BASE}/tarefas`);
      await shoot(page, info, theme, 'atas-tarefas');
      await page.goto(`${BASE}/minhas`);
      await shoot(page, info, theme, 'atas-minhas');
    });
  }
});
