import { describe, expect, it } from 'vitest';
import { areaMarkers, memberPosition, MILESTONES, stageCycle, stageNeeds } from './caminho';
import { stageSummary } from './progress';
import type { Catalog, CatalogArea, MemberProgress, StageChoice, StagePath, StageRequest, TrailRequest } from './types';

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
  versionId: 'v', label: 't', areas,
  stages: ['desprendimento', 'conhecimento', 'vontade', 'construcao'].map((key, i) => ({ id: `s${i}`, version_id: 'v', key, name: key, kind: i ? 'progresso' : 'adesao', ordinal: i, source_page: 9, summary: null })),
  trailById: new Map(trails.map((t) => [t.id, t])), trailByKey: new Map(trails.map((t) => [t.key, t])), areaById: new Map(areas.map((a) => [a.id, a])),
};
const mkPath = (key: string, ord: number, status: StagePath['status'] = 'em_curso', recognized: string | null = null): StagePath => ({
  id: `p-${key}`, membership_id: 'm', stage_id: `s${ord}`, stage_key: key, stage_ordinal: ord, status, opened_at: '', insignia_delivered_on: '2026-01-01',
  completed_on: status === 'concluida' ? '2026-03-01' : null, completion_kind: status === 'concluida' ? 'normal' : null, recognized_on: recognized, recognition_note: null,
});
const choice = (path: string, key: string, status: StageChoice['status'] = 'confirmada'): StageChoice => ({
  id: `c-${path}-${key}`, stage_path_id: path, membership_id: 'm', trail_id: `t-${key}`, trail_key: key, area_code: key[0], status, planned_opportunities: null,
  replaces_choice_id: null, proposed_by: 'u', proposed_at: '', decided_by: null, decided_at: null, decision_comment: null,
});
const req = (key: string, status: TrailRequest['status'], kind: TrailRequest['kind'] = 'normal'): TrailRequest => ({
  id: `r-${key}`, membership_id: 'm', section_id: 's', trail_id: `t-${key}`, trail_key: key, kind, status, current_version: 1, approved_reference_date: null, created_at: '', updated_at: '',
});
const adh = { membership_id: 'm', decided_on: '2026-01-01', commitment_on: '2026-01-10', notes: null, is_historical: false, recorded_at: '' };
const prog = (o: Partial<MemberProgress>): MemberProgress => ({ adhesion: adh, paths: [], choices: [], requests: [], stageRequests: [], merit: null, ...o });

describe('marcos do caminho (pp. 3 e 14)', () => {
  it('tem os oito momentos pela ordem do manual', () => {
    expect(MILESTONES.map((m) => m.key)).toEqual(['sinais_pista', 'inicio_pista', 'promessa', 'conhecimento', 'vontade', 'construcao', 'acampamento', 'passagem']);
    expect(MILESTONES.filter((m) => !m.tracked).map((m) => m.key)).toEqual(['sinais_pista', 'passagem']);
  });
});

describe('posição: estar em vs ter concluído', () => {
  it('Início de Pista e Promessa', () => {
    expect(memberPosition(prog({ adhesion: null }), catalog)).toEqual({ milestone: 'inicio_pista', state: 'em_adesao' });
    expect(memberPosition(prog({ adhesion: { ...adh, decided_on: null, profile_traced_on: '2026-01-01' } }), catalog)).toEqual({ milestone: 'inicio_pista', state: 'perfil_tracado' });
    expect(memberPosition(prog({ adhesion: { ...adh, commitment_on: null } }), catalog)).toEqual({ milestone: 'promessa', state: 'aguarda_promessa' });
    expect(memberPosition(prog({}), catalog)).toEqual({ milestone: 'promessa', state: 'aguarda_etapa' });
  });

  it('em Conhecimento, requisitos cumpridos, em validação e concluída', () => {
    const p = mkPath('conhecimento', 1);
    const chosen = codes.map((c) => choice(p.id, `${c}1`));
    expect(memberPosition(prog({ paths: [p], choices: chosen }), catalog)).toEqual({ milestone: 'conhecimento', state: 'em_curso' });
    const all = codes.map((c) => req(`${c}1`, 'validado_equipa'));
    expect(memberPosition(prog({ paths: [p], choices: chosen, requests: all }), catalog).state).toBe('requisitos_cumpridos');
    const sr: StageRequest = { id: 'sr', stage_path_id: p.id, membership_id: 'm', kind: 'normal', status: 'decidido_conselho', requested_at: '', council_decision: 'favoravel', council_date: null, council_comment: null, final_opinion: null, final_date: null, final_comment: null };
    expect(memberPosition(prog({ paths: [p], choices: chosen, requests: all, stageRequests: [sr] }), catalog).state).toBe('em_validacao');
    expect(memberPosition(prog({ paths: [mkPath('conhecimento', 1, 'concluida')] }), catalog)).toEqual({ milestone: 'conhecimento', state: 'concluida' });
    expect(memberPosition(prog({ paths: [mkPath('conhecimento', 1, 'concluida', '2026-04-01')] }), catalog).state).toBe('reconhecida');
  });

  it('compatibilidade: etapa aberta antes de haver Promessa registada continua na etapa', () => {
    expect(memberPosition(prog({ adhesion: { ...adh, commitment_on: null }, paths: [mkPath('conhecimento', 1)] }), catalog).milestone).toBe('conhecimento');
  });

  it('seis trilhos validados quaisquer não cumprem a etapa', () => {
    const p = mkPath('conhecimento', 1);
    const sixInTwoAreas = ['F1', 'F2', 'F3', 'A1', 'A2', 'A3'].map((k) => req(k, 'validado_equipa'));
    expect(memberPosition(prog({ paths: [p], requests: sixInTwoAreas }), catalog).state).toBe('em_curso');
  });

  it('Acampamento depois da Construção; a anilha é um registo à parte', () => {
    const paths = [mkPath('conhecimento', 1, 'concluida'), mkPath('vontade', 2, 'concluida'), mkPath('construcao', 3, 'concluida')];
    expect(memberPosition(prog({ paths }), catalog)).toEqual({ milestone: 'acampamento', state: 'etapas_concluidas' });
    expect(memberPosition(prog({ paths, merit: { membership_id: 'm', awarded_on: '', kind: 'normal', comment: null, recorded_at: '' } }), catalog).state).toBe('anilha_atribuida');
  });
});

describe('o que falta, por área FACEIS', () => {
  it('produz frases concretas e separa decisões pendentes', () => {
    const p = mkPath('conhecimento', 1);
    const progress = prog({
      paths: [p],
      choices: [choice(p.id, 'F1'), choice(p.id, 'A1'), choice(p.id, 'C1'), choice(p.id, 'S1'), choice(p.id, 'I1', 'proposta')],
      requests: [req('F1', 'validado_equipa'), req('A1', 'submetido'), req('C1', 'devolvido')],
    });
    const n = stageNeeds(stageSummary(p, catalog, progress), progress);
    expect(n.todo).toBe('Falta escolher o trilho da área Espiritual, desenvolver e pedir a validação do trilho escolhido da área Social e rever o pedido devolvido da área Caráter.');
    expect(n.waiting).toBe('Aguarda a negociação do trilho proposto da área Intelectual e a decisão da reunião de Equipa sobre o trilho da área Afetivo.');
    expect(n.done).toEqual(['Trilho F1 (Físico)']);
  });

  it('ciclo da etapa: escolha → oportunidades → validação → reconhecimento', () => {
    const p = mkPath('conhecimento', 1);
    const progress = prog({ paths: [p], choices: codes.map((c) => choice(p.id, `${c}1`)), requests: [req('F1', 'validado_equipa')] });
    const c = stageCycle(stageSummary(p, catalog, progress), 6);
    expect(c.map((x) => x.status)).toEqual(['feito', 'atual', 'por_fazer', 'por_fazer']);
    expect(stageCycle(null, 6).every((x) => x.status === 'por_fazer')).toBe(true);
  });

  it('marcos acumulados por área contam trilhos reconhecidos na negociação, sem duplicar', () => {
    const progress = prog({ requests: [req('F1', 'aprovado', 'negociacao'), req('F2', 'validado_equipa'), req('A1', 'submetido', 'historico')] });
    const m = areaMarkers(progress, catalog);
    expect(m.find((x) => x.code === 'F')?.validated).toBe(2);
    expect(m.find((x) => x.code === 'A')?.validated).toBe(0); // pendente não conta
  });
});
