// Presenças (interface): quadro, filtros no endereço, registo rápido com seleção explícita,
// correção com justificação, sessão a partir do Calendário, fórmula da taxa, vista de
// telemóvel e utilizador sem permissão. API simulada (só para teste); as regras do servidor
// estão em tests/db/presencas.test.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
import { CAPTURAS, THEMES, shoot } from './capturas-util';
import { installMock, leader, pioneer } from './mock-api';

type Row = Record<string, any>;
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 760;
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(d);
};
const TODAY = day(0);
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'deslocamento horizontal').toBeLessThanOrEqual(1);
}

const TEAMS = [{ id: 'teamA', name: 'Equipa Andorinha' }, { id: 'teamB', name: 'Equipa Bisonte' }];
const MEMBERS = [
  { membership_id: 'm-guia', name: 'Guia Teste', team_id: 'teamA', team_name: 'Equipa Andorinha', active: true },
  { membership_id: 'm-p1', name: 'Pedro Teste', team_id: 'teamA', team_name: 'Equipa Andorinha', active: true },
  { membership_id: 'm-p3', name: 'Rita Teste', team_id: 'teamB', team_name: 'Equipa Bisonte', active: true },
];

function stats(cells: Row[]) {
  const n = (c: string, f: (x: Row) => boolean = () => true) => cells.filter((x) => x.category === c && f(x)).length;
  const p = n('presente'), j = n('justificada'), i = n('injustificada');
  return { presencas: p, parciais: n('presente', (x) => x.partial), justificadas: j, injustificadas: i, faltas: j + i, contadas: p + j + i,
    por_registar: n('por_registar'), futuras: n('futura'), canceladas: n('cancelada'), taxa: p + j + i === 0 ? null : Math.round((1000 * p) / (p + j + i)) / 10 };
}

/** API simulada das Presenças, com estado. */
async function installPres(page: Page, opts: { register?: boolean; many?: boolean; linked?: boolean } = {}) {
  const register = opts.register ?? true;
  // Quadro grande (só para as capturas): muitas pessoas, nomes longos e muitas sessões.
  const extra = opts.many ? ['Maria Inês Albuquerque Figueiredo', 'João Pedro Vasconcelos', 'Beatriz Sousa', 'Tomás Rodrigues Carvalho', 'Leonor Martins',
    'Francisco Xavier de Menezes Castelo Branco', 'Matilde Costa', 'Duarte Almeida', 'Carolina Pires Ferreira', 'Afonso Lopes', 'Inês Ribeiro', 'Gonçalo Teixeira']
    .map((name, i) => ({ membership_id: `m-x${i}`, name, team_id: i % 2 ? 'teamA' : 'teamB', team_name: i % 2 ? 'Equipa Andorinha' : 'Equipa Bisonte', active: true })) : [];
  const ALL = [...MEMBERS, ...extra].sort((x, y) => (x.team_id + x.name).localeCompare(y.team_id + y.name));
  const S = {
    sessions: [
      { id: 's1', date: day(-20), title: 'Reunião de setembro', kind: 'reuniao', audience: 'seccao', team_id: null, cal_event_id: null, status: 'ativa', notes: null, cancel_reason: null },
      { id: 's2', date: day(-6), title: 'Reunião de equipa', kind: 'reuniao', audience: 'equipa', team_id: 'teamA', cal_event_id: null, status: 'ativa', notes: null, cancel_reason: null },
      { id: 's3', date: day(-2), title: 'Reunião semanal', kind: 'reuniao', audience: 'seccao', team_id: null, cal_event_id: null, status: 'ativa', notes: null, cancel_reason: null },
      { id: 's4', date: day(5), title: 'Reunião futura', kind: 'reuniao', audience: 'seccao', team_id: null, cal_event_id: null, status: 'ativa', notes: null, cancel_reason: null },
    ] as Row[],
    records: {
      's1|m-guia': { status: 'presente', partial: false, justification: null },
      's1|m-p1': { status: 'presente', partial: true, partial_note: 'Saiu mais cedo', justification: null },
      's1|m-p3': { status: 'injustificada', partial: false, justification: null },
      's2|m-p1': { status: 'justificada', partial: false, justification: 'Consulta médica' },
    } as Record<string, Row>,
    history: [] as Row[],
    events: [
      { id: 'ev1', title: 'Acampamento de outono', audience: 'seccao', team_id: null, team_name: null, start: day(-3), end: day(-1), all_day: true, starts_at: null },
      // Duas atividades com o mesmo nome no mesmo dia: o seletor mostra a hora (Lisboa).
      { id: 'ev2', title: 'Reunião de pais', audience: 'seccao', team_id: null, team_name: null, start: day(-8), end: day(-8), all_day: false, starts_at: `${day(-8)}T09:30:00Z` },
      { id: 'ev3', title: 'Reunião de pais', audience: 'seccao', team_id: null, team_name: null, start: day(-8), end: day(-8), all_day: false, starts_at: `${day(-8)}T17:00:00Z` },
    ] as Row[],
    // Respostas no Calendário (Vou/Não vou) à atividade ev1: intenção, não presença.
    calResponses: { 'm-p1': 'vou', 'm-p3': 'nao_vou' } as Record<string, string>,
    calls: [] as Row[],
  };
  // Só para as capturas: a reunião semanal ligada a uma atividade com respostas «Vou/Não vou».
  if (opts.linked) S.sessions.find((s) => s.id === 's3')!.cal_event_id = 'ev1';
  if (opts.many) {
    for (let i = 0; i < 14; i++) {
      const id = `sx${i}`;
      S.sessions.push({ id, date: day(-21 - i), title: i % 3 ? 'Reunião semanal' : 'Atividade de patrulha', kind: i % 3 ? 'reuniao' : 'atividade', audience: 'seccao', team_id: null, cal_event_id: null, status: i === 4 ? 'cancelada' : 'ativa', notes: null, cancel_reason: null });
      ALL.forEach((m, j) => {
        const r = (i + j) % 7;
        if (r < 6) S.records[`${id}|${m.membership_id}`] = { status: r < 4 ? 'presente' : r === 4 ? 'justificada' : 'injustificada', partial: r === 1, justification: null };
      });
    }
    S.sessions.sort((x, y) => (x.date < y.date ? -1 : 1));
  }
  const teamName = (id: string | null) => TEAMS.find((t) => t.id === id)?.name ?? null;
  const applicable = (s: Row) => ALL.filter((m) => s.audience === 'seccao' || m.team_id === s.team_id);
  const cell = (s: Row, m: Row) => {
    const r = S.records[`${s.id}|${m.membership_id}`];
    const category = s.status === 'cancelada' ? 'cancelada' : s.date > TODAY ? 'futura' : r?.status ?? 'por_registar';
    return { s: s.id, m: m.membership_id, status: r?.status ?? null, partial: !!r?.partial, partial_note: r?.partial_note ?? null,
      justification: r?.justification ?? null, has_justification: !!r?.justification, category, team_id: m.team_id };
  };
  const allCells = (from: string, to: string, team: string | null, only?: string) => S.sessions
    .filter((s) => s.date >= from && s.date <= to)
    .flatMap((s) => applicable(s).map((m) => cell(s, m)))
    .filter((c) => (!team || c.team_id === team) && (!only || c.m === only));
  const sessionRow = (s: Row, cells: Row[]) => ({ ...s, team_name: teamName(s.team_id), cal_title: s.cal_event_id ? 'Acampamento de outono' : null,
    future: s.date > TODAY, applicable: cells.filter((c) => c.s === s.id).length, registered: cells.filter((c) => c.s === s.id && c.status).length });
  const ok = (route: Route, v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  const fail = (route: Route, message: string, code = 'P0001') => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code, message }) });

  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const b = route.request().postDataJSON?.() ?? {};
    if (fn.startsWith('pres_')) S.calls.push({ fn, ...b });
    switch (fn) {
      case 'my_modules':
        return ok(route, ['calendario', 'equipas', 'inventario', 'presencas', 'secretaria', 'tesouraria'].map((k) => k === 'presencas'
          ? { module: k, status: 'teste', space: 'teste', grants: register ? ['presencas.registar'] : [], dirigente: false }
          : { module: k, status: 'desenvolvimento', space: null, grants: [], dirigente: false }));
      case 'pres_board': {
        if (!register) return ok(route, { can_register: false, today: TODAY, my_membership: 'm-p1', teams: [], sessions: [], members: [], cells: [], totals: stats([]), by_team: [], by_month: [] });
        const cells = allCells(b.p_from, b.p_to, b.p_team);
        const sessions = S.sessions.filter((s) => s.date >= b.p_from && s.date <= b.p_to && (!b.p_team || s.audience === 'seccao' || s.team_id === b.p_team));
        const members = ALL.filter((m) => !b.p_team || m.team_id === b.p_team).map((m) => ({ ...m, stats: stats(cells.filter((c) => c.m === m.membership_id)) }));
        return ok(route, {
          can_register: true, today: TODAY, my_membership: 'm-ana', teams: TEAMS,
          sessions: sessions.map((s) => sessionRow(s, cells)), members,
          cells: cells.map(({ justification, team_id, ...c }) => c),
          totals: stats(cells),
          by_team: TEAMS.map((t) => ({ team_id: t.id, team_name: t.name, members: new Set(cells.filter((c) => c.team_id === t.id).map((c) => c.m)).size, stats: stats(cells.filter((c) => c.team_id === t.id)) })),
          by_month: [{ month: TODAY.slice(0, 7), sessions: sessions.length, stats: stats(cells) }],
        });
      }
      case 'pres_session': {
        const s = S.sessions.find((x) => x.id === b.p_session);
        if (!s) return fail(route, 'Registo não encontrado.');
        const cells = applicable(s).map((m) => cell(s, m));
        return ok(route, {
          can_register: register, today: TODAY,
          session: { ...s, team_name: teamName(s.team_id), effective_status: s.status, future: s.date > TODAY, created_by_name: 'Ana',
            cal_event: s.cal_event_id ? { id: 'ev1', title: 'Acampamento de outono', status: 'ativo', start: day(-3), end: day(-1) } : null },
          members: cells.map((c) => ({ ...ALL.find((m) => m.membership_id === c.m), ...c, membership_id: c.m, updated_at: null, updated_by_name: null,
            cal_response: s.cal_event_id ? S.calResponses[c.m] ?? null : null })),
          history: S.history.filter((h) => h.session_id === s.id),
        });
      }
      case 'pres_member': {
        const m = ALL.find((x) => x.membership_id === b.p_membership)!;
        const cells = allCells(b.p_from, b.p_to, null, m.membership_id);
        return ok(route, {
          can_register: register, is_self: !register, today: TODAY,
          member: { membership_id: m.membership_id, name: m.name, team_name: m.team_name, function: 'pioneiro', active: true, entry_date: day(-400) },
          stats: stats(cells),
          entries: cells.map((c) => { const s = S.sessions.find((x) => x.id === c.s)!; return { ...c, session_id: s.id, date: s.date, title: s.title, kind: s.kind, audience: s.audience, team_name: teamName(s.team_id) }; })
            .sort((x, y) => (x.date < y.date ? 1 : -1)),
          history: S.history.filter((h) => h.membership_id === m.membership_id),
        });
      }
      case 'pres_event_options': return ok(route, S.events.filter((e) => !S.sessions.some((s) => s.cal_event_id === e.id)));
      case 'pres_session_save': {
        if (!String(b.p_title ?? '').trim()) return fail(route, 'Indica o título da sessão.');
        const id = b.p_session ?? `s${S.sessions.length + 1}`;
        const row = { id, date: b.p_date, title: b.p_title, kind: b.p_kind, audience: b.p_team ? 'equipa' : 'seccao', team_id: b.p_team, cal_event_id: b.p_cal_event, status: 'ativa', notes: b.p_notes, cancel_reason: null };
        S.sessions = [...S.sessions.filter((s) => s.id !== id), row].sort((x, y) => (x.date < y.date ? -1 : 1));
        return ok(route, id);
      }
      case 'pres_session_cancel': {
        const s = S.sessions.find((x) => x.id === b.p_session)!;
        s.status = b.p_cancel ? 'cancelada' : 'ativa';
        s.cancel_reason = b.p_reason;
        return ok(route, null);
      }
      case 'pres_record': {
        if (!register) return fail(route, 'Não tens permissão para esta ação neste módulo.', '42501');
        const s = S.sessions.find((x) => x.id === b.p_session)!;
        for (const mid of b.p_memberships as string[]) {
          const key = `${s.id}|${mid}`;
          const old = S.records[key];
          const status = b.p_status === 'por_registar' ? null : b.p_status;
          const justification = status === 'presente' || !status ? null : b.p_justification === null ? old?.justification ?? null : b.p_justification || null;
          S.records[key] = { status, partial: !!b.p_partial, partial_note: b.p_partial_note, justification };
          S.history.unshift({ id: S.history.length + 1, session_id: s.id, session_title: s.title, session_date: s.date, membership_id: mid,
            name: ALL.find((m) => m.membership_id === mid)!.name, old_status: old?.status ?? null, new_status: status,
            old_partial: old ? !!old.partial : null, new_partial: !!b.p_partial, justification_changed: (old?.justification ?? null) !== justification,
            reason: b.p_reason, changed_at: new Date().toISOString(), changed_by_name: 'Ana Dirigente' });
        }
        return ok(route, (b.p_memberships as string[]).length);
      }
      default: return route.fallback();
    }
  });
  return S;
}

test('quadro: membros e sessões, taxa com fórmula, filtros no endereço, sem rankings', async ({ page }) => {
  test.skip(isMobile(page), 'O quadro largo é só para computador; no telemóvel há listas.');
  await installMock(page, leader());
  await installPres(page);
  await page.goto('/presencas');
  await expect(page.getByRole('heading', { name: 'Presenças', level: 1 })).toBeVisible();
  const table = page.getByRole('region', { name: 'Quadro de presenças' });
  await expect(table).toBeVisible();
  if (process.env.PRES_SHOTS) await page.screenshot({ path: `${process.env.PRES_SHOTS}/quadro.png`, fullPage: true });
  // Linhas: por equipa e nome (nunca por taxa).
  const names = await table.locator('tbody th[scope="row"] a').allInnerTexts();
  expect(names).toEqual(['Guia Teste', 'Pedro Teste', 'Rita Teste']);
  // Colunas: sessões por data; células com ícone e texto acessível.
  await expect(table.locator('thead th.pres-sess-col')).toHaveCount(4);
  const pedro = table.locator('tbody tr', { has: page.getByRole('link', { name: 'Pedro Teste', exact: true }) });
  await expect(pedro.getByText('Presente (parcial)')).toHaveCount(1);
  await expect(pedro.getByText('Falta justificada')).toHaveCount(1);
  await expect(pedro.getByText('Sessão futura')).toHaveCount(1);
  // Pedro: 1 presença (parcial) e 1 falta justificada → 50 %; Guia: 1 presença → 100 %.
  await expect(pedro.locator('td.pres-num').last()).toHaveText('50 %');
  const rita = table.locator('tbody tr', { has: page.getByRole('link', { name: 'Rita Teste', exact: true }) });
  await expect(rita.locator('td.pres-num').last()).toHaveText('0 %');
  // Siglas com significado: cabeçalho acessível, title e legenda.
  const fj = table.getByRole('columnheader', { name: 'Faltas justificadas' });
  await expect(fj).toHaveText('FJ');
  await expect(fj).toHaveAttribute('title', 'Faltas justificadas');
  await expect(table.getByRole('columnheader', { name: 'Por registar' })).toBeVisible();
  await expect(page.getByTestId('legenda-siglas')).toContainText('FI faltas injustificadas');
  await expect(page.getByTestId('legenda-siglas')).toContainText('Taxa = P ÷ (P + FJ + FI)');
  // Sem texto explicativo da fórmula.
  await expect(page.getByText('Como se calcula a taxa de assiduidade')).toHaveCount(0);
  await expect(page.getByText(/ranking|classificação \d/i)).toHaveCount(0);

  // Filtros: equipa e mês ficam no endereço e sobrevivem ao recarregar.
  await page.getByLabel('Equipa').selectOption('teamB');
  await expect(page).toHaveURL(/equipa=teamB/);
  await expect(table.locator('tbody th[scope="row"] a')).toHaveText(['Rita Teste']);
  await expect(table.locator('thead th.pres-sess-col')).toHaveCount(3);
  await page.reload();
  await expect(page.getByLabel('Equipa')).toHaveValue('teamB');
  await page.getByLabel('Período').selectOption('datas');
  await expect(page).toHaveURL(/de=\d{4}-\d{2}-\d{2}&ate=/);
  await expect(page.getByLabel('De', { exact: true })).toBeVisible();

  // Resumo por equipa e por período.
  await page.getByLabel('Equipa').selectOption('');
  await page.getByRole('button', { name: 'Resumo' }).click();
  await expect(page).toHaveURL(/vista=resumo/);
  await expect(page.getByRole('heading', { name: 'Por equipa' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Equipa Andorinha/ })).toBeVisible();
  if (process.env.PRES_SHOTS) await page.screenshot({ path: `${process.env.PRES_SHOTS}/resumo.png`, fullPage: true });
  await expect(page.getByRole('heading', { name: 'Por mês' })).toBeVisible();
  await noHorizontalScroll(page);
});

test('registo rápido: só as pessoas selecionadas, nada fica presente por omissão', async ({ page }) => {
  await installMock(page, leader());
  const S = await installPres(page);
  await page.goto('/presencas/sessoes/s3');
  await expect(page.getByRole('heading', { name: 'Reunião semanal' })).toBeVisible();
  const members = page.getByRole('list', { name: 'Pessoas da sessão' });
  await expect(members.getByText('Por registar')).toHaveCount(3);
  // Sem seleção, não há nada para aplicar.
  await expect(page.getByRole('button', { name: 'Seleciona pessoas' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Pedro Teste/ }).check();
  await page.getByRole('checkbox', { name: /Rita Teste/ }).check();
  await expect(page.getByRole('button', { name: 'Escolhe o estado' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Presente' }).check();
  await page.getByLabel('Participação parcial').check();
  await page.getByLabel('Nota curta (opcional)').fill('Chegou às 16h');
  await page.getByRole('button', { name: 'Aplicar a 2 pessoas' }).click();
  await expect(page.getByText('Registado para 2 pessoas.')).toBeVisible();
  const call = S.calls.find((c) => c.fn === 'pres_record')!;
  expect(call.p_memberships.sort()).toEqual(['m-p1', 'm-p3']);
  expect(call).toMatchObject({ p_status: 'presente', p_partial: true, p_partial_note: 'Chegou às 16h' });
  await expect(members.getByText('Por registar')).toHaveCount(1); // o Guia ficou como estava
  await expect(members.getByText('Presente (parcial)')).toHaveCount(2);

  // «Selecionar os por registar» é uma escolha explícita.
  await page.getByRole('button', { name: 'Selecionar os por registar (1)' }).click();
  await expect(page.getByRole('checkbox', { name: /Guia Teste/ })).toBeChecked();
  await page.getByRole('radio', { name: 'Falta injustificada' }).check();
  await page.getByRole('button', { name: 'Aplicar a 1 pessoa' }).click();
  await expect(members.getByText('Falta injustificada')).toHaveCount(1);
  await noHorizontalScroll(page);
});

test('registo de um toque: P, FJ e FI por pessoa, com significado acessível', async ({ page }) => {
  await installMock(page, leader());
  const S = await installPres(page);
  await page.goto('/presencas/sessoes/s3');
  await expect(page.getByTestId('legenda-botoes')).toContainText('P presente');
  await expect(page.getByTestId('legenda-botoes')).toContainText('FJ falta justificada');
  const btn = page.getByRole('button', { name: 'Pedro Teste: Presente' });
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveAttribute('title', 'Presente');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  expect(S.calls.filter((c) => c.fn === 'pres_record')).toEqual([expect.objectContaining({
    p_session: 's3', p_memberships: ['m-p1'], p_status: 'presente', p_partial: false, p_justification: null, p_reason: null,
  })]);
  // Os outros continuam por registar (nada fica presente por omissão).
  const members = page.getByRole('list', { name: 'Pessoas da sessão' });
  await expect(members.getByText('Por registar')).toHaveCount(2);
  // Teclado: foco no botão e Enter.
  const rita = page.getByRole('button', { name: 'Rita Teste: Falta justificada' });
  await rita.focus();
  await page.keyboard.press('Enter');
  await expect(rita).toHaveAttribute('aria-pressed', 'true');
  expect(S.calls.filter((c) => c.fn === 'pres_record').pop()).toMatchObject({ p_memberships: ['m-p3'], p_status: 'justificada' });
  await expect(members.getByText('Por registar')).toHaveCount(1);
  await noHorizontalScroll(page);
  // Sessão futura: só a falta justificada antecipada.
  await page.goto('/presencas/sessoes/s4');
  await expect(page.getByRole('button', { name: 'Pedro Teste: Presente' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pedro Teste: Falta injustificada' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pedro Teste: Falta justificada' })).toBeEnabled();
});

test('sessões por preencher antes das conclusões e atalho para registar', async ({ page }) => {
  await installMock(page, leader());
  const S = await installPres(page);
  await page.goto('/presencas?vista=resumo');
  const fill = page.getByTestId('por-preencher');
  // s2 (falta o Guia) e s3 (ninguém registado); s1 está completa e s4 é futura.
  await expect(fill).toContainText('2 sessões por preencher');
  await expect(fill).toContainText('4 registos em falta');
  await expect(page.getByTestId('taxa-provisoria')).toHaveText('Provisória: 4 por registar');
  const pick = page.getByLabel('Sessão', { exact: true });
  await expect(pick).toHaveValue('s3'); // a mais recente por preencher
  await expect(pick.locator('option[value="s3"]')).toHaveText(`${dmy(day(-2))} · Reunião semanal · 3 por registar`);
  await expect(pick.locator('option[value="s1"]')).toContainText('preenchida');
  await pick.selectOption('s2');
  await page.getByRole('button', { name: 'Registar', exact: true }).click();
  await expect(page).toHaveURL(/\/presencas\/sessoes\/s2\?vista=resumo/);
  await expect(page.getByRole('heading', { name: 'Reunião de equipa' })).toBeVisible();
  await page.getByRole('button', { name: 'Guia Teste: Presente' }).click();
  await expect(page.getByRole('button', { name: 'Guia Teste: Presente' })).toHaveAttribute('aria-pressed', 'true');
  expect(S.calls.filter((c) => c.fn === 'pres_record').pop()).toMatchObject({ p_session: 's2', p_memberships: ['m-guia'], p_status: 'presente' });
  // Voltar mantém a vista e o resumo atualiza.
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page).toHaveURL(/\/presencas\?vista=resumo/);
  await expect(fill).toContainText('1 sessão por preencher');
  await expect(fill).toContainText('3 registos em falta');
  await noHorizontalScroll(page);
});

test('quadro grande: cabeçalho e coluna dos membros ficam fixos ao deslocar', async ({ page }) => {
  test.skip(isMobile(page), 'O quadro largo é só para computador.');
  await page.setViewportSize({ width: 1280, height: 640 });
  await installMock(page, leader());
  await installPres(page, { many: true });
  await page.goto('/presencas?vista=quadro');
  const wrap = page.getByRole('region', { name: 'Quadro de presenças' });
  await expect(wrap).toBeVisible();
  const can = await wrap.evaluate((el) => ({ x: el.scrollWidth > el.clientWidth, y: el.scrollHeight > el.clientHeight }));
  expect(can).toEqual({ x: true, y: true });
  // Teclado: o quadro recebe foco (região deslocável).
  await wrap.focus();
  await expect(wrap).toBeFocused();
  await wrap.evaluate((el) => { el.scrollLeft = 400; el.scrollTop = 200; });
  const box = (await wrap.boundingBox())!;
  const head = (await wrap.getByRole('columnheader', { name: 'Membro' }).boundingBox())!;
  expect(Math.abs(head.y - box.y)).toBeLessThan(2);
  expect(Math.abs(head.x - box.x)).toBeLessThan(2);
  const sessHead = (await wrap.locator('thead th.pres-sess-col').nth(10).boundingBox())!;
  expect(Math.abs(sessHead.y - box.y)).toBeLessThan(2);
  const name = (await wrap.locator('tbody th.pres-name-col').nth(9).boundingBox())!;
  expect(Math.abs(name.x - box.x)).toBeLessThan(2);
  await noHorizontalScroll(page);
});

test('correção individual com justificação restrita e histórico', async ({ page }) => {
  await installMock(page, leader());
  const S = await installPres(page);
  await page.goto('/presencas/sessoes/s1?pessoa=m-p3');
  await expect(page.getByRole('form', { name: 'Corrigir registo de Rita Teste' })).toBeVisible();
  const form = page.getByRole('form', { name: 'Corrigir registo de Rita Teste' });
  await form.getByLabel('Estado').selectOption('justificada');
  await expect(form.getByText('Só é visível para quem regista presenças e para o próprio.')).toBeVisible();
  await form.getByLabel('Justificação (opcional)').fill('Doença');
  await form.getByLabel('Motivo da correção (opcional)').fill('Encarregado avisou');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(form).toHaveCount(0);
  const call = S.calls.filter((c) => c.fn === 'pres_record').pop()!;
  expect(call).toMatchObject({ p_memberships: ['m-p3'], p_status: 'justificada', p_justification: 'Doença', p_reason: 'Encarregado avisou' });
  await page.getByText(/Histórico de correções \(1\)/).click();
  await expect(page.getByText(/de Falta injustificada para/)).toBeVisible();
  await expect(page.getByText(/motivo: Encarregado avisou/)).toBeVisible();
  // Cancelar a sessão: deixa de permitir registos.
  await page.getByRole('main').getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('button', { name: 'Cancelar sessão' }).click();
  await page.getByLabel('Motivo (opcional)').fill('Chuva');
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  expect(S.calls.filter((c) => c.fn === 'pres_session_cancel').pop()).toMatchObject({ p_session: 's1', p_cancel: true, p_reason: 'Chuva' });
  await expect(page.getByText('Esta sessão está cancelada: não é possível registar presenças.')).toBeVisible();
});

test('nova sessão a partir de uma atividade do Calendário', async ({ page }) => {
  await installMock(page, leader());
  const S = await installPres(page);
  await page.goto('/presencas');
  await page.getByRole('link', { name: 'Nova sessão' }).click();
  await expect(page.getByLabel('Evento', { exact: true })).toHaveValue('Reunião');
  await page.getByLabel('Evento', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Criar sessão' }).click();
  await expect(page.getByText('Indica o nome do evento.')).toBeVisible();
  // Formulário simples: evento, data e notas; a ligação ao Calendário fica em «Mais opções».
  await expect(page.getByLabel('Atividade do Calendário')).toBeHidden();
  await page.getByText('Mais opções').click();
  // Seletor comum: «DD/MM/AAAA · Nome», mais recentes primeiro; hora só para distinguir homónimos.
  const opts = await page.getByLabel('Atividade do Calendário').locator('option').allInnerTexts();
  expect(opts[0]).toBe('Nenhuma (sessão própria)');
  expect(opts[1]).toBe(`${dmy(day(-3))} · Acampamento de outono · até ${dmy(day(-1))}`);
  expect(opts[2]).toMatch(new RegExp(`^${dmy(day(-8))} · Reunião de pais · \\d{2}:30$`));
  expect(opts[3]).toMatch(new RegExp(`^${dmy(day(-8))} · Reunião de pais · \\d{2}:00$`));
  await page.getByLabel('Atividade do Calendário').selectOption('ev1');
  await expect(page.getByLabel('Evento', { exact: true })).toHaveValue('Acampamento de outono');
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue(day(-3).split('-').reverse().join('/'));
  await page.getByRole('button', { name: 'Criar sessão' }).click();
  await expect(page.getByRole('heading', { name: 'Acampamento de outono' })).toBeVisible();
  await expect(page.getByText(/Ligada à atividade do Calendário «Acampamento de outono»/)).toBeVisible();
  expect(S.calls.find((c) => c.fn === 'pres_session_save')).toMatchObject({ p_cal_event: 'ev1', p_kind: 'atividade', p_date: day(-3) });
  // «Vou/Não vou» do Calendário aparece à parte e não conta como presença.
  await expect(page.getByTestId('nota-calendario')).toBeVisible();
  const list = page.getByRole('list', { name: 'Pessoas da sessão' });
  const pedro = list.getByRole('listitem').filter({ hasText: 'Pedro Teste' });
  await expect(pedro.getByText('Calendário: Vou')).toBeVisible();
  await expect(pedro.getByText('Por registar')).toBeVisible();
  await expect(list.getByText('Calendário: Não vou')).toHaveCount(1);
  await expect(list.getByText('Por registar')).toHaveCount(3);
  await page.getByRole('button', { name: 'Selecionar quem disse «Vou» (1)' }).click();
  await expect(page.getByRole('checkbox', { name: /Pedro Teste/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Rita Teste/ })).not.toBeChecked();
  expect(S.calls.filter((c) => c.fn === 'pres_record')).toHaveLength(0);
  // A atividade deixa de aparecer nas opções (uma sessão por atividade).
  await page.goto('/presencas/nova');
  await page.getByText('Mais opções').click();
  await expect(page.getByLabel('Atividade do Calendário').locator('option[value="ev1"]')).toHaveCount(0);
});

test('telemóvel: vista por sessão e por pessoa em vez do quadro largo', async ({ page }) => {
  test.skip(!isMobile(page), 'Só no telemóvel.');
  await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page, leader());
  await installPres(page);
  await page.goto('/presencas?vista=quadro');
  await expect(page.getByRole('region', { name: 'Quadro de presenças' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Quadro' })).toHaveCount(0);
  const sessions = page.getByRole('list', { name: 'Sessões' });
  await expect(sessions.getByRole('link')).toHaveCount(4);
  await expect(sessions.getByText('1/3 registadas')).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Pessoas' }).click();
  const people = page.getByRole('list', { name: 'Pessoas' });
  await expect(people.getByRole('link', { name: /Pedro Teste/ })).toContainText('50 %');
  await people.getByRole('link', { name: /Pedro Teste/ }).click();
  await expect(page.getByRole('heading', { name: 'Pedro Teste' })).toBeVisible();
  await expect(page.getByTestId('taxa')).toHaveText('50 %');
  await expect(page.getByText(dmy(day(-6))).first()).toBeVisible();
  await expect(page.getByText('Justificação: Consulta médica')).toBeVisible();
  await noHorizontalScroll(page);
  await page.goto('/presencas/sessoes/s3');
  await expect(page.getByRole('list', { name: 'Pessoas da sessão' })).toBeVisible();
  const quick = (await page.getByRole('button', { name: 'Rita Teste: Falta injustificada' }).boundingBox())!;
  expect(quick.height).toBeGreaterThanOrEqual(36); // alvo de toque
  await noHorizontalScroll(page);
  if (process.env.PRES_SHOTS) await page.screenshot({ path: `${process.env.PRES_SHOTS}/mobile-session.png`, fullPage: true });
});

test('sem permissão de registo: só as próprias presenças e taxa, sem ações', async ({ page }) => {
  await installMock(page, pioneer());
  const S = await installPres(page, { register: false });
  await page.goto('/presencas');
  await expect(page.getByText(/As tuas presenças/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nova sessão' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Quadro de presenças' })).toHaveCount(0);
  await expect(page.getByLabel('Equipa')).toHaveCount(0);
  await expect(page.getByTestId('taxa')).toHaveText('50 %');
  await expect(page.getByText('1 parcial')).toBeVisible();
  await expect(page.getByTestId('taxa-provisoria')).toHaveText('Provisória: 1 por registar');
  await expect(page.getByTestId('por-preencher')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /: Presente$/ })).toHaveCount(0);
  expect(S.calls.every((c) => c.fn !== 'pres_board' && c.fn !== 'pres_record')).toBe(true);
  expect(S.calls.some((c) => c.fn === 'pres_member' && c.p_membership === 'm-p1')).toBe(true);
  await noHorizontalScroll(page);
});

test('sem acesso ao módulo: página «Em desenvolvimento»', async ({ page }) => {
  await installMock(page, pioneer());
  await page.route('http://mock.supabase.test/rest/v1/rpc/my_modules', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ module: 'presencas', status: 'desenvolvimento', space: null, grants: [], dirigente: false }]),
  }));
  let called = false;
  await page.route('http://mock.supabase.test/rest/v1/rpc/pres_*', (route) => { called = true; return route.abort(); });
  await page.goto('/presencas');
  await expect(page.locator('.future-badge')).toBeVisible();
  await expect(page.getByText('Esta área ainda não está disponível.', { exact: false })).toBeVisible();
  expect(called).toBe(false);
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`presenças ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      await installPres(page, { linked: true });
      await page.goto('/presencas');
      await shoot(page, info, theme, 'presencas-inicio');
      await page.goto('/presencas?vista=quadro');
      await shoot(page, info, theme, 'presencas-quadro');
      await page.goto('/presencas/sessoes/s3');
      await shoot(page, info, theme, 'presencas-sessao');
      await page.goto('/presencas/pessoas/m-p1');
      await shoot(page, info, theme, 'presencas-pessoa');
      await page.goto('/presencas/nova');
      await shoot(page, info, theme, 'presencas-formulario');
      await page.goto('/presencas?vista=pessoas');
      await shoot(page, info, theme, 'presencas-pessoas');
      await page.goto('/presencas?vista=resumo');
      await shoot(page, info, theme, 'presencas-resumo');
      await page.goto('/presencas/sessoes/s1?pessoa=m-p1');
      await shoot(page, info, theme, 'presencas-sessao-correcao');
    });
    test(`presenças quadro grande ${theme}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      await installPres(page, { many: true });
      await page.goto('/presencas?vista=quadro');
      await shoot(page, info, theme, 'presencas-quadro-grande');
      const wrap = page.locator('.pres-table-wrap');
      if (await wrap.count()) {
        // Deslocado dentro do quadro: a 1.ª coluna e o cabeçalho ficam fixos.
        await wrap.evaluate((el) => { el.scrollLeft = 300; el.scrollTop = 200; });
        await page.waitForTimeout(100);
        await wrap.screenshot({ path: `${process.env.CAPTURAS_DIR ?? 'test-results/capturas-modulos'}/presencas-quadro-grande-scroll-${info.project.name}-${theme === 'light' ? 'claro' : 'escuro'}.png` });
      }
    });
  }
});
