import { describe, expect, it } from 'vitest';
import { progressCounts, stageChecklist, trailCategory, validationInfo } from './meuprogresso';
import type { Catalog, CatalogArea, MemberProgress, StageChoice, StagePath, StageRequest, TrailDecision, TrailRequest } from './types';

const names: Record<string, string> = { F: 'Físico', A: 'Afetivo', C: 'Caráter', E: 'Espiritual', I: 'Intelectual', S: 'Social' };
const codes = Object.keys(names);
const areas: CatalogArea[] = codes.map((code, i) => ({
  id: `a-${code}`, version_id: 'v', code, name: names[code], full_name: names[code], dimension: null, position: i + 1, source_page: 41,
  catalog_trails: [1, 2, 3].map((n) => ({
    id: `t-${code}${n}`, version_id: 'v', area_id: `a-${code}`, key: `${code}${n}`, name: `Trilho ${code}${n}`, position: n,
    source_page: 41, framing: '', keywords: [], opportunities: [], pending_note: null, catalog_objectives: [],
  })),
}));
const trails = areas.flatMap((a) => a.catalog_trails);
const catalog: Catalog = {
  versionId: 'v', label: 't', areas, stages: [],
  trailById: new Map(trails.map((t) => [t.id, t])), trailByKey: new Map(trails.map((t) => [t.key, t])), areaById: new Map(areas.map((a) => [a.id, a])),
};
const path = (status: StagePath['status'] = 'em_curso', recognized: string | null = null): StagePath => ({
  id: 'p1', membership_id: 'm', stage_id: 's1', stage_key: 'conhecimento', stage_ordinal: 1, status, opened_at: '', insignia_delivered_on: '2026-01-01',
  completed_on: status === 'concluida' ? '2026-04-01' : null, completion_kind: null, recognized_on: recognized, recognition_note: null,
});
const choice = (key: string, status: StageChoice['status'] = 'confirmada'): StageChoice => ({
  id: `c-${key}`, stage_path_id: 'p1', membership_id: 'm', trail_id: `t-${key}`, trail_key: key, area_code: key[0], status, planned_opportunities: null,
  replaces_choice_id: null, proposed_by: 'u', proposed_at: '', decided_by: null, decided_at: null, decision_comment: null,
});
const req = (key: string, status: TrailRequest['status'], kind: TrailRequest['kind'] = 'normal'): TrailRequest => ({
  id: `r-${key}`, membership_id: 'm', section_id: 's', trail_id: `t-${key}`, trail_key: key, kind, status, current_version: 1, approved_reference_date: null, created_at: '', updated_at: '2026-02-02',
});
const sr = (status: StageRequest['status']): StageRequest => ({ id: 'sr', stage_path_id: 'p1', membership_id: 'm', kind: 'normal', status, requested_at: '', council_decision: null, council_date: null, council_comment: null, final_opinion: null, final_date: null, final_comment: null });
const prog = (o: Partial<MemberProgress>): MemberProgress => ({ adhesion: null, paths: [path()], choices: [], requests: [], stageRequests: [], merit: null, ...o });
const all6 = codes.map((c) => choice(`${c}1`));
const valid6 = codes.map((c) => req(`${c}1`, 'validado_equipa'));

describe('categorias dos filtros', () => {
  it('submeter não é concluir; só a decisão valida', () => {
    const t = catalog.trailByKey.get('F1')!;
    expect(trailCategory(t, prog({}))).toBe('por_iniciar');
    expect(trailCategory(t, prog({}), { F1: 1 })).toBe('em_desenvolvimento'); // vivência registada
    expect(trailCategory(t, prog({ choices: [choice('F1')] }))).toBe('em_desenvolvimento');
    expect(trailCategory(t, prog({ requests: [req('F1', 'rascunho')] }))).toBe('em_desenvolvimento');
    expect(trailCategory(t, prog({ requests: [req('F1', 'submetido')] }))).toBe('aguarda');
    expect(trailCategory(t, prog({ requests: [req('F1', 'devolvido')] }))).toBe('revisao');
    expect(trailCategory(t, prog({ requests: [req('F1', 'validado_equipa')] }))).toBe('validado');
    expect(trailCategory(t, prog({ requests: [req('F1', 'aprovado', 'negociacao')] }))).toBe('validado');
  });

  it('informação de validação com a data da reunião', () => {
    const d: TrailDecision = { id: 'd', request_id: 'r-F1', version_id: 'v', kind: 'validado_equipa', meeting_date: '2026-03-05', comment: null, reference_date: null, recorded_by: 'g', recorded_as: 'guia', recorded_at: '2026-03-06T10:00:00Z' };
    expect(validationInfo(req('F1', 'validado_equipa'), [d])).toEqual({ date: '2026-03-05', label: 'Validado na reunião de Equipa' });
    expect(validationInfo(req('F1', 'submetido'), [d])).toBeNull();
  });
});

describe('checklist da etapa com mensagens concretas', () => {
  it('falta validar e escolher, por área', () => {
    const c = stageChecklist(catalog, prog({ choices: all6.filter((x) => x.area_code !== 'E'), requests: valid6.filter((r) => !['S1', 'E1'].includes(r.trail_key)) }))!;
    expect(c.details).toContain('Falta escolher o trilho de Espiritual.');
    expect(c.details).toContain('Falta validar o trilho de Social.');
    expect(c.rows.find((r) => r.area.code === 'F')?.status).toBe('validado');
    expect(c.stageValidation).toBe('nao_disponivel');
  });

  it('distingue submetido e precisa de revisão', () => {
    const c = stageChecklist(catalog, prog({ choices: all6, requests: [...valid6.slice(0, 4), req('I1', 'submetido'), req('S1', 'devolvido')] }))!;
    expect(c.rows.find((r) => r.area.code === 'I')?.status).toBe('submetido');
    expect(c.rows.find((r) => r.area.code === 'S')?.status).toBe('revisao');
    expect(c.details).toContain('O trilho de Social precisa de revisão.');
  });

  it('seis validados: aguarda o Conselho de Guias; depois a opinião final; depois o reconhecimento', () => {
    expect(stageChecklist(catalog, prog({ choices: all6, requests: valid6 }))!.headline).toBe('Os seis trilhos estão validados; falta pedir a validação da etapa ao Conselho de Guias.');
    expect(stageChecklist(catalog, prog({ choices: all6, requests: valid6, stageRequests: [sr('submetido')] }))!.headline).toBe('Os seis trilhos estão validados; a etapa aguarda o Conselho de Guias.');
    expect(stageChecklist(catalog, prog({ choices: all6, requests: valid6, stageRequests: [sr('decidido_conselho')] }))!.stageValidation).toBe('opiniao_final');
    const done = stageChecklist(catalog, prog({ paths: [path('concluida')], choices: all6, requests: valid6 }))!;
    expect(done.recognition).toBe('pendente');
    expect(done.headline).toBe('Etapa concluída; falta o reconhecimento público.');
    expect(stageChecklist(catalog, prog({ paths: [path('concluida', '2026-05-01')], choices: all6, requests: valid6 }))!.recognition).toBe('realizado');
  });

  it('seis trilhos validados de outras áreas não fecham a etapa', () => {
    const c = stageChecklist(catalog, prog({ choices: [choice('F1')], requests: ['F1', 'F2', 'F3', 'A1', 'A2', 'A3'].map((k) => req(k, 'validado_equipa')) }))!;
    expect(c.stageValidation).toBe('nao_disponivel');
    expect(c.rows.filter((r) => r.status === 'validado')).toHaveLength(1);
  });
});

describe('histórico reconhecido vs. etapa atual', () => {
  it('seis trilhos reconhecidos antes, nenhum associado à etapa: contadores separados e explicáveis', () => {
    const hist = codes.map((c) => req(`${c}2`, 'aprovado', 'historico'));
    const c = progressCounts(catalog, prog({ requests: hist }));
    expect(c.validated).toBe(6);
    expect(c.recognized).toBe(6);
    expect(c.unassigned.map((t) => t.key)).toEqual(codes.map((x) => `${x}2`));
    expect(c.stage).toMatchObject({ validated: 0, confirmed: 0, areas: 6 }); // a etapa só conta os trilhos confirmados nela
  });
  it('depois de confirmados na negociação, passam a contar na etapa e deixam de estar por associar', () => {
    const hist = codes.map((c) => req(`${c}2`, 'aprovado', 'historico'));
    const c = progressCounts(catalog, prog({ requests: hist, choices: codes.map((x) => choice(`${x}2`)) }));
    expect(c.unassigned).toHaveLength(0);
    expect(c.stage).toMatchObject({ validated: 6, confirmed: 6 });
  });
  it('em desenvolvimento e em validação', () => {
    const c = progressCounts(catalog, prog({ choices: [choice('F1'), choice('A1')], requests: [req('A1', 'submetido'), req('C1', 'devolvido')] }));
    expect(c.inDevelopment).toBe(1); // F1 escolhido (C1 devolvido conta como «precisa de revisão»)
    expect(c.inValidation).toBe(1);
  });
});
