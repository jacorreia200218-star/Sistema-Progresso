import { describe, expect, it } from 'vitest';
import { nextAction, stageSummary, trailState, validatedKeys } from './progress';
import { errorMessage } from './errors';
import type { Catalog, CatalogArea, CatalogTrail, MemberProgress, StageChoice, StagePath, TrailRequest } from './types';

// Catálogo mínimo com 6 áreas × 3 trilhos (estrutura igual à do manual).
const codes = ['F', 'A', 'C', 'E', 'I', 'S'];
const areas: CatalogArea[] = codes.map((code, i) => ({
  id: `a-${code}`, version_id: 'v', code, name: code, full_name: code, dimension: null, position: i + 1, source_page: 41,
  catalog_trails: [1, 2, 3].map((n) => ({
    id: `t-${code}${n}`, version_id: 'v', area_id: `a-${code}`, key: `${code}${n}`, name: `Trilho ${code}${n}`, position: n,
    source_page: 41, framing: '', keywords: [], opportunities: [], pending_note: null, catalog_objectives: [],
  })),
}));
const trails = areas.flatMap((a) => a.catalog_trails);
const catalog: Catalog = {
  versionId: 'v', label: 'teste', areas,
  stages: [
    { id: 's0', version_id: 'v', key: 'desprendimento', name: 'Desprendimento', kind: 'adesao', ordinal: 0, source_page: 6, summary: null },
    { id: 's1', version_id: 'v', key: 'conhecimento', name: 'Conhecimento', kind: 'progresso', ordinal: 1, source_page: 9, summary: null },
    { id: 's2', version_id: 'v', key: 'vontade', name: 'Vontade', kind: 'progresso', ordinal: 2, source_page: 9, summary: null },
    { id: 's3', version_id: 'v', key: 'construcao', name: 'Construção', kind: 'progresso', ordinal: 3, source_page: 9, summary: null },
  ],
  trailById: new Map(trails.map((t) => [t.id, t])),
  trailByKey: new Map(trails.map((t) => [t.key, t])),
  areaById: new Map(areas.map((a) => [a.id, a])),
};
const trail = (key: string) => catalog.trailByKey.get(key) as CatalogTrail;

const path: StagePath = {
  id: 'p1', membership_id: 'm', stage_id: 's1', stage_key: 'conhecimento', stage_ordinal: 1, status: 'em_curso', opened_at: '2026-01-01',
  insignia_delivered_on: '2026-01-01', completed_on: null, completion_kind: null, recognized_on: null, recognition_note: null,
};
const choice = (key: string, status: StageChoice['status'] = 'confirmada'): StageChoice => ({
  id: `c-${key}-${status}`, stage_path_id: 'p1', membership_id: 'm', trail_id: `t-${key}`, trail_key: key, area_code: key[0], status,
  planned_opportunities: null, replaces_choice_id: null, proposed_by: 'u', proposed_at: '2026-01-02', decided_by: null, decided_at: null, decision_comment: null,
});
const request = (key: string, status: TrailRequest['status'], kind: TrailRequest['kind'] = 'normal'): TrailRequest => ({
  id: `r-${key}-${status}`, membership_id: 'm', section_id: 's', trail_id: `t-${key}`, trail_key: key, kind, status, current_version: 1,
  approved_reference_date: null, created_at: '2026-01-03', updated_at: '2026-01-03',
});
const base = (over: Partial<MemberProgress> = {}): MemberProgress => ({
  adhesion: { membership_id: 'm', decided_on: '2025-12-01', commitment_on: '2025-12-10', notes: null, is_historical: false, recorded_at: '' },
  paths: [path], choices: [], requests: [], stageRequests: [], merit: null, ...over,
});

describe('estado de cada trilho', () => {
  it('distingue por trabalhar, proposto, selecionado, rascunho, pendente, devolvido e validado', () => {
    expect(trailState(trail('F1'), base()).state).toBe('por_trabalhar');
    expect(trailState(trail('F1'), base({ choices: [choice('F1', 'proposta')] })).state).toBe('proposto');
    expect(trailState(trail('F1'), base({ choices: [choice('F1')] })).state).toBe('selecionado');
    expect(trailState(trail('F1'), base({ requests: [request('F1', 'rascunho')] })).state).toBe('rascunho');
    expect(trailState(trail('F1'), base({ requests: [request('F1', 'em_revisao')] })).state).toBe('pendente');
    expect(trailState(trail('F1'), base({ requests: [request('F1', 'devolvido')] })).state).toBe('devolvido');
    expect(trailState(trail('F1'), base({ requests: [request('F1', 'validado_equipa')] })).state).toBe('validado');
    expect(trailState(trail('F1'), base({ requests: [request('F1', 'aprovado', 'historico')] })).state).toBe('validado');
  });

  it('progresso anterior pendente ou recusado não conta como validado', () => {
    expect(trailState(trail('F1'), base({ requests: [request('F1', 'submetido', 'historico')] })).state).toBe('pendente');
    expect(trailState(trail('F1'), base({ requests: [request('F1', 'recusado', 'historico')] })).state).toBe('por_trabalhar');
    expect(validatedKeys([request('F1', 'submetido', 'historico'), request('A1', 'recusado', 'historico')]).size).toBe(0);
  });

  it('o mesmo trilho nunca conta duas vezes', () => {
    expect(validatedKeys([request('F1', 'aprovado', 'historico'), request('F1', 'validado_equipa')]).size).toBe(1);
  });
});

describe('percurso da etapa', () => {
  it('a etapa só fica pronta com um trilho confirmado e validado em cada área', () => {
    const all = codes.map((c) => choice(`${c}1`));
    const almost = base({ choices: all, requests: codes.slice(0, 5).map((c) => request(`${c}1`, 'validado_equipa')) });
    expect(stageSummary(path, catalog, almost).ready).toBe(false);
    const full = base({ choices: all, requests: codes.map((c) => request(`${c}1`, 'validado_equipa')) });
    const s = stageSummary(path, catalog, full);
    expect(s.ready).toBe(true);
    expect(s.validatedCount).toBe(6);
  });

  it('trilhos validados que não foram atribuídos à etapa não contam para ela', () => {
    const p = base({ choices: [choice('F1')], requests: [request('F2', 'validado_equipa'), request('F1', 'validado_equipa')] });
    expect(stageSummary(path, catalog, p).validatedCount).toBe(1);
  });

  it('não fica pronta com pedido de validação da etapa em curso', () => {
    const p = base({
      choices: codes.map((c) => choice(`${c}1`)),
      requests: codes.map((c) => request(`${c}1`, 'validado_equipa')),
      stageRequests: [{ id: 'sr', stage_path_id: 'p1', membership_id: 'm', kind: 'normal', status: 'submetido', requested_at: '2026-02-01', council_decision: null, council_date: null, council_comment: null, final_opinion: null, final_date: null, final_comment: null }],
    });
    const s = stageSummary(path, catalog, p);
    expect(s.ready).toBe(false);
    expect(s.openRequest?.status).toBe('submetido');
  });
});

describe('próxima ação', () => {
  it('prioriza pedidos devolvidos e depois rascunhos', () => {
    expect(nextAction(catalog, base({ requests: [request('F1', 'rascunho'), request('A1', 'devolvido')] })).to).toBe('/meu-progresso/trilho/A1#pedido');
    expect(nextAction(catalog, base({ requests: [request('F1', 'rascunho')] })).to).toBe('/meu-progresso/trilho/F1#pedido');
  });
  it('sem adesão, orienta para o Desprendimento', () => {
    expect(nextAction(catalog, base({ adhesion: null, paths: [] })).title).toContain('Início de Pista');
  });
  it('indica a área ainda sem escolha', () => {
    expect(nextAction(catalog, base()).title).toBe('Escolher um trilho de F');
  });
});

describe('mensagens de erro', () => {
  it('falhas de rede não dão falsa confirmação', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/nada foi guardado/);
  });
  it('mantém mensagens do servidor em português', () => {
    expect(errorMessage({ message: 'Já existe um pedido ativo ou uma validação para este trilho.' })).toContain('Já existe');
  });
  it('não expõe mensagens técnicas em inglês', () => {
    expect(errorMessage({ message: 'duplicate key value violates unique constraint' })).toMatch(/Ocorreu um erro/);
  });
});

describe('estado no painel da etapa', () => {
  it('mostra o estado do pedido do trilho escolhido (ex.: devolvido)', () => {
    const p = base({ choices: [choice('A1')], requests: [request('A1', 'devolvido')] });
    expect(stageSummary(path, catalog, p).slots.find((s) => s.area.code === 'A')?.state).toBe('devolvido');
  });
});
