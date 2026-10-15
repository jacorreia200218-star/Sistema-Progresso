// Secretaria (interface): lista, criar reunião e ata, aprovar, versões, impressão,
// telemóvel e computador. API simulada; as regras do servidor estão em tests/db/secretaria.test.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;
const now = new Date().toISOString();
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 960;
const PEOPLE = [
  { id: 'u-ana', name: 'Ana Dirigente Teste', team_id: null, function: 'dirigente' },
  { id: 'u-guia', name: 'Guia Teste', team_id: 'teamA', function: 'guia' },
  { id: 'u-p1', name: 'Pedro Teste', team_id: 'teamA', function: 'pioneiro' },
];
const nameOf = (id: string | null) => PEOPLE.find((p) => p.id === id)?.name ?? null;

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `deslocamento horizontal a ${width}px`).toBeLessThanOrEqual(1);
}

/** API simulada da Secretaria, com estado (só para teste). */
async function installSec(page: Page, opts: { grants?: string[]; dirigente?: boolean } = {}) {
  const grants = opts.grants ?? ['secretaria.redigir', 'secretaria.aprovar'];
  const S = {
    meetings: [{ id: 'mt1', kind: 'equipa', team_id: 'teamA', team_name: 'Equipa Andorinha', title: 'Reunião de equipa de outubro', starts_at: '2026-10-10T17:30:00.000Z', location: 'Sede', agenda: '1. Raide\n2. Material', status: 'ativa', cancel_reason: null, cal_event_id: null, created_by: 'u-guia' }] as Row[],
    participants: { mt1: ['u-p1', 'u-guia'] } as Record<string, string[]>,
    minutes: [{ id: 'at1', meeting_id: 'mt1', kind: 'ata', parent_id: null, status: 'aprovada', current_version: 1, approved_version: 1, created_at: now }] as Row[],
    versions: [{ minute_id: 'at1', version_no: 1, body: 'Texto aprovado da ata de outubro.', note: null, frozen_at: now, approved_at: now, approved_by: 'u-ana', created_by: 'u-guia', created_at: now, updated_at: now, snapshot: null }] as Row[],
    items: [] as Row[],
  };
  const content = (minuteId: string) => {
    const d = S.minutes.find((x) => x.id === minuteId)!;
    const m = S.meetings.find((x) => x.id === d.meeting_id)!;
    return { title: m.title, kind: m.kind, team_name: m.team_name ?? null, starts_at: m.starts_at, location: m.location, agenda: m.agenda,
      participants: (S.participants[m.id] ?? []).map(nameOf),
      items: S.items.filter((i) => i.minute_id === minuteId).map((i) => ({ kind: i.kind, text: i.text, responsible_name: nameOf(i.responsible_id), due_date: i.due_date, link_label: null })) };
  };
  const item = (i: Row) => ({ ...i, responsible_name: nameOf(i.responsible_id), link_label: null });
  const ok = (route: Route, v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  const fail = (route: Route, message: string) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message }) });

  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const b = route.request().postDataJSON?.() ?? {};
    switch (fn) {
      case 'my_modules':
        return ok(route, ['calendario', 'equipas', 'inventario', 'secretaria', 'tesouraria'].map((k) => k === 'secretaria'
          ? { module: k, status: 'teste', space: 'teste', grants, dirigente: opts.dirigente ?? true }
          : { module: k, status: 'desenvolvimento', space: null, grants: [], dirigente: true }));
      case 'sec_people': return ok(route, { people: PEOPLE, teams: [{ id: 'teamA', name: 'Equipa Andorinha' }] });
      case 'sec_event_options': return ok(route, [{ id: 'ev1', title: 'Acampamento de outono', starts_at: '2026-10-24T08:00:00.000Z' }]);
      case 'sec_link_options': return ok(route, { requests: [], stages: [] });
      case 'module_files_of': return ok(route, []);
      case 'sec_meetings': {
        const q = String(b.p_search ?? '').toLowerCase();
        return ok(route, { can_draft: grants.includes('secretaria.redigir'), can_approve: true,
          meetings: S.meetings.filter((m) => (!b.p_kind || m.kind === b.p_kind) && (!q || m.title.toLowerCase().includes(q)))
            .map((m) => ({ ...m, ata: S.minutes.find((x) => x.meeting_id === m.id && x.kind === 'ata') ?? null, open_tasks: S.items.filter((i) => i.meeting_id === m.id && i.kind === 'tarefa' && i.exec_status !== 'feita').length })) });
      }
      case 'sec_meeting_save': {
        if (!String(b.p_title ?? '').trim()) return fail(route, 'Indica o título.');
        const id = b.p_meeting ?? `mt${S.meetings.length + 1}`;
        const row = { id, kind: b.p_kind, team_id: b.p_team, team_name: b.p_team ? 'Equipa Andorinha' : null, title: b.p_title, starts_at: b.p_starts_at, location: b.p_location, agenda: b.p_agenda, status: 'ativa', cancel_reason: null, cal_event_id: b.p_cal_event, created_by: 'u-ana' };
        S.meetings = [row, ...S.meetings.filter((m) => m.id !== id)];
        S.participants[id] = b.p_participants;
        return ok(route, id);
      }
      case 'sec_meeting': {
        const m = S.meetings.find((x) => x.id === b.p_meeting);
        if (!m) return fail(route, 'Registo não encontrado.');
        return ok(route, { meeting: { ...m, created_by_name: 'Ana', cal_event: m.cal_event_id ? { id: 'ev1', title: 'Acampamento de outono', starts_at: now, status: 'ativo' } : null },
          participants: (S.participants[m.id] ?? []).map((id) => ({ id, name: nameOf(id) })), shares: [],
          minutes: S.minutes.filter((x) => x.meeting_id === m.id), items: S.items.filter((i) => i.meeting_id === m.id).map(item),
          can_draft: grants.includes('secretaria.redigir'), can_approve: true });
      }
      case 'sec_minute_create': {
        const id = `at${S.minutes.length + 1}`;
        const parent = b.p_kind === 'aditamento' ? S.minutes.find((x) => x.meeting_id === b.p_meeting && x.kind === 'ata')!.id : null;
        S.minutes.push({ id, meeting_id: b.p_meeting, kind: b.p_kind, parent_id: parent, status: 'rascunho', current_version: 1, approved_version: null, created_at: now });
        S.versions.push({ minute_id: id, version_no: 1, body: b.p_body ?? '', note: null, frozen_at: null, approved_at: null, approved_by: null, created_by: 'u-ana', created_at: now, updated_at: now, snapshot: null });
        return ok(route, id);
      }
      case 'sec_minute': {
        const d = S.minutes.find((x) => x.id === b.p_minute);
        if (!d) return fail(route, 'Registo não encontrado.');
        const m = S.meetings.find((x) => x.id === d.meeting_id)!;
        const v = S.versions.find((x) => x.minute_id === d.id && x.version_no === (b.p_version ?? d.current_version))!;
        const draft = grants.includes('secretaria.redigir');
        return ok(route, {
          minute: d, meeting: { id: m.id, title: m.title, kind: m.kind, status: m.status, starts_at: m.starts_at }, test: true,
          version: { ...v, frozen: !!v.frozen_at, submitted_by_name: v.frozen_at ? 'Ana Dirigente Teste' : null, approved_by_name: nameOf(v.approved_by), created_by_name: nameOf(v.created_by), content: v.snapshot ?? content(d.id) },
          versions: S.versions.filter((x) => x.minute_id === d.id).sort((a, c) => c.version_no - a.version_no).map((x) => ({ ...x, created_by_name: nameOf(x.created_by), approved_by_name: nameOf(x.approved_by) })),
          parent: d.parent_id ? { id: d.parent_id, approved_version: 1 } : null,
          addenda: S.minutes.filter((x) => x.parent_id === d.id),
          items: S.items.filter((i) => i.minute_id === d.id).map(item),
          can_edit: draft && d.status === 'rascunho', can_submit: draft && d.status === 'rascunho', can_approve: d.status === 'em_aprovacao',
          can_return: d.status === 'em_aprovacao', can_revise: draft && d.status === 'aprovada' && d.kind === 'ata',
          can_addendum: draft && d.kind === 'ata' && !!d.approved_version, can_track: true,
        });
      }
      case 'sec_minute_save': {
        const d = S.minutes.find((x) => x.id === b.p_minute)!;
        if (d.status !== 'rascunho') return fail(route, 'Uma ata aprovada não pode ser alterada. Cria uma nova versão ou um aditamento.');
        Object.assign(S.versions.find((x) => x.minute_id === d.id && x.version_no === d.current_version)!, { body: b.p_body, updated_at: new Date().toISOString() });
        return ok(route, null);
      }
      case 'sec_minute_submit': {
        const d = S.minutes.find((x) => x.id === b.p_minute)!;
        Object.assign(S.versions.find((x) => x.minute_id === d.id && x.version_no === d.current_version)!, { frozen_at: now, snapshot: content(d.id) });
        d.status = 'em_aprovacao';
        return ok(route, null);
      }
      case 'sec_minute_approve': {
        const d = S.minutes.find((x) => x.id === b.p_minute)!;
        if (b.p_expected_version !== d.current_version) return fail(route, 'A ata mudou entretanto. Atualiza a página.');
        Object.assign(S.versions.find((x) => x.minute_id === d.id && x.version_no === d.current_version)!, { approved_at: now, approved_by: 'u-ana' });
        Object.assign(d, { status: 'aprovada', approved_version: d.current_version });
        return ok(route, null);
      }
      case 'sec_minute_revise': {
        const d = S.minutes.find((x) => x.id === b.p_minute)!;
        const v = S.versions.find((x) => x.minute_id === d.id && x.version_no === d.current_version)!;
        S.versions.push({ ...v, version_no: d.current_version + 1, note: `Correção: ${b.p_reason}`, frozen_at: null, approved_at: null, approved_by: null, snapshot: null, created_by: 'u-ana' });
        Object.assign(d, { status: 'rascunho', current_version: d.current_version + 1 });
        return ok(route, d.current_version);
      }
      case 'sec_item_save': {
        const d = S.minutes.find((x) => x.id === b.p_minute)!;
        const id = `it${S.items.length + 1}`;
        S.items.push({ id, minute_id: d.id, meeting_id: d.meeting_id, kind: b.p_kind, text: b.p_text, responsible_id: b.p_responsible, due_date: b.p_due, reminder_days: b.p_reminder_days, exec_status: 'por_fazer', status_note: null, trail_request_id: null, stage_path_id: null });
        return ok(route, id);
      }
      case 'sec_item_set_status': {
        Object.assign(S.items.find((i) => i.id === b.p_item)!, { exec_status: b.p_status });
        return ok(route, null);
      }
      case 'sec_my_tasks': return ok(route, S.items.filter((i) => i.responsible_id === 'u-ana').map((i) => ({ ...item(i), meeting_title: 'Reunião', meeting_id: i.meeting_id })));
      default: return route.fallback();
    }
  });
  return S;
}

test('lista de reuniões: pesquisa e filtro no endereço, ajuda sobre visibilidade', async ({ page }) => {
  await installMock(page, leader());
  await installSec(page);
  if (isMobile(page)) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/secretaria');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Secretaria', level: 1 })).toBeVisible();
  await expect(main.getByText('Ambiente de teste.')).toBeVisible();
  await expect(main.getByRole('link', { name: /Reunião de equipa de outubro/ })).toContainText('Aprovada');
  await expect(main.getByRole('link', { name: /Reunião de equipa de outubro/ })).toContainText('10/10/2026');
  await main.getByLabel('Filtrar por tipo').selectOption('animacao');
  await expect(page).toHaveURL(/tipo=animacao/);
  await expect(main.getByText('Nenhuma reunião corresponde à pesquisa.')).toBeVisible();
  await main.getByLabel('Filtrar por tipo').selectOption('');
  await main.getByPlaceholder(/Pesquisar/).fill('outubro');
  await expect(page).toHaveURL(/q=outubro/);
  await main.getByRole('link', { name: /Reunião de equipa de outubro/ }).click();
  await expect(main.getByRole('heading', { name: 'Reunião de equipa de outubro' })).toBeVisible();
  await page.goBack();
  await expect(main.getByPlaceholder(/Pesquisar/)).toHaveValue('outubro');
  await main.getByText('Quem vê cada reunião').click();
  await expect(main).toContainText('Equipa de Animação: só os dirigentes autorizados');
  await noHorizontalScroll(page);
});

test('criar reunião e ata, tarefa, enviar, aprovar, corrigir com nova versão e imprimir', async ({ page }, info) => {
  await installMock(page, leader());
  const S = await installSec(page);
  if (isMobile(page)) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/secretaria');
  const main = page.locator('main');
  await main.getByRole('link', { name: 'Nova reunião' }).click();
  // Validação clara
  await main.getByRole('button', { name: 'Criar reunião' }).click();
  await expect(main.getByText('Escolhe o tipo de reunião.')).toBeVisible();
  await main.getByLabel('Tipo').selectOption('equipa');
  await expect(main.getByText('Veem: os membros dessa equipa e os dirigentes autorizados.')).toBeVisible();
  await main.getByLabel('Equipa', { exact: true }).selectOption('teamA');
  await main.getByLabel('Título').fill('Conselho de novembro');
  await main.getByLabel('Data e hora').fill('2026-11-07T15:00');
  await main.getByLabel('Ordem de trabalhos').fill('1. Atividade de Natal\n2. Quotas');
  await main.getByLabel('Atividade do calendário (opcional)').selectOption('ev1');
  await main.getByRole('group', { name: 'Participantes' }).getByLabel('Pedro Teste').check();
  await noHorizontalScroll(page);
  await main.getByRole('button', { name: 'Criar reunião' }).click();
  await expect(main.getByRole('heading', { name: 'Conselho de novembro' })).toBeVisible();
  await expect(main).toContainText('07/11/2026, 15:00');
  await expect(main).toContainText('Atividade: Acampamento de outono');
  await expect(main.getByRole('list').filter({ hasText: 'Pedro Teste' })).toBeVisible();

  await main.getByRole('button', { name: 'Criar ata' }).click();
  await expect(main.getByRole('heading', { name: /Ata · Conselho de novembro/ })).toBeVisible();
  await expect(main.getByText('Rascunho', { exact: true }).first()).toBeVisible();
  await main.getByLabel('Texto', { exact: true }).fill('Foi decidido organizar a atividade de Natal.');
  await main.getByRole('button', { name: 'Guardar texto' }).click();
  await expect(main.getByText('Texto guardado.')).toBeVisible();

  // Tarefa com responsável e prazo
  await main.getByRole('button', { name: 'Acrescentar' }).click();
  const form = main.getByRole('form', { name: 'Nova decisão ou tarefa' });
  await form.getByLabel('Tarefa').check();
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(form.getByText('Escolhe o responsável.')).toBeVisible();
  await form.getByLabel('Texto', { exact: true }).fill('Reservar a sede');
  await form.getByLabel('Responsável', { exact: true }).selectOption('u-ana');
  await form.getByLabel('Prazo').fill('2026-11-20');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.getByText('Registo acrescentado.')).toBeVisible();
  await expect(main.locator('.sec-item')).toContainText('Reservar a sede');
  await expect(main.locator('.sec-item')).toContainText('prazo 20/11/2026');

  await main.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await main.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(main.getByText('Enviada para aprovação.')).toBeVisible();
  await expect(main.getByText('Em aprovação').first()).toBeVisible();
  await expect(main.getByLabel('Texto', { exact: true })).toHaveCount(0);

  await main.getByRole('button', { name: 'Aprovar' }).click();
  await main.getByRole('button', { name: 'Aprovar versão 1' }).click();
  await expect(main.getByText('Ata aprovada.')).toBeVisible();
  await expect(main.getByText('Esta ata está aprovada e não pode ser alterada.', { exact: false })).toBeVisible();
  await page.screenshot({ path: `test-results/secretaria-ata-${info.project.name}.png`, fullPage: true });

  // Correção: nova versão; a aprovada continua consultável
  await main.getByRole('button', { name: 'Corrigir com nova versão' }).click();
  await main.getByRole('button', { name: 'Criar nova versão' }).click();
  await expect(main.getByText('Indica o motivo da correção.')).toBeVisible();
  await main.getByLabel('Motivo da correção').fill('Data errada');
  await main.getByRole('button', { name: 'Criar nova versão' }).click();
  await expect(main.getByText(/Nova versão criada em rascunho/)).toBeVisible();
  await expect(main).toContainText('versão aprovada em vigor: 1');
  const hist = main.getByRole('region', { name: 'Histórico de versões' });
  await expect(hist.getByRole('listitem')).toHaveCount(2);
  await expect(hist.getByRole('listitem').nth(1)).toContainText('Aprovada');
  await hist.getByRole('button', { name: 'Versão 1' }).click();
  await expect(page).toHaveURL(/versao=1/);
  await expect(main.getByText('Estás a ver a versão 1, aprovada.', { exact: false })).toBeVisible();
  await expect(main.locator('.sec-body')).toHaveText('Foi decidido organizar a atividade de Natal.');
  expect(S.versions.filter((v) => v.approved_at)).toHaveLength(2); // a de outubro + a nova v1

  // Impressão da versão aprovada
  await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await main.getByRole('link', { name: /Imprimir \/ PDF/ }).click();
  await expect(page).toHaveURL(/imprimir\?versao=1/);
  const doc = page.getByRole('article', { name: 'Documento para imprimir' });
  await expect(doc).toContainText('Ambiente de teste — documento sem valor real');
  await expect(doc).toContainText('Versão 1 · Aprovada em');
  await expect(doc).toContainText('Reservar a sede — Ana Dirigente Teste, prazo 20/11/2026');
  await expect(doc).toContainText('1. Atividade de Natal');
  await page.evaluate(() => { window.print = () => { (window as any).__printed++; }; });
  await page.getByRole('button', { name: 'Imprimir ou guardar em PDF' }).click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
  // Em modo de impressão, só o documento aparece
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Imprimir ou guardar em PDF' })).toBeHidden();
  await expect(doc).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await noHorizontalScroll(page);

  // As minhas tarefas
  await page.goto('/secretaria/tarefas');
  await expect(main.getByText('Reservar a sede')).toBeVisible();
  await main.getByLabel(/Estado: Reservar/).selectOption('feita');
  await expect(main.getByText('Estado atualizado.')).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Concluídas ou canceladas' })).toBeVisible();
  await noHorizontalScroll(page);
});

test('só consulta: sem botões de redação; a ata aprovada mostra-se fechada', async ({ page }) => {
  await installMock(page, leader());
  await installSec(page, { grants: [], dirigente: false });
  await page.goto('/secretaria');
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: /Reunião de equipa de outubro/ })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Nova reunião' })).toHaveCount(0);
  await main.getByRole('link', { name: /Reunião de equipa de outubro/ }).click();
  await expect(main.getByRole('link', { name: 'Alterar reunião' })).toHaveCount(0);
  await main.getByRole('link', { name: /^Ata/ }).click();
  await expect(main.locator('.sec-body')).toHaveText('Texto aprovado da ata de outubro.');
  await expect(main.getByRole('button', { name: /Corrigir|Aprovar|Enviar/ })).toHaveCount(0);
  await expect(main.locator('textarea')).toHaveCount(0);
});

test('sem acesso ao módulo: só a página «Em desenvolvimento»', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto('/secretaria');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Secretaria', level: 1 })).toBeVisible();
  await expect(main.getByText('Em desenvolvimento')).toBeVisible();
  await expect(main.locator('form, button, input')).toHaveCount(0);
});
