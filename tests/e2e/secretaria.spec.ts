// Reuniões e tarefas (interface): nome novo e caminho /reunioes-e-tarefas, lista com pesquisa e
// filtros, reunião e ata, sumário (preparar a partir da ata → rever → publicar), quadro de tarefas
// com atrasos, «O que me diz respeito», telemóvel e computador. API simulada; as regras do
// servidor estão em tests/db/secretaria.test.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { CAPTURAS, THEMES, shoot } from './capturas-util';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;
const now = new Date().toISOString();
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 960;
const BASE = '/reunioes-e-tarefas';
const PEOPLE = [
  { id: 'u-ana', name: 'Ana Dirigente Teste', team_id: null, function: 'dirigente' },
  { id: 'u-guia', name: 'Guia Teste', team_id: 'teamA', function: 'guia' },
  { id: 'u-p1', name: 'Pedro Teste', team_id: 'teamA', function: 'pioneiro' },
];
const TEAMS = [{ id: 'teamA', name: 'Equipa Andorinha' }, { id: 'teamB', name: 'Equipa Bússola' }];
const EVENTS = [{ id: 'ev1', title: 'Acampamento de outono', starts_at: '2026-10-24T08:00:00.000Z', all_day: false, status: 'ativo' }];
const nameOf = (id: string | null) => PEOPLE.find((p) => p.id === id)?.name ?? null;
const teamOf = (id: string | null) => TEAMS.find((t) => t.id === id)?.name ?? null;
const eventOf = (id: string | null) => EVENTS.find((e) => e.id === id) ?? null;
const today = new Date().toISOString().slice(0, 10);

async function noHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `deslocamento horizontal a ${width}px`).toBeLessThanOrEqual(1);
}

/** API simulada do módulo, com estado (só para teste). */
async function installSec(page: Page, opts: { grants?: string[]; dirigente?: boolean; mine?: Row[] } = {}) {
  const grants = opts.grants ?? ['secretaria.redigir', 'secretaria.aprovar'];
  const draft = grants.includes('secretaria.redigir');
  const approve = grants.includes('secretaria.aprovar') || (opts.dirigente ?? true);
  const S = {
    meetings: [{ id: 'mt1', kind: 'equipa', team_id: 'teamA', team_name: 'Equipa Andorinha', title: 'Reunião de equipa de outubro', starts_at: '2026-10-10T17:30:00.000Z', location: 'Sede', agenda: '1. Raide\n2. Material', status: 'ativa', cancel_reason: null, cal_event_id: 'ev1', created_by: 'u-guia' }] as Row[],
    participants: { mt1: ['u-p1', 'u-guia'] } as Record<string, string[]>,
    minutes: [{ id: 'at1', meeting_id: 'mt1', kind: 'ata', parent_id: null, status: 'aprovada', current_version: 1, approved_version: 1, created_at: now }] as Row[],
    versions: [{ minute_id: 'at1', version_no: 1, body: 'Texto aprovado da ata de outubro.', note: null, frozen_at: now, approved_at: now, approved_by: 'u-ana', created_by: 'u-guia', created_at: now, updated_at: now, snapshot: null }] as Row[],
    items: [
      { id: 'i1', minute_id: 'at1', meeting_id: 'mt1', kind: 'decisao', text: 'Fazer o raide em novembro', responsible_id: null, responsible_team_id: null, due_date: null, cal_event_id: null, exec_status: 'por_fazer' },
      { id: 'i2', minute_id: 'at1', meeting_id: 'mt1', kind: 'tarefa', text: 'Reservar o parque de campismo', responsible_id: 'u-p1', responsible_team_id: null, due_date: '2020-01-10', cal_event_id: 'ev1', exec_status: 'por_fazer' },
      { id: 'i3', minute_id: 'at1', meeting_id: 'mt1', kind: 'tarefa', text: 'Comprar mapas', responsible_id: null, responsible_team_id: null, due_date: null, cal_event_id: null, exec_status: 'em_curso' },
      { id: 'i4', minute_id: 'at1', meeting_id: 'mt1', kind: 'preparar', text: 'Levar tendas', responsible_id: null, responsible_team_id: 'teamA', due_date: '2030-10-20', cal_event_id: 'ev1', exec_status: 'concluida' },
    ] as Row[],
    summaries: [] as Row[],
    summaryVersions: [] as Row[],
    history: { i2: [{ field: 'criada', from: null, to: 'Tarefa', note: 'Ata em rascunho.', by: 'Guia Teste', at: now }] } as Record<string, Row[]>,
  };
  const content = (minuteId: string) => {
    const d = S.minutes.find((x) => x.id === minuteId)!;
    const m = S.meetings.find((x) => x.id === d.meeting_id)!;
    return { title: m.title, kind: m.kind, team_name: m.team_name ?? null, starts_at: m.starts_at, location: m.location, agenda: m.agenda,
      cal_event_title: eventOf(m.cal_event_id)?.title ?? null, participants: (S.participants[m.id] ?? []).map(nameOf),
      items: S.items.filter((i) => i.minute_id === minuteId).map((i) => ({ kind: i.kind, text: i.text, responsible_name: nameOf(i.responsible_id), team_name: teamOf(i.responsible_team_id), due_date: i.due_date, event_title: eventOf(i.cal_event_id)?.title ?? null, link_label: null })) };
  };
  const item = (i: Row) => ({ reminder_days: 2, status_note: null, trail_request_id: null, stage_path_id: null, completed_at: null, ...i,
    responsible_name: nameOf(i.responsible_id), team_name: teamOf(i.responsible_team_id), cal_event: eventOf(i.cal_event_id), link_label: null,
    overdue: i.kind !== 'decisao' && ['por_fazer', 'em_curso'].includes(i.exec_status) && !!i.due_date && i.due_date < today });
  const enrich = (e: Row) => ({ ...e, responsible_name: nameOf(e.responsible_id), team_name: teamOf(e.team_id), cal_event: eventOf(e.cal_event_id) });
  const ok = (route: Route, v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  const fail = (route: Route, message: string) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message }) });

  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const b = route.request().postDataJSON?.() ?? {};
    switch (fn) {
      case 'my_modules':
        return ok(route, ['calendario', 'equipas', 'inventario', 'presencas', 'secretaria', 'tesouraria'].map((k) => k === 'secretaria'
          ? { module: k, status: 'teste', space: 'teste', grants, dirigente: opts.dirigente ?? true }
          : { module: k, status: 'desenvolvimento', space: null, grants: [], dirigente: true }));
      case 'sec_people': return ok(route, { people: PEOPLE, teams: TEAMS });
      case 'sec_event_options': return ok(route, EVENTS);
      case 'sec_link_options': return ok(route, { requests: [], stages: [] });
      case 'module_files_of': return ok(route, []);
      case 'sec_meetings': {
        const q = String(b.p_search ?? '').toLowerCase();
        const day = (iso: string) => iso.slice(0, 10);
        return ok(route, { can_draft: draft, can_approve: approve, teams: TEAMS, events: EVENTS,
          meetings: S.meetings.filter((m) => (!b.p_kind || m.kind === b.p_kind) && (!b.p_team || m.team_id === b.p_team)
              && (!b.p_event || m.cal_event_id === b.p_event) && (!b.p_from || day(m.starts_at) >= b.p_from) && (!b.p_to || day(m.starts_at) <= b.p_to)
              && (!q || m.title.toLowerCase().includes(q)))
            .map((m) => ({ ...m, cal_event: eventOf(m.cal_event_id), ata: S.minutes.find((x) => x.meeting_id === m.id && x.kind === 'ata') ?? null,
              summary: S.summaries.find((s) => s.meeting_id === m.id) ?? null,
              decisions: S.items.filter((i) => i.meeting_id === m.id && i.kind === 'decisao').length,
              open_tasks: S.items.filter((i) => i.meeting_id === m.id && i.kind !== 'decisao' && ['por_fazer', 'em_curso'].includes(i.exec_status)).length })) });
      }
      case 'sec_meeting_save': {
        if (!String(b.p_title ?? '').trim()) return fail(route, 'Indica o título.');
        const id = b.p_meeting ?? `mt${S.meetings.length + 1}`;
        const row = { id, kind: b.p_kind, team_id: b.p_team, team_name: teamOf(b.p_team), title: b.p_title, starts_at: b.p_starts_at, location: b.p_location, agenda: b.p_agenda, status: 'ativa', cancel_reason: null, cal_event_id: b.p_cal_event, created_by: 'u-ana' };
        S.meetings = [row, ...S.meetings.filter((m) => m.id !== id)];
        S.participants[id] = b.p_participants;
        return ok(route, id);
      }
      case 'sec_meeting': {
        const m = S.meetings.find((x) => x.id === b.p_meeting);
        if (!m) return fail(route, 'Registo não encontrado.');
        return ok(route, { meeting: { ...m, created_by_name: 'Ana', cal_event: eventOf(m.cal_event_id) },
          participants: (S.participants[m.id] ?? []).map((id) => ({ id, name: nameOf(id) })), shares: [],
          minutes: S.minutes.filter((x) => x.meeting_id === m.id), summary: S.summaries.find((s) => s.meeting_id === m.id) ?? null,
          items: S.items.filter((i) => i.meeting_id === m.id).map(item), can_draft: draft, can_approve: approve, can_manage: draft || approve });
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
        return ok(route, {
          minute: d, meeting: { id: m.id, title: m.title, kind: m.kind, status: m.status, starts_at: m.starts_at }, test: true,
          version: { ...v, frozen: !!v.frozen_at, submitted_by_name: v.frozen_at ? 'Ana Dirigente Teste' : null, approved_by_name: nameOf(v.approved_by), created_by_name: nameOf(v.created_by), content: v.snapshot ?? content(d.id) },
          versions: S.versions.filter((x) => x.minute_id === d.id).sort((a, c) => c.version_no - a.version_no).map((x) => ({ ...x, created_by_name: nameOf(x.created_by), approved_by_name: nameOf(x.approved_by) })),
          parent: d.parent_id ? { id: d.parent_id, approved_version: 1 } : null,
          addenda: S.minutes.filter((x) => x.parent_id === d.id),
          items: S.items.filter((i) => i.minute_id === d.id).map(item),
          can_edit: draft && d.status === 'rascunho', can_submit: draft && d.status === 'rascunho', can_approve: approve && d.status === 'em_aprovacao',
          can_return: d.status === 'em_aprovacao', can_revise: draft && d.status === 'aprovada' && d.kind === 'ata',
          can_addendum: draft && d.kind === 'ata' && !!d.approved_version, can_track: draft || approve,
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
        S.items.push({ id, minute_id: d.id, meeting_id: d.meeting_id, kind: b.p_kind, text: b.p_text, responsible_id: b.p_responsible, responsible_team_id: b.p_team, due_date: b.p_due, cal_event_id: b.p_event, reminder_days: b.p_reminder_days, exec_status: 'por_fazer' });
        return ok(route, id);
      }
      case 'sec_item_set_status': {
        const i = S.items.find((x) => x.id === b.p_item)!;
        (S.history[i.id] ??= []).unshift({ field: 'estado', from: i.exec_status, to: b.p_status, note: b.p_note, by: 'Ana Dirigente Teste', at: new Date().toISOString() });
        i.exec_status = b.p_status;
        return ok(route, null);
      }
      case 'sec_board': {
        const tasks = S.items.filter((i) => i.kind !== 'decisao' && (b.p_archived ? i.exec_status === 'cancelada' : i.exec_status !== 'cancelada')
          && (!b.p_responsible || i.responsible_id === b.p_responsible) && (!b.p_event || i.cal_event_id === b.p_event)
          && (!b.p_team || i.responsible_team_id === b.p_team || PEOPLE.find((p) => p.id === i.responsible_id)?.team_id === b.p_team))
          .map((i) => ({ ...item(i), meeting_title: S.meetings.find((m) => m.id === i.meeting_id)!.title, meeting_starts_at: now, minute_kind: 'ata', can_manage: draft || approve, can_status: true }));
        return ok(route, { can_manage: draft || approve, tasks, events: EVENTS });
      }
      case 'sec_task': {
        const i = S.items.find((x) => x.id === b.p_item);
        if (!i) return fail(route, 'Registo não encontrado.');
        const m = S.meetings.find((x) => x.id === i.meeting_id)!;
        return ok(route, { limited: false, task: item(i), published_text: null, meeting: { id: m.id, title: m.title, kind: m.kind, starts_at: m.starts_at, status: m.status },
          minute: { id: i.minute_id, kind: 'ata', status: 'aprovada' }, can_manage: draft || approve, can_status: true,
          history: (S.history[i.id] ?? []).map((h) => ({ ...h, from: h.field === 'estado' ? ({ por_fazer: 'Por fazer', em_curso: 'Em curso', concluida: 'Concluída' } as Row)[h.from] ?? h.from : h.from,
            to: h.field === 'estado' ? ({ por_fazer: 'Por fazer', em_curso: 'Em curso', concluida: 'Concluída' } as Row)[h.to] ?? h.to : h.to })) });
      }
      case 'sec_my_tasks': return ok(route, opts.mine ?? []);
      case 'sec_summary': {
        const m = S.meetings.find((x) => x.id === b.p_meeting)!;
        const s = S.summaries.find((x) => x.meeting_id === m.id) ?? null;
        const ata = S.minutes.find((x) => x.meeting_id === m.id && x.kind === 'ata') ?? null;
        const v = s ? S.summaryVersions.find((x) => x.summary_id === s.id && x.version_no === (b.p_version ?? s.current_version)) : null;
        return ok(route, {
          meeting: { id: m.id, title: m.title, kind: m.kind, starts_at: m.starts_at, status: m.status, team_name: m.team_name, cal_event: eventOf(m.cal_event_id) },
          ata: ata && { id: ata.id, status: ata.status, approved_version: ata.approved_version }, test: true, summary: s,
          version: v && { version_no: v.version_no, note: v.note, content: { entries: v.entries.map(enrich) }, published: !!v.published_at, published_at: v.published_at,
            published_by_name: v.published_at ? 'Ana Dirigente Teste' : null, created_by_name: 'Ana Dirigente Teste', created_at: now, updated_at: v.updated_at },
          versions: s ? S.summaryVersions.filter((x) => x.summary_id === s.id).map((x) => ({ version_no: x.version_no, note: x.note, created_at: now, created_by_name: 'Ana Dirigente Teste', published_at: x.published_at, published_by_name: x.published_at ? 'Ana Dirigente Teste' : null })).reverse() : [],
          missing_items: 0, item_status: Object.fromEntries(S.items.map((i) => [i.id, i.exec_status])),
          can_manage: draft || approve,
          can_prepare: (draft || approve) && !!ata && (!s || s.status === 'rascunho'),
          can_edit: (draft || approve) && !!s && s.status === 'rascunho' && !!v && v.version_no === s.current_version,
          can_publish: approve && !!s && s.status === 'rascunho' && !!ata?.approved_version,
          can_revise: (draft || approve) && !!s && s.status === 'publicado',
        });
      }
      case 'sec_summary_prepare': {
        if (S.summaries.some((s) => s.meeting_id === b.p_meeting)) return ok(route, S.summaries.find((s) => s.meeting_id === b.p_meeting)!.id);
        const id = `su${S.summaries.length + 1}`;
        S.summaries.push({ id, meeting_id: b.p_meeting, status: 'rascunho', current_version: 1, published_version: null });
        // Pré-preenchido só com o que está na ata (nada inventado).
        S.summaryVersions.push({ summary_id: id, version_no: 1, note: 'Preparado a partir da ata.', published_at: null, updated_at: now,
          entries: S.items.filter((i) => i.meeting_id === b.p_meeting).map((i) => ({ item_id: i.id, kind: i.kind, text: i.text,
            responsible_id: i.kind === 'decisao' ? null : i.responsible_id, team_id: i.kind === 'decisao' ? null : i.responsible_team_id,
            due_date: i.kind === 'decisao' ? null : i.due_date, cal_event_id: i.kind === 'decisao' ? null : i.cal_event_id, omitted: false })) });
        return ok(route, id);
      }
      case 'sec_summary_save': {
        const s = S.summaries.find((x) => x.id === b.p_summary)!;
        const v = S.summaryVersions.find((x) => x.summary_id === s.id && x.version_no === s.current_version)!;
        v.entries = (b.p_entries as Row[]).map(({ item_id, kind, text, responsible_id, team_id, due_date, cal_event_id, omitted }) => ({ item_id, kind, text: text.trim(), responsible_id, team_id, due_date, cal_event_id, omitted }));
        v.updated_at = new Date().toISOString();
        return ok(route, null);
      }
      case 'sec_summary_publish': {
        const s = S.summaries.find((x) => x.id === b.p_summary)!;
        const v = S.summaryVersions.find((x) => x.summary_id === s.id && x.version_no === s.current_version)!;
        v.published_at = new Date().toISOString();
        Object.assign(s, { status: 'publicado', published_version: s.current_version });
        return ok(route, null);
      }
      default: return route.fallback();
    }
  });
  return S;
}

test('nome novo, caminho novo e lista com pesquisa e filtros no endereço', async ({ page }) => {
  await installMock(page, leader());
  await installSec(page);
  if (isMobile(page)) await page.setViewportSize({ width: 390, height: 844 });
  // O endereço antigo continua a funcionar
  await page.goto('/secretaria');
  await expect(page).toHaveURL(new RegExp(`${BASE}$`));
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Reuniões e tarefas', level: 1 })).toBeVisible();
  await expect(main.getByText('Secretaria')).toHaveCount(0);
  await expect(main.locator('h1 .page-tag')).toContainText('Em teste');
  const tabs = main.getByRole('navigation', { name: 'Reuniões e tarefas' });
  await expect(tabs.getByRole('link')).toHaveText([/^\s*Atas$/, /^\s*Tarefas$/, /O que me diz respeito/]);
  await expect(main.locator('.page-head .lead')).toHaveCount(0);
  // Resumo curto: título, data e hora, tipo e equipa, estado da ata e tarefas abertas
  const row = main.getByRole('link', { name: /Reunião de equipa de outubro/ });
  await expect(row).toContainText('Aprovada');
  await expect(row).toContainText('10/10/2026 · 18:30');
  await expect(row).toContainText('Reunião de Equipa · Equipa Andorinha');
  await expect(row).toContainText('2 tarefas abertas');
  // No telemóvel os filtros ficam atrás do botão «Filtros»
  if (isMobile(page)) {
    await expect(main.getByLabel('Filtrar por equipa')).toBeHidden();
    await main.getByRole('button', { name: 'Filtros' }).click();
  }
  await main.getByLabel('Filtrar por equipa').selectOption('teamB');
  await expect(page).toHaveURL(/equipa=teamB/);
  await expect(main.getByText('Nenhuma reunião corresponde à pesquisa.')).toBeVisible();
  await main.getByLabel('Filtrar por equipa').selectOption('');
  await main.getByLabel('Filtrar por atividade').selectOption('ev1');
  await expect(page).toHaveURL(/atividade=ev1/);
  await main.getByLabel('Desde a data').fill('2026-10-01');
  await main.getByLabel('Até à data').fill('2026-10-31');
  await expect(page).toHaveURL(/de=2026-10-01/);
  await expect(page).toHaveURL(/ate=2026-10-31/);
  await main.getByPlaceholder(/Pesquisar/).fill('outubro');
  await expect(page).toHaveURL(/q=outubro/);
  await expect(row).toBeVisible();
  await row.click();
  await expect(main.getByRole('heading', { name: 'Reunião de equipa de outubro' })).toBeVisible();
  await expect(main).toContainText('Assuntos (ordem de trabalhos)');
  // A página da reunião abre o detalhe: atividade e decisões
  await expect(main).toContainText('Atividade: Acampamento de outono');
  await expect(main.getByRole('region', { name: 'Decisões, tarefas e preparativos' })).toContainText('Fazer o raide em novembro');
  await page.goBack();
  await expect(main.getByPlaceholder(/Pesquisar/)).toHaveValue('outubro');
  await expect(main.getByLabel('Filtrar por atividade')).toHaveValue('ev1');
  await main.getByText('Mais informação').click();
  await expect(main.getByText('Quem vê cada reunião')).toBeVisible();
  await expect(main).toContainText('Equipa de Animação: só os dirigentes autorizados');
  await noHorizontalScroll(page);
});

test('criar reunião e ata, registos por definir, aprovar, corrigir com nova versão e imprimir', async ({ page }, info) => {
  await installMock(page, leader());
  const S = await installSec(page);
  if (isMobile(page)) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  const main = page.locator('main');
  await expect(main.locator('.page-actions').getByRole('link', { name: 'Nova reunião' })).toBeVisible();
  await main.getByRole('link', { name: 'Nova reunião' }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/nova$`));
  await main.getByRole('button', { name: 'Criar reunião' }).click();
  await expect(main.getByText('Escolhe o tipo de reunião.')).toBeVisible();
  await main.getByLabel('Tipo').selectOption('equipa');
  await expect(main.getByText('Veem: os membros dessa equipa e os dirigentes autorizados.')).toBeVisible();
  await main.getByLabel('Equipa', { exact: true }).selectOption('teamA');
  await main.getByLabel('Título').fill('Conselho de novembro');
  await main.getByLabel('Data e hora').fill('2026-11-07T15:00');
  await main.getByLabel('Assuntos (ordem de trabalhos)').fill('1. Atividade de Natal\n2. Quotas');
  await main.getByLabel('Atividade relacionada (opcional)').selectOption('ev1');
  await main.getByRole('group', { name: 'Participantes' }).getByLabel('Pedro Teste').check();
  await noHorizontalScroll(page);
  await main.getByRole('button', { name: 'Criar reunião' }).click();
  await expect(main.getByRole('heading', { name: 'Conselho de novembro' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${BASE}/reunioes/`));
  await expect(main).toContainText('07/11/2026 · 15:00');
  await expect(main).toContainText('Atividade: Acampamento de outono');

  await main.getByRole('button', { name: 'Criar ata' }).click();
  await expect(main.getByRole('heading', { name: /Ata · Conselho de novembro/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${BASE}/atas/`));
  await main.getByLabel('Texto', { exact: true }).fill('Foi decidido organizar a atividade de Natal.');
  await main.getByRole('button', { name: 'Guardar texto' }).click();
  await expect(main.getByText('Texto guardado.')).toBeVisible();

  // Tarefa sem responsável nem prazo: aceite, fica «Por definir»
  await main.getByRole('button', { name: 'Acrescentar' }).click();
  let form = main.getByRole('form', { name: 'Novo registo da ata' });
  await form.getByLabel('Tarefa').check();
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(form.getByText('Escreve a decisão, a tarefa ou o preparativo.')).toBeVisible();
  await form.getByLabel('Texto', { exact: true }).fill('Comprar enfeites');
  await expect(form.getByLabel('Responsável', { exact: true })).toHaveValue('');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.getByText('Registo acrescentado.')).toBeVisible();
  const tasks = main.locator('.sec-item').filter({ hasText: 'Comprar enfeites' });
  await expect(tasks).toContainText('Responsável por definir');
  await expect(tasks).toContainText('Prazo por definir');
  // Tarefa com responsável e prazo
  await main.getByRole('button', { name: 'Acrescentar' }).click();
  form = main.getByRole('form', { name: 'Novo registo da ata' });
  await form.getByLabel('Tarefa').check();
  await form.getByLabel('Texto', { exact: true }).fill('Reservar a sede');
  await form.getByLabel('Responsável', { exact: true }).selectOption('u-ana');
  await form.getByLabel('Prazo').fill('2026-11-20');
  await expect(form.getByLabel('Atividade associada')).toHaveValue('');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.locator('.sec-item').filter({ hasText: 'Reservar a sede' })).toContainText('Prazo 20/11/2026');
  // Preparativo para a próxima atividade, da equipa
  await main.getByRole('button', { name: 'Acrescentar' }).click();
  form = main.getByRole('form', { name: 'Novo registo da ata' });
  await form.getByLabel('A preparar para a próxima atividade').check();
  await form.getByLabel('Texto', { exact: true }).fill('Levar a caixa de primeiros socorros');
  await form.getByLabel('Equipa responsável').selectOption('teamA');
  await form.getByLabel('Atividade associada').selectOption('ev1');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(main.getByRole('heading', { name: 'A preparar para a próxima atividade' })).toBeVisible();
  expect(S.items.at(-1)).toMatchObject({ kind: 'preparar', responsible_team_id: 'teamA', cal_event_id: 'ev1', responsible_id: null, due_date: null });

  await main.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await main.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(main.getByText('Enviada para aprovação.')).toBeVisible();
  await main.getByRole('button', { name: 'Aprovar' }).click();
  await main.getByRole('button', { name: 'Aprovar versão 1' }).click();
  await expect(main.getByText('Ata aprovada.')).toBeVisible();
  await page.screenshot({ path: `test-results/reunioes-ata-${info.project.name}.png`, fullPage: true });

  await expect(main.getByRole('button', { name: 'Corrigir com nova versão' })).toBeHidden();
  await main.getByRole('button', { name: 'Mais ações' }).click();
  await expect(main.getByRole('button', { name: 'Criar aditamento' })).toBeVisible();
  await main.getByRole('button', { name: 'Corrigir com nova versão' }).click();
  await main.getByRole('button', { name: 'Criar nova versão' }).click();
  await expect(main.getByText('Indica o motivo da correção.')).toBeVisible();
  await main.getByLabel('Motivo da correção').fill('Data errada');
  await main.getByRole('button', { name: 'Criar nova versão' }).click();
  await expect(main).toContainText('versão aprovada em vigor: 1');
  const hist = main.getByRole('region', { name: 'Histórico de versões' });
  await hist.getByRole('button', { name: 'Versão 1' }).click();
  await expect(page).toHaveURL(/versao=1/);

  await page.evaluate(() => { (window as any).__printed = 0; });
  await main.getByRole('link', { name: /Imprimir \/ PDF/ }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/atas/.+/imprimir\\?versao=1`));
  const doc = page.getByRole('article', { name: 'Documento para imprimir' });
  await expect(doc).toContainText('Ambiente de teste — documento sem valor real');
  await expect(doc).toContainText('Reservar a sede — Ana Dirigente Teste, prazo 20/11/2026');
  await expect(doc).toContainText('Comprar enfeites — responsável por definir, prazo por definir');
  await expect(doc).toContainText('Preparativo: Levar a caixa de primeiros socorros — Equipa Andorinha');
  await expect(doc).toContainText('Atividade relacionada: Acampamento de outono');
  await page.evaluate(() => { window.print = () => { (window as any).__printed++; }; });
  await page.getByRole('button', { name: 'Imprimir ou guardar em PDF' }).click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
  await noHorizontalScroll(page);
});

test('ata → sumário pré-preenchido (sem inventar) → rever → publicar', async ({ page }, info) => {
  await installMock(page, leader());
  const S = await installSec(page);
  if (isMobile(page)) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/reunioes/mt1`);
  const main = page.locator('main');
  await main.getByRole('link', { name: 'Preparar sumário' }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/reunioes/mt1/sumario$`));
  await expect(main.getByText('Nada é inventado', { exact: false })).toBeVisible();
  await main.getByRole('button', { name: 'Preparar sumário a partir da ata' }).click();
  await expect(main.getByText(/Rascunho do sumário preparado a partir da ata/)).toBeVisible();
  await expect(main.getByText('Em revisão')).toBeVisible();
  // Pré-preenchido com o que consta da ata; o que falta fica «Por definir»
  const decided = main.getByRole('region', { name: 'O que ficou decidido' });
  await expect(decided.getByLabel('Decisão')).toHaveValue('Fazer o raide em novembro');
  const next = main.getByRole('region', { name: 'Próximas tarefas' });
  const entries = next.getByRole('listitem');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0).getByLabel('Responsável', { exact: true })).toHaveValue('u-p1');
  await expect(entries.nth(0).getByLabel('Prazo')).toHaveValue('10/01/2020');
  await expect(entries.nth(1).getByLabel('Tarefa')).toHaveValue('Comprar mapas');
  await expect(entries.nth(1).getByLabel('Responsável', { exact: true })).toHaveValue('');
  await expect(entries.nth(1).getByLabel('Responsável', { exact: true }).locator('option:checked')).toHaveText('Por definir');
  await expect(entries.nth(1).getByLabel('Prazo')).toHaveValue('');
  const prep = main.getByRole('region', { name: 'A preparar para a próxima atividade' });
  await expect(prep.getByLabel('Equipa responsável')).toHaveValue('teamA');
  // Revisão: título sem conteúdo reservado; um ponto omitido
  await entries.nth(0).getByLabel('Tarefa').fill('Tratar do local do acampamento');
  await entries.nth(1).getByLabel('Não incluir no sumário').check();
  // Não se publica com alterações por guardar
  await expect(main.getByRole('button', { name: 'Publicar sumário' })).toBeDisabled();
  await expect(main.getByText('Tens alterações por guardar.')).toBeVisible();
  await main.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(main.getByText('Rascunho guardado.')).toBeVisible();
  expect(S.summaryVersions[0].entries[1]).toMatchObject({ text: 'Tratar do local do acampamento', responsible_id: 'u-p1' });
  expect(S.summaryVersions[0].entries[2]).toMatchObject({ omitted: true, responsible_id: null, due_date: null });
  await noHorizontalScroll(page);
  await expect(main.getByRole('button', { name: 'Publicar sumário' })).toBeEnabled();
  await main.getByRole('button', { name: 'Publicar sumário' }).click();
  await main.getByRole('button', { name: 'Publicar versão 1' }).click();
  await expect(main.getByText('Sumário publicado. Os destinatários foram avisados na aplicação.')).toBeVisible();
  await expect(main.getByText('Publicado', { exact: true }).first()).toBeVisible();
  await expect(main.getByText(/Publicado em .* por Ana Dirigente Teste/)).toBeVisible();
  const tasksView = main.getByRole('region', { name: 'Próximas tarefas' });
  await expect(tasksView).toContainText('Tratar do local do acampamento');
  await expect(tasksView).not.toContainText('Comprar mapas');
  await expect(main.getByRole('region', { name: 'A preparar para a próxima atividade' })).toContainText('Equipa Andorinha');
  await expect(main.getByRole('button', { name: 'Rever com nova versão' })).toBeVisible();
  await expect(main.locator('textarea')).toHaveCount(0);
  await page.screenshot({ path: `test-results/reunioes-sumario-${info.project.name}.png`, fullPage: true });
  await noHorizontalScroll(page);
});

test('quadro de tarefas: colunas, atraso, filtros no endereço, estado e histórico', async ({ page }, info) => {
  await installMock(page, leader());
  const S = await installSec(page);
  if (isMobile(page)) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/tarefas`);
  const main = page.locator('main');
  const col = (name: string) => main.getByRole('region', { name: new RegExp(`^${name}`) });
  await expect(col('Por fazer')).toContainText('Reservar o parque de campismo');
  await expect(col('Em curso')).toContainText('Comprar mapas');
  await expect(col('Concluída')).toContainText('Levar tendas');
  await expect(main.getByText('1 tarefa em atraso.', { exact: false })).toBeVisible();
  const late = col('Por fazer').getByRole('listitem').filter({ hasText: 'Reservar o parque de campismo' });
  await expect(late).toContainText('Em atraso');
  await expect(late).toHaveClass(/is-overdue/);
  await expect(late).toContainText('Pedro Teste');
  await expect(late).toContainText('Prazo 10/01/2020');
  // Atraso discreto: sem fundo vermelho no cartão
  const lateBg = await late.evaluate((el) => getComputedStyle(el).backgroundColor);
  const cardBg = await col('Em curso').getByRole('listitem').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lateBg).toBe(cardBg);
  await expect(col('Em curso')).toContainText('Responsável por definir');
  await expect(col('Em curso')).toContainText('Prazo por definir');
  // Cartão curto: sem campos nem ligação à ata; abre a ficha da tarefa
  await expect(main.locator('.sec-board select')).toHaveCount(0);
  await expect(late.getByRole('link')).toHaveAttribute('href', `${BASE}/tarefas/i2`);
  // Três colunas lado a lado no computador; lista agrupada (uma por baixo da outra) no telemóvel
  const [a, b2] = [await col('Por fazer').boundingBox(), await col('Em curso').boundingBox()];
  if (isMobile(page)) expect(b2!.y).toBeGreaterThan(a!.y + a!.height - 1);
  else { expect(Math.abs(b2!.y - a!.y)).toBeLessThan(2); expect(b2!.x).toBeGreaterThan(a!.x + a!.width - 1); }
  await page.screenshot({ path: `test-results/reunioes-quadro-${info.project.name}.png`, fullPage: true });
  await noHorizontalScroll(page);

  // Filtros no endereço (no telemóvel, atrás do botão «Filtros»)
  if (isMobile(page)) await main.getByRole('button', { name: 'Filtros' }).click();
  await main.getByLabel('Filtrar por responsável').selectOption('u-p1');
  await expect(page).toHaveURL(/responsavel=u-p1/);
  await expect(main.getByText('Comprar mapas')).toHaveCount(0);
  await main.getByLabel('Filtrar por responsável').selectOption('');
  await main.getByLabel('Filtrar por atividade').selectOption('ev1');
  await expect(page).toHaveURL(/atividade=ev1/);
  await expect(main.getByText('Comprar mapas')).toHaveCount(0);
  await expect(main.getByText('Levar tendas')).toBeVisible();
  await main.getByLabel('Filtrar por atividade').selectOption('');

  // Selecionar a tarefa abre a ficha; mudar o estado aí move a tarefa de coluna
  await late.getByRole('link', { name: /Reservar o parque de campismo/ }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/tarefas/i2$`));
  await main.getByLabel(/Estado: Reservar/).selectOption('em_curso');
  await expect(main.getByText('Estado atualizado.')).toBeVisible();
  expect(S.items.find((i) => i.id === 'i2')!.exec_status).toBe('em_curso');

  // Ficha da tarefa com histórico e ligação à ata de origem
  const histRegion = main.getByRole('region', { name: 'Histórico de conclusão e alterações' });
  await expect(histRegion).toContainText('Estado: Por fazer → Em curso');
  await expect(histRegion).toContainText('Registada · Tarefa');
  await expect(main.getByRole('link', { name: 'Ata de origem' })).toHaveAttribute('href', `${BASE}/atas/at1`);
  // Alterar responsável e prazo só ao escolher a ação no menu «Mais»
  await expect(main.getByRole('form', { name: 'Alterar tarefa' })).toHaveCount(0);
  await main.getByRole('button', { name: 'Mais ações' }).click();
  await main.getByRole('button', { name: 'Alterar responsável e prazo' }).click();
  await expect(main.getByRole('form', { name: 'Alterar tarefa' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.goBack();
  await expect(col('Em curso')).toContainText('Reservar o parque de campismo');
});

test('«O que me diz respeito»: só título, prazo e atividade das tarefas do membro', async ({ page }, info) => {
  await installMock(page, pioneer());
  await installSec(page, { grants: [], dirigente: false, mine: [
    { id: 'm1', kind: 'tarefa', text: 'Tratar do transporte', due_date: '2020-02-01', exec_status: 'por_fazer', overdue: true, via: 'pessoal', team_name: null,
      cal_event: EVENTS[0], published: true, meeting_id: null, meeting_title: null },
    { id: 'm2', kind: 'preparar', text: 'Levar tendas', due_date: null, exec_status: 'em_curso', overdue: false, via: 'equipa', team_name: 'Equipa Andorinha',
      cal_event: null, published: true, meeting_id: null, meeting_title: null },
    { id: 'm3', kind: 'tarefa', text: 'Arrumar a sede', due_date: '2030-01-01', exec_status: 'concluida', overdue: false, via: 'pessoal', team_name: null,
      cal_event: null, published: false, meeting_id: 'mt1', meeting_title: 'Reunião de equipa de outubro' },
  ] });
  if (isMobile(page)) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/o-que-me-diz-respeito`);
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Reuniões e tarefas', level: 1 })).toBeVisible();
  const open = main.getByRole('region', { name: 'Por concluir' });
  await expect(open.getByRole('listitem')).toHaveCount(2);
  const first = open.getByRole('listitem').first();
  await expect(first).toContainText('Tratar do transporte');
  await expect(first).toContainText('Prazo 01/02/2020 (em atraso)');
  await expect(first).toContainText('Acampamento de outono');
  await expect(main.getByText('Tens 1 tarefa em atraso.')).toBeVisible();
  await expect(open.getByRole('listitem').nth(1)).toContainText('Prazo por definir');
  await expect(open.getByRole('listitem').nth(1)).toContainText('Da equipa Equipa Andorinha');
  // De reuniões reservadas, nenhuma ligação à reunião; da reunião que vê, sim
  await expect(open.getByRole('link', { name: /Reunião/ })).toHaveCount(0);
  await expect(main.getByRole('region', { name: 'Concluídas' }).getByRole('link', { name: 'Reunião de equipa de outubro' })).toBeVisible();
  await expect(main).toContainText('O conteúdo das atas continua reservado');
  // Sem permissões, não há ações de redação nem de quadro de gestão
  await expect(main.getByRole('link', { name: 'Nova reunião' })).toHaveCount(0);
  await page.screenshot({ path: `test-results/reunioes-mine-${info.project.name}.png`, fullPage: true });
  await noHorizontalScroll(page);
});

test('só consulta: sem botões de redação; a ata aprovada mostra-se fechada', async ({ page }) => {
  await installMock(page, leader());
  await installSec(page, { grants: [], dirigente: false });
  await page.goto(BASE);
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: /Reunião de equipa de outubro/ })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Nova reunião' })).toHaveCount(0);
  await main.getByRole('link', { name: /Reunião de equipa de outubro/ }).click();
  await expect(main.getByRole('link', { name: 'Alterar reunião' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Mais ações' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'Preparar sumário' })).toHaveCount(0);
  await main.getByRole('link', { name: /^Ata/ }).click();
  await expect(main.locator('.sec-body')).toHaveText('Texto aprovado da ata de outubro.');
  await expect(main.getByRole('button', { name: /Corrigir|Aprovar|Enviar|aditamento|Voltar a rascunho/ })).toHaveCount(0);
  await expect(main.locator('textarea')).toHaveCount(0);
});

test('sem acesso ao módulo: só a página «Em desenvolvimento», com o nome novo', async ({ page }) => {
  await installMock(page, pioneer());
  await page.goto(BASE);
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Reuniões e tarefas', level: 1 })).toBeVisible();
  await expect(main.getByText('Em desenvolvimento')).toBeVisible();
  await expect(main.locator('form, button, input')).toHaveCount(0);
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`reuniões e tarefas ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      await installSec(page);
      await page.goto(BASE);
      await shoot(page, info, theme, 'reunioes-lista');
      await page.goto(`${BASE}/reunioes/mt1`);
      await shoot(page, info, theme, 'reunioes-reuniao');
      await page.goto(`${BASE}/atas/at1`);
      await shoot(page, info, theme, 'reunioes-ata');
      await page.goto(`${BASE}/tarefas`);
      await shoot(page, info, theme, 'reunioes-tarefas');
      await page.goto(`${BASE}/tarefas/i2`);
      await shoot(page, info, theme, 'reunioes-tarefa');
      await page.goto(`${BASE}/nova`);
      await shoot(page, info, theme, 'reunioes-formulario');
      await page.goto(`${BASE}/reunioes/mt1/sumario`);
      await shoot(page, info, theme, 'reunioes-sumario');
      await page.goto(`${BASE}/o-que-me-diz-respeito`);
      await shoot(page, info, theme, 'reunioes-mine-vazio');
      await page.goto(`${BASE}/reunioes/mt1`);
      await page.locator('main').getByRole('button', { name: 'Mais ações' }).click();
      await shoot(page, info, theme, 'reunioes-reuniao-mais');
    });
  }
});
