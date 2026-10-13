import { describe, expect, it } from 'vitest';
import { objectiveStates, progressCounts, stageChecklist, trailCategory, validatedObjectives, validationInfo } from './meuprogresso';
import type { Catalog, CatalogArea, MemberProgress, RequestObjective, StageChoice, StagePath, StageRequest, TrailDecision, TrailRequest } from './types';

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
    expect(trailCategory(t, prog({}))).toBe('por_fechar');
    expect(trailCategory(t, prog({ choices: [choice('F1')] }))).toBe('por_fechar'); // escolher não é começar nem fechar
    expect(trailCategory(t, prog({ requests: [req('F1', 'rascunho')] }))).toBe('por_fechar');
    expect(trailCategory(t, prog({ requests: [req('F1', 'submetido')] }))).toBe('em_validacao');
    expect(trailCategory(t, prog({ requests: [req('F1', 'devolvido')] }))).toBe('a_rever');
    expect(trailCategory(t, prog({ requests: [req('F1', 'objetivos_validados')] }))).toBe('por_fechar'); // parte dos objetivos não fecha o trilho
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
  it('a rever e em validação', () => {
    const c = progressCounts(catalog, prog({ choices: [choice('F1'), choice('A1')], requests: [req('A1', 'submetido'), req('C1', 'devolvido')] }));
    expect(c.toReview).toBe(1); // C1 devolvido: a rever
    expect(c.inValidation).toBe(1);
  });
});

describe('objetivos', () => {
  const t = { ...catalog.trailByKey.get('F1')!, catalog_objectives: [
    { id: 'o2', trail_id: 't-F1', code: 'F2', text: 'Aceito-me', position: 1, pending_note: null },
    { id: 'o3', trail_id: 't-F1', code: 'F3', text: 'Respeito', position: 2, pending_note: null },
  ] };
  const row = (request: string, objective: string, version: number, decision: RequestObjective['decision'], comment: string | null = null): RequestObjective => ({
    id: `${request}-${objective}-${version}`, request_id: request, version_id: `${request}-v${version}`, objective_id: objective, objective_code: objective === 'o2' ? 'F2' : 'F3',
    decision, comment, decided_at: decision ? '2026-03-01T10:00:00Z' : null, version_no: version,
  });
  const r = (id: string, status: TrailRequest['status'], v = 1): TrailRequest => ({ ...req('F1', status), id, current_version: v });
  const st = (p: MemberProgress) => Object.fromEntries([...objectiveStates(t, p)].map(([k, v]) => [k, v.state]));

  it('sem pedido: todos por validar', () => {
    expect(st(prog({}))).toEqual({ o2: 'disponivel', o3: 'disponivel' });
  });
  it('seleção parcial em validação', () => {
    expect(st(prog({ requests: [r('a', 'submetido')], objectives: [row('a', 'o2', 1, null)] }))).toEqual({ o2: 'em_validacao', o3: 'disponivel' });
  });
  it('validação parcial não fecha o trilho; o objetivo aceite fica validado', () => {
    const p = prog({ requests: [r('a', 'objetivos_validados')], objectives: [row('a', 'o2', 1, 'aceite')] });
    expect(st(p)).toEqual({ o2: 'validado', o3: 'disponivel' });
    expect(trailCategory(t, p)).toBe('por_fechar');
    expect(validatedObjectives(t, p)).toBe(1);
  });
  it('a rever mostra o comentário e mantém o aceite; no rascunho de correção continua a rever', () => {
    const p = prog({ requests: [r('a', 'devolvido')], objectives: [row('a', 'o2', 1, 'aceite'), row('a', 'o3', 1, 'rever', 'Falta um exemplo')] });
    expect(st(p)).toEqual({ o2: 'validado', o3: 'a_rever' });
    expect(objectiveStates(t, p).get('o3')?.comment).toBe('Falta um exemplo');
    const draft = prog({ requests: [r('a', 'rascunho', 2)], objectives: [row('a', 'o2', 1, 'aceite'), row('a', 'o3', 1, 'rever', 'Falta um exemplo'), row('a', 'o3', 2, null)] });
    expect(st(draft)).toEqual({ o2: 'validado', o3: 'a_rever' });
  });
  it('pedidos antigos por trilho aplicam o estado do pedido a todos os objetivos', () => {
    expect(st(prog({ requests: [r('a', 'submetido')] }))).toEqual({ o2: 'em_validacao', o3: 'em_validacao' });
    expect(st(prog({ requests: [r('a', 'validado_equipa')] }))).toEqual({ o2: 'validado', o3: 'validado' });
  });
  it('pedidos cancelados não contam', () => {
    expect(st(prog({ requests: [r('a', 'cancelado')], objectives: [row('a', 'o2', 1, null)] }))).toEqual({ o2: 'disponivel', o3: 'disponivel' });
  });
});
