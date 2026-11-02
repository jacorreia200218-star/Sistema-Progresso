// API Supabase simulada para testes de interface (Playwright). Usa o catálogo
// verdadeiro (catalog/pioneiros-v1.json) e pessoas FICTÍCIAS, apenas para teste.
import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const catalogJson = JSON.parse(readFileSync(path.resolve('catalog/pioneiros-v1.json'), 'utf8'));
const now = new Date().toISOString();
const today = now.slice(0, 10);

type Row = Record<string, any>;

function buildCatalog() {
  const version = { id: 'v1', label: catalogJson.label };
  const stages = catalogJson.stages.map((s: Row) => ({ id: `st-${s.key}`, version_id: 'v1', ...s }));
  const areas = catalogJson.areas.map((a: Row) => ({
    id: `a-${a.code}`, version_id: 'v1', code: a.code, name: a.name, full_name: a.full_name, dimension: a.dimension, position: a.position, source_page: a.source_page,
    catalog_trails: a.trails.map((t: Row) => ({
      id: `t-${t.key}`, version_id: 'v1', area_id: `a-${a.code}`, key: t.key, name: t.name, position: t.position, source_page: t.source_page,
      framing: t.framing, keywords: t.keywords, opportunities: t.opportunities,
      pending_note: catalogJson.pending_items.find((p: Row) => p.affects.includes(t.key))?.issue ?? null,
      catalog_objectives: t.objectives.map((o: Row, i: number) => ({
        id: `o-${o.code}`, trail_id: `t-${t.key}`, code: o.code, text: o.text, position: i + 1,
        pending_note: catalogJson.pending_items.find((p: Row) => p.affects.includes(o.code))?.issue ?? null,
      })),
    })),
  }));
  return { version, stages, areas };
}

export interface Persona {
  userId: string;
  tables: Record<string, Row[]>;
  rpc?: Record<string, unknown>;
}

// Pessoas fictícias (apenas teste) espalhadas pelos marcos do caminho.
const FICTICIOS: [string, string, string, string][] = [
  ['Ana Fictícia', 'teamA', 'inicio_pista', 'em_adesao'],
  ['Bruno Fictício', 'teamB', 'inicio_pista', 'perfil_tracado'],
  ['Carla Fictícia', 'teamA', 'promessa', 'aguarda_promessa'],
  ['Pedro Teste', 'teamA', 'conhecimento', 'em_curso'],
  ['Diogo Fictício', 'teamB', 'conhecimento', 'requisitos_cumpridos'],
  ['Eva Fictícia', 'teamB', 'conhecimento', 'em_validacao'],
  ['Filipe Fictício', 'teamA', 'conhecimento', 'em_curso'],
  ['Guia Teste', 'teamA', 'vontade', 'em_curso'],
  ['Helena Fictícia', 'teamB', 'vontade', 'concluida'],
  ['Inês Fictícia', 'teamA', 'construcao', 'em_curso'],
  ['João Fictício', 'teamB', 'acampamento', 'etapas_concluidas'],
];
const pathMembers = FICTICIOS.map(([name, team, milestone, state], i) => ({
  membership_id: name === 'Pedro Teste' ? 'm-p1' : name === 'Guia Teste' ? 'm-guia' : `m-f${i}`,
  full_name: name, totem: null, photo_path: null, team_id: team, function: name === 'Guia Teste' ? 'guia' : 'pioneiro',
  milestone, state, is_me: false,
}));
const counts = pathMembers.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.milestone]: (acc[m.milestone] ?? 0) + 1 }), {});

const section = { id: 'sec1', name: 'Pioneiros (teste)', kind: 'pioneiros', group_id: 'g1', catalog_version_id: 'v1', groups: { name: 'Agrupamento de teste' } };
const teams = [
  { id: 'teamA', section_id: 'sec1', name: 'Equipa Andorinha', archived_at: null },
  { id: 'teamB', section_id: 'sec1', name: 'Equipa Bússola', archived_at: null },
];
const profiles = {
  p1: { id: 'u-p1', full_name: 'Pedro Teste', totem: 'Lince Atento', photo_path: null },
  ana: { id: 'u-ana', full_name: 'Ana Dirigente Teste', totem: null, photo_path: null },
  guia: { id: 'u-guia', full_name: 'Guia Teste', totem: null, photo_path: null },
  novo: { id: 'u-novo', full_name: 'Pessoa Nova Teste', totem: null, photo_path: null },
};
const mem = (id: string, prof: Row, fn: string | null, team: string | null, extra: Row = {}) => ({
  id, profile_id: prof.id, section_id: 'sec1', status: 'ativo', function: fn, is_admin: false, team_id: team,
  requested_at: '2026-09-01T10:00:00Z', approved_at: '2026-09-02T10:00:00Z', profiles: prof, ...extra,
});
const memberships = [
  mem('m-p1', profiles.p1, 'pioneiro', 'teamA'),
  mem('m-ana', profiles.ana, 'dirigente', null, { is_admin: true }),
  mem('m-guia', profiles.guia, 'guia', 'teamA'),
  mem('m-novo', profiles.novo, null, null, { status: 'pendente', approved_at: null, requested_team_id: 'teamB' }),
];

const progressRows = () => {
  const path = { id: 'path1', membership_id: 'm-p1', stage_id: 'st-conhecimento', stage_key: 'conhecimento', stage_ordinal: 1, status: 'em_curso', opened_at: '2026-09-10T10:00:00Z', insignia_delivered_on: '2026-09-10', completed_on: null, completion_kind: null, recognized_on: null, recognition_note: null };
  const choice = (key: string, area: string, status = 'confirmada') => ({ id: `c-${key}`, stage_path_id: 'path1', membership_id: 'm-p1', trail_id: `t-${key}`, trail_key: key, area_code: area, status, planned_opportunities: 'Raid de equipa; plano de treino', replaces_choice_id: null, proposed_by: 'u-p1', proposed_at: now, decided_by: 'u-ana', decided_at: now, decision_comment: null });
  const req = (id: string, key: string, status: string, kind = 'normal', v = 1) => ({ id, membership_id: 'm-p1', section_id: 'sec1', trail_id: `t-${key}`, trail_key: key, kind, status, current_version: v, approved_reference_date: null, created_at: now, updated_at: now });
  return {
    adhesions: [{ membership_id: 'm-p1', decided_on: '2026-09-05', commitment_on: '2026-09-08', notes: null, is_historical: false, recorded_at: now }],
    stage_paths: [path],
    stage_choices: [
      choice('fisico-desempenho', 'F'), choice('afetivo-autoestima', 'A'), choice('carater-autonomia', 'C'),
      // Espiritual: uma proposta substituída e a troca por negociar (registos distintos).
      { ...choice('espiritual-descoberta', 'E', 'substituida'), proposed_at: '2026-09-12T10:00:00Z', decided_at: '2026-09-20T10:00:00Z' },
      { ...choice('espiritual-servico', 'E', 'proposta'), replaces_choice_id: 'c-espiritual-descoberta', decided_by: null, decided_at: null },
      // Intelectual: proposta retirada pelo pioneiro.
      { ...choice('intelectual-procura-do-conhecimento', 'I', 'retirada'), decided_by: 'u-p1', decision_comment: '—' },
    ],
    trail_requests: [
      req('r-ok', 'fisico-desempenho', 'validado_equipa'),
      req('r-dev', 'afetivo-autoestima', 'devolvido', 'normal', 1),
      req('r-draft', 'carater-autonomia', 'rascunho'),
      req('r-hist', 'social-interacao-e-cooperacao', 'submetido', 'historico'),
      // Pedidos por objetivos: validação parcial, «A rever» com um objetivo aceite e um em validação.
      req('r-parc', 'intelectual-procura-do-conhecimento', 'objetivos_validados'),
      req('r-rev', 'carater-responsabilidade', 'devolvido'),
      req('r-obj', 'espiritual-descoberta', 'submetido'),
    ],
    trail_request_versions: [
      { id: 'v-ok', request_id: 'r-ok', version_no: 1, reflection: 'Treinei com regularidade.', experiences: 'Raid', period_start: null, period_end: null, approximate_date: null, created_at: now, updated_at: now, submitted_at: now, withdrawn_at: null },
      { id: 'v-dev', request_id: 'r-dev', version_no: 1, reflection: 'Reflexão inicial.', experiences: '', period_start: null, period_end: null, approximate_date: null, created_at: now, updated_at: now, submitted_at: now, withdrawn_at: null },
      { id: 'v-draft', request_id: 'r-draft', version_no: 1, reflection: '', experiences: '', period_start: null, period_end: null, approximate_date: null, created_at: now, updated_at: now, submitted_at: null, withdrawn_at: null },
      { id: 'v-hist', request_id: 'r-hist', version_no: 1, reflection: 'Fui guia de cozinha no acampamento.', experiences: '', period_start: null, period_end: null, approximate_date: 'Verão de 2025', created_at: now, updated_at: now, submitted_at: now, withdrawn_at: null },
      ...['r-parc', 'r-rev', 'r-obj'].map((id) => ({
        id: `v-${id}`, request_id: id, version_no: 1, reflection: '', experiences: '', context: '', period_start: null, period_end: null, approximate_date: null,
        evidence: id === 'r-obj' ? 'Preparei a vigília da equipa e conversei com o assistente sobre o que significa rezar em conjunto.' : 'No projeto da escola organizei o grupo e cumpri os prazos combinados.',
        created_at: now, updated_at: now, submitted_at: now, withdrawn_at: null,
      })),
    ],
    request_objectives: [
      { id: 'ro1', request_id: 'r-parc', version_id: 'v-r-parc', objective_id: 'o-I1', objective_code: 'I1', decision: 'aceite', comment: null, decided_by: 'u-guia', decided_at: now },
      { id: 'ro2', request_id: 'r-rev', version_id: 'v-r-rev', objective_id: 'o-C3', objective_code: 'C3', decision: 'aceite', comment: null, decided_by: 'u-guia', decided_at: now },
      { id: 'ro3', request_id: 'r-rev', version_id: 'v-r-rev', objective_id: 'o-C4', objective_code: 'C4', decision: 'rever', comment: 'Conta um exemplo em que assumiste uma responsabilidade na equipa.', decided_by: 'u-guia', decided_at: now },
      { id: 'ro4', request_id: 'r-obj', version_id: 'v-r-obj', objective_id: 'o-E1', objective_code: 'E1', decision: null, comment: null, decided_by: null, decided_at: null },
      { id: 'ro5', request_id: 'r-obj', version_id: 'v-r-obj', objective_id: 'o-E2', objective_code: 'E2', decision: null, comment: null, decided_by: null, decided_at: null },
    ],
    trail_decisions: [
      { id: 'd1', request_id: 'r-ok', version_id: 'v-ok', kind: 'validado_equipa', meeting_date: today, comment: 'Validado em reunião.', reference_date: null, recorded_by: 'u-guia', recorded_as: 'guia', recorded_at: now },
      { id: 'd2', request_id: 'r-dev', version_id: 'v-dev', kind: 'devolvido_equipa', meeting_date: today, comment: 'Falta mostrar continuidade.', reference_date: null, recorded_by: 'u-guia', recorded_as: 'guia', recorded_at: now },
      { id: 'd3', request_id: 'r-parc', version_id: 'v-r-parc', kind: 'objetivos_equipa', meeting_date: today, comment: null, reference_date: null, recorded_by: 'u-guia', recorded_as: 'guia', recorded_at: now },
      { id: 'd4', request_id: 'r-rev', version_id: 'v-r-rev', kind: 'devolvido_equipa', meeting_date: today, comment: null, reference_date: null, recorded_by: 'u-guia', recorded_as: 'guia', recorded_at: now },
    ],
    stage_requests: [],
    merit_awards: [],
    attachments: [],
  };
};

export function pioneer(): Persona {
  const c = buildCatalog();
  return {
    userId: 'u-p1',
    tables: {
      profiles: Object.values(profiles),
      memberships: memberships.filter((m) => m.id === 'm-p1' || m.function === 'dirigente' || m.team_id === 'teamA').map((m) => (m.id === 'm-p1' ? { ...m, sections: section, teams: teams[0] } : m)),
      section_settings: [{ section_id: 'sec1', historical_progress_enabled: true, updated_by: null, updated_at: now }],
      catalog_versions: [c.version],
      catalog_areas: c.areas,
      catalog_stages: c.stages,
      teams,
      notifications: [
        { id: 'n1', kind: 'decisao_equipa', title: 'Trilho a rever', body: 'Autoestima', link: '/pedidos/r-dev', read_at: null, created_at: now },
        { id: 'n2', kind: 'decisao_equipa', title: 'Trilho validado na Equipa', body: 'Desempenho', link: '/pedidos/r-ok', read_at: now, created_at: now },
        { id: 'n3', kind: 'escolha_decidida', title: 'Escolha confirmada', body: 'Autonomia', link: '/meu-progresso', read_at: now, created_at: now },
      ],
      experiences: [],
      ...progressRows(),
    },
    rpc: {
      section_path: { scope: 'proprio', total: pathMembers.length, counts, members: pathMembers.map((m) => (m.membership_id === 'm-p1' ? { ...m, is_me: true, can_open: true } : { ...m, state: null, can_open: false })) },
      my_pending_counts: { pedidos: 2 },
      section_activity: [],
    },
  };
}

export function leader(): Persona {
  const c = buildCatalog();
  const rows = progressRows();
  return {
    userId: 'u-ana',
    tables: {
      profiles: Object.values(profiles),
      memberships: memberships.map((m) => (m.id === 'm-ana' ? { ...m, sections: section, teams: null } : m)),
      section_settings: [{ section_id: 'sec1', historical_progress_enabled: true, updated_by: null, updated_at: now }],
      settings_history: [],
      membership_history: [],
      invites: [{ id: 'i1', section_id: 'sec1', code: 'AB7K9M2P', team_id: null, replaced_by: null, label: 'Pioneiros 2026/27', expires_at: new Date(Date.now() + 864e6).toISOString(), max_uses: 20, use_count: 3, revoked_at: null, created_at: now }],
      catalog_versions: [c.version],
      catalog_areas: c.areas,
      catalog_stages: c.stages,
      teams,
      notifications: [
        { id: 'nl1', kind: 'pedido_submetido', title: 'Novo pedido de validação', body: 'Pedro Teste · Descoberta', link: '/revisoes/pedido/r-obj', read_at: null, created_at: now },
        { id: 'nl2', kind: 'escolha_proposta', title: 'Nova proposta de trilho', body: 'Pedro Teste · Serviço', link: '/acompanhamento/pedidos?tipo=negociacao', read_at: null, created_at: now },
        { id: 'nl3', kind: 'comunicacao_conselho', title: 'Trilho validado na Equipa', body: 'Pedro Teste · Desempenho', link: '/acompanhamento/etapas?ver=trilhos', read_at: now, created_at: now },
        { id: 'nl4', kind: 'pedido_historico', title: 'Progresso anterior por decidir', body: 'Pedro Teste · Interação e cooperação', link: '/acompanhamento/pedidos?tipo=anterior', read_at: now, created_at: now },
      ],
      ...rows,
    },
    rpc: {
      section_path: { scope: 'seccao', total: pathMembers.length, counts, members: pathMembers },
      my_pending_counts: { negociacao: 1, trilhos: 1, anterior: 1, etapas: 0, acompanhamento: 3, gestao: 1 },
      section_activity: [
        { at: now, kind: 'validado_equipa', membership_id: 'm-p1', member: 'Pedro Teste', subject: 'Desempenho', ref: 'r-ok' },
        { at: now, kind: 'etapa_aberta', membership_id: 'm-p1', member: 'Pedro Teste', subject: 'Conhecimento', ref: 'path1' },
      ],
    },
  };
}

/** Conta criada, ainda sem secção (vai usar um convite). */
export function newUser(): Persona {
  const c = buildCatalog();
  return {
    userId: 'u-novo',
    tables: { profiles: [profiles.novo], memberships: [], catalog_versions: [c.version], catalog_areas: c.areas, catalog_stages: c.stages, notifications: [] },
    rpc: {
      invite_preview: { ok: true, section: 'Pioneiros (teste)', group: 'Agrupamento de teste', team: 'Equipa Bússola', already: false },
      join_section: { ok: true, membership_id: 'm-novo' },
    },
  };
}

/** Conta criada, com pedido de entrada pendente (ainda sem acesso aos dados da secção). */
export function pendingUser(): Persona {
  const c = buildCatalog();
  return {
    userId: 'u-novo',
    tables: {
      profiles: [profiles.novo],
      memberships: [{ ...memberships.find((m) => m.id === 'm-novo')!, requested_team_id: null, sections: section, teams: null }],
      catalog_versions: [c.version],
      catalog_areas: c.areas,
      catalog_stages: c.stages,
      notifications: [],
    },
    rpc: {
      join_team_options: teams.map((t) => ({ membership_id: 'm-novo', section_id: 'sec1', team_id: t.id, team_name: t.name })),
    },
  };
}

/** Secção grande: muitos pioneiros no mesmo marco (para o «+N»). */
export function bigLeader(): Persona {
  const p = leader();
  const extra = Array.from({ length: 9 }, (_, i) => ({
    membership_id: `m-x${i}`, full_name: `Zé Extra ${String.fromCharCode(65 + i)}`, totem: null, photo_path: null, team_id: i % 2 ? 'teamA' : 'teamB',
    function: 'pioneiro', milestone: 'conhecimento', state: 'em_curso', is_me: false,
  }));
  const members = [...pathMembers, ...extra];
  return { ...p, rpc: { ...p.rpc, section_path: { scope: 'seccao', total: members.length, counts: { ...counts, conhecimento: (counts.conhecimento ?? 0) + extra.length }, members } } };
}

export function emptyLeader(): Persona {
  const p = leader();
  return { ...p, rpc: { ...p.rpc, section_path: { scope: 'seccao', total: 0, counts: {}, members: [] }, section_activity: [] } };
}

function matches(row: Row, params: URLSearchParams) {
  for (const [k, v] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq' && String(row[k]) !== val) return false;
    if (op === 'in') {
      const list = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      if (!list.includes(String(row[k]))) return false;
    }
  }
  return true;
}

export interface MockControl {
  calls: { fn: string; body: Row }[];
  failNext: (fn: string, kind: 'network' | 'error', message?: string) => void;
}

export async function installMock(page: Page, persona: Persona): Promise<MockControl> {
  const calls: MockControl['calls'] = [];
  const failures = new Map<string, { kind: 'network' | 'error'; message?: string }>();
  const session = {
    access_token: 'token-de-teste', refresh_token: 'refresh-de-teste', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
    user: { id: persona.userId, aud: 'authenticated', role: 'authenticated', email: 'teste@exemplo.invalid', app_metadata: {}, user_metadata: {}, created_at: now },
  };
  await page.addInitScript((s) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(s));
  }, session);

  const pushEndpoints = new Set<string>();
  await page.route('http://mock.supabase.test/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p.startsWith('/auth/v1/')) {
      if (p.endsWith('/logout')) return route.fulfill({ status: 204 });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) });
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop()!;
      const body = req.postDataJSON?.() ?? {};
      const f = failures.get(fn);
      if (f) {
        failures.delete(fn);
        if (f.kind === 'network') return route.abort('internetdisconnected');
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: f.message ?? 'Erro de teste.' }) });
      }
      calls.push({ fn, body });
      const T = persona.tables;
      if (fn === 'create_trail_request') {
        if ((T.trail_requests ?? []).some((r) => r.trail_id === body.p_trail && !['recusado', 'cancelado', 'objetivos_validados'].includes(r.status))) {
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'Já existe um pedido ativo ou uma validação para este trilho.' }) });
        }
        const id = `r-novo-${(T.trail_requests ?? []).length}`;
        const key = String(body.p_trail).replace(/^t-/, '');
        T.trail_requests = [{ id, membership_id: body.p_membership, section_id: 'sec1', trail_id: body.p_trail, trail_key: key, kind: body.p_kind, status: 'rascunho', current_version: 1, approved_reference_date: null, created_at: now, updated_at: now }, ...(T.trail_requests ?? [])];
        T.trail_request_versions = [...(T.trail_request_versions ?? []), { id: `v-${id}`, request_id: id, version_no: 1, reflection: '', experiences: '', context: '', evidence: '', period_start: null, period_end: null, approximate_date: null, created_at: now, updated_at: now, submitted_at: null, withdrawn_at: null }];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(id) });
      }
      if (fn === 'save_request_draft') {
        const v = (T.trail_request_versions ?? []).find((x) => x.request_id === body.p_request && !x.submitted_at);
        if (v) Object.assign(v, { reflection: body.p_reflection, experiences: body.p_experiences, context: body.p_context ?? v.context, evidence: body.p_evidence ?? v.evidence });
      }
      if (fn === 'submit_trail_request') {
        const r = (T.trail_requests ?? []).find((x) => x.id === body.p_request);
        const v = (T.trail_request_versions ?? []).find((x) => x.request_id === body.p_request && !x.submitted_at);
        if (r) r.status = 'submetido';
        if (v) v.submitted_at = now;
      }
      const fail = (message: string) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message }) });
      const versionOf = (r: Row, no = r.current_version) => (T.trail_request_versions ?? []).find((x) => x.request_id === r.id && x.version_no === no);
      if (fn === 'submit_trail_validation') {
        const r = (T.trail_requests ?? []).find((x) => x.id === body.p_request);
        if (!r || r.status !== 'rascunho') return fail('Este pedido já foi enviado. Atualiza a página.');
        if (body.p_expected_version !== r.current_version) return fail('O pedido mudou entretanto. Atualiza a página.');
        if (!String(body.p_justification ?? '').trim()) return fail('Explica como demonstraste que alcançaste este trilho.');
        const v = versionOf(r)!;
        T.request_objectives = (T.request_objectives ?? []).filter((o) => !(o.version_id === v.id && o.decision === null));
        Object.assign(v, { evidence: body.p_justification, submitted_at: now });
        r.status = 'submetido';
      }
      if (fn === 'start_new_version') {
        const r = (T.trail_requests ?? []).find((x) => x.id === body.p_request);
        if (!r || r.status !== 'devolvido') return fail('Só pedidos devolvidos podem ter nova versão.');
        const v = versionOf(r)!;
        const nv = { ...v, id: `${v.id}-${r.current_version + 1}`, version_no: r.current_version + 1, submitted_at: null, withdrawn_at: null };
        T.trail_request_versions = [...T.trail_request_versions, nv];
        Object.assign(r, { current_version: r.current_version + 1, status: 'rascunho' });
      }
      if (fn === 'record_objectives_decision' || fn === 'submit_objectives_request') {
        return fail('A validação é feita por trilho completo.');
      }
      if (fn === 'record_team_decision') {
        const r = (T.trail_requests ?? []).find((x) => x.id === body.p_request)!;
        if (!['submetido', 'em_revisao'].includes(r.status)) return fail('Já foi registada uma decisão para este pedido. Atualiza a página.');
        const v = versionOf(r)!;
        const ok = !!body.p_validated;
        // Validado por um guia → falta a confirmação dos dirigentes.
        const asGuia = (T.memberships ?? []).find((m) => m.profile_id === persona.userId)?.function === 'guia';
        r.status = !ok ? 'devolvido' : asGuia ? 'validado_guias' : 'validado_equipa';
        T.trail_decisions = [{ id: `d-${Date.now()}`, request_id: r.id, version_id: v.id, kind: !ok ? 'devolvido_equipa' : asGuia ? 'validado_guias' : 'validado_equipa', meeting_date: body.p_meeting_date, comment: body.p_comment || null, objective_codes: body.p_objective_codes ?? null, reference_date: null, recorded_by: persona.userId, recorded_as: asGuia ? 'guia' : 'dirigente', recorded_at: now }, ...(T.trail_decisions ?? [])];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.status) });
      }
      if (fn === 'confirm_trail_validation') {
        const r = (T.trail_requests ?? []).find((x) => x.id === body.p_request)!;
        if (r.status !== 'validado_guias') return fail('Este pedido não está à espera da confirmação dos dirigentes.');
        r.status = 'validado_equipa';
        T.trail_decisions = [{ id: `d-${Date.now()}`, request_id: r.id, version_id: versionOf(r)!.id, kind: 'validado_equipa', meeting_date: now.slice(0, 10), comment: body.p_comment || null, objective_codes: null, reference_date: null, recorded_by: persona.userId, recorded_as: 'dirigente', recorded_at: now }, ...(T.trail_decisions ?? [])];
      }
      if (fn === 'remove_notifications') {
        const visible = (T.notifications ?? []).filter((n) => !n.deleted_at);
        const gone = body.p_scope === 'todas' ? visible : body.p_scope === 'lidas' ? visible.filter((n) => n.read_at) : visible.filter((n) => (body.p_ids ?? []).includes(n.id));
        for (const n of gone) n.deleted_at = now;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gone.map((n) => n.id)) });
      }
      if (fn === 'restore_notifications') {
        const back = (T.notifications ?? []).filter((n) => n.deleted_at && (body.p_ids ?? []).includes(n.id));
        for (const n of back) n.deleted_at = null;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(back.length) });
      }
      if (fn === 'mark_notifications_read') {
        for (const n of T.notifications ?? []) if (!n.read_at && (!body.p_ids || body.p_ids.includes(n.id))) n.read_at = now;
      }
      if (fn === 'save_push_subscription') pushEndpoints.add(String(body.p_endpoint));
      if (fn === 'remove_push_subscription') pushEndpoints.delete(String(body.p_endpoint));
      const result = persona.rpc && fn in persona.rpc ? persona.rpc[fn]
        : fn === 'has_push_subscription' ? pushEndpoints.has(String(body.p_endpoint))
        : fn === 'merit_eligibility' ? { validated: 1, total: 18, last_stage_concluded: false, eligible: false } : fn === 'create_invite' ? ((n: number) => `TST${n}-PQR${n}`)(calls.filter((c) => c.fn === 'create_invite').length) : null;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.replace('/rest/v1/', '');
      const rows = (persona.tables[table] ?? []).filter((r) => matches(r, url.searchParams) && !(table === 'notifications' && r.deleted_at));
      if (req.method() === 'HEAD') {
        return route.fulfill({ status: 200, headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: '' });
      }
      if (req.method() !== 'GET') {
        const posted = req.postDataJSON?.() ?? {};
        calls.push({ fn: `${req.method()} ${table}`, body: posted });
        if (req.method() === 'POST' && table === 'experiences') {
          persona.tables.experiences = [...(persona.tables.experiences ?? []), { id: `e-${Date.now()}`, created_at: now, ...posted }];
        }
        return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
      }
      const accept = req.headers()['accept'] ?? '';
      if (accept.includes('vnd.pgrst.object')) {
        if (!rows.length) return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' }) });
        return route.fulfill({ status: 200, contentType: 'application/vnd.pgrst.object+json', body: JSON.stringify(rows[0]) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    }
    if (p.startsWith('/storage/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/x' }) });
    return route.fulfill({ status: 404, body: '' });
  });

  return {
    calls,
    failNext: (fn, kind, message) => failures.set(fn, { kind, message }),
  };
}
