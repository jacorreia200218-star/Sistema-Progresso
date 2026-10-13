// Peças do Caminho partilhadas entre a tab Caminho e o Meu progresso.
import {
  ADHESION_KNOWLEDGE, memberPosition, MILESTONES, milestoneByKey, stageStatusFor, STATE_LABEL,
  type MilestoneKey, type PositionState,
} from '../../lib/caminho';
import type { Catalog, MemberProgress } from '../../lib/types';
import type { TrackStep } from './Track';

const KEYS = MILESTONES.map((m) => m.key);

export function shortState(state: PositionState): string {
  const map: Partial<Record<PositionState, string>> = {
    em_adesao: 'Em adesão', perfil_tracado: 'Perfil traçado', aguarda_promessa: 'Aguarda Promessa', aguarda_etapa: 'Promessa feita',
    em_curso: 'Em curso', requisitos_cumpridos: 'Requisitos cumpridos', em_validacao: 'Em validação',
    concluida: 'Concluída', reconhecida: 'Reconhecida', etapas_concluidas: 'Etapas concluídas', anilha_atribuida: 'Anilha atribuída',
  };
  return map[state] ?? STATE_LABEL[state].label;
}

/** Estado de cada marco no percurso de uma pessoa (concluído, atual, por vir). */
export function personalSteps(p: MemberProgress, catalog: Catalog, self: boolean): Record<MilestoneKey, TrackStep> {
  const pos = memberPosition(p, catalog);
  const idx = KEYS.indexOf(pos.milestone);
  const out = {} as Record<MilestoneKey, TrackStep>;
  MILESTONES.forEach((m, i) => {
    const stage = ['conhecimento', 'vontade', 'construcao'].includes(m.key) ? stageStatusFor(m.key, p, catalog) : null;
    if (!m.tracked) out[m.key] = { status: 'info', caption: m.key === 'passagem' ? 'Idade e maturidade' : 'Antes de entrar' };
    else if (i === idx) out[m.key] = { status: 'atual', caption: `${self ? 'Estás aqui' : 'Está aqui'} · ${shortState(pos.state)}` };
    else if (i < idx) out[m.key] = { status: 'feito', caption: stage && stage.state !== 'nao_iniciada' ? shortState(stage.state as PositionState) : 'Feito' };
    else out[m.key] = { status: 'por_vir', caption: 'Por vir' };
  });
  return out;
}

export function MilestoneInfo({ k }: { k: MilestoneKey }) {
  const m = milestoneByKey[k];
  return (
    <div className="stack">
      <p>{m.summary}</p>
      <div className="grid-2">
        <div>
          <h4>O que é necessário</h4>
          <ul className="tight">{m.needed.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
        <div>
          <h4>Como se valida</h4>
          <p>{m.validation}</p>
          <h4>O que permite avançar</h4>
          <p>{m.advance}</p>
        </div>
      </div>
      {k === 'inicio_pista' && (
        <details className="card flat">
          <summary>Conhecimentos de adesão da III Secção (p. 6)</summary>
          <h4>Adesão ao movimento</h4>
          <ul className="tight">{ADHESION_KNOWLEDGE.movimento.map((x) => <li key={x}>{x}</li>)}</ul>
          <h4>Adesão à secção</h4>
          <ul className="tight">{ADHESION_KNOWLEDGE.seccao.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="faint">{ADHESION_KNOWLEDGE.nota}</p>
        </details>
      )}
      {m.note && <p className="faint">{m.note}</p>}
      <p className="faint">Manual do Dirigente, {m.pages}.</p>
    </div>
  );
}

